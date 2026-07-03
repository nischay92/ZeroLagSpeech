# ZeroLag Desktop — Setup Guide

Practical, tested setup instructions for this branch. The sidecar is
**Node.js**, not Python — see `apps/sidecar/README.md` for why, and
`docs/sidecar-protocol.md` for the full wire contract.

## Prerequisites

- **Node.js 20+** (needed for the desktop app's dev workflow and the
  sidecar's dev mode; the *packaged* app does not require Node on the
  end user's machine — see "Standalone packaging" below)
- **Rust stable toolchain** — install via [rustup.rs](https://rustup.rs):
  ```bash
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
  ```
- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **API keys** for Deepgram, ElevenLabs, and Cerebras (ElevenLabs is
  optional — Deepgram is the default speech provider)

## Clone and install

```bash
git clone https://github.com/nischay92/ZeroLagSpeech.git
cd ZeroLagSpeech
git checkout backend-integration   # this branch
npm install
```

`npm install` at the root installs both workspaces (`apps/desktop` and
`apps/sidecar`) via npm workspaces.

## Development

Two ways to run it, depending on what you're working on:

### Full native app (Tauri window)

```bash
npm run dev
```

This starts Vite and opens the native Tauri window. **The sidecar is
spawned automatically** — `apps/desktop/src-tauri/src/lib.rs` runs
`node apps/sidecar/src/server.js` directly in dev mode, on a dynamically
allocated port with a per-launch auth token. You do not need a second
terminal for the sidecar.

### Browser-only UI (faster iteration, no native window)

```bash
npm run dev:ui
```

Opens at `http://127.0.0.1:1420`. In this mode there's no Tauri runtime to
auto-spawn the sidecar, so start it yourself in a second terminal:

```bash
npm run dev:sidecar
```

The browser build falls back to `VITE_SIDECAR_URL` /
`VITE_SIDECAR_TOKEN` env vars (see `apps/desktop/src/lib/runtime.ts`),
defaulting to `http://127.0.0.1:43110` / `local-development-token` if
unset — these must match whatever the sidecar is actually listening on.

### Providing API keys in dev

The **native app** (`npm run dev`) reads provider keys from the macOS
Keychain, same as a packaged build — open the app, click **Provider
settings**, paste in your keys, save, then fully quit and relaunch
(keys are only read once at sidecar spawn time).

For **standalone sidecar testing** (`npm run dev:sidecar` on its own, or
running `apps/sidecar` directly), copy the example env file and fill in
real keys:

```bash
cd apps/sidecar
cp .env.example .env
# edit .env with real DEEPGRAM_API_KEY / ELEVENLABS_API_KEY / CEREBRAS_API_KEY
npm start
```

`apps/sidecar/.env` is gitignored — never commit it.

## Building the `.dmg`

```bash
npm run tauri:build
```

This chain does three things:
1. `node scripts/build-sidecar.mjs` compiles the sidecar into a single
   standalone binary via `@yao-pkg/pkg` (embeds the Node runtime itself —
   the packaged app does **not** require Node.js on the machine that
   runs it), output to
   `apps/desktop/src-tauri/binaries/zerolag-sidecar-<rust-target-triple>`.
2. `npm run build` (Vite) builds the frontend.
3. `tauri build --config src-tauri/tauri.release.conf.json` builds the
   Rust app and bundles everything into `.app` / `.dmg`.

Output lands in
`apps/desktop/src-tauri/target/release/bundle/dmg/ZeroLag_<version>_<arch>.dmg`.

### First-run Keychain prompt (expected, not a bug)

The app isn't code-signed with a real Apple Developer certificate, so
each freshly-built binary has an unstable identity as far as macOS
Keychain ACLs are concerned. The **first time** a newly built app tries
to read previously-saved provider keys, macOS will show:

> "ZeroLag wants to use your confidential information stored in
> 'org.zerolag.desktop.providers' in your keychain."

That password field is your **Mac login password**, not anything
ZeroLag-specific. Click **Always Allow**. This will happen again on the
next rebuild, since it's tied to the binary's (unstable, unsigned)
identity — the only real fix is proper code signing with an Apple
Developer ID, which needs a paid Apple Developer Program enrollment and
is out of scope here.

## Verification checklist

```bash
npm run lint
npm run build
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --release --manifest-path apps/desktop/src-tauri/Cargo.toml
```

For a full manual pass after building the `.dmg`:
1. Mount the `.dmg`, drag `ZeroLag.app` to `/Applications` (don't run
   directly from a symlinked path like an iCloud-synced Desktop — Tauri's
   sidecar resolver explicitly refuses to run from a path containing a
   symlink).
2. Open the app, go to **Provider settings**, save your three keys.
3. Fully quit and reopen (keys are read once at sidecar spawn).
4. Click **Start recording**, confirm the floating overlay appears,
   speak, confirm live transcript + running notes + Q&A all populate.
5. Close the main window and confirm the app **and** the floating
   overlay both fully quit — no leftover `zerolag-desktop` /
   `zerolag-sidecar` processes (`ps aux | grep zerolag`).

## Known gaps

- No code signing / notarization — see the Keychain prompt note above.
- Windows packaging (`.exe`/`.msi`) is not covered here; this guide is
  macOS-only, matching what's actually been built and tested on this
  branch.
- The packaged-app sidecar auth token model is implemented and verified,
  but the sidecar itself is unsigned, so treat this as a working local
  build, not something ready for distribution to end users outside the
  team.
