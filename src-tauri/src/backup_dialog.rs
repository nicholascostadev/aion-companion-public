//! The Windows Save and Open file dialogs for backups, owned by the main window.
//!
//! Only picks a path: the backup service reads, validates and writes. Each call blocks until
//! the dialog closes, so run it on a blocking worker, never on the main thread. Cancelling
//! is `Ok(None)`; a dialog that could not open or failed is an error with its code. Titles,
//! filter labels and errors follow the saved language, like the tray and window titles.

use companion_capture::{localization, LiveCapture};
use std::path::PathBuf;
use tauri::Manager;

/// The suffix every backup file carries.
pub const EXTENSION: &str = ".aion-backup.json";

/// Asks where to save a new backup. A chosen name without the backup suffix gets it; if that
/// renamed file already exists (so the dialog never asked to replace it), this refuses
/// rather than overwrite it.
pub fn choose_save(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let locale = locale(app);
    let Some(chosen) = native::run(owner(app), Mode::Save, locale)? else {
        return Ok(None);
    };
    let path = with_extension(chosen.clone());
    // The dialog asked before returning an existing path; a renamed one was never confirmed.
    if path != chosen && path.exists() {
        return Err(localization::render(
            locale,
            "backupExists",
            &[("path", path.display().to_string())],
        ));
    }
    Ok(Some(path))
}

/// Asks which backup file to restore from. The file is only named here, never read.
pub fn choose_open(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    native::run(owner(app), Mode::Open, locale(app))
}

#[derive(Clone, Copy)]
enum Mode {
    Save,
    Open,
}

/// The saved language (English when settings cannot be read), resolved to a catalog locale.
fn locale(app: &tauri::AppHandle) -> &'static str {
    let settings = app
        .state::<LiveCapture>()
        .offline_settings()
        .unwrap_or_default();
    localization::resolve_locale(settings["locale"].as_str().unwrap_or("en"))
}

/// The dialog's own title.
#[cfg_attr(not(windows), allow(dead_code))]
fn title(mode: Mode, locale: &str) -> &'static str {
    let key = match mode {
        Mode::Save => "backupSaveTitle",
        Mode::Open => "backupOpenTitle",
    };
    localization::text(locale, key)
}

/// Filter pairs, label then pattern: backups first (selected by default), then any JSON file.
#[cfg_attr(not(windows), allow(dead_code))]
fn filters(locale: &str) -> [(String, String); 2] {
    let label =
        |key, pattern: &str| localization::render(locale, key, &[("pattern", pattern.to_owned())]);
    let backups = format!("*{EXTENSION}");
    let json = "*.json".to_owned();
    [
        (label("backupFilterBackups", &backups), backups),
        (label("backupFilterJson", &json), json),
    ]
}

/// `FNERR_BUFFERTOOSMALL`: the chosen path did not fit the buffer.
#[cfg_attr(not(windows), allow(dead_code))]
const BUFFER_TOO_SMALL: u32 = 0x3003;

/// What a dialog that closed without a path means: no extended error is a cancel.
#[cfg_attr(not(windows), allow(dead_code))]
fn closed_without_path(code: u32, locale: &str) -> Result<Option<PathBuf>, String> {
    match code {
        0 => Ok(None),
        BUFFER_TOO_SMALL => Err(localization::text(locale, "backupPathTooLong").to_owned()),
        code => Err(localization::render(
            locale,
            "backupDialogFailed",
            &[("code", format!("0x{code:04X}"))],
        )),
    }
}

/// The default file name offered by the Save dialog.
#[cfg_attr(not(windows), allow(dead_code))]
fn default_name() -> String {
    let days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| (elapsed.as_secs() / 86_400) as i64)
        .unwrap_or(0);
    let (year, month, day) = civil_from_days(days);
    format!("aion-companion-{year:04}-{month:02}-{day:02}{EXTENSION}")
}

/// Proleptic Gregorian date (UTC) of a day count since 1970-01-01 (Howard Hinnant's algorithm).
#[cfg_attr(not(windows), allow(dead_code))]
fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let month = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    let year = yoe + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Appends the backup suffix unless the name already ends with it (any case); a bare
/// `.json` is replaced rather than doubled.
fn with_extension(path: PathBuf) -> PathBuf {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return path;
    };
    let lower = name.to_ascii_lowercase();
    if lower.ends_with(EXTENSION) {
        return path;
    }
    let stem = if lower.ends_with(".json") {
        &name[..name.len() - ".json".len()]
    } else {
        name
    };
    path.with_file_name(format!("{stem}{EXTENSION}"))
}

