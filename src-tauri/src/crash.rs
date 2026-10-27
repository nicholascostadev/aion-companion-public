//! Local evidence for sessions that end without warning. Panics and native
//! exceptions write a report before the process dies; a session marker shows
//! the next launch whether the previous one reached a clean exit. Nothing is
//! uploaded: reports stay in the diagnostics folder until rotated away.
use companion_capture::diagnostics as log;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};

const KEPT_REPORTS: usize = 10;
const EXPORTED_REPORTS: usize = 5;
const EXPORTED_LINES: usize = 200;
const PANIC_REPORTS_PER_SESSION: usize = 5;
const HEARTBEAT: Duration = Duration::from_secs(30);
const MARKER: &str = "session.json";

struct Session {
    folder: PathBuf,
    started_ms: u64,
    // How the previous session ended, as read at launch, for the bug report.
    previous: Option<Value>,
    quit_reason: Mutex<Option<String>>,
    // Serializes marker writes so a late heartbeat cannot undo the clean exit.
    marker: Mutex<bool>,
}
static SESSION: OnceLock<Session> = OnceLock::new();
static PANIC_REPORTS: AtomicUsize = AtomicUsize::new(0);

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |t| t.as_millis() as u64)
}

/// Same location as Tauri's app data directory, known before the app starts.
fn default_folder() -> Option<PathBuf> {
    let identifier = if crate::build_info::DEVELOPMENT {
        "org.aioncompanion.development"
    } else {
        "org.aioncompanion.prototype"
    };
    let root = std::env::var_os("APPDATA").filter(|path| !path.is_empty())?;
    Some(PathBuf::from(root).join(identifier).join("diagnostics"))
}

fn crashes(folder: &Path) -> PathBuf {
    folder.join("crashes")
}

/// Call once the capture guard is held, so a refused second launch cannot
/// overwrite the running session's marker or report its own refusal as a crash.
pub fn install() {
    if let Some(folder) = default_folder() {
        install_in(folder);
    }
}

fn install_in(folder: PathBuf) {
    if std::fs::create_dir_all(crashes(&folder)).is_err() {
        return;
    }
    let previous = std::fs::read(folder.join(MARKER))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let session = SESSION.get_or_init(|| Session {
        folder: folder.clone(),
        started_ms: now_ms(),
        previous: previous.clone(),
        quit_reason: Mutex::new(None),
        marker: Mutex::new(false),
    });
    #[cfg(windows)]
    native::install(&crashes(&folder));
    if let Some(previous) = previous {
        report_previous(&folder, &previous);
    }
    prune(&crashes(&folder));
    write_marker(session, None);
    let _ = std::thread::Builder::new()
        .name("aion-session-heartbeat".into())
        .spawn(|| loop {
            std::thread::sleep(HEARTBEAT);
            match SESSION.get() {
                Some(session) if !write_marker(session, None) => break,
                None => break,
                _ => {}
            }
        });
}

/// Returns false once the clean exit has been written.
fn write_marker(session: &Session, exit_reason: Option<&str>) -> bool {
    let Ok(mut exited) = session.marker.lock() else {
        return false;
    };
    if *exited {
        return false;
    }
    let now = now_ms();
    let memory = memory();
    let marker = json!({
        "pid": std::process::id(),
        "version": env!("CARGO_PKG_VERSION"),
        "revision": env!("AION_BUILD_REVISION"),
        "started_ms": session.started_ms,
        "heartbeat_ms": now,
        "memory": memory,
        "exit": exit_reason.map(|reason| json!({"at_ms": now, "reason": reason})),
    });
    let path = session.folder.join(MARKER);
    let temporary = session.folder.join("session.json.tmp");
    if let Ok(bytes) = serde_json::to_vec_pretty(&marker) {
        if std::fs::write(&temporary, bytes).is_ok() {
            let _ = std::fs::rename(&temporary, &path);
        }
    }
    *exited = exit_reason.is_some();
    true
}

/// The quit transaction names why the app chose to exit before calling `exit`.
pub fn note_quit(reason: &str) {
    if let Some(session) = SESSION.get() {
        if let Ok(mut quit) = session.quit_reason.lock() {
            quit.get_or_insert_with(|| reason.to_owned());
        }
    }
}

