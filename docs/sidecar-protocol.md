# Desktop–Sidecar Protocol v1

ZeroLag Desktop communicates with its bundled sidecar over loopback only. This document is the integration contract for the desktop, Deepgram, and Cerebras owners. The sidecar implementation is Node.js (see `apps/sidecar/README.md` for why) — the contract below is language-agnostic and applies regardless.

## Transport and security

- Development HTTP URL: `http://127.0.0.1:43110`
- Development WebSocket URL: `ws://127.0.0.1:43110`
- The process must never bind to `0.0.0.0` or a LAN interface.
- Packaged builds choose an available loopback port.
- Tauri generates a random per-launch token and passes it to the child process.
- Every WebSocket connection supplies that token as the `token` query parameter.
- The token must never be persisted, logged, or reused across launches.

The development token exists only for local testing. Packaged mode refuses to start with the development default.

## Audio contract

The desktop sends raw binary WebSocket messages with this fixed format:

```json
{
  "encoding": "pcm_s16le",
  "sample_rate_hz": 16000,
  "channels": 1
}
```

Audio is signed 16-bit little-endian mono PCM at 16 kHz. A JSON `start` command must be sent before any binary frames.

## Endpoints

### `GET /health`

Returns protocol and provider readiness:

```json
{
  "status": "ok",
  "protocol_version": "1.0",
  "providers": {
    "speech": "mock",
    "inference": "mock"
  }
}
```

### `WS /ws/session/{session_id}?token={launch_token}`

Carries control commands, binary audio, and ordered events for one session.

## Desktop commands

Start streaming:

```json
{
  "type": "start",
  "audio": {
    "encoding": "pcm_s16le",
    "sample_rate_hz": 16000,
    "channels": 1
  }
}
```

Stop and finalize:

```json
{ "type": "stop" }
```

Connection liveness:

```json
{ "type": "ping" }
```

## Event envelope

```json
{
  "protocol_version": "1.0",
  "event": "transcript.segment",
  "session_id": "00000000-0000-0000-0000-000000000000",
  "sequence": 2,
  "timestamp": "2026-07-03T00:00:00Z",
  "data": {}
}
```

Rules:

- `sequence` starts at zero and increases once per emitted event.
- `timestamp` is UTC ISO 8601.
- Unknown commands produce an `error` event without crashing the connection.
- Provider-specific payloads stay behind normalized shared schemas.

Event types:

- `session.connected`
- `session.status`
- `transcript.segment`
- `inference.result`
- `latency.updated`
- `session.completed`
- `error`

## Provider boundaries

D maps Deepgram output into `transcript.segment` events. G maps Cerebras output into `inference.result` events. Neither provider adapter changes the transport envelope or sends provider credentials to the desktop UI.

Any breaking protocol change requires a new protocol version and coordinated updates to the sidecar and TypeScript schemas.

## Implemented extension: `inference.result` data shape

The base contract above doesn't specify what goes in `inference.result.data` beyond "provider-specific payloads stay behind normalized shared schemas." The Node sidecar (`apps/sidecar`) uses:

```json
{ "kind": "notes" | "qa", "text": "string", "question": "string?", "source": "auto" | "manual" }
```

One event type covers three cases: the rolling notes summary (`kind: "notes"`, emitted periodically as the session progresses), a question auto-detected in spoken transcript (`kind: "qa", source: "auto"`), and a manually typed question via `POST /sessions/:id/ask` (`kind: "qa", source: "manual"`). ElevenLabs is also supported as a second speech provider alongside Deepgram (`?provider=deepgram|elevenlabs` was the original selection mechanism from an earlier contract draft — provider selection now happens via env var at sidecar launch, matching the dynamic-port/token model above).
