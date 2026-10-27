//! Native UI follows the durable offline language preference, even without a workspace.
use companion_capture::{localization, LiveCapture};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::{menu::MenuItemKind, AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct NativeUi(Mutex<Vec<(&'static str, MenuItemKind<tauri::Wry>)>>);

#[tauri::command]
pub async fn ui_preferences(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| {
        let settings = live.offline_settings()?;
        Ok(json!({"locale": settings["locale"].as_str().unwrap_or("en")}))
    })
    .await
}

fn saved_locale(app: &AppHandle) -> Result<String, String> {
    let settings = app.state::<LiveCapture>().offline_settings()?;
    Ok(settings["locale"].as_str().unwrap_or("en").to_string())
}

pub fn text(app: &AppHandle, key: &str) -> String {
    let locale = saved_locale(app).unwrap_or_else(|_| "en".into());
    localization::text(&locale, key).to_string()
}

pub fn title(app: &AppHandle, key: &str) -> String {
    let product = if crate::build_info::DEVELOPMENT {
        "Aion Companion Dev"
    } else {
        "Aion Companion"
    };
    if key == "titleWorkspace" && crate::build_info::DEVELOPMENT {
        format!(
            "{product} · {} · {}",
            env!("AION_BUILD_BRANCH"),
            text(app, key)
        )
    } else {
        format!("{product} · {}", text(app, key))
    }
}

pub fn register_menu(app: &AppHandle, items: Vec<(&'static str, MenuItemKind<tauri::Wry>)>) {
    if let Ok(mut current) = app.state::<NativeUi>().0.lock() {
        *current = items;
    }
}

pub fn refresh(app: &AppHandle) -> Result<(), String> {
    // Serialize presentation refreshes, then read current settings. An older
    // save finishing its adapter later cannot relabel the app with an old locale.
    let state = app.state::<NativeUi>();
    let menu = state.0.lock().map_err(|_| "Native UI state unavailable")?;
    let locale = saved_locale(app)?;
    for (key, item) in menu.iter() {
        let text = localization::text(&locale, key);
        match item {
            MenuItemKind::MenuItem(item) => item.set_text(text),
            MenuItemKind::Check(item) => item.set_text(text),
            _ => Ok(()),
        }
        .map_err(|e| e.to_string())?;
    }
    if let Some(tray) = app.tray_by_id("companion-tray") {
        tray.set_tooltip(Some(title(app, "trayTooltip")))
            .map_err(|e| e.to_string())?;
    }
    for (label, key) in [
        ("main", "titleWorkspace"),
        ("dps-overlay", "titleOverlay"),
        ("companion-menu", "titleMenu"),
        ("group-overlay", "titleGroup"),
        ("tracker-overlay", "titleTrackers"),
        ("dps-details", "titleDetails"),
        ("alert-popup", "titleAlert"),
        ("pet-radar", "titlePets"),
        ("timers-overlay", "titleTimers"),
        ("explore-overlay", "titleExplore"),
    ] {
        if let Some(window) = app.get_webview_window(label) {
            window
                .set_title(&title(app, key))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Presentation failure must never turn a successfully persisted save into an
/// apparent failure. Visibility refreshes also recover from a missed event.
pub fn committed(app: &AppHandle) {
    if let Err(error) = refresh(app) {
        companion_capture::diagnostics::record("warn", "ui-preferences", &error);
    }
    if let Err(error) = app.emit("ui-preferences-changed", ()) {
        companion_capture::diagnostics::record("warn", "ui-preferences", &error.to_string());
    }
}
