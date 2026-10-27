//! Where the user put each in-game window, kept in the profile so it opens there again.
//!
//! Only the user's own drops count. A move or resize is saved when the system move/size loop
//! ends (`WM_EXITSIZEMOVE`: the loop behind every drag region, resize grip and the keyboard
//! Move command). Programmatic placement (defaults, Group content fitting, Windows moving a
//! window off a removed display) never replaces a saved spot. Saving runs off the UI thread
//! with atomic replaces, and quitting flushes anything still queued.
//!
//! The DPS meter, top menu, Group and damage details keep their top-left here, in
//! `window-positions.json`. The pet radar, Timers and alert popup keep their earlier
//! geometry files, written through the same queue. The tracker surface always covers the game
//! and is never saved.
use serde_json::{json, Map, Value};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
    time::Duration,
};
use tauri::{AppHandle, Manager, PhysicalPosition, WebviewWindow};

const FILE: &str = "window-positions.json";
/// Saved coordinates beyond this are not a real desktop.
const LIMIT: i64 = 100_000;
const MAX_ENTRIES: usize = 32;
const MAX_ERRORS: usize = 8;
/// Windows rearranges displays in steps; recover once they have settled.
const DISPLAY_SETTLE: Duration = Duration::from_millis(500);

/// Physical pixels: top-left and size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}
impl Rect {
    fn right(&self) -> i64 {
        i64::from(self.x) + i64::from(self.width)
    }
    fn bottom(&self) -> i64 {
        i64::from(self.y) + i64::from(self.height)
    }
    fn overlap(&self, other: &Rect) -> i64 {
        let width = self.right().min(other.right()) - i64::from(self.x.max(other.x));
        let height = self.bottom().min(other.bottom()) - i64::from(self.y.max(other.y));
        width.max(0) * height.max(0)
    }
    /// Squared distance from `point` to the nearest pixel of this rectangle.
    fn distance(&self, (x, y): (i64, i64)) -> i64 {
        let dx = (i64::from(self.x) - x).max(x - self.right()).max(0);
        let dy = (i64::from(self.y) - y).max(y - self.bottom()).max(0);
        dx * dx + dy * dy
    }
}

/// A connected display: its full bounds and its work area (without the taskbar).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Display {
    pub bounds: Rect,
    pub work: Rect,
}

/// Where a window of `size` that wants its top-left at `at` goes: exactly there while all of it
/// is on connected displays (a saved spot is the user's, over a fullscreen game or not),
/// otherwise moved the least to fit the work area of the display it overlaps most, or the
/// nearest display when it is on none (a removed monitor, a lower resolution).
pub fn restore(at: (i32, i32), size: (i32, i32), displays: &[Display]) -> (i32, i32) {
    let window = Rect {
        x: at.0,
        y: at.1,
        width: size.0.max(1),
        height: size.1.max(1),
    };
    let area = i64::from(window.width) * i64::from(window.height);
    let covered: i64 = displays.iter().map(|d| window.overlap(&d.bounds)).sum();
    if displays.is_empty() || covered >= area {
        return at;
    }
    let center = (
        i64::from(window.x) + i64::from(window.width) / 2,
        i64::from(window.y) + i64::from(window.height) / 2,
    );
    let Some(best) = displays
        .iter()
        .max_by_key(|d| (window.overlap(&d.bounds), -d.bounds.distance(center)))
    else {
        return at;
    };
    let clamp = |at: i32, size: i32, start: i32, span: i32| {
        let end = i64::from(start) + i64::from(span) - i64::from(size);
        i64::from(at).min(end).max(i64::from(start)) as i32
    };
    (
        clamp(window.x, window.width, best.work.x, best.work.width),
        clamp(window.y, window.height, best.work.y, best.work.height),
    )
}

