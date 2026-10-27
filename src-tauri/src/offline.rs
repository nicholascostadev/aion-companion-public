use crate::background::capture as background;
use companion_capture::LiveCapture;
use serde_json::Value;
use tauri::{AppHandle, Manager};

#[tauri::command]
pub async fn offline_status(app: AppHandle) -> Result<Value, String> {
    background(app, |live| live.offline_status()).await
}
#[tauri::command]
pub async fn offline_live_status(app: AppHandle) -> Result<Value, String> {
    background(app, |live| live.offline_live_status()).await
}
/// A locked, non-activating overlay copies without selecting/focusing DOM elements.
#[tauri::command]
pub fn offline_copy_text(text: String, app: AppHandle) -> Result<(), String> {
    if text.len() > 1024 * 1024 {
        return Err("Clipboard text exceeds 1 MiB".into());
    }
    clipboard(&app, &text)
}
#[tauri::command]
pub async fn offline_positions(
    preset_id: String,
    positions: Value,
    app: AppHandle,
) -> Result<Value, String> {
    background(app, move |live| {
        live.offline_positions(&preset_id, positions)
    })
    .await
}
#[tauri::command]
pub async fn offline_configure(app: AppHandle, settings: Value) -> Result<Value, String> {
    crate::background::run(move || {
        let live = app.state::<LiveCapture>();
        let saved = live.offline_configure_with(settings, |next| {
            crate::overlay::configure_hotkeys(&app, next)
        })?;
        crate::ui_preferences::committed(&app);
        Ok(saved)
    })
    .await
}
#[tauri::command]
pub async fn offline_logs(query: Value, app: AppHandle) -> Result<Value, String> {
    background(app, move |live| live.offline_logs(query)).await
}
#[tauri::command]
pub async fn offline_log(
    id: String,
    boss_only: Option<bool>,
    app: AppHandle,
) -> Result<Value, String> {
    background(app, move |live| {
        live.offline_log_filtered(&id, boss_only.unwrap_or(false))
    })
    .await
}
#[tauri::command]
pub async fn offline_log_rename(
    id: String,
    label: String,
    app: AppHandle,
) -> Result<Value, String> {
    background(app, move |live| live.offline_log_rename(&id, &label)).await
}
#[tauri::command]
pub async fn offline_log_delete(ids: Vec<String>, app: AppHandle) -> Result<usize, String> {
    background(app, move |live| live.offline_log_delete(&ids)).await
}
/// Full report of exactly this fight: the current one while it is still recording (no
/// detail clipping), otherwise the saved log. Another fight is never substituted.
#[tauri::command]
pub async fn offline_inspect(id: String, app: AppHandle) -> Result<Value, String> {
    background(app, move |live| live.offline_inspect(&id)).await
}
#[tauri::command]
pub async fn offline_export(id: String, app: AppHandle) -> Result<String, String> {
    background(app, move |live| live.offline_export(&id)).await
}
#[tauri::command]
pub async fn offline_catalogue_import(json: String, app: AppHandle) -> Result<Value, String> {
    background(app, move |live| live.offline_catalogue_import(&json)).await
}
#[tauri::command]
pub async fn offline_summary(
    id: Option<String>,
    multiline: bool,
    app: AppHandle,
) -> Result<String, String> {
    background(app, move |live| {
        live.offline_summary(id.as_deref(), multiline)
    })
    .await
}
#[tauri::command]
pub async fn offline_action(
    action: String,
    summary: Option<bool>,
    app: AppHandle,
) -> Result<Value, String> {
    background(app, move |live| {
        match action.as_str() {
            "save" => {
                live.offline_save()?;
            }
            "reset" => {
                live.reset()?;
            }
            "clear" => {
                live.offline_clear()?;
            }
            "open_data_folder" => {
                let path = live.offline_data_folder()?;
                #[cfg(windows)]
                {
                    std::process::Command::new("explorer.exe")
                        .arg(path)
                        .spawn()
                        .map_err(|e| e.to_string())?;
                }
            }
            _ => return Err("Unknown offline action".into()),
        };
        if summary.unwrap_or(false) {
            live.offline_live_status()
        } else {
            live.offline_status()
        }
    })
    .await
}

pub fn initialize(app: &AppHandle) -> Result<(), String> {
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("offline");
    app.state::<LiveCapture>().initialize_offline(folder)
}

#[cfg(windows)]
pub fn clipboard(app: &AppHandle, text: &str) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "user32")]
    extern "system" {
        fn OpenClipboard(hwnd: *mut c_void) -> i32;
        fn CloseClipboard() -> i32;
        fn EmptyClipboard() -> i32;
        fn SetClipboardData(format: u32, data: *mut c_void) -> *mut c_void;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalAlloc(flags: u32, bytes: usize) -> *mut c_void;
        fn GlobalLock(handle: *mut c_void) -> *mut c_void;
        fn GlobalUnlock(handle: *mut c_void) -> i32;
        fn GlobalFree(handle: *mut c_void) -> *mut c_void;
    }
    let owner = app
        .get_webview_window("main")
        .ok_or("Clipboard owner unavailable")?
        .hwnd()
        .map_err(|e| e.to_string())?
        .0 as *mut c_void;
    let data: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let handle = GlobalAlloc(2, data.len() * 2);
        if handle.is_null() {
            return Err("Clipboard allocation failed".into());
        }
        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            GlobalFree(handle);
            return Err("Clipboard memory unavailable".into());
        }
        std::ptr::copy_nonoverlapping(data.as_ptr(), ptr.cast(), data.len());
        GlobalUnlock(handle);
        if OpenClipboard(owner) == 0 {
            GlobalFree(handle);
            return Err("Clipboard is busy".into());
        }
        EmptyClipboard();
        let copied = !SetClipboardData(13, handle).is_null();
        CloseClipboard();
        if !copied {
            GlobalFree(handle);
            return Err("Could not copy summary".into());
        }
    }
    Ok(())
}
#[cfg(not(windows))]
pub fn clipboard(_: &AppHandle, _: &str) -> Result<(), String> {
    Err("Native clipboard is available on Windows".into())
}
