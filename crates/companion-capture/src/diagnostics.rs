//! Local, bounded support logs. Never records packet payloads or command arguments.
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Mutex, OnceLock},
};

const MAX_ENTRIES: usize = 512;
const MAX_FILE: u64 = 512 * 1024;
const MAX_TEXT: usize = 4096;

#[derive(Default)]
struct Journal {
    entries: VecDeque<Value>,
    writer: Option<mpsc::SyncSender<Value>>,
    persistence_error: Option<String>,
    dropped_writes: u64,
    folder: Option<PathBuf>,
}
static JOURNAL: OnceLock<Mutex<Journal>> = OnceLock::new();
// The writer thread and durable records append to the same file.
static FILE: Mutex<()> = Mutex::new(());
fn journal() -> &'static Mutex<Journal> {
    JOURNAL.get_or_init(Mutex::default)
}

/// Strip home paths, URLs and likely credentials before anything reaches disk.
/// This is best effort; users should still review a report before sharing it.
pub fn sanitize_text(text: &str) -> String {
    let mut text: String = text.chars().take(MAX_TEXT).collect();
    for key in ["USERPROFILE", "HOME", "LOCALAPPDATA", "APPDATA"] {
        if let Ok(path) = std::env::var(key) {
            if !path.is_empty() {
                text = text.replace(&path, "[local-path]");
                text = text.replace(&path.replace('\\', "/"), "[local-path]");
            }
        }
    }
    let lower = text.to_ascii_lowercase();
    if [
        "authorization",
        "bearer ",
        "password",
        "passwd",
        "token=",
        "token:",
        "token\"",
        "secret=",
        "secret:",
        "cookie:",
        "api_key",
        "apikey",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
    {
        return "[message redacted: possible credential]".into();
    }
    // URLs may carry credentials in either their path, query or fragment. Keep
    // packaged script locations so a stack trace can still identify the fault.
    text.split_inclusive(char::is_whitespace)
        .map(|word| {
            if word.contains("://") {
                let trimmed = word.trim_end_matches(char::is_whitespace);
                let whitespace = &word[trimmed.len()..];
                let candidate = trimmed.trim_start_matches('(');
                if [
                    "http://tauri.localhost/assets/",
                    "https://tauri.localhost/assets/",
                    "tauri://localhost/assets/",
                ]
                .iter()
                .any(|prefix| candidate.starts_with(prefix))
                {
                    format!(
                        "{}{whitespace}",
                        trimmed.split(['?', '#']).next().unwrap_or("[url]")
                    )
                } else {
                    format!("[url]{whitespace}")
                }
            } else {
                word.to_owned()
            }
        })
        .collect()
}

pub fn sanitize(value: &Value) -> Value {
    fn walk(value: &Value, depth: usize) -> Value {
        if depth > 12 {
            return json!("[depth limit]");
        }
        match value {
            Value::String(text) => json!(sanitize_text(text)),
            Value::Array(items) => {
                Value::Array(items.iter().take(128).map(|v| walk(v, depth + 1)).collect())
            }
            Value::Object(items) => Value::Object(
                items
                    .iter()
                    .take(128)
                    .filter_map(|(key, value)| {
                        let lower = key.to_ascii_lowercase();
                        if [
                            "password",
                            "token",
                            "secret",
                            "cookie",
                            "authorization",
                            "api_key",
                            "apikey",
                            "private_key",
                            "credential",
                            "hex",
                            "raw",
                            "payload",
                        ]
                        .iter()
                        .any(|s| lower.contains(s))
                            || (lower.contains("packet") && !value.is_number())
                        {
                            None
                        } else {
                            Some((key.chars().take(128).collect(), walk(value, depth + 1)))
                        }
                    })
                    .collect(),
            ),
            _ => value.clone(),
        }
    }
    walk(value, 0)
}

impl Journal {
    fn retain(&mut self, entry: Value) {
        self.entries.push_back(entry);
        while self.entries.len() > MAX_ENTRIES {
            self.entries.pop_front();
        }
    }
    fn push(&mut self, entry: Value) {
        self.retain(entry.clone());
        if let Some(writer) = &self.writer {
            if writer.try_send(entry).is_err() {
                self.dropped_writes += 1;
            }
        }
    }
}

pub fn record(level: &str, source: &str, message: &str) {
    if let Ok(log) = journal().lock() {
        write(log, level, source, message, false);
    }
}

/// Writes to disk before returning, for evidence the process may not survive
/// (panics, native crashes, exit). Gives up rather than deadlock when the
/// journal is held, which a panic inside the journal itself would cause.
pub fn record_now(level: &str, source: &str, message: &str) {
    for _ in 0..100 {
        match journal().try_lock() {
            Ok(log) => return write(log, level, source, message, true),
            Err(std::sync::TryLockError::Poisoned(poisoned)) => {
                return write(poisoned.into_inner(), level, source, message, true)
            }
            Err(std::sync::TryLockError::WouldBlock) => {
                std::thread::sleep(std::time::Duration::from_millis(1))
            }
        }
    }
}

fn write(
    mut log: std::sync::MutexGuard<'_, Journal>,
    level: &str,
    source: &str,
    message: &str,
    durable: bool,
) {
    let level = match level {
        "error" => "error",
        "warn" => "warn",
        _ => "info",
    };
    let source: String = source.chars().take(96).collect();
    let message = sanitize_text(message);
    // Repeated poll failures should not displace all earlier evidence.
    let now = crate::wall_clock();
    if let Some(last) = log.entries.iter_mut().rev().take(16).find(|last| {
        last["level"] == level
            && last["source"] == source
            && last["message"] == message
            && last["pid"] == std::process::id()
            && now.saturating_sub(last["last_seen_ms"].as_u64().unwrap_or(0)) < 10_000
    }) {
        last["repeats"] = json!(last["repeats"].as_u64().unwrap_or(1) + 1);
        last["last_seen_ms"] = json!(now);
        return;
    }
    let entry = json!({"at_ms":now,"last_seen_ms":now,"level":level,"source":sanitize_text(&source),"message":message,"repeats":1,"pid":std::process::id()});
    match log.folder.clone().filter(|_| durable) {
        Some(folder) => {
            log.retain(entry.clone());
            drop(log);
            if let Err(error) = append(&folder, &entry) {
                persistence_failed(&error.to_string());
            }
        }
        None => log.push(entry),
    }
}

fn read_history(path: &Path) -> std::io::Result<Vec<Value>> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    // A damaged/oversized log cannot cause an unbounded read during startup.
    Ok(BufReader::new(file.take(MAX_FILE))
        .lines()
        .map_while(Result::ok)
        .filter_map(|line| serde_json::from_str::<Value>(&line).ok())
        .map(|v| sanitize(&v))
        .collect())
}

