use tauri::{Manager, PhysicalPosition, Position};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
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
        .run(tauri::generate_context!())
        .expect("error while running ZeroLag");
}
