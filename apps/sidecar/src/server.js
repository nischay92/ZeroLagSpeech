// Only load .env for standalone dev/testing — never inside a pkg-compiled
// binary. Two reasons: (1) the packaged app always gets its config via env
// vars set directly by Rust from the OS keychain, so it's never needed
// there, and (2) critically, pkg's static analysis bundles any file
// reachable via a statically-resolvable fs path as a snapshot asset —
// which previously meant the real apps/sidecar/.env (with live API keys)
// was getting embedded straight into the compiled binary and loaded
// regardless of what environment the process was actually launched with.
// `process.pkg` only exists inside a pkg-compiled binary.
if (!process.pkg) {
  const path = require("path");
  require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
}
const express = require("express");
const { WebSocketServer } = require("ws");

const db = require("./db");
const cerebras = require("./cerebras");
const deepgram = require("./stt/deepgram");
const elevenlabs = require("./stt/elevenlabs");

for (const key of ["DEEPGRAM_API_KEY", "ELEVENLABS_API_KEY", "CEREBRAS_API_KEY"]) {
  if (!process.env[key]) {
    console.warn(`Warning: ${key} is not set — related features will fail.`);
  }
}

const HOST = process.env.ZEROLAG_SIDECAR_HOST || "127.0.0.1";
const PORT = process.env.ZEROLAG_SIDECAR_PORT || 43110;
const TOKEN = process.env.ZEROLAG_SIDECAR_TOKEN || "zerolag-development-token";
const ENVIRONMENT = process.env.ZEROLAG_SIDECAR_ENVIRONMENT || "development";
const PROTOCOL_VERSION = "1.0";
const TICK_INTERVAL_MS = 6000;
const CEREBRAS_TIMEOUT_MS = 12000;
const RATE_LIMIT_COOLDOWN_MS = 45000;
const CONTEXT_CHAR_LIMIT = 3000; // caps per-call token usage regardless of session length

if (ENVIRONMENT === "packaged" && TOKEN === "zerolag-development-token") {
  console.error("Packaged sidecars require a per-launch authentication token. Refusing to start.");
  process.exit(1);
}

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

function isLoopbackHost(host) {
  if (!host) return false;
  return host === "127.0.0.1" || host === "::1" || host === "::ffff:127.0.0.1" || host === "localhost";
}

const ALLOWED_ORIGINS = new Set([
  "http://127.0.0.1:1420",
  "http://localhost:1420",
  "http://tauri.localhost",
  "tauri://localhost",
]);

const app = express();

