export type RecordingPhase =
  "idle" | "connecting" | "recording" | "stopping" | "error";

export interface RecordingState {
  phase: RecordingPhase;
  isRecording: boolean;
  durationMs: number;
  message: string;
}

export interface RecordingCommand {
  action: "start" | "stop";
}
