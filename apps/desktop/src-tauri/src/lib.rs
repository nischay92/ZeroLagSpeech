use serde::Serialize;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::{net::TcpListener, sync::Mutex};
#[cfg(debug_assertions)]
use std::process::{Child, Command, Stdio};
use tauri::{Manager, PhysicalPosition, Position, State};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

const CREDENTIAL_SERVICE: &str = "org.zerolag.desktop.providers";
const PROVIDERS: [&str; 3] = ["deepgram", "elevenlabs", "cerebras"];

// File-based logging — stdout/stderr from a GUI-launched (non-terminal) app
// isn't reliably observable, so this is the only way to actually see what
// the sidecar-spawn code is doing at runtime in a packaged build. Proven
// necessary diagnosing two earlier spawn failures (a Tauri symlink guard,
// and node not being on a GUI-launched process's minimal PATH).
fn debug_log(msg: &str) {
    let home = std::env::var("HOME").unwrap_or_default();
    let dir = PathBuf::from(home).join("Library/Logs/ZeroLag");
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(mut f) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("sidecar-debug.log"))
    {
        let _ = writeln!(f, "[{:?}] {}", std::time::SystemTime::now(), msg);
        let _ = f.flush();
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeConfig {
    base_url: String,
    token: String,
    startup_error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProviderStatus {
    deepgram_configured: bool,
    elevenlabs_configured: bool,
    cerebras_configured: bool,
}

struct RuntimeState {
    config: RuntimeConfig,
    child: Mutex<Option<ManagedChild>>,
}

enum ManagedChild {
    #[cfg(debug_assertions)]
    Development(Child),
    #[cfg(not(debug_assertions))]
    Bundled(CommandChild),
}

impl ManagedChild {
    fn terminate(self) {
        match self {
            #[cfg(debug_assertions)]
            Self::Development(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(not(debug_assertions))]
            Self::Bundled(child) => {
                let _ = child.kill();
            }
        }
    }
}

fn credential(provider: &str) -> Result<keyring::Entry, String> {
    if !PROVIDERS.contains(&provider) {
        return Err("Unsupported provider".into());
    }
    keyring::Entry::new(CREDENTIAL_SERVICE, provider).map_err(|error| error.to_string())
}

fn has_credential(provider: &str) -> bool {
    credential(provider)
        .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        .is_ok_and(|secret| !secret.trim().is_empty())
}

fn available_port() -> Result<u16, String> {
    TcpListener::bind(("127.0.0.1", 0))
        .and_then(|listener| listener.local_addr())
        .map(|address| address.port())
        .map_err(|error| format!("Could not reserve a sidecar port: {error}"))
}

// Dev mode runs `node` directly on the sidecar source, the same way the
// Python scaffold runs its venv interpreter directly — no separate
// manually-started terminal needed anymore. Relies on PATH, which is fine
// here specifically because `tauri dev` is always launched from an
// interactive developer shell (unlike a packaged GUI launch, which gets a
// minimal PATH — that case uses the bundled binary via shell.sidecar()
// below instead, which does its own robust node/runtime resolution at
// build time via pkg).
#[cfg(debug_assertions)]
fn spawn_sidecar(_app: &tauri::AppHandle, port: u16, token: &str) -> Result<ManagedChild, String> {
    let sidecar_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../sidecar");
    let entry = sidecar_dir.join("src/server.js");

    if !entry.exists() {
        return Err(format!(
            "Sidecar source not found at {}. Run `npm install` in apps/sidecar once.",
            entry.display()
        ));
    }

    debug_log(&format!("dev spawn_sidecar: node {}", entry.display()));

    let mut command = Command::new("node");
    command
        .arg(&entry)
        .current_dir(&sidecar_dir)
        .env("ZEROLAG_SIDECAR_HOST", "127.0.0.1")
        .env("ZEROLAG_SIDECAR_PORT", port.to_string())
        .env("ZEROLAG_SIDECAR_TOKEN", token)
        .env("ZEROLAG_SIDECAR_ENVIRONMENT", "development")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    for provider in PROVIDERS {
        if let Ok(secret) = credential(provider)
            .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        {
            command.env(format!("{}_API_KEY", provider.to_uppercase()), secret);
        }
    }

    command
        .spawn()
        .map(ManagedChild::Development)
        .map_err(|error| format!("Could not launch the ZeroLag sidecar: {error}"))
}

#[cfg(not(debug_assertions))]
fn spawn_sidecar(app: &tauri::AppHandle, port: u16, token: &str) -> Result<ManagedChild, String> {
    debug_log("release spawn_sidecar: resolving bundled zerolag-sidecar binary");

    // The pkg-compiled binary runs from a read-only snapshot filesystem, so
    // notes.db can't live next to the source like it does in dev — point it
    // at a real, user-writable location instead.
    let home = std::env::var("HOME").unwrap_or_default();
    let db_path = PathBuf::from(home)
        .join("Library/Application Support/ZeroLag/notes.db");

    let mut command = app
        .shell()
        .sidecar("zerolag-sidecar")
        .map_err(|error| format!("Could not locate the bundled ZeroLag sidecar: {error}"))?
        .env("ZEROLAG_SIDECAR_HOST", "127.0.0.1")
        .env("ZEROLAG_SIDECAR_PORT", port.to_string())
        .env("ZEROLAG_SIDECAR_TOKEN", token)
        .env("ZEROLAG_SIDECAR_ENVIRONMENT", "packaged")
        .env("NOTES_DB_PATH", db_path.to_string_lossy().to_string());

    for provider in PROVIDERS {
        if let Ok(secret) = credential(provider)
            .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        {
            command = command.env(format!("{}_API_KEY", provider.to_uppercase()), secret);
        }
    }

    match command.spawn() {
        Ok((mut rx, child)) => {
            debug_log(&format!("sidecar spawned OK, pid={}", child.pid()));
            tauri::async_runtime::spawn(async move {
                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            debug_log(&format!("[stdout] {}", String::from_utf8_lossy(&line)));
                        }
                        CommandEvent::Stderr(line) => {
                            debug_log(&format!("[stderr] {}", String::from_utf8_lossy(&line)));
                        }
                        CommandEvent::Error(err) => {
                            debug_log(&format!("[spawn error event] {}", err));
                        }
                        CommandEvent::Terminated(payload) => {
                            debug_log(&format!("[terminated] {:?}", payload));
                        }
                        _ => {}
                    }
                }
            });
            Ok(ManagedChild::Bundled(child))
        }
        Err(error) => {
            debug_log(&format!("spawn() FAILED: {error}"));
            Err(format!("Could not launch the bundled ZeroLag sidecar: {error}"))
        }
    }
}

