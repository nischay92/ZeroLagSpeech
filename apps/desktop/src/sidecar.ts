export type Provider = "deepgram" | "elevenlabs";

interface ConnectedData {
  provider: Provider;
}

interface StatusData {
  status: string;
  message?: string;
}

interface TranscriptData {
  text: string;
  is_final: boolean;
}

interface InferenceData {
  kind: "notes" | "qa";
  text: string;
  question?: string;
  source?: "auto" | "manual";
}

interface LatencyData {
  cerebrasLatencyMs: number;
}

interface ErrorData {
  message: string;
}

type Envelope =
  | { event: "session.connected"; session_id: string; sequence: number; timestamp: string; data: ConnectedData }
  | { event: "session.status"; session_id: string; sequence: number; timestamp: string; data: StatusData }
  | { event: "transcript.segment"; session_id: string; sequence: number; timestamp: string; data: TranscriptData }
  | { event: "inference.result"; session_id: string; sequence: number; timestamp: string; data: InferenceData }
  | { event: "latency.updated"; session_id: string; sequence: number; timestamp: string; data: LatencyData }
  | { event: "session.completed"; session_id: string; sequence: number; timestamp: string; data: Record<string, never> }
  | { event: "error"; session_id: string; sequence: number; timestamp: string; data: ErrorData };

export interface SidecarCallbacks {
  onConnected?: (data: ConnectedData) => void;
  onStatus?: (data: StatusData) => void;
  onTranscript?: (data: TranscriptData) => void;
  onInference?: (data: InferenceData) => void;
  onLatency?: (data: LatencyData) => void;
  onCompleted?: () => void;
  onError?: (data: ErrorData) => void;
}

export interface SidecarSession {
  sessionId: string;
  stop: () => void;
}

const SIDECAR_URL = import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:43110";

// In a packaged build the sidecar is spawned by Tauri right as the app
// launches (a cold Node start — requiring express/ws/better-sqlite3/the
// Cerebras SDK). If Start Recording is clicked before it's finished
// booting, a one-shot WS connection attempt fails immediately. Poll
// /health first so a slow-starting sidecar doesn't produce a hard error.
async function waitForSidecarReady(retries = 10, delayMs = 300): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`${SIDECAR_URL}/health`);
      if (res.ok) return;
    } catch {
      // sidecar not listening yet — fall through and retry
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Sidecar at ${SIDECAR_URL} did not become ready in time`);
}

export async function startSession(
  provider: Provider,
  callbacks: SidecarCallbacks,
): Promise<SidecarSession> {
  await waitForSidecarReady();

  const sessionId = crypto.randomUUID();
  const wsUrl = `${SIDECAR_URL.replace(/^http/, "ws")}/ws/session/${sessionId}?provider=${provider}`;
  const ws = new WebSocket(wsUrl);
  ws.binaryType = "arraybuffer";

  // Attach the message handler before awaiting "open" so nothing sent
  // immediately after the handshake (e.g. session.connected) is dropped.
  ws.onmessage = (event) => {
    const envelope = JSON.parse(event.data as string) as Envelope;
    switch (envelope.event) {
      case "session.connected":
        callbacks.onConnected?.(envelope.data);
        break;
      case "session.status":
        callbacks.onStatus?.(envelope.data);
        break;
      case "transcript.segment":
        callbacks.onTranscript?.(envelope.data);
        break;
      case "inference.result":
        callbacks.onInference?.(envelope.data);
        break;
      case "latency.updated":
        callbacks.onLatency?.(envelope.data);
        break;
      case "session.completed":
        callbacks.onCompleted?.();
        break;
      case "error":
        callbacks.onError?.(envelope.data);
        break;
    }
  };

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener(
      "error",
      () => reject(new Error("Failed to connect to sidecar at " + SIDECAR_URL)),
      { once: true },
    );
  });

  const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const audioContext = new AudioContext({ sampleRate: 16000 });
  await audioContext.audioWorklet.addModule("/pcm-worklet.js");

  const source = audioContext.createMediaStreamSource(mediaStream);
  const workletNode = new AudioWorkletNode(audioContext, "pcm-processor");

  let sendBuffer: Int16Array[] = [];
  workletNode.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
    sendBuffer.push(new Int16Array(event.data));
  };
  source.connect(workletNode);

  const sendTimer = window.setInterval(() => {
    if (!sendBuffer.length || ws.readyState !== WebSocket.OPEN) return;
    const totalLength = sendBuffer.reduce((sum, arr) => sum + arr.length, 0);
    const merged = new Int16Array(totalLength);
    let offset = 0;
    for (const arr of sendBuffer) {
      merged.set(arr, offset);
      offset += arr.length;
    }
    sendBuffer = [];
    ws.send(merged.buffer);
  }, 200);

  const stop = () => {
    window.clearInterval(sendTimer);
    workletNode.disconnect();
    void audioContext.close();
    mediaStream.getTracks().forEach((track) => track.stop());
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event: "session.stop" }));
      window.setTimeout(() => ws.close(), 500);
    }
  };

  return { sessionId, stop };
}

export async function askQuestion(sessionId: string, question: string): Promise<string> {
  const res = await fetch(`${SIDECAR_URL}/sessions/${sessionId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
  });
  const data = (await res.json()) as { answer?: string; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data.answer ?? "";
}