/// The main window's handle as an integer (0 when it is gone), so it can cross threads.
#[cfg(windows)]
fn owner(app: &tauri::AppHandle) -> isize {
    app.get_webview_window("main")
        .and_then(|window| window.hwnd().ok())
        .map(|hwnd| hwnd.0 as isize)
        .unwrap_or(0)
}
#[cfg(not(windows))]
fn owner(_: &tauri::AppHandle) -> isize {
    0
}

#[cfg(windows)]
mod native {
    use super::{closed_without_path, default_name, filters, title, Mode, BUFFER_TOO_SMALL};
    use companion_capture::localization;
    use std::ffi::OsString;
    use std::os::windows::ffi::OsStringExt;
    use std::path::PathBuf;
    use windows_sys::Win32::UI::Controls::Dialogs::{
        CommDlgExtendedError, GetOpenFileNameW, GetSaveFileNameW, FNERR_BUFFERTOOSMALL,
        OFN_DONTADDTORECENT, OFN_ENABLESIZING, OFN_EXPLORER, OFN_FILEMUSTEXIST, OFN_HIDEREADONLY,
        OFN_NOCHANGEDIR, OFN_NOREADONLYRETURN, OFN_OVERWRITEPROMPT, OFN_PATHMUSTEXIST,
        OPENFILENAMEW,
    };

    const _: () = assert!(BUFFER_TOO_SMALL == FNERR_BUFFERTOOSMALL as u32);

    /// Room for a long path (`\\?\` prefixed paths can reach 32 767 characters).
    const PATH_CAPACITY: usize = 32_768;

    /// Double-NUL-terminated filter pairs: label, pattern, …
    fn filter(locale: &str) -> Vec<u16> {
        let mut out = Vec::new();
        for (label, pattern) in filters(locale) {
            for part in [label, pattern] {
                out.extend(part.encode_utf16());
                out.push(0);
            }
        }
        out.push(0);
        out
    }

    /// Opens the dialog on a thread of its own: the common dialog sets up the COM apartment
    /// it needs there, whatever a pooled worker thread was initialised with.
    pub fn run(owner: isize, mode: Mode, locale: &'static str) -> Result<Option<PathBuf>, String> {
        std::thread::Builder::new()
            .name("backup-file-dialog".into())
            .spawn(move || show(owner, mode, locale))
            .map_err(|error| {
                localization::render(
                    locale,
                    "backupDialogUnavailable",
                    &[("error", error.to_string())],
                )
            })?
            .join()
            .map_err(|_| localization::text(locale, "backupDialogStopped").to_owned())?
    }

    fn show(owner: isize, mode: Mode, locale: &str) -> Result<Option<PathBuf>, String> {
        let filter = filter(locale);
        let title: Vec<u16> = title(mode, locale).encode_utf16().chain([0]).collect();
        let mut buffer = vec![0u16; PATH_CAPACITY];
        if let Mode::Save = mode {
            let name = default_name();
            let units: Vec<u16> = name.encode_utf16().collect();
            buffer[..units.len()].copy_from_slice(&units);
        }
        let common = OFN_EXPLORER | OFN_ENABLESIZING | OFN_HIDEREADONLY | OFN_NOCHANGEDIR;
        let flags = match mode {
            Mode::Save => common | OFN_OVERWRITEPROMPT | OFN_PATHMUSTEXIST | OFN_NOREADONLYRETURN,
            Mode::Open => common | OFN_FILEMUSTEXIST | OFN_PATHMUSTEXIST | OFN_DONTADDTORECENT,
        };
        let mut dialog = OPENFILENAMEW {
            lStructSize: std::mem::size_of::<OPENFILENAMEW>() as u32,
            hwndOwner: owner as _,
            lpstrFilter: filter.as_ptr(),
            nFilterIndex: 1,
            lpstrFile: buffer.as_mut_ptr(),
            nMaxFile: PATH_CAPACITY as u32,
            lpstrTitle: title.as_ptr(),
            Flags: flags,
            ..Default::default()
        };
        // SAFETY: every pointer in `dialog` points into `filter`, `title` and `buffer`, which
        // outlive the call; `nMaxFile` is the buffer's length in UTF-16 units.
        let chosen = unsafe {
            match mode {
                Mode::Save => GetSaveFileNameW(&mut dialog),
                Mode::Open => GetOpenFileNameW(&mut dialog),
            }
        };
        if chosen == 0 {
            // SAFETY: no arguments; reads the calling thread's last common dialog error.
            let code = unsafe { CommDlgExtendedError() };
            return closed_without_path(code as u32, locale);
        }
        let length = buffer
            .iter()
            .position(|&unit| unit == 0)
            .unwrap_or(buffer.len());
        if length == 0 {
            return Ok(None);
        }
        Ok(Some(PathBuf::from(OsString::from_wide(&buffer[..length]))))
    }
}

