//! Owned report requests. Preparing a request requires capture state; executing it
//! never does. Keep filesystem access, aggregation and JSON construction here.
use companion_core::combat::{Catalogue, CombatLog};
use serde_json::Value;
use std::{fs, path::PathBuf, sync::Arc};

/// Identify whether the optional boss view has boss/dummy targets to select.
/// Raw target observations and events stay intact for complete inspection and native logs.
pub(super) fn has_boss_targets(log: &CombatLog) -> bool {
    log.targets.values().any(|target| target.boss || target.dummy)
}

pub(super) struct CachedReport {
    pub at: std::time::Instant,
    pub key: crate::offline::ReportKey,
    pub summary: Value,
    value: Option<Value>,
    pub log: CombatLog,
}

impl CachedReport {
    #[cfg(test)]
    pub fn has_full_detail(&self) -> bool {
        self.value.is_some()
    }
    pub fn report(&mut self, full: bool) -> &Value {
        if !full {
            return &self.summary;
        }
        self.value.get_or_insert_with(|| {
            self.log.with_report_details(
                self.summary.clone(),
                &self.log.events[self.log.events.len().saturating_sub(25000)..],
            )
        })
    }
}

/// Only the newly appended event suffix crosses the capture mutex on a poll.
/// Metadata is refreshed as a whole so late identity/HP updates remain visible.
pub(super) struct PollUpdate {
    pub log: CombatLog,
    pub prefix_len: usize,
    pub catalogue: Arc<Catalogue>,
    pub now_ms: u64,
    pub party_only: bool,
    pub boss_only: bool,
}

impl PollUpdate {
    pub fn execute(
        mut self,
        previous: Option<CachedReport>,
        key: crate::offline::ReportKey,
    ) -> CachedReport {
        if self.prefix_len > 0 {
            let mut events = previous
                .expect("Prepared update has a cached prefix")
                .log
                .events;
            debug_assert_eq!(events.len(), self.prefix_len);
            events.append(&mut self.log.events);
            self.log.events = events;
        }
        let summary = self.log.report_summary(
            &self.catalogue,
            self.now_ms,
            self.party_only,
            self.boss_only,
        );
        CachedReport {
            at: std::time::Instant::now(),
            key,
            summary,
            value: None,
            log: self.log,
        }
    }
}

pub(super) enum LogSource {
    Snapshot(CombatLog),
    File(PathBuf),
}

pub(super) struct ReportRequest {
    pub source: LogSource,
    pub catalogue: Arc<Catalogue>,
    pub now_ms: Option<u64>,
    pub party_only: bool,
    pub boss_only: bool,
    pub detail_limit: Option<usize>,
}

impl LogSource {
    pub fn load(self) -> Result<CombatLog, String> {
        match self {
            Self::Snapshot(log) => Ok(log),
            Self::File(path) => {
                // Check and read the same handle, with a bounded read even if the
                // file grows after metadata is obtained.
                use std::io::Read;
                const MAX_BYTES: u64 = 256 * 1024 * 1024;
                let file = fs::File::open(path).map_err(|e| e.to_string())?;
                if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES {
                    return Err("Log exceeds 256 MiB".into());
                }
                let mut bytes = Vec::new();
                file.take(MAX_BYTES + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() as u64 > MAX_BYTES {
                    return Err("Log exceeds 256 MiB".into());
                }
                crate::state_validation::log(&bytes, false)
            }
        }
    }
}

impl ReportRequest {
    pub fn execute(self) -> Result<Value, String> {
        let log = self.source.load()?;
        // The saved meter requests the boss view, which falls back to ordinary damage
        // when this fight has no boss. Explicit all-target inspection remains unchanged.
        let boss_only = self.boss_only && has_boss_targets(&log);
        let visible = self.detail_limit.map_or(log.events.as_slice(), |limit| {
            &log.events[log.events.len().saturating_sub(limit)..]
        });
        Ok(log.report_events(
            &self.catalogue,
            self.now_ms.unwrap_or(log.duration_ms),
            self.party_only,
            boss_only,
            visible,
        ))
    }
}
