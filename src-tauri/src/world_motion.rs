//! Publish small capture-owned position snapshots outside the packet/capture lock.
use companion_capture::LiveCapture;
use serde_json::Value;
use std::{sync::mpsc::RecvTimeoutError, time::Duration};
use tauri::{AppHandle, Emitter, Manager};

#[tauri::command]
pub async fn world_motion_status(app: AppHandle) -> Result<Value, String> {
    crate::background::capture(app, |live| live.world_motion_status()).await
}

// The clock/age advance while standing still; only actual context, position,
// facing and freshness changes need an event. Expiry is checked even in silence.
fn changed(previous: &Value, next: &Value) -> bool {
    [
        "running",
        "phase",
        "message",
        "session_id",
        "zone_id",
        "map_id",
        "position",
        "last_position",
        "facing",
    ]
    .iter()
    .any(|key| previous[*key] != next[*key])
}

pub fn start(app: &AppHandle) -> Result<(), String> {
    let receiver = app.state::<LiveCapture>().subscribe_world_motion()?;
    let app = app.clone();
    std::thread::Builder::new()
        .name("world-motion-events".into())
        .spawn(move || {
            let mut previous = Value::Null;
            let mut last_error: Option<String> = None;
            loop {
                match receiver.recv_timeout(Duration::from_millis(250)) {
                    Ok(()) | Err(RecvTimeoutError::Timeout) => {}
                    Err(RecvTimeoutError::Disconnected) => break,
                }
                // One pending token means "read latest", never "replay this fix".
                while receiver.try_recv().is_ok() {}
                let next = match app.state::<LiveCapture>().world_motion_status() {
                    Ok(next) => next,
                    Err(error) => {
                        if last_error.as_deref() != Some(error.as_str()) {
                            companion_capture::diagnostics::record("error", "world-motion", &error);
                            last_error = Some(error);
                        }
                        continue;
                    }
                };
                if changed(&previous, &next) {
                    if let Err(error) = app.emit("world-motion-updated", &next) {
                        let error = error.to_string();
                        if last_error.as_deref() != Some(error.as_str()) {
                            companion_capture::diagnostics::record("error", "world-motion", &error);
                            last_error = Some(error);
                        }
                        // Retry the latest state on the next wakeup or expiry tick.
                        continue;
                    }
                    previous = next;
                }
                last_error = None;
            }
        })
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn emits_measurements_and_expiry_but_not_clock_ticks_or_cube_revisions() {
        let first = json!({"running":true,"session_id":"1:0","now_ms":1000,
            "revision":1,"position_age_ms":0,
            "position":{"x":100,"y":200,"observed_ms":1000},
            "last_position":{"x":100,"y":200,"observed_ms":1000}});
        let mut next = first.clone();
        next["now_ms"] = json!(1100);
        next["position_age_ms"] = json!(100);
        next["revision"] = json!(2);
        assert!(!changed(&first, &next));
        next["position"]["observed_ms"] = json!(1100);
        assert!(changed(&first, &next));
        next = first.clone();
        next["position"] = Value::Null;
        assert!(changed(&first, &next));
        next = first.clone();
        next["session_id"] = json!("1:1");
        assert!(changed(&first, &next));
        next = first.clone();
        next["running"] = json!(false);
        assert!(changed(&first, &next));
    }
}
