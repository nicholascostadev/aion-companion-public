use companion_capture::{activities, LiveCapture};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn timers_status(app: AppHandle) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let capture = app.state::<LiveCapture>();
        let pets = capture.pets_status(None)?;
        let mut alerts = capture.alerts_status()?;
        alerts["live_observations"] =
            (pets["running"] == true && pets["phase"] == "capturing").into();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64);
        Ok(activities::timers_status(&alerts, now))
    })
    .await
    .map_err(|e| e.to_string())?
}
