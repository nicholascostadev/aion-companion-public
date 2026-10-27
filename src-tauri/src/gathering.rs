//! Thin IPC adapter for captured player position. Gathering placements are bundled metadata.
use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
pub async fn gathering_status(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| live.gathering_status()).await
}