app.use((req, res, next) => {
  if (!isLoopbackHost(req.socket.remoteAddress?.replace(/^::ffff:/, ""))) {
    return res.status(403).json({ detail: "Loopback access only" });
  }
  next();
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    protocol_version: PROTOCOL_VERSION,
    providers: {
      speech: process.env.DEEPGRAM_API_KEY || process.env.ELEVENLABS_API_KEY ? "ready" : "unavailable",
      inference: process.env.CEREBRAS_API_KEY ? "ready" : "unavailable",
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
  console.log(`Sidecar listening on http://${HOST}:${PORT} (${ENVIRONMENT})`);
});

// ws's `path` option only does exact string matching, not patterns, so the
// /ws/session/{session_id} path (with a variable segment) is matched manually.
const SESSION_PATH_RE = /^\/ws\/session\/([^/]+)$/;
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const remoteHost = socket.remoteAddress?.replace(/^::ffff:/, "");
  if (!SESSION_PATH_RE.test(url.pathname) || !isLoopbackHost(remoteHost)) {
    socket.destroy();
    return;
  }
  const token = url.searchParams.get("token") || "";
  if (token !== TOKEN) {
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
  // Provider selection isn't part of the base protocol (single "speech"
  // provider slot in /health) — default to Deepgram, with an optional
  // ?provider= override for testing ElevenLabs directly.
  const provider = url.searchParams.get("provider") === "elevenlabs" ? "elevenlabs" : "deepgram";
  const providerModule = provider === "elevenlabs" ? elevenlabs : deepgram;

  db.createSession(sessionId, provider);
  console.log(`[session ${sessionId}] connected (${provider})`);

  let sequence = 0;
  const sendEvent = (event, data) => {
    if (browserWs.readyState !== browserWs.OPEN) return;
    browserWs.send(
      JSON.stringify({
        protocol_version: PROTOCOL_VERSION,
        event,
        session_id: sessionId,
        sequence: sequence++,
        timestamp: new Date().toISOString(),
        data,
      })
    );
  };

  let started = false;
  let upstream = null;
  let buffer = "";
  let latestInterim = "";
  let pendingQuestionText = "";
  let previousSummary = "";
  let summarizedUpToLength = 0;
  let closed = false;
  let ticking = false;
  let cooldownUntil = 0;

  sendEvent("session.connected", { sidecar: "ready", provider });

  function connectUpstream() {
    upstream = providerModule.connect({
      onOpen() {
        // no-op: session.status "streaming" already sent optimistically on "start"
      },
      onTranscript({ type, text }) {
        sendEvent("transcript.segment", {
          segment_id: `${sessionId}-${sequence}`,
          text,
          is_final: type === "final",
        });
        if (type === "final") {
          buffer += (buffer ? " " : "") + text;
          pendingQuestionText += (pendingQuestionText ? " " : "") + text;
          latestInterim = "";
          db.addTranscript(sessionId, text);
        } else {
          latestInterim = text;
        }
      },
      onError(err) {
        console.error(`[${provider}] upstream error:`, err.message || err);
        sendEvent("error", { code: "provider_error", message: String(err.message || err) });
      },
      onClose() {
        sendEvent("session.status", { status: "upstream_closed" });
      },
    });
  }

  async function finalizeSession() {
    const newFinalText = buffer.slice(summarizedUpToLength);
    const textToSummarize = (newFinalText + " " + latestInterim).trim();
    if (textToSummarize) {
      try {
        const summary = await withTimeout(
          cerebras.summarize(textToSummarize.slice(-CONTEXT_CHAR_LIMIT), previousSummary),
          CEREBRAS_TIMEOUT_MS,
          "summarize"
        );
        db.addSummary(sessionId, summary);
        sendEvent("inference.result", { kind: "notes", text: summary });
      } catch (err) {
        console.error(`[session ${sessionId}] final summarize failed:`, err.message || err);
      }
    }
    sendEvent("session.completed", { audio_bytes: buffer.length });
  }

  // Single sequential tick handles both auto-Q&A and notes summary, so at
  // most 2 Cerebras calls go out per interval instead of one per finalized
  // transcript segment — avoids blowing through the per-minute rate limit.
  const tick = setInterval(async () => {
    if (ticking || closed || !started) return;
    if (Date.now() < cooldownUntil) return;
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
      const newFinalText = buffer.slice(summarizedUpToLength);
      const textToSummarize = (newFinalText + " " + latestInterim).trim();
      if (textToSummarize) {
        const cappedText = textToSummarize.slice(-CONTEXT_CHAR_LIMIT);
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
            sendEvent("error", { code: "inference_error", message: String(err.message || err) });
          }
        }
      }
    }

    ticking = false;
  }, TICK_INTERVAL_MS);

  browserWs.on("message", (data, isBinary) => {
    if (isBinary) {
      if (!started) {
        sendEvent("error", { code: "session_not_started", message: "Send start before audio" });
        return;
      }
      upstream?.sendAudio(data);
      return;
    }

    let command;
    try {
      command = JSON.parse(data.toString());
    } catch {
      sendEvent("error", { code: "invalid_command", message: "Malformed command" });
      return;
    }

    switch (command.type) {
      case "start":
        if (!started) {
          started = true;
          connectUpstream();
          sendEvent("session.status", { status: "streaming" });
        }
        break;
      case "stop":
        finalizeSession().finally(() => {
          browserWs.close(1000);
        });
        break;
      case "ping":
        sendEvent("session.status", { status: "alive" });
        break;
      default:
        sendEvent("error", { code: "invalid_command", message: "Unknown command type" });
    }
  });

  const endSession = () => {
    if (closed) return;
    closed = true;
    clearInterval(tick);
    upstream?.close();
    db.endSession(sessionId);
  };

  browserWs.on("close", endSession);
  browserWs.on("error", endSession);
});