#[cfg(not(windows))]
mod native {
    use super::Mode;
    use companion_capture::localization;
    use std::path::PathBuf;

    pub fn run(_: isize, _: Mode, locale: &'static str) -> Result<Option<PathBuf>, String> {
        Err(localization::text(locale, "backupDialogNeedsWindows").to_owned())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adds_the_backup_suffix_once() {
        let at = |name: &str| with_extension(PathBuf::from(format!("C:/b/{name}")));
        assert_eq!(at("mine"), PathBuf::from("C:/b/mine.aion-backup.json"));
        assert_eq!(at("mine.json"), PathBuf::from("C:/b/mine.aion-backup.json"));
        assert_eq!(
            at("mine.AION-Backup.JSON"),
            PathBuf::from("C:/b/mine.AION-Backup.JSON")
        );
        assert_eq!(
            at("mine.aion-backup.json"),
            PathBuf::from("C:/b/mine.aion-backup.json")
        );
    }

    #[test]
    fn names_the_default_file_by_date() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
        assert_eq!(civil_from_days(20_746), (2026, 10, 20));
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        let name = default_name();
        assert!(name.starts_with("aion-companion-") && name.ends_with(EXTENSION));
    }

    #[test]
    fn labels_the_dialog_in_the_saved_language() {
        let pair = |label: &str, pattern: &str| (label.to_owned(), pattern.to_owned());
        let english = [
            pair(
                "Aion Companion backup (*.aion-backup.json)",
                "*.aion-backup.json",
            ),
            pair("JSON files (*.json)", "*.json"),
        ];
        let portuguese = [
            pair(
                "Backup do Aion Companion (*.aion-backup.json)",
                "*.aion-backup.json",
            ),
            pair("Arquivos JSON (*.json)", "*.json"),
        ];
        assert_eq!(filters("en"), english);
        assert_eq!(filters("pt-BR"), portuguese);
        // The legacy `pt` setting reads as Brazilian Portuguese; any other falls back.
        assert_eq!(filters("pt"), portuguese);
        assert_eq!(filters("de"), english);
        assert_eq!(filters(""), english);
        assert_eq!(title(Mode::Save, "en"), "Save a backup");
        assert_eq!(title(Mode::Open, "en"), "Choose a backup to restore");
        assert_eq!(title(Mode::Save, "pt-BR"), "Salvar um backup");
        assert_eq!(title(Mode::Open, "pt"), "Escolha um backup para restaurar");
    }

    #[test]
    fn a_dialog_closed_without_an_error_is_a_cancel() {
        for locale in ["en", "pt-BR"] {
            assert_eq!(closed_without_path(0, locale), Ok(None));
        }
        assert_eq!(
            closed_without_path(BUFFER_TOO_SMALL, "en"),
            Err("The chosen path is too long".to_owned())
        );
        assert_eq!(
            closed_without_path(BUFFER_TOO_SMALL, "pt-BR"),
            Err("O caminho escolhido é longo demais".to_owned())
        );
        assert_eq!(
            closed_without_path(0xFFFF, "en"),
            Err("The Windows file dialog failed (error 0xFFFF)".to_owned())
        );
        assert_eq!(
            closed_without_path(2, "pt"),
            Err("A janela de arquivos do Windows falhou (erro 0x0002)".to_owned())
        );
    }
}