fn append(folder: &Path, entry: &Value) -> std::io::Result<()> {
    let _file = FILE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let current = folder.join("support.jsonl");
    let mut bytes = serde_json::to_vec(entry)?;
    bytes.push(b'\n');
    if std::fs::metadata(&current).is_ok_and(|m| m.len() + bytes.len() as u64 > MAX_FILE) {
        let previous = folder.join("support.previous.jsonl");
        match std::fs::remove_file(&previous) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
        std::fs::rename(&current, previous)?;
    }
    let mut file = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(current)?;
    // One write per line keeps concurrent appends from interleaving.
    file.write_all(&bytes)?;
    file.flush()
}

pub fn initialize(folder: PathBuf) -> Result<(), String> {
    std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
    let mut entries =
        read_history(&folder.join("support.previous.jsonl")).map_err(|e| e.to_string())?;
    entries.extend(read_history(&folder.join("support.jsonl")).map_err(|e| e.to_string())?);
    let (send, receive) = mpsc::sync_channel(128);
    let mut log = journal().lock().map_err(|_| "Support log unavailable")?;
    if log.writer.is_some() {
        return Ok(());
    }
    let writer_folder = folder.clone();
    std::thread::Builder::new()
        .name("aion-support-log".into())
        .spawn(move || {
            let folder = writer_folder;
            while let Ok(entry) = receive.recv() {
                if let Err(error) = append(&folder, &entry) {
                    if let Ok(mut log) = journal().lock() {
                        log.persistence_error = Some(sanitize_text(&error.to_string()));
                    }
                }
            }
        })
        .map_err(|e| e.to_string())?;
    let pending = std::mem::take(&mut log.entries);
    for entry in entries {
        log.push(entry);
    }
    log.writer = Some(send);
    log.folder = Some(folder);
    for entry in pending {
        log.push(entry);
    }
    Ok(())
}

