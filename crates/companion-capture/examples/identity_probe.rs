//! Local receive-only identity research. Save and quit Companion before running.
use companion_capture::LiveCapture;
use serde_json::json;
use std::{collections::HashSet, io::Write};
fn main() -> Result<(), String> {
    let destination = std::env::args()
        .nth(1)
        .ok_or("Provide a local diagnostic JSON path")?;
    let seconds = std::env::args()
        .nth(2)
        .and_then(|value| value.parse::<u32>().ok())
        .unwrap_or(45)
        .clamp(1, 300);
    let journal_path = std::path::Path::new(&destination).with_extension("identity.jsonl");
    let mut journal = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&journal_path)
        .map_err(|e| e.to_string())?;
    let capture = LiveCapture::default();
    capture.start(13328)?;
    let result = (|| -> Result<(), String> {
        let mut previous = HashSet::new();
        let mut written = 0usize;
        for _ in 0..seconds * 4 {
            let live = capture.snapshot()?;
            let mut identity = capture.identity_diagnostic()?;
            let records = identity["trace"]["records"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            let mut current = HashSet::new();
            let frames: Vec<_> = records
                .into_iter()
                .filter(|frame| {
                    let key = format!("{}:{}", frame["observed_ms"], frame["hex"]);
                    current.insert(key.clone());
                    !previous.contains(&key)
                })
                .collect();
            previous = current;
            identity["trace"].as_object_mut().unwrap().remove("records");
            let sample = json!({"kind":"aion-identity-sample","schema_version":1,
            "identity":identity,"stats":live["stats"],"phase":live["phase"],"frames":frames});
            let bytes = serde_json::to_vec(&sample).map_err(|e| e.to_string())?;
            written += bytes.len() + 1;
            if written > 16 * 1024 * 1024 {
                return Err("Identity sample reached its 16 MiB limit".into());
            }
            journal
                .write_all(&bytes)
                .and_then(|_| journal.write_all(b"\n"))
                .map_err(|e| e.to_string())?;
            journal.flush().map_err(|e| e.to_string())?;
            let diagnostic = json!({"live":live,"identity":sample["identity"],"frames":sample["frames"],"group":capture.group_snapshot()?});
            std::fs::write(
                &destination,
                serde_json::to_vec_pretty(&diagnostic).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?;
            std::thread::sleep(std::time::Duration::from_millis(250));
        }
        Ok(())
    })();
    let stopped = capture.stop();
    result?;
    stopped?;
    Ok(())
}