pub fn exit_requested(code: Option<i32>) {
    note_quit(&match code {
        Some(code) => format!("exit requested with code {code}"),
        None => "the last window closed".into(),
    });
}

/// Called from the final `RunEvent::Exit`, immediately before the process ends.
pub fn finish() {
    let Some(session) = SESSION.get() else {
        return;
    };
    let reason = session
        .quit_reason
        .lock()
        .ok()
        .and_then(|reason| reason.clone())
        .unwrap_or_else(|| "no quit reason was recorded".into());
    log::record_now("info", "session", &format!("Exited normally: {reason}"));
    write_marker(session, Some(&reason));
}

fn report_previous(folder: &Path, previous: &Value) {
    let Some(message) = previous_summary(&crashes(folder), previous, boot_ms()) else {
        return;
    };
    log::record("error", "session", &message);
    #[cfg(windows)]
    {
        let since = previous["started_ms"].as_u64().unwrap_or(0);
        let _ = std::thread::Builder::new()
            .name("aion-crash-history".into())
            .spawn(move || {
                for event in windows_events::since(since) {
                    log::record("error", "session", &event);
                }
            });
    }
}

/// Explains an unclean exit from the previous marker; None after a clean exit.
fn previous_summary(crashes: &Path, previous: &Value, boot: Option<u64>) -> Option<String> {
    if previous["exit"].is_object() {
        return None;
    }
    let started = previous["started_ms"].as_u64().unwrap_or(0);
    let heartbeat = previous["heartbeat_ms"].as_u64().unwrap_or(started);
    let mut message = format!(
        "The previous session (version {}, process {}) ended without quitting. It started {} and was last confirmed running {}{}.",
        previous["version"].as_str().unwrap_or("unknown"),
        previous["pid"],
        utc(started),
        utc(heartbeat),
        previous["memory"]["working_set_mb"]
            .as_u64()
            .map(|mb| {
                format!(
                    " using {mb} MB of memory (private {} MB, peak {} MB)",
                    previous["memory"]["private_mb"], previous["memory"]["peak_working_set_mb"]
                )
            })
            .unwrap_or_default(),
    );
    let reports = reports_since(crashes, started);
    if !reports.is_empty() {
        message.push_str(&format!(" Crash reports: {}.", reports.join("; ")));
    } else if boot.is_some_and(|boot| boot > heartbeat) {
        message.push_str(&format!(
            " Windows started again {}, so the computer restarted, shut down or lost power while the app was running.",
            utc(boot.unwrap_or(0))
        ));
    } else {
        message.push_str(
            " No crash was captured in the app. Windows may still have recorded one; otherwise the process was ended from outside (for example Task Manager, security software or a low-memory condition).",
        );
    }
    Some(message)
}

/// Bug report section: both session markers and the newest crash reports.
/// Minidumps stay on disk; they are binary and can hold process memory.
pub fn support_snapshot() -> Value {
    let Some(session) = SESSION.get() else {
        return json!({"error": "Crash capture is unavailable"});
    };
    let previous_summary = session
        .previous
        .as_ref()
        .and_then(|previous| previous_summary(&crashes(&session.folder), previous, boot_ms()));
    json!({
        "current_session": {"pid": std::process::id(), "started_ms": session.started_ms, "memory": memory()},
        "previous_session": log::sanitize(session.previous.as_ref().unwrap_or(&Value::Null)),
        "previous_session_summary": previous_summary.map(|text| log::sanitize_text(&text)),
        "reports": exported_reports(&crashes(&session.folder)),
    })
}

fn exported_reports(folder: &Path) -> Vec<Value> {
    let mut entries: Vec<(u64, String)> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            Some((report_stamp(&name)?, name))
        })
        .collect();
    entries.sort();
    let dumps: Vec<&String> = entries
        .iter()
        .map(|(_, name)| name)
        .filter(|n| n.ends_with(".dmp"))
        .collect();
    entries
        .iter()
        .rev()
        .filter(|(_, name)| name.ends_with(".txt"))
        .take(EXPORTED_REPORTS)
        .map(|(stamp, name)| {
            let text = std::fs::read_to_string(folder.join(name)).unwrap_or_default();
            let lines: Vec<String> = text
                .lines()
                .take(EXPORTED_LINES)
                .map(log::sanitize_text)
                .collect();
            let dump = name.replace(".txt", ".dmp");
            json!({
                "file": name,
                "at_ms": stamp,
                "lines": lines,
                "truncated": text.lines().count() > EXPORTED_LINES,
                "minidump_on_disk": dumps.contains(&&dump),
            })
        })
        .collect()
}

