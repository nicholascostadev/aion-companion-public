//! Local synthetic throughput diagnostic; never imports data into the user's library.
use companion_core::combat::{ActorInfo, Catalogue, CombatEvent, CombatLog};
fn main() {
    let count = std::env::args()
        .nth(1)
        .and_then(|n| n.parse::<usize>().ok())
        .unwrap_or(50000)
        .min(500000);
    let mut log = CombatLog {
        duration_ms: 300000,
        ..Default::default()
    };
    for id in 1..=12 {
        log.actors.insert(
            id,
            ActorInfo {
                id,
                name: format!("Test {id}"),
                ..Default::default()
            },
        );
    }
    for i in 0..count {
        log.events.push(CombatEvent {
            at_ms: (i as u64) * 300000 / count as u64,
            source: (i % 12 + 1) as u32,
            target: 20,
            skill: 11010000,
            amount: 1000,
            critical: Some(i % 5 == 0),
            ..CombatEvent::new("damage")
        });
    }
    let start = std::time::Instant::now();
    // An explicit full inspection copies a log once. Subsequent polling copies
    // only the appended suffix; report aggregation remains outside capture state.
    let snapshot = log.clone();
    let copy = start.elapsed();
    let append_at = std::time::Instant::now();
    let appended = log.events[log.events.len().saturating_sub(100)..].to_vec();
    let append = append_at.elapsed();
    let compute_at = std::time::Instant::now();
    let report = snapshot.report_events(
        &Catalogue::default(),
        300000,
        false,
        false,
        &snapshot.events[snapshot.events.len().saturating_sub(25000)..],
    );
    let compute = compute_at.elapsed();
    let bytes = serde_json::to_vec(&report).unwrap();
    let summary_at = std::time::Instant::now();
    let summary = snapshot.report_summary(&Catalogue::default(), 300000, false, false);
    let summary_compute = summary_at.elapsed();
    let summary_bytes = serde_json::to_vec(&summary).unwrap();
    assert_eq!(summary["players"], report["players"]);
    println!(
        "events={count} full_snapshot_us={} appended_events={} append_copy_us={} report_us={} total_us={} json_bytes={} summary_us={} summary_json_bytes={}",
        copy.as_micros(),
        appended.len(),
        append.as_micros(),
        compute.as_micros(),
        start.elapsed().as_micros(),
        bytes.len(), summary_compute.as_micros(), summary_bytes.len()
    );
}
