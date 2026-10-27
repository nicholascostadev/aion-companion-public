//! Desktop IPC adapters for capture. Command names and payloads are stable;
//! state locking, aggregation and filesystem work run on blocking workers.
use companion_capture::LiveCapture;
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn live_configure(
    auto_end: bool,
    party_only: bool,
    app: AppHandle,
) -> Result<Value, String> {
    crate::background::capture(app, move |live| live.configure(auto_end, party_only)).await
}

#[tauri::command]
pub async fn live_status(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, LiveCapture::snapshot).await
}

#[tauri::command]
pub async fn group_status(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| {
        let mut status = live.group_snapshot()?;
        if cfg!(feature = "development") {
            status["protocol_diagnostic"] = live.group_debug_snapshot()?;
        }
        Ok(status)
    })
    .await
}

#[tauri::command]
pub async fn live_reset(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, LiveCapture::reset).await
}

#[tauri::command]
pub async fn save_live_comparison(app: AppHandle) -> Result<String, String> {
    crate::background::run(move || save_comparison(&app)).await
}

// Shutdown already runs outside the event thread and needs a synchronous result
// before allowing the launcher to replace this process.
pub fn save_comparison(app: &AppHandle) -> Result<String, String> {
    let report = app.state::<LiveCapture>().comparison_report()?;
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("comparisons");
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let path = folder.join(format!("{stamp}.comparison.json"));
    let file = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    let mut writer = std::io::BufWriter::new(file);
    serde_json::to_writer_pretty(&mut writer, &report).map_err(|e| e.to_string())?;
    std::io::Write::flush(&mut writer).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}