/// Summaries of reports written after `since_ms`, newest last.
fn reports_since(folder: &Path, since_ms: u64) -> Vec<String> {
    let mut reports: Vec<(u64, String)> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            let stamp = report_stamp(&name)?;
            (name.ends_with(".txt") && stamp >= since_ms).then_some((stamp, name))
        })
        .collect();
    reports.sort();
    reports
        .into_iter()
        .map(|(_, name)| {
            let summary = std::fs::read_to_string(folder.join(&name))
                .ok()
                .and_then(|text| {
                    text.lines()
                        .find_map(|line| line.strip_prefix("Summary: ").map(str::to_owned))
                })
                .unwrap_or_else(|| "unreadable report".into());
            format!("{summary} ({name})")
        })
        .collect()
}

fn report_stamp(name: &str) -> Option<u64> {
    name.strip_prefix("crash-")?.split('-').next()?.parse().ok()
}

/// Keeps the newest reports; each crash may have a text report and a dump.
fn prune(folder: &Path) {
    let mut stamps: Vec<u64> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| report_stamp(&entry.file_name().to_string_lossy()))
        .collect();
    stamps.sort_unstable();
    stamps.dedup();
    let Some(&oldest_kept) = stamps.iter().rev().nth(KEPT_REPORTS - 1) else {
        return;
    };
    for entry in std::fs::read_dir(folder).into_iter().flatten().flatten() {
        if report_stamp(&entry.file_name().to_string_lossy()).is_some_and(|s| s < oldest_kept) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

fn write_report(stamp: u64, kind: &str, summary: &str, details: &str) -> Option<String> {
    let session = SESSION.get()?;
    let name = format!("crash-{stamp}-{kind}.txt");
    let text = format!(
        "Aion Companion crash report\nSummary: {summary}\nTime: {}\nVersion: {} ({})\nProcess: {}\nSession started: {}\n\n{details}\n",
        utc(stamp),
        env!("CARGO_PKG_VERSION"),
        env!("AION_BUILD_REVISION"),
        std::process::id(),
        utc(session.started_ms),
    );
    std::fs::write(crashes(&session.folder).join(&name), text).ok()?;
    Some(name)
}

/// Runs from the panic hook, before unwinding or an abort ends the process.
pub fn panic(info: &std::panic::PanicHookInfo<'_>) {
    let thread = std::thread::current();
    let thread = thread.name().unwrap_or("unnamed").to_owned();
    let summary = format!("panic on thread '{thread}': {info}");
    if PANIC_REPORTS.fetch_add(1, Ordering::Relaxed) >= PANIC_REPORTS_PER_SESSION {
        log::record_now("error", "panic", &summary);
        return;
    }
    let backtrace = std::backtrace::Backtrace::force_capture();
    let report = write_report(
        now_ms(),
        "panic",
        &summary,
        &format!("Backtrace:\n{backtrace}"),
    );
    log::record_now(
        "error",
        "panic",
        &match report {
            Some(name) => format!("{summary} (report {name})"),
            None => summary,
        },
    );
}

/// "2026-10-24 13:05:09 UTC"; the journal and reports avoid local time zones.
fn utc(ms: u64) -> String {
    let seconds = ms / 1000;
    let (days, time) = ((seconds / 86_400) as i64, seconds % 86_400);
    // Howard Hinnant's civil-from-days algorithm.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02} {:02}:{:02}:{:02} UTC",
        time / 3600,
        time / 60 % 60,
        time % 60
    )
}

#[cfg(windows)]
fn boot_ms() -> Option<u64> {
    let uptime = unsafe { windows_sys::Win32::System::SystemInformation::GetTickCount64() };
    now_ms().checked_sub(uptime)
}
#[cfg(not(windows))]
fn boot_ms() -> Option<u64> {
    None
}

