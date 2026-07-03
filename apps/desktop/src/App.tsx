import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo } from "react";
import { RecordingOverlay } from "./components/RecordingOverlay";
import { useRecordingSession } from "./hooks/useRecordingSession";
import type { RecordingCommand, RecordingState } from "./lib/recording-events";

const isOverlay = new URLSearchParams(window.location.search).has("overlay");

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function MainWorkspace() {
  const recording = useRecordingSession();
  const { start, stop } = recording;
  const recordingState = useMemo<RecordingState>(
    () => ({
      phase: recording.phase,
      isRecording: recording.phase === "recording",
      durationMs: recording.durationMs,
      message: recording.message,
    }),
    [recording.durationMs, recording.message, recording.phase],
  );

  useEffect(() => {
    void emitTo("recorder-overlay", "recording-state", recordingState).catch(
      () => {
        // Browser-only development has no Tauri event bus.
      },
    );
  }, [recordingState]);

  useEffect(() => {
    let active = true;
    const unlistenCommands = listen<RecordingCommand>(
      "recording-command",
      ({ payload }) => {
        if (payload.action === "start") void start();
        if (payload.action === "stop") void stop();
      },
    );
    const unlistenRequests = listen("recording-state-request", () => {
      void emitTo("recorder-overlay", "recording-state", recordingState);
    });

    return () => {
      active = false;
      void unlistenCommands.then((unlisten) => active || unlisten());
      void unlistenRequests.then((unlisten) => active || unlisten());
    };
  }, [recordingState, start, stop]);

  const busy =
    recording.phase === "connecting" || recording.phase === "stopping";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            Z
          </span>
          <span>ZeroLag</span>
        </div>
        <div className={`connection-pill connection-pill--${recording.phase}`}>
          <span className="connection-dot" />
          {recording.message}
        </div>
      </header>

      <section className="workspace">
        <div className="workspace-copy">
          <p className="eyebrow">Local voice intelligence</p>
          <h1>Capture the conversation. Keep your momentum.</h1>
          <p className="lede">
            ZeroLag records on your Mac and streams normalized audio to the
            local provider sidecar. The floating control stays available while
            you work in any app.
          </p>

          <div className="recording-controls" aria-label="Recording controls">
            {recording.phase !== "recording" ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => void recording.start()}
                disabled={busy}
              >
                <span className="record-icon" aria-hidden="true" />
                {recording.phase === "connecting"
                  ? "Connecting…"
                  : "Start recording"}
              </button>
            ) : (
              <button
                className="button button--stop"
                type="button"
                onClick={() => void recording.stop()}
              >
                <span className="stop-icon" aria-hidden="true" />
                Stop recording
              </button>
            )}
            <div
              className="timer"
              aria-label={`Recording duration ${formatDuration(recording.durationMs)}`}
            >
              {formatDuration(recording.durationMs)}
            </div>
          </div>

          {recording.error ? (
            <div className="error-banner" role="alert">
              <strong>Recording unavailable</strong>
              <span>{recording.error}</span>
            </div>
          ) : null}
        </div>

        <aside className="transcript-card" aria-live="polite">
          <div className="card-header">
            <div>
              <span className="card-kicker">Mock transcript</span>
              <h2>Current session</h2>
            </div>
            {recording.phase === "recording" ? (
              <span className="live-badge">
                <span />
                Live
              </span>
            ) : null}
          </div>
          <div className="transcript-body">
            {recording.transcript ? (
              <p>{recording.transcript}</p>
            ) : (
              <p className="empty-copy">
                Your transcript will appear here after recording begins. The
                current sidecar returns deterministic mock text until Deepgram
                is connected.
              </p>
            )}
          </div>
          <footer className="card-footer">
            <span>16 kHz · Mono · PCM</span>
            <span>Stored locally</span>
          </footer>
        </aside>
      </section>
    </main>
  );
}

function App() {
  if (isOverlay) return <RecordingOverlay />;
  return <MainWorkspace />;
}

export default App;
