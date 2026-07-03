# ZeroLag Python Sidecar

The sidecar is the local provider process bundled with ZeroLag Desktop. It owns speech and inference I/O while the Tauri application owns capture, presentation, persistence, and process lifecycle.

Ownership:

- D: Deepgram speech and transcription integration
- G: Cerebras inference integration

## Setup

```bash
cd apps/sidecar
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

## Run

```bash
ZEROLAG_SIDECAR_TOKEN=local-development-token .venv/bin/python -m zerolag_sidecar
```

The server binds only to `127.0.0.1:43110`. Never bind the packaged sidecar to all network interfaces.

## Verify

```bash
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
```

With the sidecar running, exercise the real HTTP and WebSocket transports:

```bash
ZEROLAG_SIDECAR_TOKEN=local-development-token .venv/bin/python scripts/smoke_test.py
```

The stable protocol is documented in `docs/sidecar-protocol.md`. Provider implementations must return shared event schemas and must never expose provider-specific payloads or credentials to the desktop UI.