pub fn persistence_failed(error: &str) {
    if let Ok(mut log) = journal().lock() {
        log.persistence_error = Some(sanitize_text(error));
    }
}

pub fn snapshot() -> Value {
    match journal().lock() {
        Ok(log) => {
            json!({"entries":log.entries,"entry_limit":MAX_ENTRIES,"file_limit_bytes":MAX_FILE,
            "retained_files":2,"persistence_error":log.persistence_error,"dropped_disk_writes":log.dropped_writes})
        }
        Err(_) => json!({"error":"Support log unavailable"}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn logs_are_bounded_and_redact_sensitive_values() {
        let mut log = Journal::default();
        for i in 0..1000 {
            log.push(json!({"index":i}));
        }
        assert_eq!(log.entries.len(), MAX_ENTRIES);
        assert_eq!(log.entries.front().unwrap()["index"], 488);
        let safe = sanitize(
            &json!({"token":"secret", "raw_payload":"deadbeef", "message":"failed https://host/path?credential=value", "nested":{"password":"value"}}),
        );
        assert!(safe.get("token").is_none());
        assert!(safe.get("raw_payload").is_none());
        assert_eq!(safe["nested"], json!({}));
        assert_eq!(
            sanitize(&json!({"packets":12,"api_key":"sensitive"})),
            json!({"packets":12})
        );
        assert!(!safe.to_string().contains("credential=value"));
        assert!(!sanitize_text("Authorization: Bearer abc").contains("abc"));
        assert!(
            sanitize_text("at http://tauri.localhost/assets/App.js:1:42\n")
                .contains("App.js:1:42\n")
        );
        assert_eq!(sanitize_text("at https://host/private\n"), "at [url]\n");
        assert_eq!(sanitize_text(&"é".repeat(5000)).chars().count(), MAX_TEXT);
    }
    #[test]
    fn files_rotate_and_recover_after_a_partial_last_line() {
        let folder = std::env::temp_dir().join(format!(
            "aion-support-test-{}-{}",
            std::process::id(),
            crate::wall_clock()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        for i in 0..180 {
            append(&folder, &json!({"index":i,"message":"a".repeat(4096)})).unwrap();
        }
        assert!(folder.join("support.previous.jsonl").is_file());
        assert!(
            std::fs::metadata(folder.join("support.jsonl"))
                .unwrap()
                .len()
                <= MAX_FILE
        );
        std::fs::OpenOptions::new()
            .append(true)
            .open(folder.join("support.jsonl"))
            .unwrap()
            .write_all(b"{partial")
            .unwrap();
        let entries = read_history(&folder.join("support.jsonl")).unwrap();
        assert_eq!(entries.last().unwrap()["index"], 179);
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn durable_records_reach_disk_before_returning() {
        let folder = std::env::temp_dir().join(format!(
            "aion-support-durable-{}-{}",
            std::process::id(),
            crate::wall_clock()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        // A full queue proves the entry bypassed the asynchronous writer.
        let (send, _receive) = mpsc::sync_channel(0);
        let log = Mutex::new(Journal {
            writer: Some(send),
            folder: Some(folder.clone()),
            ..Journal::default()
        });
        write(
            log.lock().unwrap(),
            "error",
            "panic",
            "worker panicked",
            true,
        );
        let entries = read_history(&folder.join("support.jsonl")).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["message"], "worker panicked");
        let log = log.lock().unwrap();
        assert_eq!(log.entries.len(), 1);
        assert_eq!(log.dropped_writes, 0);
        drop(log);
        std::fs::remove_dir_all(folder).unwrap();
    }
    #[test]
    fn unavailable_disk_does_not_lose_in_memory_logs() {
        let (send, receive) = mpsc::sync_channel(1);
        drop(receive);
        let mut log = Journal {
            writer: Some(send),
            ..Journal::default()
        };
        log.push(json!({"message":"capture failed"}));
        assert_eq!(log.entries.len(), 1);
        assert_eq!(log.dropped_writes, 1);
    }
}
