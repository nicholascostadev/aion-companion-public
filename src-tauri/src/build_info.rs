use serde_json::{json, Value};
use tauri::Manager;

pub const DEVELOPMENT: bool = cfg!(feature = "development");

#[tauri::command]
pub fn app_build_info() -> Value {
    json!({
        "channel": if DEVELOPMENT { "development" } else { "stable" },
        "version": env!("CARGO_PKG_VERSION"),
        "branch": env!("AION_BUILD_BRANCH"),
        "revision": env!("AION_BUILD_REVISION"),
        "live_reload": !cfg!(feature = "custom-protocol"),
    })
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    let expected = if DEVELOPMENT {
        "org.aioncompanion.development"
    } else {
        "org.aioncompanion.prototype"
    };
    if app.config().identifier != expected {
        return Err("Build channel does not match its application data identity.".into());
    }
    if DEVELOPMENT {
        if let Some(window) = app.get_webview_window("main") {
            window
                .set_title(&format!(
                    "Aion Companion Dev · {} · Combat workspace",
                    env!("AION_BUILD_BRANCH")
                ))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn channel_is_compiled_in_and_independent_of_optimization() {
        let info = app_build_info();
        assert_eq!(
            info["channel"],
            if cfg!(feature = "development") {
                "development"
            } else {
                "stable"
            }
        );
        assert_eq!(info["live_reload"], !cfg!(feature = "custom-protocol"));
        let context: tauri::Context<tauri::Wry> = tauri::generate_context!();
        assert_eq!(
            context.config().identifier,
            if DEVELOPMENT {
                "org.aioncompanion.development"
            } else {
                "org.aioncompanion.prototype"
            }
        );
    }
}
