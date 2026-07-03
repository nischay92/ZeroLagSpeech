const path = require("path");
// Resolve .env relative to this file, not process.cwd() — the working
// directory isn't guaranteed when Tauri spawns this as a sidecar process.
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const express = require("express");
const { WebSocketServer } = require("ws");

const db = require("./db");
const cerebras = require("./cerebras");
const deepgram = require("./stt/deepgram");
const elevenlabs = require("./stt/elevenlabs");

for (const key of ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY", "CEREBRAS_API_KEY"]) {
  if (!process.env[key]) {
    console.warn(`Warning: ${key} is not set in .env — related features will fail.`);
  }
}

const PORT = process.env.SIDECAR_PORT || 43110;
const HOST = "127.0.0.1"; // loopback only, per docs/sidecar-protocol.md
const TICK_INTERVAL_MS = 6000;
const CEREBRAS_TIMEOUT_MS = 12000;
const RATE_LIMIT_COOLDOWN_MS = 45000;
const CONTEXT_CHAR_LIMIT = 3000; // caps per-call token usage regardless of session length

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    ),
  ]);
}

function isRateLimitError(err) {
  const msg = String((err && err.message) || err);
  return err?.status === 429 || /429|rate limit/i.test(msg);
}

// Cerebras returns a `retry-after` header with 429s telling us exactly how
// long the tokens/min bucket needs to refill — honor that instead of
// guessing a fixed cooldown, since the actual limit varies by account/tier.
function cooldownMsFor(err) {
  const retryAfter = Number(err?.headers?.["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
  return RATE_LIMIT_COOLDOWN_MS;
}

const app = express();

// Loopback-only dev server: the desktop UI is served from a different
// origin (Vite on localhost:1420, or a tauri:// origin once packaged), so
// REST calls need CORS enabled. No cookies/credentials are involved.
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    providers: {
      deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
      elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
      cerebras: Boolean(process.env.CEREBRAS_API_KEY),
    },
  });
});

app.get("/sessions", (req, res) => {
  res.json(db.listSessions());
});

app.get("/sessions/:session_id", (req, res) => {
  const session = db.getSession(req.params.session_id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  res.json(session);
});

app.post("/sessions/:session_id/ask", async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: "question is required" });
  const session = db.getSession(req.params.session_id);
  if (!session) return res.status(404).json({ error: "Session not found" });
  try {
    const transcript = db.getTranscriptText(req.params.session_id).slice(-CONTEXT_CHAR_LIMIT);
    const answer = await cerebras.answerQuestion(transcript, question);
    db.addQa(req.params.session_id, question, answer, "manual");
    res.json({ answer });
  } catch (err) {
    console.error("Cerebras answerQuestion failed:", err);
    res.status(500).json({ error: "Failed to get answer from Cerebras" });
  }
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Sidecar listening on http://${HOST}:${PORT}`);
});

