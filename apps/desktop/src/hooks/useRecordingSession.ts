import { useCallback, useEffect, useRef, useState } from "react";
import { startAudioCapture, type AudioCapture } from "../audio/capture";
import {
  createSessionSocketUrl,
  SIDECAR_AUDIO_FORMAT,
  type SidecarEvent,
  type InferenceResultData,
} from "../lib/sidecar";
import type { RecordingPhase } from "../lib/recording-events";
import { getRuntimeConfig } from "../lib/runtime";

export interface QaEntry {
  question: string;
  answer: string;
  source?: "auto" | "manual";
}

export function useRecordingSession() {
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [message, setMessage] = useState("Ready to record");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [notes, setNotes] = useState("");
  const [qaLog, setQaLog] = useState<QaEntry[]>([]);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [durationMs, setDurationMs] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const startedAtRef = useRef(0);
  const sessionRef = useRef<{ baseUrl: string; sessionId: string } | null>(null);

  const closeResources = useCallback(async () => {
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) await capture.stop();
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
  }, []);

  const start = useCallback(async () => {
    if (socketRef.current) return;
    setPhase("connecting");
    setMessage("Connecting to local sidecar…");
    setError(null);
    setTranscript("");
    setNotes("");
    setQaLog([]);
    setLatencyMs(null);
    setDurationMs(0);

    try {
      const runtime = await getRuntimeConfig();
      if (runtime.startupError) throw new Error(runtime.startupError);
      const sessionId = crypto.randomUUID();
      sessionRef.current = { baseUrl: runtime.baseUrl, sessionId };
      const socket = new WebSocket(
        createSessionSocketUrl(runtime.baseUrl, sessionId, runtime.token),
      );
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("Sidecar connection timed out.")),
          5000,
        );
        socket.addEventListener(
          "open",
          () => {
            window.clearTimeout(timeout);
            resolve();
          },
          { once: true },
        );
        socket.addEventListener(
          "error",
          () => {
            window.clearTimeout(timeout);
            reject(
              new Error(
                "Cannot reach the ZeroLag local runtime. Restart the app and try again.",
              ),
            );
          },
          { once: true },
        );
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") return;
        const payload = JSON.parse(event.data) as SidecarEvent;
        if (payload.event === "transcript.segment") {
          const text = payload.data.text;
          if (typeof text === "string")
            setTranscript((current) => `${current} ${text}`.trim());
        }
        if (payload.event === "inference.result") {
          const data = payload.data as unknown as InferenceResultData;
          if (data.kind === "notes") {
            setNotes(data.text);
          } else {
            setQaLog((log) => [
              ...log,
              { question: data.question ?? "", answer: data.text, source: data.source },
            ]);
          }
        }
        if (payload.event === "latency.updated") {
          const ms = payload.data.cerebrasLatencyMs;
          if (typeof ms === "number") setLatencyMs(ms);
        }
        if (payload.event === "session.completed") {
          void closeResources();
          setPhase("idle");
          setMessage("Recording saved locally");
        }
        if (payload.event === "error") {
          const detail = payload.data.message;
          setError(
            typeof detail === "string"
              ? detail
              : "The sidecar reported an error.",
          );
        }
      });

      const capture = await startAudioCapture((frame) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(frame);
      });
      captureRef.current = capture;
      socket.send(
        JSON.stringify({ type: "start", audio: SIDECAR_AUDIO_FORMAT }),
      );
      startedAtRef.current = Date.now();
      setPhase("recording");
      setMessage("Recording");
    } catch (caught) {
      await closeResources();
      setPhase("error");
      setMessage("Recording unavailable");
      setError(
        caught instanceof Error ? caught.message : "Unable to start recording.",
      );
    }
  }, [closeResources]);

  const stop = useCallback(async () => {
    const socket = socketRef.current;
    if (!socket) return;
    setPhase("stopping");
    setMessage("Finishing session…");
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) await capture.stop();
    if (socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ type: "stop" }));
    window.setTimeout(() => {
      if (socketRef.current === socket) {
        void closeResources();
        setPhase("idle");
        setMessage("Recording stopped");
      }
    }, 2000);
  }, [closeResources]);

  const ask = useCallback(async (question: string) => {
    const session = sessionRef.current;
    const trimmed = question.trim();
    if (!session || !trimmed) return;
    try {
      const res = await fetch(
        `${session.baseUrl}/sessions/${session.sessionId}/ask`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: trimmed }),
        },
      );
      const data = (await res.json()) as { answer?: string; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setQaLog((log) => [
        ...log,
        { question: trimmed, answer: data.answer ?? "", source: "manual" },
      ]);
    } catch (caught) {
      setQaLog((log) => [
        ...log,
        {
          question: trimmed,
          answer: caught instanceof Error ? caught.message : "Could not get an answer.",
          source: "manual",
        },
      ]);
    }
  }, []);

  useEffect(() => {
    if (phase !== "recording") return;
    const timer = window.setInterval(
      () => setDurationMs(Date.now() - startedAtRef.current),
      250,
    );
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(
    () => () => {
      void closeResources();
    },
    [closeResources],
  );

  return {
    phase,
    message,
    error,
    transcript,
    notes,
    qaLog,
    latencyMs,
    durationMs,
    start,
    stop,
    ask,
  };
}
