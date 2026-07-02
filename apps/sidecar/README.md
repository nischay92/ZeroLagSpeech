# ZeroLag Python Sidecar

This directory is reserved for the local backend process bundled with ZeroLag Desktop.

Ownership:

- D: Deepgram speech and transcription integration
- G: Cerebras inference integration

The sidecar must bind only to loopback, implement the contract in `docs/sidecar-protocol.md`, avoid hosted database dependencies, and never log provider credentials.

Implementation begins after the desktop shell contract is approved.