#[cfg(windows)]
fn memory() -> Value {
    use windows_sys::Win32::System::{
        ProcessStatus::{K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS},
        Threading::GetCurrentProcess,
    };
    let mut counters = PROCESS_MEMORY_COUNTERS::default();
    let size = std::mem::size_of::<PROCESS_MEMORY_COUNTERS>() as u32;
    if unsafe { K32GetProcessMemoryInfo(GetCurrentProcess(), &mut counters, size) } == 0 {
        return Value::Null;
    }
    let mb = |bytes: usize| bytes as u64 / (1024 * 1024);
    json!({
        "working_set_mb": mb(counters.WorkingSetSize),
        "peak_working_set_mb": mb(counters.PeakWorkingSetSize),
        "private_mb": mb(counters.PagefileUsage),
    })
}
#[cfg(not(windows))]
fn memory() -> Value {
    Value::Null
}

/// Native faults (access violations, stack overflows, heap corruption) bypass
/// the panic hook. A dedicated thread writes the minidump and report, because
/// the faulting thread may have no stack left.
#[cfg(windows)]
mod native {
    use std::{
        path::{Path, PathBuf},
        sync::{
            atomic::{AtomicBool, AtomicPtr, AtomicU32, Ordering},
            OnceLock,
        },
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, GENERIC_WRITE, HANDLE, HMODULE, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{CreateFileW, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL},
        System::{
            Diagnostics::Debug::{
                MiniDumpWithThreadInfo, MiniDumpWithUnloadedModules, MiniDumpWriteDump,
                SetUnhandledExceptionFilter, EXCEPTION_CONTINUE_SEARCH, EXCEPTION_POINTERS,
                MINIDUMP_EXCEPTION_INFORMATION,
            },
            LibraryLoader::{
                GetModuleFileNameW, GetModuleHandleExW, GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS,
                GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            },
            Threading::{
                CreateEventW, GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, SetEvent,
                WaitForSingleObject, INFINITE,
            },
        },
    };

    struct Events {
        request: usize,
        done: usize,
    }
    static EVENTS: OnceLock<Events> = OnceLock::new();
    static FOLDER: OnceLock<PathBuf> = OnceLock::new();
    static POINTERS: AtomicPtr<EXCEPTION_POINTERS> = AtomicPtr::new(std::ptr::null_mut());
    static THREAD: AtomicU32 = AtomicU32::new(0);
    static ACTIVE: AtomicBool = AtomicBool::new(false);

