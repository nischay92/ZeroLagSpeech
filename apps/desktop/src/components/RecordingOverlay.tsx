import { emitTo, listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import type { RecordingState } from "../lib/recording-events";

const initialState: RecordingState = {
  phase: "idle",
  isRecording: false,
  durationMs: 0,
  message: "Ready",
};

function time(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function RecordingOverlay() {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    document.body.classList.add("overlay-body");
    const pending = listen<RecordingState>("recording-state", ({ payload }) =>
      setState(payload),
    );
    void emitTo("main", "recording-state-request");
    return () => {
      document.body.classList.remove("overlay-body");
      void pending.then((unlisten) => unlisten());
    };
  }, []);

  const busy = state.phase === "connecting" || state.phase === "stopping";
  return (
    <div
      className={`overlay-control overlay-control--${state.phase}`}
      data-tauri-drag-region
    >
      <span className="overlay-brand" data-tauri-drag-region>
        Z
      </span>
      <div className="overlay-status" data-tauri-drag-region>
        <strong>
          {state.isRecording ? time(state.durationMs) : state.message}
        </strong>
        <span>{state.isRecording ? "Recording" : "ZeroLag"}</span>
      </div>
      <button
        type="button"
        className={
          state.isRecording
            ? "overlay-button overlay-button--stop"
            : "overlay-button"
        }
        disabled={busy}
        aria-label={state.isRecording ? "Stop recording" : "Start recording"}
        onClick={() =>
          void emitTo("main", "recording-command", {
            action: state.isRecording ? "stop" : "start",
          })
        }
      >
        <span aria-hidden="true" />
      </button>
    </div>
  );
}
