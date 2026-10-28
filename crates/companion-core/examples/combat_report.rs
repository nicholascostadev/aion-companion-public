//! Render a native combat checkpoint with the production meter aggregation.
//! Usage: combat_report <native-log.json> [--party-only] [--boss-only]
use companion_core::combat::{Catalogue, CombatLog};
use serde_json::json;
use std::{io::Read, path::Path};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    if args.is_empty()
        || args.len() > 3
        || args
            .iter()
            .skip(1)
            .any(|a| a != "--party-only" && a != "--boss-only")
    {
        return Err("Usage: combat_report <native-log.json> [--party-only] [--boss-only]".into());
    }
    let path = Path::new(&args[0]);
    let mut bytes = Vec::new();
    std::fs::File::open(path)?
        .take(128 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)?;
    if bytes.len() > 128 * 1024 * 1024 {
        return Err("Native combat log exceeds 128 MiB".into());
    }
    // Check the envelope before deserializing a type with recovery defaults.
    let value: serde_json::Value = serde_json::from_slice(&bytes)?;
    if value["schema_version"] != 1
        || !value["events"].is_array()
        || !value["actors"].is_object()
        || !value["targets"].is_object()
        || !value["started_ms"].is_u64()
        || !value["duration_ms"].is_u64()
    {
        return Err("Expected a version 1 native combat log".into());
    }
    let log: CombatLog = serde_json::from_value(value)?;
    let boss_only = args.iter().any(|arg| arg == "--boss-only")
        && log
            .targets
            .values()
            .any(|target| target.boss || target.dummy);
    let party_only = args.iter().any(|arg| arg == "--party-only");
    let report = log.report_summary(
        &Catalogue::default(),
        log.duration_ms,
        party_only,
        boss_only,
    );
    println!(
        "{}",
        json!({
            "kind": "aion-native-meter-report", "schema_version": 1,
            "aggregation": {"party_only": party_only, "boss_only": boss_only},
            "report": report
        })
    );
    Ok(())
}
