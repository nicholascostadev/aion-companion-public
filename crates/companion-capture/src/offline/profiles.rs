//! Startup recovery of remembered player values from the app's own native recordings.
//! `companion_core::players` owns what is remembered and how it is used; this only
//! supplies the recorded fights, so no second profile format exists.
use companion_core::players::Players;
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

pub(super) fn load(root: &Path, index: &BTreeMap<String, Value>) -> Players {
    let mut entries: Vec<_> = index.iter().collect();
    entries.sort_by_key(|(_, row)| std::cmp::Reverse(row["started_ms"].as_u64().unwrap_or(0)));
    // Metadata recovery must not turn startup into an unbounded log replay.
    let mut budget = 32 * 1024 * 1024u64;
    Players::recovered(entries.into_iter().take(128).filter_map(|(id, _)| {
        let path = root.join("logs").join(format!("{id}.json"));
        let meta = std::fs::metadata(&path).ok()?;
        if meta.len() > budget {
            return None;
        }
        budget -= meta.len();
        let bytes = crate::persistence::read_bounded(&path, meta.len()).ok()?;
        let log = crate::state_validation::log(&bytes, false).ok()?;
        (log.id == *id).then_some(log)
    }))
}
