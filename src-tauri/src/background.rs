//! Blocking native command work must not run on the desktop event thread or on
//! an async executor worker. Window operations stay in their desktop adapters.
use companion_capture::LiveCapture;
use tauri::{AppHandle, Manager};

pub async fn run<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let result = tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| e.to_string())
        .and_then(|result| result);
    if let Err(error) = &result {
        companion_capture::diagnostics::record("error", "native-command", error);
    }
    result
}

pub async fn capture<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&LiveCapture) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    run(move || work(&app.state::<LiveCapture>())).await
}
