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
├── Bundled Node.js sidecar (packaged as a standalone binary via pkg)
│   ├── Deepgram + ElevenLabs speech integration
│   └── Cerebras inference integration
├── Local SQLite persistence (sessions, transcripts, notes, Q&A)
├── In-process session state
└── OS-secure provider credentials (macOS Keychain / Windows Credential Manager)
```

See `SETUP.md` for full setup/build instructions.

Repository layout:

- `apps/desktop` — Tauri desktop shell and React UI
- `apps/desktop/src-tauri` — native Rust application and bundle configuration
- `apps/sidecar` — Node.js backend implementing the sidecar protocol (owned by the provider maintainers)
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

See `SETUP.md` for the full, tested walkthrough. Quick version:

```bash
git clone https://github.com/nischay92/ZeroLagSpeech.git
cd ZeroLagSpeech
git checkout backend-integration
npm install
npm run dev
```

`npm run dev` starts Vite, launches the authenticated local Node sidecar on an available loopback port, and opens the native Tauri windows. The sidecar stops automatically when ZeroLag exits — no second terminal needed.

To work on the UI in a browser without launching Tauri:

```bash
npm run dev:ui
```

The browser-only development URL is <http://127.0.0.1:1420>. In this mode, start the sidecar yourself with `npm run dev:sidecar` in a second terminal.

Provider API keys are configured from **Provider settings** inside the desktop app. They are stored in macOS Keychain or Windows Credential Manager; they are never written to `.env`, local storage, or frontend assets.

## Verification

```bash
npm run lint
npm run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --release --manifest-path apps/desktop/src-tauri/Cargo.toml
```

## Desktop security rules

- The sidecar must bind only to a loopback address.
- Sidecar requests authenticate with a fresh per-launch secret.
- Provider credentials must use the operating system's secure credential store.
- Provider keys must never be committed, logged, or embedded in frontend assets.
- Local session data must remain on the user's machine unless the user explicitly enables a future sync feature.

## Planned milestones

1. Validate the Tauri macOS shell and development workflow. (complete)
2. Add cross-platform microphone capture, permissions, and floating recording controls. (complete)
3. Implement and package the sidecar lifecycle. (complete — Node.js, packaged as a standalone binary via pkg)
4. Integrate Deepgram speech streaming. (complete, plus ElevenLabs as a second provider)
5. Integrate Cerebras inference. (complete — rolling notes summary + real-time Q&A)
6. Add local sessions, transcripts, and artifacts. (complete — SQLite)
7. Build the live transcript and AI workspace. (complete)
8. Add secure provider settings. (complete)
9. Package and verify the macOS `.dmg`. (complete)
10. Package and verify Windows `.exe`/`.msi` installers.
11. Code signing / notarization (currently unsigned — see `SETUP.md`'s Keychain prompt note).

## Current status

The repository contains the cross-platform desktop shell, production recording controls, microphone capture, always-on-top overlay, automatic authenticated sidecar lifecycle (dev and packaged), native secure provider credentials, real Deepgram/ElevenLabs/Cerebras provider integration, SQLite persistence, and the versioned sidecar protocol. Windows packaging, code signing, and release verification remain pending. See `SETUP.md` for the full setup/build guide.

## Installer builds

Installer builds must run on their target operating system. Run `npm run tauri:build` on macOS to produce the `.dmg`, or on Windows to produce `.exe` (NSIS) and `.msi` installers. Output is written below `apps/desktop/src-tauri/target/release/bundle/`.

macOS prompts for microphone access on first use. On Windows, microphone access is controlled under **Settings → Privacy & security → Microphone**.
