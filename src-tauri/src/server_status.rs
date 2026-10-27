//! Official notices are read directly over the user's connection. No browser or service.
use companion_capture::{
    maintenance_notice,
    server_status::{Maintenance, SOURCE},
    LiveCapture,
};
use serde_json::Value;
use std::{io::Read, time::Duration};
use tauri::{AppHandle, Manager};

const DETAIL: &str =
    "https://api-global-community.plaync.com/aion2_global/board/notice_en/article/";
const MAX_RESPONSE: u64 = 1_000_000;

fn read(client: &reqwest::blocking::Client, url: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Official maintenance check failed: {e}"))?;
    let mut bytes = Vec::new();
    response
        .take(MAX_RESPONSE + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Official notice read failed: {e}"))?;
    if bytes.len() as u64 > MAX_RESPONSE {
        return Err("Official notice exceeds response limit".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "Official notice response format changed".into())
}

fn check(client: &reqwest::blocking::Client) -> Result<Option<Maintenance>, String> {
    let ids = maintenance_notice::candidates(&read(client, SOURCE)?)?;
    for id in ids {
        if let Some(notice) = maintenance_notice::parse(&read(client, &format!("{DETAIL}{id}"))?)? {
            return Ok(Some(notice));
        }
    }
    Ok(None)
}

pub fn start(app: &AppHandle) {
    let app = app.clone();
    std::thread::Builder::new()
        .name("official-maintenance".into())
        .spawn(move || {
            let client = reqwest::blocking::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("AionCompanion/", env!("CARGO_PKG_VERSION")))
                .build();
            loop {
                // Network waits never acquire alert/capture state or delay the alert clock.
                let result = match &client {
                    Ok(client) => check(client),
                    Err(error) => Err(format!("Official maintenance client unavailable: {error}")),
                };
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map_or(0, |d| d.as_millis() as u64);
                let _ = app
                    .state::<LiveCapture>()
                    .alerts_update_maintenance(result, now);
                std::thread::sleep(Duration::from_secs(60));
            }
        })
        .expect("Could not start official maintenance checker");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "explicit public-network integration check"]
    fn public_official_notice_can_be_read_directly() {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let notice = check(&client)
            .expect("Public official notice API")
            .expect("Recognized latest maintenance");
        assert!(notice.ends_ms > notice.starts_ms);
        assert!(notice.url.starts_with("https://aion2.plaync.com/"));
        println!(
            "Official notice: {} ({}–{}, completed={})",
            notice.title, notice.starts_ms, notice.ends_ms, notice.completed
        );
    }
}
