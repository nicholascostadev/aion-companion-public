use serde_json::Value;
use tauri::AppHandle;

#[tauri::command]
pub async fn pets_catalogue() -> Result<tauri::ipc::Response, String> {
    crate::background::run(|| {
        // Response::new(String) treats this as JSON, retaining the command's object payload.
        // Avoid parsing and cloning the entire catalogue for each WebView request.
        Ok(tauri::ipc::Response::new(
            companion_capture::pet_catalogue().to_owned(),
        ))
    })
    .await
}
#[tauri::command]
pub async fn pets_status(profile_id: Option<String>, app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, move |live| live.pets_status(profile_id.as_deref())).await
}
#[tauri::command]
pub async fn pets_motion(profile_id: Option<String>, app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, move |live| live.pets_motion(profile_id.as_deref())).await
}
#[tauri::command]
pub async fn pets_configure(config: Value, app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, move |live| live.pets_configure(config)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    #[test]
    fn catalogue_reply_remains_the_complete_json_object() {
        let response = tauri::async_runtime::block_on(pets_catalogue()).unwrap();
        let InvokeResponseBody::Json(json) = response.body().unwrap() else {
            panic!("The catalogue command must return JSON, not binary bytes");
        };
        assert_eq!(json, companion_capture::pet_catalogue());
        let payload: Value = serde_json::from_str(&json).unwrap();
        assert!(payload.is_object());
        assert_eq!(payload["pets"].as_array().unwrap().len(), 207);
        assert!(payload["maps"].as_array().unwrap().len() > 200);
        assert!(payload["thresholds_provenance"].is_object());
    }
}
