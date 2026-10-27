//! Prerequisite checks and an allowlisted route to official setup help.
use serde_json::{json, Value};

fn link_url(link: &str) -> Result<&'static str, String> {
    match link {
        "npcap" => Ok("https://npcap.com/#download"),
        "npcap_help" => Ok("https://npcap.com/guide/npcap-users-guide.html"),
        "webview2" => Ok("https://developer.microsoft.com/en-us/microsoft-edge/webview2/"),
        "github_cli" => Ok("https://cli.github.com/"),
        "repository" => Ok("https://github.com/nicholascostadev/aion-companion-public"),
        "github_invitations" => Ok("https://github.com/notifications"),
        "releases" => Ok("https://github.com/nicholascostadev/aion-companion-public/releases/latest"),
        _ => Err("Unknown setup link".into()),
    }
}

#[tauri::command]
pub async fn setup_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(|| {
        json!({
            "platform_supported": cfg!(all(windows, target_arch = "x86_64")),
            // This command can only be reached after the desktop WebView has opened.
            "webview2_ready": true,
            "npcap": companion_capture::capture_requirements(),
            "installed": crate::updates::supported(),
            "distribution": if crate::updates::public_releases() { "public" } else { "private" },
        })
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn setup_open_link(link: String) -> Result<(), String> {
    let url = link_url(&link)?;
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        let url: Vec<u16> = url.encode_utf16().chain(Some(0)).collect();
        let verb: Vec<u16> = "open".encode_utf16().chain(Some(0)).collect();
        let result = unsafe {
            ShellExecuteW(
                std::ptr::null_mut(),
                verb.as_ptr(),
                url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
            )
        };
        if result as isize <= 32 {
            return Err(
                "Windows could not open your browser. Try the official download page manually."
                    .into(),
            );
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Setup links are available in the Windows app.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_official_fixed_setup_links_can_open() {
        for link in [
            "npcap",
            "npcap_help",
            "webview2",
            "github_cli",
            "releases",
            "repository",
            "github_invitations",
        ] {
            assert!(link_url(link).unwrap().starts_with("https://"));
        }
        for input in [
            "https://example.com",
            "file:///C:/Windows",
            "releases/../other",
            "cmd",
            "",
        ] {
            assert!(link_url(input).is_err());
        }
    }
}