    pub fn install(folder: &Path) {
        if FOLDER.set(folder.to_owned()).is_err() {
            return;
        }
        // Manual reset: every faulting thread is released once the report exists.
        let (request, done) = unsafe {
            (
                CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()),
                CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()),
            )
        };
        if request.is_null() || done.is_null() {
            return;
        }
        let events = EVENTS.get_or_init(|| Events {
            request: request as usize,
            done: done as usize,
        });
        let spawned = std::thread::Builder::new()
            .name("aion-crash-writer".into())
            .spawn(move || {
                if unsafe { WaitForSingleObject(events.request as HANDLE, INFINITE) } == 0 {
                    write();
                }
                unsafe { SetEvent(events.done as HANDLE) };
            });
        if spawned.is_ok() {
            unsafe { SetUnhandledExceptionFilter(Some(filter)) };
        }
    }

    /// Runs on the faulting thread: no allocation, minimal stack.
    unsafe extern "system" fn filter(info: *const EXCEPTION_POINTERS) -> i32 {
        if let Some(events) = EVENTS.get() {
            if !ACTIVE.swap(true, Ordering::AcqRel) {
                POINTERS.store(info as *mut _, Ordering::Release);
                THREAD.store(GetCurrentThreadId(), Ordering::Release);
                SetEvent(events.request as HANDLE);
            }
            WaitForSingleObject(events.done as HANDLE, 30_000);
        }
        // Windows Error Reporting still records the crash and ends the process.
        EXCEPTION_CONTINUE_SEARCH
    }

    fn write() {
        let Some(folder) = FOLDER.get() else { return };
        let pointers = POINTERS.load(Ordering::Acquire);
        let stamp = super::now_ms();
        // The dump comes first: it is the evidence least likely to survive later failures.
        let dump = format!("crash-{stamp}-native.dmp");
        let dumped = minidump(&folder.join(&dump), pointers);
        let (summary, details) = describe(pointers);
        let details = format!(
            "{details}\nMinidump: {}\nOpen the minidump with WinDbg or Visual Studio next to the matching build's symbols.",
            if dumped { dump.as_str() } else { "could not be written" }
        );
        let report = super::write_report(stamp, "native", &summary, &details);
        companion_capture::diagnostics::record_now(
            "error",
            "crash",
            &match report {
                Some(name) => format!("{summary} (report {name})"),
                None => summary,
            },
        );
    }

    fn minidump(path: &Path, pointers: *mut EXCEPTION_POINTERS) -> bool {
        let wide: Vec<u16> = path.as_os_str().encode_wide_nul();
        unsafe {
            let file = CreateFileW(
                wide.as_ptr(),
                GENERIC_WRITE,
                0,
                std::ptr::null(),
                CREATE_ALWAYS,
                FILE_ATTRIBUTE_NORMAL,
                std::ptr::null_mut(),
            );
            if file == INVALID_HANDLE_VALUE {
                return false;
            }
            let exception = MINIDUMP_EXCEPTION_INFORMATION {
                ThreadId: THREAD.load(Ordering::Acquire),
                ExceptionPointers: pointers,
                ClientPointers: 0,
            };
            let written = MiniDumpWriteDump(
                GetCurrentProcess(),
                GetCurrentProcessId(),
                file,
                MiniDumpWithThreadInfo | MiniDumpWithUnloadedModules,
                if pointers.is_null() {
                    std::ptr::null()
                } else {
                    &exception
                },
                std::ptr::null(),
                std::ptr::null(),
            );
            CloseHandle(file);
            written != 0
        }
    }

    trait WideNul {
        fn encode_wide_nul(&self) -> Vec<u16>;
    }
    impl WideNul for std::ffi::OsStr {
        fn encode_wide_nul(&self) -> Vec<u16> {
            use std::os::windows::ffi::OsStrExt;
            self.encode_wide().chain(std::iter::once(0)).collect()
        }
    }

    fn describe(pointers: *mut EXCEPTION_POINTERS) -> (String, String) {
        let Some(record) =
            (unsafe { pointers.as_ref() }).and_then(|p| unsafe { p.ExceptionRecord.as_ref() })
        else {
            return ("native exception without details".into(), String::new());
        };
        let code = record.ExceptionCode as u32;
        let address = record.ExceptionAddress as usize;
        let location = module(address)
            .map(|(name, base)| format!("{name}+{:#x}", address - base))
            .unwrap_or_else(|| format!("{address:#x}"));
        let mut summary = format!(
            "native exception {code:#010x} ({}) at {location}",
            name(code)
        );
        if code == 0xC000_0005 && record.NumberParameters >= 2 {
            let access = match record.ExceptionInformation[0] {
                0 => "reading",
                1 => "writing",
                8 => "executing",
                _ => "accessing",
            };
            summary.push_str(&format!(
                " while {access} {:#x}",
                record.ExceptionInformation[1]
            ));
        }
        let parameters = record.ExceptionInformation[..(record.NumberParameters as usize).min(15)]
            .iter()
            .map(|value| format!("{value:#x}"))
            .collect::<Vec<_>>()
            .join(", ");
        let details = format!(
            "Exception code: {code:#010x}\nAddress: {address:#x} ({location})\nParameters: [{parameters}]\nFaulting thread id: {}\n",
            THREAD.load(Ordering::Acquire)
        );
        (summary, details)
    }

    fn module(address: usize) -> Option<(String, usize)> {
        let mut handle: HMODULE = std::ptr::null_mut();
        let found = unsafe {
            GetModuleHandleExW(
                GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                    | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
                address as *const u16,
                &mut handle,
            )
        };
        if found == 0 {
            return None;
        }
        let mut buffer = [0u16; 520];
        let length =
            unsafe { GetModuleFileNameW(handle, buffer.as_mut_ptr(), buffer.len() as u32) };
        let path = String::from_utf16_lossy(&buffer[..length as usize]);
        let name = path.rsplit(['\\', '/']).next().unwrap_or(&path).to_owned();
        Some((name, handle as usize))
    }

    fn name(code: u32) -> &'static str {
        match code {
            0xC000_0005 => "access violation",
            0xC000_00FD => "stack overflow",
            0xC000_0374 => "heap corruption",
            0xC000_0409 => "fail fast / stack buffer overrun",
            0xC000_001D => "illegal instruction",
            0xC000_0094 => "integer divide by zero",
            0xC000_0420 => "assertion failure",
            0xC000_0017 => "out of memory",
            0x8000_0003 => "breakpoint",
            0xE06D_7363 => "C++ exception",
            0x4000_0015 => "fatal application exit",
            _ => "unknown exception",
        }
    }
}

