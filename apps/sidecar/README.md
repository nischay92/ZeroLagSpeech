# ZeroLag Sidecar

Local backend process bundled with ZeroLag Desktop. Implements the contract
in `docs/sidecar-protocol.md`: Deepgram/ElevenLabs live speech-to-text,
Cerebras inference (rolling notes + real-time Q&A), and local session
persistence.

Ownership:

- D: Deepgram speech and transcription integration
- G: Cerebras inference integration

**Implementation note:** this is Node.js, not Python. A parallel Python
scaffold (`feature/sidecar-foundation`) landed on `main` around the same
time this was built — it implements the same wire contract (dynamic port,
per-launch token, loopback checks) but with **mock data only**
(`run_mock_session` returns fake transcripts/inference; `/health` reports
`"speech": "mock", "inference": "mock"`). This Node implementation has real
Deepgram/ElevenLabs/Cerebras integration, already exercised and debugged
against live traffic (rate limits, timeouts, per-call token budgets,
packaging into a working `.dmg`). Given that, this replaces the Python
sidecar rather than sitting alongside it — same protocol contract, same
security model (dynamic port, per-launch token, OS keychain credentials),
different language. Worth a heads-up to D/G/whoever owns
`feature/sidecar-foundation` before this merges anywhere shared, since it
removes their just-merged scaffold.

## Setup

```bash
cd apps/sidecar
npm install
```

No `.env` needed for normal use — in the packaged app, Tauri passes
`DEEPGRAM_API_KEY` / `ELEVENLABS_API_KEY` / `CEREBRAS_API_KEY` as env vars
sourced from the OS keychain (see `apps/desktop/src-tauri/src/lib.rs`).
For standalone local testing outside the desktop app, copy `.env.example`
to `.env` and fill in keys, or export the same env vars manually along
with `ZEROLAG_SIDECAR_PORT` / `ZEROLAG_SIDECAR_TOKEN`.

```bash
ZEROLAG_SIDECAR_PORT=43110 ZEROLAG_SIDECAR_TOKEN=local-development-token npm start
```

Binds to `127.0.0.1` only — never `0.0.0.0`.

## What's implemented vs. the documented contract

Implements `docs/sidecar-protocol.md` in full: dynamic port (env-supplied
by Rust), per-launch token required as a `?token=` query param on the WS
connection (rejected with close code 1008 if missing/wrong), loopback-only
request validation, the `protocol_version: "1.0"` envelope field,
`sequence` starting at 0, and the `start`/`stop`/`ping` JSON command
protocol gating when audio is accepted.

One legitimate extension beyond the base doc: `inference.result.data` uses
`{ kind: "notes" | "qa", text, question?, source? }` to cover rolling
notes, auto-detected spoken questions, and manually typed questions
through one event type — the Python scaffold doesn't have this yet since
it doesn't do real inference.

REST endpoints beyond `GET /health`: `GET /sessions`, `GET /sessions/:id`
(transcript/notes/Q&A history), `POST /sessions/:id/ask` (manual Q&A) —
needed for session history and the typed-question chat box in the UI.

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

Packaged as a single standalone binary (no system Node required) — see
the build script referenced from the root `package.json`'s `tauri:build`
chain.
