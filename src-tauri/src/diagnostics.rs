//! Explicit manual support export. No upload, arbitrary file reads or packet data.
use companion_capture::{diagnostics as log, LiveCapture};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

pub fn install_panic_hook() {
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        crate::crash::panic(info);
        previous(info);
    }));
}

pub fn initialize(app: &AppHandle) {
    let result = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())
        .and_then(|root| log::initialize(root.join("diagnostics")));
    if let Err(error) = result {
        log::persistence_failed(&error);
    }
    log::record(
        "info",
        "application",
        &format!(
            "Started Aion Companion {} ({})",
            env!("CARGO_PKG_VERSION"),
            env!("AION_BUILD_REVISION")
        ),
    );
}

#[tauri::command]
pub async fn diagnostics_record(
    level: String,
    source: String,
    message: String,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    if message.len() > 32 * 1024 || source.len() > 256 {
        return Err("Diagnostic message exceeds its size limit".into());
    }
    log::record(
        &level,
        &format!("frontend:{}:{source}", window.label()),
        &message,
    );
    Ok(())
}

fn section(result: Result<Value, String>) -> Value {
    result.unwrap_or_else(|error| json!({"error":log::sanitize_text(&error)}))
}

fn report(
    frontend: Value,
    capture: Value,
    overlay: Value,
    windows: Value,
    crashes: Value,
) -> Result<String, String> {
    // Enforce before serialization/sanitization to avoid an unbounded client report.
    if serde_json::to_vec(&frontend)
        .map_err(|e| e.to_string())?
        .len()
        > 1024 * 1024
    {
        return Err("Frontend diagnostics exceed 1 MiB".into());
    }
    serde_json::to_string_pretty(&json!({
        "kind":"aion-companion-diagnostics","schema_version":1,
        "exported_at_ms":std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |t|t.as_millis() as u64),
        "build":crate::build_info::app_build_info(),
        "system":{"os":std::env::consts::OS,"architecture":std::env::consts::ARCH,"os_version":os_version()},
        "privacy":{"manual_sharing_only":true,"may_contain_character_names":true,
            "excluded":["raw packets","recordings","saved combat logs","account storage","environment variables","crash minidumps"],
            "redaction":"Best effort: local home paths, URLs and common credential fields/messages. Review before sharing."},
        "logs":log::snapshot(),
        "crashes":crashes,
        "capture":log::sanitize(&capture),"overlay":log::sanitize(&overlay),
        "windows":log::sanitize(&windows),"frontend":log::sanitize(&frontend)
    })).map_err(|e| e.to_string())
}

#[cfg(windows)]
fn os_version() -> String {
    // Windows' built-in version command contains no account or machine identifier.
    use std::os::windows::process::CommandExt;
    std::process::Command::new("cmd.exe")
        .args(["/d", "/c", "ver"])
        .creation_flags(0x08000000)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .trim()
                .chars()
                .take(256)
                .collect()
        })
        .unwrap_or_else(|| "unavailable".into())
}
#[cfg(not(windows))]
fn os_version() -> String {
    "unavailable".into()
}

#[tauri::command]
pub async fn diagnostics_export(frontend: Option<Value>, app: AppHandle) -> Result<String, String> {
    crate::background::run(move || {
        log::record("info", "diagnostics", "User requested a manual diagnostic report");
        let capture = section(app.state::<LiveCapture>().support_snapshot());
        let mut overlay = crate::overlay::overlay_status(app.clone());
        // The recording destination is unrelated to support and may contain local paths.
        if let Some(object) = overlay.as_object_mut() { object.remove("saved_path"); }
        let windows = app.webview_windows().into_iter().map(|(label, window)| json!({
            "label":label,"visible":window.is_visible().ok(),"scale_factor":window.scale_factor().ok(),
            "size":window.inner_size().ok().map(|s|json!({"width":s.width,"height":s.height})),
            "position":window.outer_position().ok().map(|p|json!({"x":p.x,"y":p.y}))
        })).collect::<Vec<_>>();
        report(frontend.unwrap_or(Value::Null), capture, overlay, json!(windows), crate::crash::support_snapshot())
    }).await
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn export_has_versioned_native_format_and_sanitized_partial_state() {
        let exported = report(
            json!({"token":"private","message":"Error https://host/secret"}),
            section(Err("Capture state unavailable".into())),
            json!({"raw_packet":"ffff"}),
            json!([]),
            json!({"reports":[{"file":"crash-1-panic.txt","lines":["Summary: panic"]}]}),
        )
        .unwrap();
        let value: Value = serde_json::from_str(&exported).unwrap();
        assert_eq!(value["kind"], "aion-companion-diagnostics");
        assert_eq!(value["schema_version"], 1);
        assert_eq!(value["capture"]["error"], "Capture state unavailable");
        assert!(value["frontend"].get("token").is_none());
        assert!(!exported.contains("host/secret"));
        assert_eq!(value["overlay"], json!({}));
        assert!(value["build"]["version"].is_string());
        assert_eq!(value["crashes"]["reports"][0]["lines"][0], "Summary: panic");
    }
    #[test]
    fn rejects_oversized_frontend_reports() {
        assert!(report(
            json!({"message":"x".repeat(1024*1024)}),
            Value::Null,
            Value::Null,
            Value::Null,
            Value::Null
        )
        .is_err());
    }

    #[test]
    fn accepts_bounded_frontend_logs_with_multibyte_messages() {
        let entries = (0..100)
            .map(|_| json!({"message":"界".repeat(2000)}))
            .collect::<Vec<_>>();
        assert!(report(
            json!({"entries":entries}),
            Value::Null,
            Value::Null,
            Value::Null,
            Value::Null
        )
        .is_ok());
    }
}
