//! Bounded evidence for readiness decoding. Never used to infer a member's state.
use serde::Serialize;

#[derive(Clone, Default, PartialEq, Serialize)]
pub struct GroupDiagnostic {
    pub roster_frames: u64,
    pub last_roster_hex: Option<String>,
    pub ready_frames: u64,
    pub last_ready: Option<ReadyDiagnostic>,
}

#[derive(Clone, PartialEq, Serialize)]
pub struct ReadyDiagnostic {
    observed_ms: u64,
    length: usize,
    outcome: &'static str,
    /// At most 64 bytes of the readiness record; longer records are truncated.
    prefix_hex: String,
}

impl GroupDiagnostic {
    pub(super) fn roster(&mut self, frame: &[u8]) {
        self.roster_frames = self.roster_frames.saturating_add(1);
        self.last_roster_hex = (frame.len() <= 8192)
            .then(|| frame.iter().map(|byte| format!("{byte:02x}")).collect());
    }

    pub(super) fn ready(&mut self, frame: &[u8], matched: bool, observed_ms: u64) {
        self.ready_frames = self.ready_frames.saturating_add(1);
        self.last_ready = Some(ReadyDiagnostic {
            observed_ms,
            length: frame.len(),
            outcome: if frame.len() != 11 {
                "unsupported_length"
            } else if matched {
                "applied"
            } else {
                "unknown_member"
            },
            prefix_hex: frame.iter().take(64).map(|byte| format!("{byte:02x}")).collect(),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evidence_is_bounded_and_distinguishes_unsupported_and_unmatched_updates() {
        let mut diagnostic = GroupDiagnostic::default();
        diagnostic.roster(&[2, 0x97, 1]);
        assert_eq!(diagnostic.last_roster_hex.as_deref(), Some("029701"));
        diagnostic.roster(&vec![0; 8193]);
        assert!(diagnostic.last_roster_hex.is_none());
        assert_eq!(diagnostic.roster_frames, 2);
        diagnostic.ready(&vec![0x97; 9000], false, 10);
        let update = diagnostic.last_ready.as_ref().unwrap();
        assert_eq!(update.length, 9000);
        assert_eq!(update.prefix_hex.len(), 128);
        assert_eq!(update.outcome, "unsupported_length");
        diagnostic.ready(&[0; 11], false, 20);
        assert_eq!(diagnostic.last_ready.as_ref().unwrap().outcome, "unknown_member");
        diagnostic.ready(&[0; 11], true, 30);
        assert_eq!(diagnostic.last_ready.as_ref().unwrap().outcome, "applied");
        assert_eq!(diagnostic.ready_frames, 3);
    }
}
