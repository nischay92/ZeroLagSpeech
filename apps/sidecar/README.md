# ZeroLag Sidecar

Local backend process bundled with ZeroLag Desktop. Implements the contract
in `docs/sidecar-protocol.md`: Deepgram/ElevenLabs live speech-to-text,
Cerebras inference (rolling notes + real-time Q&A), and local session
persistence.

Ownership:

- D: Deepgram speech and transcription integration
- G: Cerebras inference integration

**Implementation note:** this is implemented in Node.js, not Python as the
root README's architecture diagram originally described. The wire contract
(loopback HTTP/WS, JSON event envelope) doesn't require any particular
language — Node was chosen because it's what D/G had already built and
verified standalone. Flag/update the root README's "Bundled Python sidecar"
line when this lands, since it's a real language pivot other teammates
should be aware of.

## Setup

```bash
cd apps/sidecar
npm install
cp .env.example .env   # fill in DEEPGRAM_API_KEY, ELEVENLABS_API_KEY, CEREBRAS_API_KEY
npm start
```

Binds to `127.0.0.1:43110` by default (override with `SIDECAR_PORT`).

## What's implemented vs. the documented contract

Implemented per `docs/sidecar-protocol.md`:

- `GET /health` — provider readiness booleans.
- `WS /ws/session/{session_id}` — session_id is client-generated (e.g.
  `crypto.randomUUID()`) and passed in the path, per the doc.
- Outbound event envelope `{ event, session_id, sequence, timestamp, data }`
  with a per-connection incrementing `sequence`.
- All seven planned event types are emitted: `session.connected`,
  `session.status`, `transcript.segment`, `inference.result`,
  `latency.updated`, `session.completed`, `error`.
- Loopback-only binding (`app.listen(PORT, "127.0.0.1", ...)`).

Extensions beyond what the doc specified (the doc explicitly left these
open, to be versioned before real provider implementations land — see
`docs/sidecar-protocol.md` for the full writeup):

- `?provider=deepgram|elevenlabs` query param on the WS URL selects the STT
  provider.
- Inbound audio is raw binary WS frames (PCM16, 16kHz mono), not JSON.
- `inference.result.data` uses `{ kind: "notes" | "qa", text, question?, source? }`
  to cover rolling notes, auto-detected spoken questions, and manually
  typed questions through one event type.
- `session.completed` requires a client-sent `{"event":"session.stop"}`
  text frame before closing — a bare WS close doesn't reach the client in
  time to deliver a final event, so this is the graceful-stop handshake.
- Two REST endpoints beyond the documented minimum: `GET /sessions/:id`
  (transcript/notes/Q&A history) and `POST /sessions/:id/ask` (manual
  Q&A), needed for session history and the typed-question chat box.

**Not implemented yet (intentionally):** the packaged-build one-time
session token / auth requirement from the doc. The Tauri shell doesn't
spawn or manage the sidecar process yet (no `externalBin` config), so
there's no token-passing mechanism to hook into — that's milestone #3 in
the root README, owned by the desktop-shell side. This sidecar currently
only serves the documented dev-mode transport
(`http://127.0.0.1:43110` / `ws://127.0.0.1:43110`, no auth).

## Files

- `src/server.js` — Express + `ws` server implementing the protocol above.
- `src/db.js` — SQLite (`better-sqlite3`) persistence: sessions,
  transcripts, summaries, Q&A history.
- `src/cerebras.js` — Cerebras chat completions: rolling summary,
  general-knowledge Q&A, and per-segment auto question detection.
- `src/stt/deepgram.js`, `src/stt/elevenlabs.js` — raw WebSocket clients to
  each provider's live/realtime transcription API, normalized to the same
  `{ type: "partial" | "final", text }` shape so `server.js` doesn't need
  provider-specific branching.

This was ported from a standalone Node backend that was built and verified
independently (STT auth, Cerebras calls, rate-limit handling, notes-freeze
and 429-storm bugs already found and fixed there) before being adapted to
this protocol — see that project's `PROJECT_NOTES.md` for the debugging
history if similar issues show up here.
