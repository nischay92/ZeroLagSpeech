# Desktop runtime

ZeroLag owns the local provider sidecar for the lifetime of the desktop application.

## Development lifecycle

1. Rust reserves an available loopback port.
2. Rust generates a random per-launch authentication token.
3. Tauri starts the sidecar — `node apps/sidecar/src/server.js` directly in dev mode, or the bundled standalone binary in packaged builds — with the port and token in its environment.
4. React obtains runtime metadata through a private Tauri command.
5. The UI checks `/health` and opens authenticated session WebSockets.
6. Tauri terminates and reaps the sidecar when the application exits.

The token is never persisted. The sidecar binds only to `127.0.0.1`.

## Credentials

Provider API keys are written and deleted only by Rust commands. macOS uses Keychain and Windows uses Credential Manager. React receives configuration booleans, never stored secret values. Keys are provided to the provider sidecar through its private process environment.

## Release packaging

`scripts/build-sidecar.mjs` compiles `apps/sidecar` into a single standalone binary with `@yao-pkg/pkg` (embeds the Node runtime — no Node install required on the end user's machine), names it with Tauri's target-triple convention, and writes it to `apps/desktop/src-tauri/binaries/`, where `bundle.externalBin` (in `apps/desktop/src-tauri/tauri.release.conf.json`) picks it up. `npm run tauri:build` runs this automatically. A macOS-built binary cannot be shipped as the Windows sidecar — both must be built on their native platform.