/// Crashes that bypass in-process handlers (Rust aborts use fail-fast, external
/// termination) still appear in the Windows event log; read the matching ones
/// once, on the launch after an unclean exit.
#[cfg(windows)]
mod windows_events {
    use std::os::windows::process::CommandExt;

    pub fn since(since_ms: u64) -> Vec<String> {
        let Some(exe) = std::env::current_exe().ok().and_then(|path| {
            path.file_name()
                .map(|name| name.to_string_lossy().to_lowercase())
        }) else {
            return Vec::new();
        };
        let window = super::now_ms().saturating_sub(since_ms) + 60_000;
        let time = format!("TimeCreated[timediff(@SystemTime) <= {window}]");
        [
            ("Application", format!("*[System[Provider[@Name='Application Error' or @Name='Application Hang'] and {time}]]")),
            ("System", format!("*[System[Provider[@Name='Microsoft-Windows-Resource-Exhaustion-Detector'] and {time}]]")),
        ]
        .into_iter()
        .flat_map(|(channel, query)| query_events(channel, &query))
        .filter(|event| event.to_lowercase().contains(&exe))
        .take(4)
        .map(|event| summarize(&event))
        .collect()
    }

    fn query_events(channel: &str, query: &str) -> Vec<String> {
        let Ok(output) = std::process::Command::new("wevtutil.exe")
            .args([
                "qe",
                channel,
                &format!("/q:{query}"),
                "/c:20",
                "/rd:true",
                "/f:xml",
            ])
            .creation_flags(0x0800_0000)
            .output()
        else {
            return Vec::new();
        };
        String::from_utf8_lossy(&output.stdout)
            .split("<Event ")
            .skip(1)
            .map(str::to_owned)
            .collect()
    }

