# Desktop–Sidecar Protocol

ZeroLag Desktop communicates with its bundled Python sidecar over loopback only.

## Transport

- HTTP development URL: `http://127.0.0.1:43110`
- WebSocket development URL: `ws://127.0.0.1:43110`
- Packaged builds will choose an available loopback port and pass a one-time session token to the sidecar.
- The sidecar must reject non-loopback traffic and unauthenticated packaged-app requests.

## Initial endpoints

- `GET /health` — sidecar and provider readiness
- `WS /ws/session/{session_id}` — audio, transcript, inference, and lifecycle events

## Event envelope

```json
{
  "event": "transcript.segment",
  "session_id": "uuid",
  "sequence": 1,
  "timestamp": "2026-07-02T00:00:00Z",
  "data": {}
}
```

Planned event types:

- `session.connected`
- `session.status`
- `transcript.segment`
- `inference.result`
- `latency.updated`
- `session.completed`
- `error`

Provider-specific payloads must remain behind stable shared response schemas. This contract will be versioned before D and G merge real provider implementations.
