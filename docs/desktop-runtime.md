# Desktop runtime

ZeroLag owns the local provider sidecar for the lifetime of the desktop application.

## Development lifecycle

1. Rust reserves an available loopback port.
2. Rust generates a random per-launch authentication token.
3. Tauri starts `apps/sidecar/.venv` with the port and token in its environment.
4. React obtains runtime metadata through a private Tauri command.
5. The UI checks `/health` and opens authenticated session WebSockets.
6. Tauri terminates and reaps the sidecar when the application exits.

The token is never persisted. The sidecar binds only to `127.0.0.1`.

## Credentials

Provider API keys are written and deleted only by Rust commands. macOS uses Keychain and Windows uses Credential Manager. React receives configuration booleans, never stored secret values. Keys are provided to the provider sidecar through its private process environment.

## Release packaging

TODO(packaging): Build `zerolag-sidecar` with PyInstaller on each target runner, name it with Tauri's target-triple convention, configure it under `bundle.externalBin`, and select that executable in release builds. A macOS-produced Python binary cannot be shipped as the Windows sidecar, so both artifacts must be generated in their native release jobs.
