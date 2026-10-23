//! Desktop shell for Railplot. The editor itself is the web app in `dist/`;
//! this side only provides file access, native file dialogs, USB serial ports and updating itself.
mod serial;

use std::fs;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

#[tauri::command]
fn write_binary_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path}: {e}"))
}

/// A .railplot file passed on the command line (for example by double-clicking it in Explorer).
#[tauri::command]
fn startup_file() -> Option<String> {
    std::env::args()
        .skip(1)
        .find(|a| a.to_lowercase().ends_with(".railplot"))
}

/// A newer Railplot on the release page, as the updater found it.
#[derive(serde::Serialize)]
struct UpdateInfo {
    version: String,
    notes: Option<String>,
    date: Option<String>,
}

/// Can this copy update itself? Only builds made with an update signing key carry the updater settings.
#[tauri::command]
fn can_update(app: tauri::AppHandle) -> bool {
    app.try_state::<UpdaterOn>().is_some()
}

struct UpdaterOn;

fn updater(app: &tauri::AppHandle) -> Result<tauri_plugin_updater::Updater, String> {
    if app.try_state::<UpdaterOn>().is_none() {
        return Err("This copy of Railplot was built without updates.".into());
    }
    app.updater().map_err(|e| e.to_string())
}

/// Ask the release page for a newer version. `None`: this is the newest.
#[tauri::command]
async fn check_update(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let found = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    Ok(found.map(|u| UpdateInfo { version: u.version.clone(), notes: u.body.clone(), date: u.date.map(|d| d.to_string()) }))
}

/// Download the newer version, check its signature, install it and start it.
/// Progress goes to the page as "update-progress" events: [bytes so far, total bytes or null].
#[tauri::command]
async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    let found = updater(&app)?.check().await.map_err(|e| e.to_string())?;
    let Some(update) = found else { return Err("Railplot is already up to date.".into()) };
    let mut done: u64 = 0;
    let progress = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit("update-progress", (done, total));
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let context = tauri::generate_context!();
    // the release workflow adds the updater settings (the update signing key's public half) when it has
    // the key; a build without them still runs, and offers the download page instead
    let updates = context.config().plugins.0.contains_key("updater");
    let mut builder = tauri::Builder::default().plugin(tauri_plugin_dialog::init()).manage(serial::Ports::default());
    if updates {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build()).manage(UpdaterOn);
    }
    builder
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_text_file,
            write_binary_file,
            startup_file,
            can_update,
            check_update,
            install_update,
            serial::serial_ports,
            serial::serial_open,
            serial::serial_write,
            serial::serial_close
        ])
        .run(context)
        .expect("error while running Railplot");
}