#[tauri::command]
fn runtime_config(runtime: State<'_, RuntimeState>) -> RuntimeConfig {
    runtime.config.clone()
}

#[tauri::command]
fn provider_status() -> ProviderStatus {
    ProviderStatus {
        deepgram_configured: has_credential("deepgram"),
        elevenlabs_configured: has_credential("elevenlabs"),
        cerebras_configured: has_credential("cerebras"),
    }
}

#[tauri::command]
fn save_provider_credential(provider: String, api_key: String) -> Result<(), String> {
    let secret = api_key.trim();
    if secret.is_empty() {
        return Err("API key cannot be empty".into());
    }
    credential(&provider)?
        .set_password(secret)
        .map_err(|error| format!("Could not save credential: {error}"))
}

#[tauri::command]
fn delete_provider_credential(provider: String) -> Result<(), String> {
    let entry = credential(&provider)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!("Could not remove credential: {error}")),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            runtime_config,
            provider_status,
            save_provider_credential,
            delete_provider_credential
        ])
        .setup(|app| {
            debug_log("setup() entered");
            let port = available_port().unwrap_or(43110);
            let token = Uuid::new_v4().to_string();
            let (child, startup_error) = match spawn_sidecar(app.handle(), port, &token) {
                Ok(child) => (Some(child), None),
                Err(error) => {
                    debug_log(&format!("spawn_sidecar returned error: {error}"));
                    (None, Some(error))
                }
            };
            app.manage(RuntimeState {
                config: RuntimeConfig {
                    base_url: format!("http://127.0.0.1:{port}"),
                    token,
                    startup_error,
                },
                child: Mutex::new(child),
            });

            if let Some(overlay) = app.get_webview_window("recorder-overlay") {
                if let Some(monitor) = overlay.current_monitor()? {
                    let screen = monitor.size();
                    let origin = monitor.position();
                    let window = overlay.outer_size()?;
                    let margin = (24.0 * monitor.scale_factor()) as i32;
                    let x = origin.x + screen.width as i32 - window.width as i32 - margin;
                    let y = origin.y + margin;
                    overlay.set_position(Position::Physical(PhysicalPosition::new(x, y)))?;
                }
            }
            debug_log("setup() returning Ok");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building ZeroLag")
        .run(|app, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                let runtime = app.state::<RuntimeState>();
                if let Ok(mut child) = runtime.child.lock() {
                    if let Some(process) = child.take() {
                        process.terminate();
                    }
                };
            }

            // The floating recorder-overlay is a separate, skipTaskbar,
            // always-on-top window — closing "main" alone doesn't close it
            // or quit the app (macOS keeps running as long as any window,
            // even a hidden-from-dock one, is still open). Closing main is
            // the intended "quit ZeroLag" action here, so tear everything
            // down together instead of leaving the overlay stranded.
            if let tauri::RunEvent::WindowEvent {
                label,
                event: tauri::WindowEvent::CloseRequested { .. },
                ..
            } = &event
            {
                if label == "main" {
                    if let Some(overlay) = app.get_webview_window("recorder-overlay") {
                        let _ = overlay.close();
                    }
                    app.exit(0);
                }
            }
        });
}
