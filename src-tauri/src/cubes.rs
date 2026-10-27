//! Thin IPC adapter; capture owns all observed cube state.
use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
pub async fn cubes_status(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| live.cubes_status()).await
}

#[tauri::command]
pub async fn cubes_clear(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| live.cubes_clear()).await
}
