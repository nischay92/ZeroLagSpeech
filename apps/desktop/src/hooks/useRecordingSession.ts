import { useCallback, useEffect, useRef, useState } from "react";
import { startAudioCapture, type AudioCapture } from "../audio/capture";
import {
  createSessionSocketUrl,
  SIDECAR_AUDIO_FORMAT,
  type SidecarEvent,
} from "../lib/sidecar";
import type { RecordingPhase } from "../lib/recording-events";

const SIDECAR_URL =
  import.meta.env.VITE_SIDECAR_URL ?? "http://127.0.0.1:43110";
const SIDECAR_TOKEN =
  import.meta.env.VITE_SIDECAR_TOKEN ?? "local-development-token";

export function useRecordingSession() {
  const [phase, setPhase] = useState<RecordingPhase>("idle");
  const [message, setMessage] = useState("Ready to record");
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState("");
  const [durationMs, setDurationMs] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);
  const startedAtRef = useRef(0);

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
    setDurationMs(0);

    const socket = new WebSocket(
      createSessionSocketUrl(SIDECAR_URL, crypto.randomUUID(), SIDECAR_TOKEN),
    );
    socket.binaryType = "arraybuffer";
    socketRef.current = socket;

    try {
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
                "Cannot reach the ZeroLag sidecar. Start it and try again.",
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

  return { phase, message, error, transcript, durationMs, start, stop };
}
