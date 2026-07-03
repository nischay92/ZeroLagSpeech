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

## Implemented extensions (D/G sidecar, Node implementation)

The points below were left open in the initial contract above. They're
implemented in `apps/sidecar` as of the first real provider integration;
listed here so the versioning this doc calls for actually happens instead
of living only in code.

- **Provider selection**: `?provider=deepgram|elevenlabs` query parameter
  on the `WS /ws/session/{session_id}` URL. Defaults to `deepgram`.
- **Inbound audio transport**: raw binary WebSocket frames, PCM16 mono at
  16kHz, batched client-side into ~200ms chunks. Not part of the JSON
  event envelope — binary frames on the same connection.
- **`inference.result` data shape**:
  `{ kind: "notes" | "qa", text: string, question?: string, source?: "auto" | "manual" }`.
  One event type covers three cases: the rolling notes summary
  (`kind: "notes"`, emitted periodically), a question auto-detected in
  spoken transcript (`kind: "qa", source: "auto"`), and a manually typed
  question via the REST ask endpoint (`kind: "qa", source: "manual"`).
- **`latency.updated` data shape**: `{ cerebrasLatencyMs: number }`,
  emitted after each Cerebras call (notes summary or Q&A).
- **`session.completed` handshake**: since a WS `close` event fires too
  late on the server to deliver a final message, the client must send a
  text frame `{"event":"session.stop"}` before closing; the sidecar
  responds with `session.completed` and then closes the socket itself. A
  bare client-side close still works for cleanup, it just won't produce a
  `session.completed` event on the wire.
- **Additional REST endpoints** beyond `GET /health`:
  - `GET /sessions` — list all sessions.
  - `GET /sessions/{session_id}` — full transcript/notes/Q&A history for
    one session.
  - `POST /sessions/{session_id}/ask` `{ question }` → `{ answer }` —
    manual Q&A, grounded in that session's stored transcript.
- **CORS**: REST endpoints reflect the request's `Origin` header and allow
  `GET, POST, OPTIONS`. Needed because the desktop UI's dev server
  (`http://localhost:1420`) and the sidecar (`http://127.0.0.1:43110`) are
  different origins even on the same machine. WebSocket connections are
  unaffected (not subject to CORS), so this only matters for the REST
  endpoints above.

## Known gap: packaged-app authentication

The "one-time session token" and "reject unauthenticated packaged-app
requests" requirements above are **not implemented yet**. The Tauri shell
doesn't currently spawn or manage the sidecar process (no `externalBin`
config, no token-passing code), so there's no mechanism on the desktop
side to generate or pass such a token. This is tracked against milestone
#3 in the root README ("Implement and package the Python [sic] sidecar
lifecycle") and needs design coordination with the desktop-shell owner
before implementation, per this repo's rule that auth changes to the
sidecar require coordination. Today the sidecar only serves the
documented dev-mode transport with no auth, which is fine for local dev
but must be closed before packaging.
