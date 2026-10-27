//! Background-only diagnostic. Prints counters, never packet contents or player names.
use companion_capture::LiveCapture;
fn main() -> Result<(), String> {
    let args: Vec<_> = std::env::args_os().skip(1).collect();
    if args.len() > 2 {
        return Err("Usage: check_live [seconds, max 600] [new-comparison.json]".into());
    }
    let seconds = args
        .first()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| "15".into())
        .parse::<u64>()
        .map_err(|e| e.to_string())?
        .clamp(1, 600);
    let capture = LiveCapture::default();
    capture.start(13328)?;
    for _ in 0..seconds {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let mut snapshot = capture.snapshot()?;
        let players = snapshot["players"].as_array().map_or(0, Vec::len);
        snapshot.as_object_mut().unwrap().remove("players");
        snapshot["player_count"] = players.into();
        println!("{snapshot}");
        if snapshot["phase"] == "error" {
            return Err(snapshot["message"]
                .as_str()
                .unwrap_or("Capture error")
                .into());
        }
    }
    println!("{}", capture.stop()?["stats"]);
    if let Ok(recording) = capture.recording() {
        let replay = recording.snapshot(recording.duration_ms)?;
        println!(
            "Export verified: {} events, {} actors",
            recording.events.len(),
            replay.players.len()
        );
    }
    if let Some(path) = args.get(1) {
        let report = capture.comparison_report()?;
        let file = std::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .map_err(|e| e.to_string())?;
        serde_json::to_writer_pretty(file, &report).map_err(|e| e.to_string())?;
        println!("Normalized comparison report saved. No raw packets were written.");
    }
    Ok(())
}
