//! Replay this app's local identity diagnostic samples without a running game.
use companion_core::wire::Decoder;
use serde_json::{json, Value};
use std::io::{BufRead, BufReader};

fn main() -> Result<(), String> {
    let path = std::env::args()
        .nth(1)
        .ok_or("Provide an identity diagnostic JSONL path")?;
    let expected_name = std::env::args().nth(2);
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Identity diagnostic exceeds 16 MiB".into());
    }
    let mut decoder = Decoder::default();
    let mut frames = 0u64;
    for line in BufReader::new(file).lines() {
        let line = line.map_err(|e| e.to_string())?;
        let sample: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if sample["kind"] != "aion-identity-sample" || sample["schema_version"] != 1 {
            return Err("Unsupported identity diagnostic format".into());
        }
        let records = sample["frames"]
            .as_array()
            .ok_or("Missing diagnostic frames")?;
        if records.len() > 256 {
            return Err("Too many frames in a diagnostic sample".into());
        }
        for record in records {
            let text = record["hex"]
                .as_str()
                .ok_or("Missing diagnostic frame body")?;
            if !(4..=16384).contains(&text.len()) || text.len() % 2 != 0 {
                return Err("Invalid diagnostic frame size".into());
            }
            let bytes: Result<Vec<_>, _> = text
                .as_bytes()
                .chunks_exact(2)
                .map(|pair| {
                    std::str::from_utf8(pair)
                        .map_err(|e| e.to_string())
                        .and_then(|pair| u8::from_str_radix(pair, 16).map_err(|e| e.to_string()))
                })
                .collect();
            let bytes = bytes?;
            if record["length"].as_u64() != Some(bytes.len() as u64)
                || record["opcode"].as_u64()
                    != Some(u16::from_be_bytes([bytes[0], bytes[1]]) as u64)
            {
                return Err("Diagnostic frame metadata does not match its body".into());
            }
            decoder.decode(&bytes);
            decoder.observations.clear();
            decoder.pet_observations.clear();
            frames += 1;
        }
    }
    let entities = &decoder.entities;
    println!(
        "{}",
        json!({"frames":frames,"local":entities.local,
        "local_name":entities.local.and_then(|id| entities.name(id)),
        "local_server":entities.local_server_id(),"local_identity_source":entities.local_identity_source,
        "named_entities":entities.named_count(),"self_records":entities.self_records,
        "last_self_outcome":entities.last_self_outcome,"rejected":decoder.rejected})
    );
    if let Some(expected) = expected_name {
        if entities.local.and_then(|id| entities.name(id)) != Some(expected.as_str()) {
            return Err("FAIL: replay did not identify the expected local character".into());
        }
    }
    Ok(())
}
