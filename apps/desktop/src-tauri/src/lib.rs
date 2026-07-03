use serde::Serialize;
use std::{net::TcpListener, sync::Mutex};
#[cfg(debug_assertions)]
use std::{
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
};
use tauri::{Manager, PhysicalPosition, Position, State};
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::process::CommandChild;
#[cfg(not(debug_assertions))]
use tauri_plugin_shell::ShellExt;
use uuid::Uuid;

const CREDENTIAL_SERVICE: &str = "org.zerolag.desktop.providers";
const PROVIDERS: [&str; 2] = ["deepgram", "cerebras"];

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

#[cfg(debug_assertions)]
fn development_python(sidecar_dir: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    return sidecar_dir.join(".venv/Scripts/python.exe");

    #[cfg(not(target_os = "windows"))]
    sidecar_dir.join(".venv/bin/python")
}

#[cfg(debug_assertions)]
fn spawn_sidecar(_app: &tauri::AppHandle, port: u16, token: &str) -> Result<ManagedChild, String> {
    let sidecar_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../sidecar");
    let python = development_python(&sidecar_dir);

    if !python.exists() {
        return Err(format!(
            "Sidecar environment not found at {}. Run the sidecar setup once.",
            python.display()
        ));
    }

    let mut command = Command::new(python);
    command
        .args(["-m", "zerolag_sidecar"])
        .current_dir(sidecar_dir)
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
    let mut command = app
        .shell()
        .sidecar("zerolag-sidecar")
        .map_err(|error| format!("Could not locate the bundled ZeroLag sidecar: {error}"))?
        .env("ZEROLAG_SIDECAR_HOST", "127.0.0.1")
        .env("ZEROLAG_SIDECAR_PORT", port.to_string())
        .env("ZEROLAG_SIDECAR_TOKEN", token)
        .env("ZEROLAG_SIDECAR_ENVIRONMENT", "packaged");

    for provider in PROVIDERS {
        if let Ok(secret) = credential(provider)
            .and_then(|entry| entry.get_password().map_err(|error| error.to_string()))
        {
            command = command.env(format!("{}_API_KEY", provider.to_uppercase()), secret);
        }
    }

    command
        .spawn()
        .map(|(_events, child)| ManagedChild::Bundled(child))
        .map_err(|error| format!("Could not launch the bundled ZeroLag sidecar: {error}"))
}

#[tauri::command]
fn runtime_config(runtime: State<'_, RuntimeState>) -> RuntimeConfig {
    runtime.config.clone()
}

#[tauri::command]
fn provider_status() -> ProviderStatus {
    ProviderStatus {
        deepgram_configured: has_credential("deepgram"),
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
            let port = available_port().unwrap_or(43110);
            let token = Uuid::new_v4().to_string();
            let (child, startup_error) = match spawn_sidecar(app.handle(), port, &token) {
                Ok(child) => (Some(child), None),
                Err(error) => (None, Some(error)),
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
        });
}
