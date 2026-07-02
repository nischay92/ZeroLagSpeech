# ZeroLag Desktop

ZeroLag is an open-source, local-first voice intelligence application for macOS and Windows. It turns live speech into transcripts and structured AI assistance without requiring users—or the project maintainers—to operate hosted application infrastructure.

The macOS `.dmg` is the first distribution target. Windows `.exe`/`.msi` packaging will follow from the same shared codebase.

## Product direction

The desktop application will provide a simple flow:

```text
Download → Install → Add provider keys → Start recording
```

Users will not need Docker, Node.js, Python, PostgreSQL, Redis, Supabase, or terminal commands. Internet access remains necessary for cloud speech and inference providers unless local providers are added later.

The earlier hosted-web implementation remains recoverable from Git history but is no longer part of the active desktop branch.

## Architecture

```text
ZeroLag Desktop
├── Tauri 2 native shell
├── React + Vite + TypeScript UI
├── Bundled Python sidecar
│   ├── Deepgram speech integration
│   └── Cerebras inference integration
├── Local persistence (planned)
├── In-process session state (planned)
└── OS-secure provider credentials (planned)
```

Repository layout:

- `apps/desktop` — Tauri desktop shell and React UI
- `apps/desktop/src-tauri` — native Rust application and bundle configuration
- `apps/sidecar` — reserved Python backend owned by the provider maintainers
- `docs/sidecar-protocol.md` — versioned UI-to-sidecar communication contract

## Team ownership

- Project lead: desktop architecture, Tauri shell, UI, local persistence, packaging, and releases
- D: Deepgram streaming speech and transcription integration
- G: Cerebras inference and structured-response integration

Provider implementations must remain behind the shared sidecar protocol. Changes to event envelopes, authentication, sidecar lifecycle, or shared response schemas require coordination before implementation.

## Prerequisites for contributors

- Node.js 20+
- Rust stable toolchain
- macOS: Xcode and Xcode Command Line Tools

Install Rust through <https://rustup.rs> or a supported system package manager.

## Development setup

```bash
git clone https://github.com/nischay92/ZeroLagSpeech.git
cd ZeroLagSpeech
git checkout desktop-mvp
npm install
npm run dev
```

`npm run dev` starts Vite and opens the native Tauri window.

To work on the UI in a browser without launching Tauri:

```bash
npm run dev:ui
```

The browser-only development URL is <http://127.0.0.1:1420>.

## Verification

```bash
npm run lint
npm run format:check
npm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Desktop security rules

- The sidecar must bind only to a loopback address.
- Packaged builds must authenticate sidecar requests with a per-launch secret.
- Provider credentials must use the operating system's secure credential store.
- Provider keys must never be committed, logged, or embedded in frontend assets.
- Local session data must remain on the user's machine unless the user explicitly enables a future sync feature.

## Planned milestones

1. Validate the Tauri macOS shell and development workflow.
2. Add macOS microphone capture and permissions.
3. Implement and package the Python sidecar lifecycle.
4. Integrate Deepgram speech streaming.
5. Integrate Cerebras inference.
6. Add local sessions, transcripts, and artifacts.
7. Build the live transcript and AI workspace.
8. Add secure provider settings.
9. Package and verify the macOS `.dmg`.
10. Add Windows packaging and `.exe`/`.msi` verification.

## Current status

The repository currently contains the desktop shell, initial UI, macOS bundle target, and sidecar protocol. Audio capture, provider implementations, persistence, secure key storage, and release packaging are intentionally pending.
