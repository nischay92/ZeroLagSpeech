# ZeroLag Desktop

ZeroLag is an open-source, local-first voice intelligence application for macOS and Windows. It turns live speech into transcripts and structured AI assistance without requiring users—or the project maintainers—to operate hosted application infrastructure.

The same shared codebase produces a macOS `.dmg` and Windows `.exe`/`.msi` installers.

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
- Windows: Microsoft C++ Build Tools and WebView2

Install Rust through <https://rustup.rs> or a supported system package manager.

## Development setup

```bash
git clone https://github.com/nischay92/ZeroLagSpeech.git
cd ZeroLagSpeech
git checkout desktop-mvp
npm install
npm run setup:sidecar
npm run dev
```

`npm run dev` starts Vite, launches the authenticated local sidecar on an available loopback port, and opens the native Tauri windows. The sidecar stops automatically when ZeroLag exits.

To work on the UI in a browser without launching Tauri:

```bash
npm run dev:ui
```

The browser-only development URL is <http://127.0.0.1:1420>.

To set up the local Python sidecar manually instead of using `npm run setup:sidecar`:

```bash
cd apps/sidecar
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cd apps/sidecar
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

You do not need to run the sidecar in a second terminal. The desktop runtime owns its process, random port, and per-launch authentication token.

Provider API keys are configured from **Provider settings** inside the desktop app. They are stored in macOS Keychain or Windows Credential Manager; they are never written to `.env`, local storage, or frontend assets.

## Verification

```bash
npm run lint
npm run format:check
npm run build
cargo fmt --manifest-path apps/desktop/src-tauri/Cargo.toml --check
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml

cd apps/sidecar
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/pytest
```

## Desktop security rules

- The sidecar must bind only to a loopback address.
- Sidecar requests authenticate with a fresh per-launch secret.
- Provider credentials must use the operating system's secure credential store.
- Provider keys must never be committed, logged, or embedded in frontend assets.
- Local session data must remain on the user's machine unless the user explicitly enables a future sync feature.

## Planned milestones

1. Validate the Tauri macOS shell and development workflow.
2. Add cross-platform microphone capture, permissions, and floating recording controls. (complete)
3. Implement and package the Python sidecar lifecycle.
4. Integrate Deepgram speech streaming.
5. Integrate Cerebras inference.
6. Add local sessions, transcripts, and artifacts.
7. Build the live transcript and AI workspace.
8. Add secure provider settings.
9. Package and verify the macOS `.dmg`.
10. Package and verify Windows `.exe`/`.msi` installers.

## Current status

The repository currently contains the cross-platform desktop shell, production recording controls, microphone capture, always-on-top overlay, automatic authenticated development-sidecar lifecycle, native secure provider credentials, mock providers, and versioned sidecar protocol. Provider integration, persistence, packaged PyInstaller binaries, code signing, and release verification remain pending.

## Installer builds

Installer builds must run on their target operating system. Run `npm run tauri:build` on macOS to produce the `.dmg`, or on Windows to produce `.exe` (NSIS) and `.msi` installers. Output is written below `apps/desktop/src-tauri/target/release/bundle/`.

macOS prompts for microphone access on first use. On Windows, microphone access is controlled under **Settings → Privacy & security → Microphone**.
