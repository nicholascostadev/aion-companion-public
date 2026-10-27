//! Opt-in, bounded evidence for identifying unrecognized incoming game records.
use serde::Serialize;
use std::collections::VecDeque;

const MAX_RECORDS: usize = 256;
const PER_OPCODE: usize = 4;
const IDENTITY_FRAME_BYTES: usize = 8192;
const MAX_HEX_BYTES: usize = 1024 * 1024;

#[derive(Clone, Serialize)]
pub struct SmallFrame {
    pub observed_ms: u64,
    pub opcode: u16,
    pub length: usize,
    pub hex: String,
}

#[derive(Default, Serialize)]
pub struct SmallFrames {
    #[serde(skip)]
    pub enabled: bool,
    #[serde(skip)]
    pub identity_mode: bool,
    pub records: VecDeque<SmallFrame>,
}

impl SmallFrames {
    pub fn record(&mut self, frame: &[u8]) {
        let limit = if self.identity_mode { IDENTITY_FRAME_BYTES } else { 128 };
        if !self.enabled || !(2..=limit).contains(&frame.len()) {
            return;
        }
        self.push(SmallFrame {
            observed_ms: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH).map_or(0, |time| time.as_millis() as u64),
            opcode: u16::from_be_bytes([frame[0], frame[1]]),
            length: frame.len(),
            hex: frame.iter().map(|byte| format!("{byte:02x}")).collect(),
        });
    }

    fn push(&mut self, record: SmallFrame) {
        // Repetitive traffic cannot replace every variant of a rarer message type.
        self.records.retain(|old| old.opcode != record.opcode || old.hex != record.hex);
        if self.records.iter().filter(|old| old.opcode == record.opcode).count() >= PER_OPCODE {
            if let Some(at) = self.records.iter().position(|old| old.opcode == record.opcode) {
                self.records.remove(at);
            }
        }
        self.records.push_back(record);
        let mut bytes: usize = self.records.iter().map(|record| record.hex.len()).sum();
        while self.records.len() > MAX_RECORDS || bytes > MAX_HEX_BYTES {
            if let Some(record) = self.records.pop_front() { bytes -= record.hex.len(); }
        }
    }

    pub fn take(&mut self) -> VecDeque<SmallFrame> {
        std::mem::take(&mut self.records)
    }

    pub fn append(&mut self, records: VecDeque<SmallFrame>) {
        for record in records { self.push(record); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tracing_is_opt_in_and_bounds_payload_size_and_message_variants() {
        let mut trace = SmallFrames::default();
        trace.record(&[3, 0x97, 1]);
        assert!(trace.records.is_empty());
        trace.enabled = true;
        for value in 0..10 { trace.record(&[3, 0x97, value]); }
        assert_eq!(trace.records.len(), PER_OPCODE);
        assert_eq!(trace.records.front().unwrap().hex, "039706");
        trace.record(&[3, 0x97, 9]);
        trace.record(&vec![0; 129]);
        assert_eq!(trace.records.len(), PER_OPCODE);
        for opcode in 0..300u16 { trace.record(&opcode.to_be_bytes()); }
        assert_eq!(trace.records.len(), MAX_RECORDS);
        let mut shared = SmallFrames::default();
        shared.append(trace.take());
        assert!(trace.records.is_empty());
        assert_eq!(shared.records.len(), MAX_RECORDS);
    }

    #[test]
    fn identity_sampling_retains_large_complete_records_with_a_total_budget() {
        let mut trace = SmallFrames::default();
        trace.enabled = true;
        let mut frame = vec![0; IDENTITY_FRAME_BYTES];
        frame[..2].copy_from_slice(&[0x50, 0x36]);
        trace.record(&frame);
        assert!(trace.records.is_empty());
        trace.identity_mode = true;
        trace.record(&frame);
        assert_eq!(trace.records[0].length, frame.len());
        assert_eq!(trace.records[0].hex.len(), frame.len() * 2);
        trace.record(&vec![0; IDENTITY_FRAME_BYTES + 1]);
        assert_eq!(trace.records.len(), 1);
        for opcode in 0..300u16 {
            frame[..2].copy_from_slice(&opcode.to_be_bytes());
            trace.record(&frame);
        }
        assert!(!trace.records.is_empty());
        assert!(trace.records.iter().map(|record| record.hex.len()).sum::<usize>() <= MAX_HEX_BYTES);
        let mut shared = SmallFrames::default();
        shared.append(trace.take());
        assert!(shared.records.iter().map(|record| record.hex.len()).sum::<usize>() <= MAX_HEX_BYTES);
    }
}