/// A saved `{x, y}` inside sane desktop bounds.
pub fn point(value: &Value) -> Option<(i32, i32)> {
    let (x, y) = (value["x"].as_i64()?, value["y"].as_i64()?);
    ((-LIMIT..=LIMIT).contains(&x) && (-LIMIT..=LIMIT).contains(&y)).then_some((x as i32, y as i32))
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 64
        && label
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

/// The saved spots of a `window-positions.json`; anything unreadable is skipped.
fn parse(value: &Value) -> BTreeMap<String, (i32, i32)> {
    value["windows"]
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(label, _)| valid_label(label))
        .filter_map(|(label, at)| Some((label.clone(), point(at)?)))
        .take(MAX_ENTRIES)
        .collect()
}

fn encode(saved: &BTreeMap<String, (i32, i32)>) -> Vec<u8> {
    let windows: Map<String, Value> = saved
        .iter()
        .map(|(label, (x, y))| (label.clone(), json!({"x":x,"y":y})))
        .collect();
    json!({"version":1,"windows":windows})
        .to_string()
        .into_bytes()
}

/// Replaces `path` atomically, so a crash mid-write keeps the previous file.
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder).map_err(|e| e.to_string())?;
    }
    let mut temp = path.as_os_str().to_owned();
    temp.push(".tmp");
    let temp = PathBuf::from(temp);
    let result = (|| {
        let mut file = fs::File::create(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, path)
    })();
    if let Err(error) = result {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

/// Latest bytes per file, written in order by whoever flushes next.
#[derive(Default)]
struct Queue {
    pending: Mutex<BTreeMap<PathBuf, Vec<u8>>>,
    /// Held while writing, so files are replaced one at a time and a newer record is never
    /// overtaken by an older one.
    io: Mutex<()>,
}
impl Queue {
    fn push(&self, path: PathBuf, bytes: Vec<u8>) {
        if let Ok(mut pending) = self.pending.lock() {
            pending.insert(path, bytes);
        }
    }
    /// Writes everything queued; a failed file stays queued unless a newer record replaced it.
    fn flush(&self) -> Vec<String> {
        let Ok(_io) = self.io.lock() else {
            return vec!["Window positions unavailable".into()];
        };
        let batch = self
            .pending
            .lock()
            .map(|mut pending| std::mem::take(&mut *pending))
            .unwrap_or_default();
        let mut errors = Vec::new();
        for (path, bytes) in batch {
            if let Err(error) = write_atomic(&path, &bytes) {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.entry(path).or_insert(bytes);
                }
                errors.push(format!("Could not save a window position: {error}"));
            }
        }
        errors
    }
}

#[derive(Default)]
struct Store {
    path: Option<PathBuf>,
    /// The user's drops for the windows saved in this file.
    saved: BTreeMap<String, (i32, i32)>,
    /// Where each open window belongs: the user's drop or saved spot, else its default spot.
    /// Content fitting and display recovery move a window from here (clamped onto the
    /// displays), never this.
    anchors: BTreeMap<String, (i32, i32)>,
    /// Windows inside a user move/size loop right now.
    moving: BTreeSet<String>,
}

#[derive(Default)]
pub struct WindowPositions {
    store: Mutex<Store>,
    queue: Queue,
    errors: Mutex<Vec<String>>,
}

/// Loads the saved spots. Call from app setup before any window is placed.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(FILE);
    let saved = fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .map(|value| parse(&value))
        .unwrap_or_default();
    app.manage(WindowPositions {
        store: Mutex::new(Store {
            path: Some(path),
            saved,
            ..Default::default()
        }),
        ..Default::default()
    });
    Ok(())
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Store) -> T) -> Option<T> {
    let state = app.try_state::<WindowPositions>()?;
    let mut store = state.store.lock().ok()?;
    Some(f(&mut store))
}

fn record_errors(app: &AppHandle, new: Vec<String>) {
    let Some(state) = app.try_state::<WindowPositions>() else {
        return;
    };
    let Ok(mut errors) = state.errors.lock() else {
        return;
    };
    for error in new {
        if errors.len() < MAX_ERRORS && !errors.contains(&error) {
            errors.push(error);
        }
    }
}