    /// Locale-independent: provider, time and event data fields from the XML.
    pub(super) fn summarize(event: &str) -> String {
        let attribute = |name: &str| {
            event
                .split_once(&format!("{name}='"))
                .and_then(|(_, rest)| rest.split_once('\''))
                .map(|(value, _)| value.to_owned())
                .unwrap_or_default()
        };
        let provider = attribute("Provider Name");
        let time = attribute("SystemTime");
        let fields = event
            .split("<Data")
            .skip(1)
            .filter_map(|data| {
                let (head, rest) = data.split_once('>')?;
                let value = rest.split_once("</Data>")?.0.trim();
                if head.ends_with('/') || value.is_empty() {
                    return None;
                }
                let name = head
                    .split_once("Name='")
                    .and_then(|(_, n)| n.split_once('\''))
                    .map(|(n, _)| n);
                Some(match name {
                    Some(name) => format!("{name}={value}"),
                    None => value.to_owned(),
                })
            })
            .collect::<Vec<_>>();
        let fields = if fields.is_empty() {
            "the app was listed among the largest memory users".to_owned()
        } else {
            fields.join(", ")
        };
        format!("Windows recorded '{provider}' for the previous session at {time}: {fields}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_utc_dates() {
        assert_eq!(utc(0), "1970-01-01 00:00:00 UTC");
        assert_eq!(utc(1_792_861_509_000), "2026-10-24 17:05:09 UTC");
        assert_eq!(utc(951_782_400_000), "2000-02-29 00:00:00 UTC");
    }

    #[test]
    fn report_names_carry_their_time_and_prune_keeps_the_newest() {
        assert_eq!(
            report_stamp("crash-1792861509000-native.dmp"),
            Some(1_792_861_509_000)
        );
        assert_eq!(report_stamp("session.json"), None);
        let folder = std::env::temp_dir().join(format!(
            "aion-crash-test-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        for stamp in 1..=12u64 {
            std::fs::write(
                folder.join(format!("crash-{stamp}-native.txt")),
                format!("Summary: crash {stamp}\n"),
            )
            .unwrap();
            std::fs::write(folder.join(format!("crash-{stamp}-native.dmp")), b"").unwrap();
        }
        std::fs::write(folder.join("notes.txt"), b"kept").unwrap();
        prune(&folder);
        assert!(!folder.join("crash-2-native.dmp").exists());
        assert!(folder.join("crash-3-native.txt").exists());
        assert!(folder.join("notes.txt").exists());
        assert_eq!(
            reports_since(&folder, 11),
            [
                "crash 11 (crash-11-native.txt)",
                "crash 12 (crash-12-native.txt)"
            ]
        );
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn next_launch_explains_how_the_previous_session_ended() {
        let folder = std::env::temp_dir().join(format!(
            "aion-crash-summary-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let previous = json!({"pid":42,"version":"0.7.33","started_ms":1_000_000,"heartbeat_ms":2_000_000,
            "memory":{"working_set_mb":300,"private_mb":250,"peak_working_set_mb":410},"exit":null});
        let clean = json!({"started_ms":1_000_000,"exit":{"at_ms":2_000_000,"reason":"Quit"}});
        assert_eq!(previous_summary(&folder, &clean, None), None);

        let outside = previous_summary(&folder, &previous, Some(500_000)).unwrap();
        assert!(outside.contains("version 0.7.33, process 42"), "{outside}");
        assert!(
            outside.contains("using 300 MB of memory (private 250 MB, peak 410 MB)"),
            "{outside}"
        );
        assert!(outside.contains("ended from outside"), "{outside}");

        let rebooted = previous_summary(&folder, &previous, Some(3_000_000)).unwrap();
        assert!(
            rebooted.contains("Windows started again 1970-01-01 00:50:00 UTC"),
            "{rebooted}"
        );

        std::fs::write(
            folder.join("crash-1500000-native.txt"),
            "Summary: native exception 0xc0000005
",
        )
        .unwrap();
        std::fs::write(
            folder.join("crash-900000-panic.txt"),
            "Summary: older session
",
        )
        .unwrap();
        let crashed = previous_summary(&folder, &previous, Some(3_000_000)).unwrap();
        assert!(
            crashed.ends_with(
                "Crash reports: native exception 0xc0000005 (crash-1500000-native.txt)."
            ),
            "{crashed}"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn heartbeat_cannot_overwrite_a_clean_exit() {
        let folder = std::env::temp_dir().join(format!(
            "aion-crash-marker-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        let session = Session {
            folder: folder.clone(),
            started_ms: 1,
            previous: None,
            quit_reason: Mutex::new(None),
            marker: Mutex::new(false),
        };
        assert!(write_marker(&session, None));
        assert!(write_marker(
            &session,
            Some("Quit was chosen in the app or tray")
        ));
        assert!(!write_marker(&session, None));
        let marker: Value =
            serde_json::from_slice(&std::fs::read(folder.join(MARKER)).unwrap()).unwrap();
        assert_eq!(
            marker["exit"]["reason"],
            "Quit was chosen in the app or tray"
        );
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[test]
    fn exported_reports_are_newest_first_bounded_and_sanitized() {
        let folder = std::env::temp_dir().join(format!(
            "aion-crash-export-{}-{}",
            std::process::id(),
            now_ms()
        ));
        std::fs::create_dir_all(&folder).unwrap();
        for stamp in 1..=7u64 {
            std::fs::write(
                folder.join(format!("crash-{stamp}-panic.txt")),
                format!(
                    "Summary: panic {stamp}
fetch https://host/secret failed
"
                ),
            )
            .unwrap();
        }
        std::fs::write(folder.join("crash-7-native.dmp"), b"MDMP").unwrap();
        std::fs::write(
            folder.join("crash-6-panic.txt"),
            "x
"
            .repeat(EXPORTED_LINES + 5),
        )
        .unwrap();
        let reports = exported_reports(&folder);
        assert_eq!(reports.len(), EXPORTED_REPORTS);
        assert_eq!(reports[0]["file"], "crash-7-panic.txt");
        assert_eq!(reports[0]["lines"][0], "Summary: panic 7");
        assert!(!reports[0].to_string().contains("host/secret"));
        assert_eq!(
            reports[1]["lines"].as_array().unwrap().len(),
            EXPORTED_LINES
        );
        assert_eq!(reports[1]["truncated"], true);
        std::fs::remove_dir_all(folder).unwrap();
    }

    /// Crashes a child copy of this test binary and inspects what it left behind.
    #[cfg(windows)]
    fn crash_child(kind: &str) -> (PathBuf, Vec<String>) {
        let folder = std::env::temp_dir().join(format!(
            "aion-crash-child-{kind}-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "crash::tests::crashing_child",
                "--exact",
                "--nocapture",
                "--test-threads=1",
            ])
            .env("AION_CRASH_CHILD", &folder)
            .env("AION_CRASH_KIND", kind)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(!status.success(), "the child must die from its crash");
        let mut names: Vec<String> = std::fs::read_dir(crashes(&folder))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        (folder, names)
    }

    #[cfg(windows)]
    #[test]
    fn crashing_child() {
        let Some(folder) = std::env::var_os("AION_CRASH_CHILD") else {
            return;
        };
        install_in(PathBuf::from(folder));
        if std::env::var("AION_CRASH_KIND").as_deref() == Ok("panic") {
            std::panic::set_hook(Box::new(panic));
            // A panic cannot unwind out of a native callback; Rust aborts with fail-fast,
            // which skips exception filters, so only the panic hook sees it.
            extern "C" fn native_callback() {
                panic!("simulated callback failure");
            }
            native_callback();
        } else {
            unsafe { std::ptr::write_volatile(std::ptr::without_provenance_mut::<u32>(16), 1) };
        }
    }

    #[cfg(windows)]
    #[test]
    fn native_crash_writes_a_minidump_and_report() {
        let (folder, names) = crash_child("native");
        let report = names
            .iter()
            .find(|n| n.ends_with("-native.txt"))
            .expect("text report");
        assert!(
            names.iter().any(|n| n.ends_with("-native.dmp")),
            "{names:?}"
        );
        let text = std::fs::read_to_string(crashes(&folder).join(report)).unwrap();
        assert!(
            text.contains("Summary: native exception 0xc0000005 (access violation)"),
            "{text}"
        );
        assert!(text.contains("while writing 0x10"), "{text}");
        let log = std::fs::read_to_string(folder.join(MARKER)).unwrap();
        assert!(serde_json::from_str::<Value>(&log).unwrap()["exit"].is_null());
        // The next launch explains the unclean exit using the report.
        let reports = reports_since(&crashes(&folder), 0);
        assert!(reports[0].contains("access violation"), "{reports:?}");
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn aborting_panic_is_reported_before_the_process_dies() {
        let (folder, names) = crash_child("panic");
        let report = names
            .iter()
            .find(|n| n.ends_with("-panic.txt"))
            .expect("panic report");
        let text = std::fs::read_to_string(crashes(&folder).join(report)).unwrap();
        assert!(text.contains("simulated callback failure"), "{text}");
        assert!(text.contains("Backtrace:"), "{text}");
        std::fs::remove_dir_all(folder).unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn summarizes_windows_crash_events_without_localized_text() {
        let event = "xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><Provider Name='Application Error' Guid='{a}'/><TimeCreated SystemTime='2026-10-24T13:05:09.1234567Z'/></System><EventData><Data Name='AppName'>aion-companion.exe</Data><Data Name='ExceptionCode'>c0000005</Data><Data Name='Empty'></Data><Data Name='ModuleName'>WebView2Loader.dll</Data></EventData></Event>";
        assert_eq!(
            windows_events::summarize(event),
            "Windows recorded 'Application Error' for the previous session at 2026-10-24T13:05:09.1234567Z: AppName=aion-companion.exe, ExceptionCode=c0000005, ModuleName=WebView2Loader.dll"
        );
    }
}