// ws's `path` option only does exact string matching, not patterns, so the
// /ws/session/{session_id} path (with a variable segment) is matched manually.
const SESSION_PATH_RE = /^\/ws\/session\/([^/]+)$/;
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  if (!SESSION_PATH_RE.test(url.pathname)) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (browserWs, req) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const sessionId = SESSION_PATH_RE.exec(url.pathname)[1];
  const provider = url.searchParams.get("provider") === "elevenlabs" ? "elevenlabs" : "deepgram";
  const providerModule = provider === "elevenlabs" ? elevenlabs : deepgram;

  db.createSession(sessionId, provider);
  console.log(`[session ${sessionId}] started (${provider})`);

  let sequence = 0;
  const sendEvent = (event, data) => {
    if (browserWs.readyState !== browserWs.OPEN) return;
    sequence += 1;
    browserWs.send(
      JSON.stringify({
        event,
        session_id: sessionId,
        sequence,
        timestamp: new Date().toISOString(),
        data,
      })
    );
  };

  let buffer = "";
  let latestInterim = "";
  let pendingQuestionText = "";
  let previousSummary = "";
  let summarizedUpToLength = 0;
  let closed = false;
  let ticking = false;
  let cooldownUntil = 0;

  const upstream = providerModule.connect({
    onOpen() {
      sendEvent("session.connected", { provider });
    },
    onTranscript({ type, text }) {
      sendEvent("transcript.segment", { text, is_final: type === "final" });
      if (type === "final") {
        buffer += (buffer ? " " : "") + text;
        pendingQuestionText += (pendingQuestionText ? " " : "") + text;
        latestInterim = "";
        db.addTranscript(sessionId, text);
        console.log(`[session ${sessionId}] final: "${text}" (buffer is now ${buffer.length} chars)`);
      } else {
        latestInterim = text;
      }
    },
    onError(err) {
      console.error(`[${provider}] upstream error:`, err.message || err);
      sendEvent("error", { message: String(err.message || err) });
    },
    onClose() {
      sendEvent("session.status", { status: "upstream_closed" });
    },
  });

  // Single sequential tick handles both auto-Q&A and notes summary, so at
  // most 2 Cerebras calls go out per interval instead of one per finalized
  // transcript segment — avoids blowing through the per-minute rate limit.
  const tick = setInterval(async () => {
    if (ticking || closed) return;
    if (Date.now() < cooldownUntil) {
      console.log(
        `[session ${sessionId}] cooling down after rate limit, ${Math.ceil((cooldownUntil - Date.now()) / 1000)}s left`
      );
      return;
    }
    ticking = true;

    if (pendingQuestionText) {
      const questionText = pendingQuestionText;
      const contextBefore = buffer.slice(0, buffer.length - questionText.length).slice(-CONTEXT_CHAR_LIMIT);
      pendingQuestionText = "";
      const startedAt = Date.now();
      try {
        const answer = await withTimeout(
          cerebras.respondIfQuestion(contextBefore, questionText),
          CEREBRAS_TIMEOUT_MS,
          "respondIfQuestion"
        );
        sendEvent("latency.updated", { cerebrasLatencyMs: Date.now() - startedAt });
        if (answer && !closed) {
          db.addQa(sessionId, questionText, answer, "auto");
          sendEvent("inference.result", { kind: "qa", question: questionText, text: answer, source: "auto" });
        }
      } catch (err) {
        console.error(`[session ${sessionId}] respondIfQuestion failed:`, err.message || err);
        if (isRateLimitError(err)) {
          const cooldownMs = cooldownMsFor(err);
          cooldownUntil = Date.now() + cooldownMs;
          sendEvent("session.status", {
            status: "rate_limited",
            message: `Cerebras rate limited, pausing ${Math.ceil(cooldownMs / 1000)}s...`,
          });
        }
      }
    }

    if (!closed && Date.now() >= cooldownUntil) {
      // Only the text since the last summary is sent, not the whole
      // session — otherwise per-call token usage grows unboundedly as the
      // session runs and eventually blows a tokens/minute rate limit even
      // with very few calls per minute.
      const newFinalText = buffer.slice(summarizedUpToLength);
      const textToSummarize = (newFinalText + " " + latestInterim).trim();
      if (textToSummarize) {
        const cappedText = textToSummarize.slice(-CONTEXT_CHAR_LIMIT);
        console.log(`[session ${sessionId}] summarizing ${cappedText.length} new chars...`);
        const startedAt = Date.now();
        try {
          const summary = await withTimeout(
            cerebras.summarize(cappedText, previousSummary),
            CEREBRAS_TIMEOUT_MS,
            "summarize"
          );
          sendEvent("latency.updated", { cerebrasLatencyMs: Date.now() - startedAt });
          previousSummary = summary;
          summarizedUpToLength = buffer.length;
          db.addSummary(sessionId, summary);
          sendEvent("inference.result", { kind: "notes", text: summary });
          console.log(`[session ${sessionId}] notes updated`);
        } catch (err) {
          console.error(`[session ${sessionId}] summarize failed:`, err.message || err);
          if (isRateLimitError(err)) {
            const cooldownMs = cooldownMsFor(err);
            cooldownUntil = Date.now() + cooldownMs;
            sendEvent("session.status", {
              status: "rate_limited",
              message: `Cerebras rate limited, pausing ${Math.ceil(cooldownMs / 1000)}s...`,
            });
          } else {
            sendEvent("error", { message: String(err.message || err) });
          }
        }
      }
    }

    ticking = false;
  }, TICK_INTERVAL_MS);

  browserWs.on("message", (data, isBinary) => {
    if (isBinary) {
      upstream.sendAudio(data);
      return;
    }
    // Graceful client-initiated stop: send session.completed before the
    // socket closes, since a "close" event fires too late to deliver it.
    try {
      const msg = JSON.parse(data.toString());
      if (msg.event === "session.stop") {
        sendEvent("session.completed", {});
        browserWs.close();
      }
    } catch {
      // ignore malformed control messages
    }
  });

  const endSession = () => {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    upstream.close();
    db.endSession(sessionId);
  };

  browserWs.on("close", endSession);
  browserWs.on("error", endSession);
});