/// Save problems so far, for the overlay status.
pub fn errors(app: &AppHandle) -> Vec<String> {
    app.try_state::<WindowPositions>()
        .and_then(|state| state.errors.lock().ok().map(|e| e.clone()))
        .unwrap_or_default()
}

/// The user's saved top-left for a window kept in `window-positions.json`.
pub fn saved(app: &AppHandle, label: &str) -> Option<(i32, i32)> {
    with(app, |store| store.saved.get(label).copied()).flatten()
}

/// Where an open window belongs (see `Store::anchors`); `None` when it was only centred.
pub fn anchor(app: &AppHandle, label: &str) -> Option<(i32, i32)> {
    with(app, |store| store.anchors.get(label).copied()).flatten()
}

/// True while the user is dragging or resizing the window.
pub fn moving(app: &AppHandle, label: &str) -> bool {
    with(app, |store| store.moving.contains(label)).unwrap_or(false)
}

fn set_moving(app: &AppHandle, label: &str, moving: bool) {
    with(app, |store| {
        if moving {
            store.moving.insert(label.to_string());
        } else {
            store.moving.remove(label);
        }
    });
}

fn set_anchor(app: &AppHandle, label: &str, at: Option<(i32, i32)>) {
    with(app, |store| match at {
        Some(at) => store.anchors.insert(label.to_string(), at),
        None => store.anchors.remove(label),
    });
}

/// Queues a whole file for an atomic replace and writes it on a worker thread.
pub fn save_file(app: &AppHandle, path: PathBuf, value: &Value) {
    if let Some(state) = app.try_state::<WindowPositions>() {
        state.queue.push(path, value.to_string().into_bytes());
        save_soon(app);
    }
}

fn save_soon(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || flush(&app));
}

/// Writes every queued position now. Called before quitting.
pub fn flush(app: &AppHandle) {
    if let Some(state) = app.try_state::<WindowPositions>() {
        let errors = state.queue.flush();
        record_errors(app, errors);
    }
}

