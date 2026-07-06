import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useState } from "react";
import { ProviderSettings } from "./components/ProviderSettings";
import { RecordingOverlay } from "./components/RecordingOverlay";
import { useRecordingSession } from "./hooks/useRecordingSession";
import { useRuntimeHealth } from "./hooks/useRuntimeHealth";
import type { RecordingCommand, RecordingState } from "./lib/recording-events";

function QaPanel({
  qaLog,
  onAsk,
}: {
  qaLog: { question: string; answer: string; source?: "auto" | "manual" }[];
  onAsk: (question: string) => void;
}) {
  const [question, setQuestion] = useState("");
  return (
    <aside className="transcript-card qa-card" aria-live="polite">
      <div className="card-header">
        <div>
          <span className="card-kicker">Cerebras</span>
          <h2>Notes &amp; Q&amp;A</h2>
        </div>
      </div>
      <div className="transcript-body qa-log">
        {qaLog.length ? (
          qaLog.map((entry, i) => (
            <div className="qa-item" key={i}>
              <p className="qa-question">
                Q: {entry.question}
                {entry.source === "auto" ? (
                  <span className="qa-tag"> (from speech)</span>
                ) : null}
              </p>
              <p className="qa-answer">A: {entry.answer}</p>
            </div>
          ))
        ) : (
          <p className="empty-copy">
            Questions asked out loud are answered automatically here. You can
            also type one below.
          </p>
        )}
      </div>
      <form
        className="qa-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!question.trim()) return;
          onAsk(question);
          setQuestion("");
        }}
      >
        <input
          type="text"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this session…"
          aria-label="Ask about this session"
        />
        <button type="submit" className="small-button small-button--primary">
          Ask
        </button>
      </form>
    </aside>
  );
}

const isOverlay = new URLSearchParams(window.location.search).has("overlay");

function formatDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

function MainWorkspace() {
  const recording = useRecordingSession();
  const runtime = useRuntimeHealth();
  const [settingsOpen, setSettingsOpen] = useState(false);
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
        <div className="topbar-actions">
          <div
            className={`connection-pill connection-pill--${runtime.health}`}
            title={runtime.message}
          >
            <span className="connection-dot" />
            {runtime.health === "ready"
              ? "Runtime ready"
              : runtime.health === "starting"
                ? "Starting runtime…"
                : "Runtime unavailable"}
          </div>
          <button
            className="settings-button"
            type="button"
            onClick={() => setSettingsOpen(true)}
          >
            Provider settings
          </button>
        </div>
      </header>

      <section className="workspace">
        <div className="workspace-copy">
          <p className="eyebrow">Local voice intelligence</p>
          <h1>Capture the conversation. Keep your momentum.</h1>
          <p className="lede">
            ZeroLag records on your computer and streams normalized audio to the
            local provider sidecar. The floating control stays available while
            you work in any app.
          </p>

          <div className="recording-controls" aria-label="Recording controls">
            {recording.phase !== "recording" ? (
              <button
                className="button button--primary"
                type="button"
                onClick={() => void recording.start()}
                disabled={busy || runtime.health !== "ready"}
                data-state={recording.phase}
              >
                {busy ? (
                  <span className="button-spinner" aria-hidden="true" />
                ) : (
                  <span className="record-icon" aria-hidden="true" />
                )}
                {recording.phase === "connecting"
                  ? "Connecting…"
                  : recording.phase === "stopping"
                    ? "Finishing…"
                    : runtime.health === "starting"
                      ? "Preparing runtime…"
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
            <span
              className={`recording-state recording-state--${recording.phase}`}
            >
              {recording.phase === "stopping"
                ? "Finishing safely…"
                : recording.message}
            </span>
          </div>

          {recording.error ? (
            <div className="error-banner" role="alert">
              <strong>Recording unavailable</strong>
              <span>{recording.error}</span>
            </div>
          ) : null}
        </div>

        <div className="session-panels">
          <aside className="transcript-card" aria-live="polite">
            <div className="card-header">
              <div>
                <span className="card-kicker">Live transcript</span>
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
                  Your transcript will appear here after recording begins.
                </p>
              )}
            </div>
            <footer className="card-footer">
              <span>16 kHz · Mono · PCM</span>
              <span>
                {recording.latencyMs !== null
                  ? `${recording.latencyMs}ms inference latency`
                  : "Stored locally"}
              </span>
            </footer>
          </aside>

          <aside className="transcript-card notes-card" aria-live="polite">
            <div className="card-header">
              <div>
                <span className="card-kicker">Cerebras</span>
                <h2>Running notes</h2>
              </div>
            </div>
            <div className="transcript-body">
              {recording.notes ? (
                <p>{recording.notes}</p>
              ) : (
                <p className="empty-copy">
                  A running summary appears here as the conversation continues.
                </p>
              )}
            </div>
          </aside>

          <QaPanel qaLog={recording.qaLog} onAsk={(q) => void recording.ask(q)} />
        </div>
      </section>
      {settingsOpen ? (
        <ProviderSettings
          status={runtime.providers}
          onChanged={runtime.refreshProviders}
          onClose={() => setSettingsOpen(false)}
        />
      ) : null}
    </main>
  );
}

function App() {
  if (isOverlay) return <RecordingOverlay />;
  return <MainWorkspace />;
}

export default App;
