export const SIDECAR_PROTOCOL_VERSION = "1.0" as const;

export type SidecarEventName =
  | "session.connected"
  | "session.status"
  | "transcript.segment"
  | "inference.result"
  | "latency.updated"
  | "session.completed"
  | "error";

export interface SidecarEvent<
  TData extends Record<string, unknown> = Record<string, unknown>,
> {
  protocol_version: typeof SIDECAR_PROTOCOL_VERSION;
  event: SidecarEventName;
  session_id: string;
  sequence: number;
  timestamp: string;
  data: TData;
}

export interface SidecarHealth {
  status: "ok";
  protocol_version: typeof SIDECAR_PROTOCOL_VERSION;
  providers: {
    speech: "mock" | "ready" | "unavailable";
    inference: "mock" | "ready" | "unavailable";
  };
}

export const SIDECAR_AUDIO_FORMAT = {
  encoding: "pcm_s16le",
  sample_rate_hz: 16_000,
  channels: 1,
} as const;

export function createSessionSocketUrl(
  baseUrl: string,
  sessionId: string,
  token: string,
): string {
  const url = new URL(`/ws/session/${encodeURIComponent(sessionId)}`, baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("token", token);
  return url.toString();
}