/// The connected displays as the window sees them.
pub fn displays(window: &WebviewWindow) -> Vec<Display> {
    let rect = |p: &PhysicalPosition<i32>, s: &tauri::PhysicalSize<u32>| Rect {
        x: p.x,
        y: p.y,
        width: s.width.min(i32::MAX as u32) as i32,
        height: s.height.min(i32::MAX as u32) as i32,
    };
    window
        .available_monitors()
        .map(|monitors| {
            monitors
                .iter()
                .map(|m| Display {
                    bounds: rect(m.position(), m.size()),
                    work: rect(&m.work_area().position, &m.work_area().size),
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Places a newly built window: at `wanted` (a saved spot) kept on connected displays, else at
/// `default`, else centred. `size` is the physical size it will have. The wanted spot (or the
/// default) becomes the window's anchor even when it had to be pulled onto a display, so it
/// returns there if that display comes back. Placing never saves anything.
pub fn place(
    window: &WebviewWindow,
    wanted: Option<(i32, i32)>,
    size: (i32, i32),
    default: Option<(i32, i32)>,
) -> Result<(), String> {
    let target = wanted
        .map(|at| restore(at, size, &displays(window)))
        .or(default);
    match target {
        Some((x, y)) => window
            .set_position(PhysicalPosition::new(x, y))
            .map_err(|e| e.to_string())?,
        None => window.center().map_err(|e| e.to_string())?,
    }
    set_anchor(window.app_handle(), window.label(), wanted.or(default));
    Ok(())
}

/// The physical size a freshly built window is placed with.
pub fn size_of(window: &WebviewWindow) -> (i32, i32) {
    window
        .outer_size()
        .map(|s| (s.width as i32, s.height as i32))
        .unwrap_or((1, 1))
}

/// Saves the drop of a window kept in `window-positions.json`.
pub fn save_drop(app: &AppHandle, label: &str, dropped: Dropped) {
    let Some(Some((path, bytes))) = with(app, |store| {
        store
            .saved
            .insert(label.to_string(), (dropped.x, dropped.y));
        Some((store.path.clone()?, encode(&store.saved)))
    }) else {
        return;
    };
    if let Some(state) = app.try_state::<WindowPositions>() {
        state.queue.push(path, bytes);
        save_soon(app);
    }
}

/// The window at the end of a user move or resize: outer top-left and client size.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Dropped {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Why a window is checked against the displays.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Recovery {
    /// Displays were added, removed or rearranged: back to the anchor when it is visible again
    /// (its monitor came back), otherwise the least distance to be fully visible.
    Return,
    /// The window's scale changed (opened on, or a monitor switched to, another DPI) and Windows
    /// resized it after it was placed: only pulled in if it now hangs off the displays.
    KeepVisible,
}

/// Where a window at `current` with its final `size` should move, if anywhere. Never while the
/// user is dragging or resizing it; their drop decides.
fn recovery_target(
    mode: Recovery,
    current: (i32, i32),
    size: (i32, i32),
    anchor: Option<(i32, i32)>,
    moving: bool,
    displays: &[Display],
) -> Option<(i32, i32)> {
    if moving {
        return None;
    }
    let from = match mode {
        Recovery::Return => anchor.unwrap_or(current),
        Recovery::KeepVisible => current,
    };
    Some(restore(from, size, displays)).filter(|target| *target != current)
}

/// Checks an open window against the displays with its current (final) size; never changes its
/// anchor or saved spot.
fn recover(app: &AppHandle, label: &str, mode: Recovery) {
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    let (Ok(at), Ok(size)) = (window.outer_position(), window.outer_size()) else {
        return;
    };
    let target = recovery_target(
        mode,
        (at.x, at.y),
        (size.width as i32, size.height as i32),
        anchor(app, label),
        moving(app, label),
        &displays(&window),
    );
    if let Some(target) = target {
        if let Err(error) = move_without_activation(&window, target) {
            record_errors(app, vec![error]);
        }
    }
}

/// Runs `recover` from a worker once Windows has finished rearranging or rescaling: window
/// queries wait on the UI thread, which is the one reporting the change.
fn recover_later(app: AppHandle, label: String, mode: Recovery) {
    std::thread::spawn(move || {
        std::thread::sleep(DISPLAY_SETTLE);
        recover(&app, &label, mode);
    });
}

#[cfg(windows)]
fn move_without_activation(window: &WebviewWindow, (x, y): (i32, i32)) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // No SWP_SHOWWINDOW: a hidden window stays hidden; tao's flags are left alone.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            y,
            0,
            0,
            SWP_NOACTIVATE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
    };
    if ok == 0 {
        return Err("Could not move a window back onto the screen".into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn move_without_activation(window: &WebviewWindow, (x, y): (i32, i32)) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())
}

/// What to do with a window's drop: `save_drop` or the window's own geometry file.
pub type OnDrop = fn(&AppHandle, &str, Dropped);

/// Watches a window for the end of user moves and resizes, and for display changes.
#[cfg(windows)]
pub fn watch(window: &WebviewWindow, on_drop: OnDrop) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let app = window.app_handle().clone();
    let label = window.label().to_string();
    // A subclass is installed on the thread that owns the window.
    window
        .run_on_main_thread(move || {
            if let Err(error) = subclass::install(hwnd, app.clone(), label, on_drop) {
                record_errors(&app, vec![error]);
            }
        })
        .map_err(|e| e.to_string())
}
#[cfg(not(windows))]
pub fn watch(_: &WebviewWindow, _: OnDrop) -> Result<(), String> {
    Ok(())
}

/// A move or resize run outside the system move loop (`no_activate`) starts here; its end is
/// the usual `WM_EXITSIZEMOVE`. A window that is not watched is ignored.
#[cfg(windows)]
pub fn begin_user_move(hwnd: isize) {
    subclass::begin(hwnd);
}

#[cfg(windows)]
mod subclass {
    use super::{Dropped, OnDrop, Recovery};
    use std::cell::Cell;
    use tauri::AppHandle;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
        UI::{
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetClientRect, GetWindowRect, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_ENTERSIZEMOVE,
                WM_EXITSIZEMOVE, WM_NCDESTROY,
            },
        },
    };
    const ID: usize = 0x4149_4f4e;

    struct Watch {
        app: AppHandle,
        label: String,
        on_drop: OnDrop,
        /// Window rectangle when the move/size loop began; a click without a move saves nothing.
        start: Cell<Option<(i32, i32, i32, i32)>>,
    }

    fn window_rect(hwnd: HWND) -> Option<(i32, i32, i32, i32)> {
        let mut rect = RECT::default();
        (unsafe { GetWindowRect(hwnd, &mut rect) } != 0).then_some((
            rect.left,
            rect.top,
            rect.right,
            rect.bottom,
        ))
    }

    pub fn install(
        hwnd: isize,
        app: AppHandle,
        label: String,
        on_drop: OnDrop,
    ) -> Result<(), String> {
        let watch = Box::into_raw(Box::new(Watch {
            app: app.clone(),
            label: label.clone(),
            on_drop,
            start: Cell::new(None),
        }));
        let ok = unsafe { SetWindowSubclass(hwnd as HWND, Some(proc), ID, watch as usize) };
        if ok == 0 {
            drop(unsafe { Box::from_raw(watch) });
            return Err(
                "Could not watch a window for moves; its position will not be saved".into(),
            );
        }
        // Placing a new window on a monitor with another scale makes Windows resize it inside
        // the placement itself, before this watch existed: check it once with its final size.
        super::recover_later(app, label, Recovery::KeepVisible);
        Ok(())
    }

    fn started(hwnd: HWND, watch: &Watch) {
        watch.start.set(window_rect(hwnd));
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            super::set_moving(&watch.app, &watch.label, true)
        }));
    }

    pub fn begin(hwnd: isize) {
        let mut data = 0;
        if unsafe { GetWindowSubclass(hwnd as HWND, Some(proc), ID, &mut data) } != 0 && data != 0 {
            started(hwnd as HWND, unsafe { &*(data as *const Watch) });
        }
    }

    unsafe extern "system" fn proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        let watch = data as *const Watch;
        match message {
            WM_ENTERSIZEMOVE => started(hwnd, unsafe { &*watch }),
            WM_EXITSIZEMOVE => {
                let watch = unsafe { &*watch };
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    super::set_moving(&watch.app, &watch.label, false)
                }));
                let start = watch.start.take();
                let end = window_rect(hwnd);
                let mut client = RECT::default();
                if let Some((left, top, _, _)) = end.filter(|end| start != Some(*end)) {
                    if unsafe { GetClientRect(hwnd, &mut client) } != 0 {
                        let dropped = Dropped {
                            x: left,
                            y: top,
                            width: (client.right - client.left).max(0) as u32,
                            height: (client.bottom - client.top).max(0) as u32,
                        };
                        // Nothing may unwind into the window procedure.
                        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            super::set_anchor(&watch.app, &watch.label, Some((left, top)));
                            (watch.on_drop)(&watch.app, &watch.label, dropped);
                        }));
                    }
                }
            }
            WM_DISPLAYCHANGE => {
                let watch = unsafe { &*watch };
                super::recover_later(watch.app.clone(), watch.label.clone(), Recovery::Return);
            }
            // A scale change (another monitor's DPI, or the user changing scaling, which need
            // not send WM_DISPLAYCHANGE) resizes the window after this; tao applies the size.
            WM_DPICHANGED => {
                let watch = unsafe { &*watch };
                super::recover_later(
                    watch.app.clone(),
                    watch.label.clone(),
                    Recovery::KeepVisible,
                );
            }
            WM_NCDESTROY => unsafe {
                RemoveWindowSubclass(hwnd, Some(proc), id);
                drop(Box::from_raw(watch as *mut Watch));
                return DefSubclassProc(hwnd, message, wparam, lparam);
            },
            _ => {}
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn rect(x: i32, y: i32, width: i32, height: i32) -> Rect {
        Rect {
            x,
            y,
            width,
            height,
        }
    }
    /// 1920×1080 primary with a 40 px taskbar, and a 1280×1024 monitor to its left.
    const PRIMARY: Display = Display {
        bounds: rect(0, 0, 1920, 1080),
        work: rect(0, 0, 1920, 1040),
    };
    const LEFT: Display = Display {
        bounds: rect(-1280, 0, 1280, 1024),
        work: rect(-1280, 0, 1280, 1024),
    };

    #[test]
    fn a_saved_spot_on_connected_displays_is_kept_exactly() {
        assert_eq!(restore((1500, 200), (360, 300), &[PRIMARY]), (1500, 200));
        // Negative coordinates on a monitor left of the primary.
        assert_eq!(
            restore((-900, 40), (340, 300), &[PRIMARY, LEFT]),
            (-900, 40)
        );
        // Over a fullscreen game where the taskbar would be: still on the display.
        assert_eq!(restore((100, 1050), (480, 30), &[PRIMARY]), (100, 1050));
        // Straddling two side-by-side monitors.
        assert_eq!(
            restore((-100, 100), (360, 300), &[PRIMARY, LEFT]),
            (-100, 100)
        );
    }

    #[test]
    fn a_spot_on_a_removed_monitor_comes_back_into_the_nearest_work_area() {
        assert_eq!(restore((-900, 40), (340, 300), &[PRIMARY]), (0, 40));
        // Far below every display: nearest edge, inside the work area.
        assert_eq!(restore((500, 5000), (360, 300), &[PRIMARY]), (500, 740));
    }

    #[test]
    fn a_partly_visible_window_moves_the_least_to_be_fully_visible() {
        // A lower resolution left the meter hanging off the right edge.
        assert_eq!(restore((1800, 200), (360, 300), &[PRIMARY]), (1560, 200));
        // Above the top edge.
        assert_eq!(restore((300, -20), (480, 36), &[PRIMARY]), (300, 0));
        // Hanging below the shorter left monitor: up into its work area, not onto the primary.
        assert_eq!(
            restore((-400, 900), (340, 300), &[PRIMARY, LEFT]),
            (-400, 724)
        );
        // Larger than the work area: pinned to its top-left.
        assert_eq!(restore((50, 50), (4000, 3000), &[PRIMARY]), (0, 0));
    }

    #[test]
    fn a_rescaled_window_is_pulled_in_only_when_it_now_hangs_off_the_displays() {
        let keep = |current, size, anchor| {
            recovery_target(
                Recovery::KeepVisible,
                current,
                size,
                anchor,
                false,
                &[PRIMARY],
            )
        };
        // Restored at 100% near the right edge, then grown to 150% by the monitor's scale.
        assert_eq!(
            keep((1500, 200), (540, 450), Some((1500, 200))),
            Some((1380, 200))
        );
        // Still fully visible after rescaling: left exactly where it is.
        assert_eq!(keep((100, 200), (540, 450), Some((100, 200))), None);
        // Group fitted up from a low anchor: a rescale keeps the fitted spot, not the anchor.
        assert_eq!(keep((1500, 440), (400, 600), Some((1500, 700))), None);
    }

    #[test]
    fn a_display_change_returns_a_window_to_its_anchor_when_it_is_visible_again() {
        let back = |current, anchor, displays: &[Display]| {
            recovery_target(
                Recovery::Return,
                current,
                (340, 300),
                anchor,
                false,
                displays,
            )
        };
        // The left monitor came back: home to the user's spot there.
        assert_eq!(
            back((0, 40), Some((-900, 40)), &[PRIMARY, LEFT]),
            Some((-900, 40))
        );
        // Still missing: pulled onto the primary, and nothing to do once it is there.
        assert_eq!(
            back((-900, 40), Some((-900, 40)), &[PRIMARY]),
            Some((0, 40))
        );
        assert_eq!(back((0, 40), Some((-900, 40)), &[PRIMARY]), None);
        // Only centred (no anchor) and visible: stays.
        assert_eq!(back((700, 300), None, &[PRIMARY]), None);
    }

    #[test]
    fn recovery_never_moves_a_window_the_user_is_dragging() {
        for mode in [Recovery::Return, Recovery::KeepVisible] {
            let target = recovery_target(
                mode,
                (1800, 200),
                (540, 450),
                Some((-900, 40)),
                true,
                &[PRIMARY],
            );
            assert_eq!(target, None);
        }
    }

    #[test]
    fn without_display_information_the_saved_spot_is_used() {
        assert_eq!(restore((-5000, 99), (300, 200), &[]), (-5000, 99));
    }

    #[test]
    fn saved_positions_are_bounded_and_validated() {
        let value = json!({"version":1,"windows":{
            "dps-overlay":{"x":-1200,"y":40},
            "companion-menu":{"x":720,"y":12},
            "group-overlay":{"x":"10","y":0},
            "dps-details":{"x":0},
            "far":{"x":200_000,"y":0},
            "../escape":{"x":1,"y":1},
            "Upper":{"x":1,"y":1}
        }});
        let saved = parse(&value);
        assert_eq!(saved.len(), 2);
        assert_eq!(saved["dps-overlay"], (-1200, 40));
        assert_eq!(saved["companion-menu"], (720, 12));
        assert!(parse(&json!({"windows":[1,2]})).is_empty());
        assert!(parse(&json!("nope")).is_empty());
        let many: Map<String, Value> = (0..100)
            .map(|i| (format!("w{i}"), json!({"x":i,"y":i})))
            .collect();
        assert_eq!(parse(&json!({"windows":many})).len(), MAX_ENTRIES);
    }

    #[test]
    fn encoded_positions_round_trip() {
        let saved = BTreeMap::from([
            ("dps-overlay".to_string(), (-1200, 40)),
            ("group-overlay".to_string(), (24, 96)),
        ]);
        let bytes = encode(&saved);
        assert_eq!(parse(&serde_json::from_slice(&bytes).unwrap()), saved);
    }

    fn folder(name: &str) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "aion-companion-positions-{name}-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&folder);
        folder
    }

    #[test]
    fn the_queue_writes_the_latest_record_atomically() {
        let folder = folder("queue");
        let path = folder.join(FILE);
        let queue = Queue::default();
        queue.push(path.clone(), b"{\"old\":1}".to_vec());
        queue.push(path.clone(), b"{\"new\":2}".to_vec());
        assert!(queue.flush().is_empty());
        assert_eq!(fs::read(&path).unwrap(), b"{\"new\":2}");
        assert!(!folder.join(format!("{FILE}.tmp")).exists());
        // Nothing queued: nothing written.
        fs::write(&path, b"kept").unwrap();
        assert!(queue.flush().is_empty());
        assert_eq!(fs::read(&path).unwrap(), b"kept");
        let _ = fs::remove_dir_all(folder);
    }

    #[test]
    fn a_failed_write_keeps_the_file_and_the_record_queued() {
        let folder = folder("failed");
        // A folder where the file belongs makes the replace fail.
        let path = folder.join(FILE);
        fs::create_dir_all(&path).unwrap();
        let queue = Queue::default();
        queue.push(path.clone(), b"{}".to_vec());
        assert_eq!(queue.flush().len(), 1);
        assert!(path.is_dir());
        assert!(!folder.join(format!("{FILE}.tmp")).exists());
        // Still queued for the next flush once the problem is gone.
        fs::remove_dir_all(&path).unwrap();
        assert!(queue.flush().is_empty());
        assert_eq!(fs::read(&path).unwrap(), b"{}");
        let _ = fs::remove_dir_all(folder);
    }
}
