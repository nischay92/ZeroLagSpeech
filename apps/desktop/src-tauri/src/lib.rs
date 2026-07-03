use std::fs::OpenOptions;
use std::io::Write;
use std::sync::Mutex;
use tauri::Manager;

struct SidecarState(Mutex<Option<tauri_plugin_shell::process::CommandChild>>);

fn log_path() -> std::path::PathBuf {
    let dir = dirs_home().join("Library/Logs/ZeroLag");
    let _ = std::fs::create_dir_all(&dir);
    dir.join("sidecar-debug.log")
}

fn dirs_home() -> std::path::PathBuf {
    std::env::var("HOME").map(std::path::PathBuf::from).unwrap_or_default()
}

// File-based logging instead of println!/eprintln! — stdout/stderr from a
// GUI-launched (non-terminal) app isn't reliably observable, so this is the
// only way to actually see what the sidecar-spawn code is doing at runtime.
fn debug_log(msg: &str) {
    if let Ok(mut f) = OpenOptions::new().create(true).append(true).open(log_path()) {
        let _ = writeln!(f, "[{}] {}", chrono_now(), msg);
        let _ = f.flush();
    }
}

fn chrono_now() -> String {
    format!("{:?}", std::time::SystemTime::now())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .setup(|_app| {
            debug_log("setup() entered");
            debug_log(&format!("current_exe = {:?}", std::env::current_exe()));
            debug_log(&format!("debug_assertions active = {}", cfg!(debug_assertions)));

            // Only auto-spawn the bundled sidecar in release/packaged builds.
            // In `tauri dev`, the sidecar is already run manually in a
            // separate terminal per apps/sidecar/README.md — auto-spawning
            // here too would just fight it for port 43110.
            #[cfg(not(debug_assertions))]
            {
                use tauri_plugin_shell::process::CommandEvent;
                use tauri_plugin_shell::ShellExt;

                debug_log("resolving sidecar command...");
                let shell = _app.shell();
                match shell.sidecar("zerolag-sidecar") {
                    Ok(cmd) => {
                        debug_log("sidecar command resolved OK, spawning...");
                        match cmd.spawn() {
                            Ok((mut rx, child)) => {
                                debug_log(&format!("sidecar spawned OK, pid={}", child.pid()));
                                let state = _app.state::<SidecarState>();
                                *state.0.lock().unwrap() = Some(child);

                                tauri::async_runtime::spawn(async move {
                                    debug_log("event reader task started");
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
                                            _ => {
                                                debug_log("[other event]");
                                            }
                                        }
                                    }
                                    debug_log("event reader task ended (channel closed)");
                                });
                            }
                            Err(e) => {
                                debug_log(&format!("spawn() FAILED: {}", e));
                            }
                        }
                    }
                    Err(e) => {
                        debug_log(&format!("shell.sidecar() FAILED: {}", e));
                    }
                }
            }
            debug_log("setup() returning Ok");
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let state = window.state::<SidecarState>();
                let mut guard = state.0.lock().unwrap();
                if let Some(child) = guard.take() {
                    let _ = child.kill();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running ZeroLag");
}
