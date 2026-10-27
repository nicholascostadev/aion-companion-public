use companion_capture::LiveCapture;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use tauri::{
    menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, MenuItemKind, PredefinedMenuItem},
    tray::TrayIconBuilder,
};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

const LABEL: &str = "dps-overlay";
const MENU_LABEL: &str = "companion-menu";
const GROUP_LABEL: &str = "group-overlay";
/// Click-through surface over the game window that draws tracker bars at their x/y.
/// Kept out of `OVERLAYS` so the shared focus `Visibility` slots stay unchanged.
const TRACKERS_LABEL: &str = "tracker-overlay";
/// Damage details for one player, opened from a DPS meter row.
const DETAILS_LABEL: &str = "dps-details";
/// Fits the toolbar including the pet radar button.
pub(crate) const MENU_WIDTH: f64 = 512.0;
/// The 32 px pill plus a 2 px transparent margin (`MenuBar.tsx`), so no dead strip eats clicks.
const MENU_HEIGHT: f64 = 36.0;
const TRAY_ID: &str = "companion-tray";
const OVERLAYS: [&str; crate::focus::PANELS] = [LABEL, MENU_LABEL, GROUP_LABEL, DETAILS_LABEL];

pub fn configure_hotkeys(app: &AppHandle, settings: &Value) -> Result<(), String> {
    let mut next = Vec::new();
    for action in [
        "toggle_overlay",
        "toggle_lock",
        "reset",
        "copy_summary",
        "compact_strip",
    ] {
        let value = settings["hotkeys"][action].as_str().unwrap_or("");
        if value.is_empty() {
            continue;
        }
        let key = value
            .parse::<Shortcut>()
            .map_err(|e| format!("Invalid {action} shortcut: {e}"))?;
        if next.iter().any(|(other, _)| *other == key) {
            return Err("Each action needs a different shortcut".into());
        }
        next.push((key, action.to_string()));
    }
    if let Some(presets) = settings["presets"].as_array() {
        for preset in presets {
            let value = preset["keybind"].as_str().unwrap_or("");
            if value.is_empty() {
                continue;
            }
            let key = value
                .parse::<Shortcut>()
                .map_err(|e| format!("Invalid preset shortcut: {e}"))?;
            if next.iter().any(|(other, _)| *other == key) {
                return Err("Preset shortcuts must be unique".into());
            }
            next.push((
                key,
                format!("preset:{}", preset["id"].as_str().unwrap_or("")),
            ));
        }
    }
    let state = app.state::<OverlayState>();
    let mut old = state
        .shortcuts
        .lock()
        .map_err(|_| "Shortcut settings unavailable")?;
    if *old == next {
        return Ok(());
    }
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    for (key, _) in &next {
        if let Err(error) = app.global_shortcut().register(*key) {
            let _ = app.global_shortcut().unregister_all();
            for (key, _) in old.iter() {
                let _ = app.global_shortcut().register(*key);
            }
            return Err(format!("Shortcut could not register: {error}"));
        }
    }
    state.lock_hotkey.store(
        next.iter().any(|(_, action)| action == "toggle_lock"),
        Ordering::Release,
    );
    *old = next;
    Ok(())
}

pub struct OverlayState {
    locked: AtomicBool,
    ready: AtomicBool,
    menu_ready: AtomicBool,
    group_ready: AtomicBool,
    lock_hotkey: AtomicBool,
    quitting: AtomicBool,
    trackers_ready: AtomicBool,
    trackers_requested: AtomicBool,
    /// Arrange mode: the tracker surface accepts input so bars can be dragged.
    trackers_editing: AtomicBool,
    details_ready: AtomicBool,
    /// `{revision, report_id, player}` of the last row opened, or null.
    details: Mutex<Value>,
    /// Player rows that take input while the meter is otherwise click-through.
    hit: Mutex<crate::hit::HitRegions>,
    errors: Mutex<Vec<String>>,
    saved: Mutex<String>,
    visibility: Mutex<crate::focus::Visibility>,
    group_auto: Mutex<crate::group_auto::GroupAuto>,
    shortcuts: Mutex<Vec<(Shortcut, String)>>,
    /// Tray check rows, reconciled by `sync_tray`.
    tray: Mutex<Vec<(TrayToggle, CheckMenuItem<tauri::Wry>)>>,
}
impl Default for OverlayState {
    fn default() -> Self {
        Self {
            locked: AtomicBool::new(false),
            ready: AtomicBool::new(false),
            menu_ready: AtomicBool::new(false),
            group_ready: AtomicBool::new(false),
            lock_hotkey: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            trackers_ready: AtomicBool::new(false),
            trackers_requested: AtomicBool::new(false),
            trackers_editing: AtomicBool::new(false),
            details_ready: AtomicBool::new(false),
            details: Mutex::new(Value::Null),
            hit: Mutex::new(crate::hit::HitRegions::default()),
            errors: Mutex::new(Vec::new()),
            saved: Mutex::new(String::new()),
            visibility: Mutex::new(crate::focus::Visibility::default()),
            group_auto: Mutex::new(crate::group_auto::GroupAuto::default()),
            shortcuts: Mutex::new(Vec::new()),
            tray: Mutex::new(Vec::new()),
        }
    }
}

fn request_visibility(app: &AppHandle, label: &str, visible: bool) -> Result<(), String> {
    let index = OVERLAYS
        .iter()
        .position(|&item| item == label)
        .ok_or("Unknown overlay")?;
    app.state::<OverlayState>()
        .visibility
        .lock()
        .map_err(|_| "Overlay visibility unavailable")?
        .requested[index] = visible;
    schedule_visibility(app)
}

/// True while AION (or one of our overlays over it) is focused: the overlay focus gate.
pub fn game_active(app: &AppHandle) -> bool {
    app.state::<OverlayState>()
        .visibility
        .lock()
        .map(|v| v.active)
        .unwrap_or(false)
}

fn schedule_visibility(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        if let Err(error) = apply_visibility(&handle) {
            record_error(&handle, error);
        }
    })
    .map_err(|e| e.to_string())
}

fn apply_visibility(app: &AppHandle) -> Result<(), String> {
    sync_tray(app);
    let state = app.state::<OverlayState>();
    let (desired, active) = {
        let visibility = state
            .visibility
            .lock()
            .map_err(|_| "Overlay visibility unavailable")?;
        (
            std::array::from_fn::<bool, { crate::focus::PANELS }, _>(|i| visibility.visible(i)),
            visibility.active,
        )
    };
    for (index, label) in OVERLAYS.iter().enumerate() {
        if let Some(window) = app.get_webview_window(label) {
            if window.is_visible().map_err(|e| e.to_string())? != desired[index] {
                set_visible_without_activation(&window, desired[index])?;
            }
        }
    }
    // Like every overlay, trackers only show while AION (or one of our overlays over it) is
    // focused; arranging is an explicit request too, never a reason to show over other apps.
    if let Some(window) = app.get_webview_window(TRACKERS_LABEL) {
        let editing = state.trackers_editing.load(Ordering::Acquire);
        let want = active && (editing || state.trackers_requested.load(Ordering::Acquire));
        if window.is_visible().map_err(|e| e.to_string())? != want {
            set_visible_without_activation(&window, want)?;
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn set_visible_without_activation(
    window: &tauri::WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, ShowWindow, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER,
        SWP_NOSIZE, SWP_NOZORDER, SW_HIDE, SW_SHOWNOACTIVATE,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    if visible {
        // Never shown without the focus guard (this runs on the window's own thread): a
        // failed install leaves the window hidden and the caller reports the error.
        crate::no_activate::ensure(hwnd.0 as isize)?;
    }
    unsafe {
        if visible {
            // Tao keeps WS_CAPTION on undecorated windows and strips the frame only when it
            // answers WM_NCCALCSIZE. Its creation-time recalc runs before the window userdata
            // exists, so a window created hidden keeps the default caption until a frame
            // change. Tao's own show path does that recalc; this raw no-activate show must too.
            SetWindowPos(
                hwnd.0,
                std::ptr::null_mut(),
                0,
                0,
                0,
                0,
                SWP_FRAMECHANGED
                    | SWP_NOACTIVATE
                    | SWP_NOMOVE
                    | SWP_NOSIZE
                    | SWP_NOZORDER
                    | SWP_NOOWNERZORDER,
            );
        }
        ShowWindow(hwnd.0, if visible { SW_SHOWNOACTIVATE } else { SW_HIDE });
    }
    crate::webview_visibility::sync_window(window);
    Ok(())
}
#[cfg(not(windows))]
pub(crate) fn set_visible_without_activation(
    window: &tauri::WebviewWindow,
    visible: bool,
) -> Result<(), String> {
    if visible {
        window.show()
    } else {
        window.hide()
    }
    .map_err(|e| e.to_string())
}

fn start_focus_tracking(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let mut ids = crate::focus::game_process_ids();
        let mut refreshed = std::time::Instant::now();
        let mut polled = std::time::Instant::now();
        let mut observed = std::time::Instant::now();
        loop {
            if refreshed.elapsed() >= std::time::Duration::from_secs(1) {
                ids = crate::focus::game_process_ids();
                refreshed = std::time::Instant::now();
            }
            let sync_browsers = polled.elapsed() >= std::time::Duration::from_millis(500);
            if sync_browsers {
                // Off the main thread: a first show builds the window, which waits on the event loop.
                if let Err(error) = sync_group(&app) {
                    record_error(&app, error);
                }
                polled = std::time::Instant::now();
            }
            // Row input is checked often so the first click over a locked row lands; the
            // foreground check keeps its slower cadence.
            let observe = observed.elapsed() >= std::time::Duration::from_millis(125);
            if observe {
                observed = std::time::Instant::now();
            }
            let handle = app.clone();
            let games = ids.clone();
            if app
                .run_on_main_thread(move || {
                    sync_row_input(&handle);
                    crate::pet_window::sync_input(&handle);
                    crate::activity_window::sync_input(&handle);
                    if sync_browsers {
                        crate::webview_visibility::sync(&handle);
                    }
                    if !observe {
                        return;
                    }
                    #[cfg(windows)]
                    let windows: Vec<isize> = OVERLAYS
                        .iter()
                        .chain([
                            &TRACKERS_LABEL,
                            &crate::alert_window::LABEL,
                            &crate::pet_window::LABEL,
                            &crate::activity_window::TIMERS,
                            &crate::activity_window::EXPLORE,
                        ])
                        .filter_map(|label| {
                            handle
                                .get_webview_window(label)?
                                .hwnd()
                                .ok()
                                .map(|hwnd| hwnd.0 as isize)
                        })
                        .collect();
                    #[cfg(not(windows))]
                    let windows = Vec::new();
                    let target = crate::focus::foreground_target(&games, &windows);
                    if let Ok(mut state) = handle.state::<OverlayState>().visibility.lock() {
                        state.observe(target);
                    }
                    if let Err(error) = apply_visibility(&handle) {
                        record_error(&handle, error);
                    }
                    // The alert popup follows the same focus gate as every overlay.
                    crate::alert_window::sync(&handle, game_active(&handle));
                    // So does the pet radar.
                    crate::pet_window::sync(&handle, game_active(&handle));
                    crate::activity_window::sync(&handle, game_active(&handle));
                })
                .is_err()
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    });
}
/// Feature intent is independent from room eligibility and foreground focus.
fn sync_group(app: &AppHandle) -> Result<(), String> {
    use crate::group_auto::{Action, Roster};
    let state = app.state::<OverlayState>();
    let (action, revision) = {
        // Serialize snapshot reads with decisions so concurrent enable/poll calls
        // cannot apply an older room snapshot after a more recent leave.
        let mut auto = state
            .group_auto
            .lock()
            .map_err(|_| "Group automation unavailable")?;
        let group = app.state::<LiveCapture>().group_snapshot()?;
        let requested = state
            .visibility
            .lock()
            .map_err(|_| "Overlay visibility unavailable")?
            .requested[2];
        (
            auto.observe(Roster::from_snapshot(&group), requested),
            auto.revision(),
        )
    };
    match action {
        Some(Action::Show) => {
            // Creating the webview may take a while. A later leave/disable wins.
            group_window(app)?;
            let auto = state
                .group_auto
                .lock()
                .map_err(|_| "Group automation unavailable")?;
            if auto.show_allowed(revision) {
                request_visibility(app, GROUP_LABEL, true)?;
            }
        }
        Some(Action::Hide) => {
            let auto = state
                .group_auto
                .lock()
                .map_err(|_| "Group automation unavailable")?;
            if auto.hide_allowed(revision) {
                request_visibility(app, GROUP_LABEL, false)?;
            }
        }
        None => {}
    }
    Ok(())
}

fn manual_group(app: &AppHandle, enabled: bool) -> Result<(), String> {
    app.state::<OverlayState>()
        .group_auto
        .lock()
        .map_err(|_| "Group automation unavailable")?
        .manual(enabled);
    // Outside a room no window changes, but the tray's check mark does.
    schedule_visibility(app)
}

pub(crate) fn record_error(app: &AppHandle, error: String) {
    if let Ok(mut errors) = app.state::<OverlayState>().errors.lock() {
        if errors.len() < 8 && !errors.contains(&error) {
            errors.push(error);
        }
    }
}

#[tauri::command]
pub fn overlay_status(app: AppHandle) -> Value {
    let state = app.state::<OverlayState>();
    let tray = app.tray_by_id(TRAY_ID);
    let tray_registered = tray
        .as_ref()
        .is_some_and(|icon| icon.rect().ok().flatten().is_some());
    let (requested, active, game_focused) = state
        .visibility
        .lock()
        .map(|v| (v.requested, v.active, v.game_focused))
        .unwrap_or(([false; crate::focus::PANELS], false, false));
    let group_auto = state
        .group_auto
        .lock()
        .map(|auto| auto.status())
        .unwrap_or(Value::Null);
    let mut status = json!({"group_enabled":group_auto["enabled"].as_bool().unwrap_or(false),"group_auto":group_auto,"requested_visible":requested[0],"menu_requested":requested[1],"group_requested":requested[2],"game_focused":game_focused,"focus_suppressed":!active,"locked":state.locked.load(Ordering::Acquire),"ready":state.ready.load(Ordering::Acquire),"menu_ready":state.menu_ready.load(Ordering::Acquire),"group_ready":state.group_ready.load(Ordering::Acquire),"group_visible":app.get_webview_window(GROUP_LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"menu_visible":app.get_webview_window(MENU_LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"can_lock":state.lock_hotkey.load(Ordering::Acquire),"tray_ready":tray.is_some(),"tray_registered":tray_registered,"visible":app.get_webview_window(LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"saved_path":state.saved.lock().map(|s|s.clone()).unwrap_or_default(),"errors":state.errors.lock().map(|v|v.clone()).unwrap_or_default()});
    status["details_requested"] = requested[3].into();
    status["details_ready"] = state.details_ready.load(Ordering::Acquire).into();
    status["details_visible"] = app
        .get_webview_window(DETAILS_LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false))
        .into();
    status["details_selection"] = state
        .details
        .lock()
        .map(|d| d.clone())
        .unwrap_or(Value::Null);
    status["row_regions"] = state.hit.lock().map(|h| h.len()).unwrap_or(0).into();
    status["position_errors"] = crate::window_positions::errors(&app).into();
    status["trackers_requested"] = state.trackers_requested.load(Ordering::Acquire).into();
    status["trackers_editing"] = state.trackers_editing.load(Ordering::Acquire).into();
    status["trackers_ready"] = state.trackers_ready.load(Ordering::Acquire).into();
    let trackers = app.get_webview_window(TRACKERS_LABEL);
    status["trackers_visible"] = trackers
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false))
        .into();
    // Physical bounds, for diagnostics of the game-covering surface.
    status["trackers_bounds"] = trackers
        .and_then(|w| Some((w.outer_position().ok()?, w.outer_size().ok()?)))
        .map_or(
            Value::Null,
            |(p, s)| json!({"x":p.x,"y":p.y,"width":s.width,"height":s.height}),
        );
    status
}

#[tauri::command]
pub fn trackers_ready(app: AppHandle) {
    app.state::<OverlayState>()
        .trackers_ready
        .store(true, Ordering::Release);
}

/// Covers the game window (or the primary monitor) so bar x/y are game-relative pixels.
fn fit_trackers(window: &tauri::WebviewWindow) -> Result<(), String> {
    let (left, top, right, bottom) = match game_rect() {
        Some(rect) => rect,
        None => {
            let monitor = window
                .primary_monitor()
                .map_err(|e| e.to_string())?
                .ok_or("No monitor available for trackers")?;
            let (p, s) = (monitor.position(), monitor.size());
            (p.x, p.y, p.x + s.width as i32, p.y + s.height as i32)
        }
    };
    window
        .set_position(PhysicalPosition::new(left, top))
        .map_err(|e| e.to_string())?;
    window
        .set_size(PhysicalSize::new(
            (right - left).max(1) as u32,
            (bottom - top).max(1) as u32,
        ))
        .map_err(|e| e.to_string())
}

/// Creates the hidden, click-through tracker surface if needed.
fn trackers_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(TRACKERS_LABEL) {
        return Ok(window);
    }
    let window = WebviewWindowBuilder::new(
        app,
        TRACKERS_LABEL,
        WebviewUrl::App("index.html?view=trackers".into()),
    )
    .title(crate::ui_preferences::title(app, "titleTrackers"))
    .inner_size(800.0, 600.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    guard_activation(app, &window);
    fit_trackers(&window)?;
    window
        .set_ignore_cursor_events(true)
        .map_err(|e| e.to_string())?;
    Ok(window)
}

#[tauri::command]
pub async fn trackers_show(app: AppHandle) -> Result<Value, String> {
    show_trackers(&app)?;
    Ok(overlay_status(app))
}

/// Requests the tracker surface with its saved arrange choice. Arranging is the surface's
/// unlocked state, so like every overlay it arranges until the user presses Done once;
/// that choice is saved. If arranging cannot start, the surface stays click-through.
fn show_trackers(app: &AppHandle) -> Result<(), String> {
    let window = trackers_window(app)?;
    fit_trackers(&window)?;
    let state = app.state::<OverlayState>();
    state.trackers_requested.store(true, Ordering::Release);
    if !crate::overlay_locks::saved(app, TRACKERS_LABEL)
        && !state.trackers_editing.load(Ordering::Acquire)
    {
        if let Err(error) = set_trackers_editing(app, true) {
            record_error(app, format!("Could not start arranging trackers: {error}"));
            set_trackers_editing(app, false)?;
        }
    }
    schedule_visibility(app)
}

/// Hiding ends arranging for now (a hidden surface never takes input) but keeps the saved
/// choice, so the next show arranges again until Done.
#[tauri::command]
pub fn trackers_hide(app: AppHandle) -> Result<Value, String> {
    let state = app.state::<OverlayState>();
    state.trackers_requested.store(false, Ordering::Release);
    if state.trackers_editing.load(Ordering::Acquire) {
        set_trackers_editing(&app, false)?;
    }
    schedule_visibility(&app)?;
    Ok(overlay_status(app.clone()))
}

fn set_trackers_editing(app: &AppHandle, editing: bool) -> Result<(), String> {
    let window = trackers_window(app)?;
    if editing {
        let result = (|| {
            fit_trackers(&window)?;
            // Arranging takes clicks but, like every overlay, never focus from the game.
            window
                .set_ignore_cursor_events(false)
                .map_err(|e| e.to_string())
        })();
        // A half-applied arrange would block the game without showing Done: undo it.
        if let Err(error) = result {
            let _ = window.set_ignore_cursor_events(true);
            return Err(error);
        }
    } else {
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    app.state::<OverlayState>()
        .trackers_editing
        .store(editing, Ordering::Release);
    Ok(())
}

/// Arrange mode: the surface takes input until Done, then returns to click-through. It
/// appears once AION is focused; clicks on it count as overlay focus, so it stays up.
/// The user's choice is saved as the surface's lock: Done locks, Arrange unlocks.
#[tauri::command]
pub async fn trackers_arrange(app: AppHandle, editing: bool) -> Result<Value, String> {
    set_trackers_editing(&app, editing)?;
    if let Err(error) = crate::overlay_locks::save(&app, TRACKERS_LABEL, !editing) {
        record_error(
            &app,
            format!("Could not save the trackers arrange choice: {error}"),
        );
    }
    schedule_visibility(&app)?;
    Ok(overlay_status(app))
}
#[tauri::command]
pub fn overlay_ready(app: AppHandle) {
    app.state::<OverlayState>()
        .ready
        .store(true, Ordering::Release);
}

#[tauri::command]
pub fn menu_ready(app: AppHandle) {
    app.state::<OverlayState>()
        .menu_ready
        .store(true, Ordering::Release);
}

#[tauri::command]
pub fn group_ready(app: AppHandle) {
    app.state::<OverlayState>()
        .group_ready
        .store(true, Ordering::Release);
}
#[tauri::command]
pub async fn group_show(app: AppHandle) -> Result<Value, String> {
    manual_group(&app, true)?;
    sync_group(&app)?;
    Ok(overlay_status(app))
}
/// Creates the hidden Group window (and top menu) if needed without requesting it visible.
fn group_window(app: &AppHandle) -> Result<(), String> {
    show_menu(app.clone())?;
    if app.get_webview_window(GROUP_LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        GROUP_LABEL,
        WebviewUrl::App("index.html?view=group".into()),
    )
    .title(crate::ui_preferences::title(app, "titleGroup"))
    // The panel fits the window to its roster (`group_window::group_fit`) once mounted.
    .inner_size(320.0, 360.0)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    guard_activation(app, &window);
    let default = match game_rect() {
        Some((left, top, right, bottom)) => {
            let scale = window
                .monitor_from_point(
                    (f64::from(left) + f64::from(right)) / 2.0,
                    (f64::from(top) + f64::from(bottom)) / 2.0,
                )
                .map_err(|e| e.to_string())?
                .map(|m| m.scale_factor())
                .unwrap_or(1.0);
            Some((left + (24.0 * scale) as i32, top + (96.0 * scale) as i32))
        }
        None => None,
    };
    place_saved(app, &window, default)
}
#[tauri::command]
pub fn group_hide(app: AppHandle) -> Result<(), String> {
    let state = app.state::<OverlayState>();
    let mut auto = state
        .group_auto
        .lock()
        .map_err(|_| "Group automation unavailable")?;
    auto.manual(false);
    request_visibility(&app, GROUP_LABEL, false)
}

#[tauri::command]
pub async fn menu_show(app: AppHandle) -> Result<Value, String> {
    show_menu(app.clone())?;
    Ok(overlay_status(app))
}

fn show_menu(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(MENU_LABEL) {
        let _ = window;
        return request_visibility(&app, MENU_LABEL, true);
    }
    let window = WebviewWindowBuilder::new(
        &app,
        MENU_LABEL,
        WebviewUrl::App("index.html?view=menu".into()),
    )
    .title(crate::ui_preferences::title(&app, "titleMenu"))
    .inner_size(MENU_WIDTH, MENU_HEIGHT)
    .resizable(false)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    guard_activation(&app, &window);
    // Top centre of the game (or the primary monitor) unless the user moved it before.
    let default = if let Some((left, top, right, bottom)) = game_rect() {
        let scale = window
            .monitor_from_point(
                (f64::from(left) + f64::from(right)) / 2.0,
                (f64::from(top) + f64::from(bottom)) / 2.0,
            )
            .map_err(|e| e.to_string())?
            .map(|monitor| monitor.scale_factor())
            .unwrap_or(window.scale_factor().map_err(|e| e.to_string())?);
        let x =
            ((f64::from(left) + f64::from(right) - MENU_WIDTH * scale) / 2.0).max(f64::from(left));
        Some((x as i32, top + (12.0 * scale) as i32))
    } else if let Some(monitor) = window.primary_monitor().map_err(|e| e.to_string())? {
        let scale = monitor.scale_factor();
        let x = monitor.position().x
            + ((f64::from(monitor.size().width) - MENU_WIDTH * scale) / 2.0).max(0.0) as i32;
        Some((x, monitor.position().y + (12.0 * scale) as i32))
    } else {
        None
    };
    place_saved(&app, &window, default)?;
    request_visibility(&app, MENU_LABEL, true)
}

/// The user's lock or unlock (menu, meter button or hotkey); the choice is saved.
#[tauri::command]
pub fn overlay_lock(app: AppHandle, locked: bool) -> Result<Value, String> {
    set_lock(&app, locked, true)?;
    Ok(overlay_status(app))
}

/// Applies a lock state to the open meter. `remember` saves it as the user's choice; a
/// safety unlock (no hotkey, failed quit) leaves the saved choice for the next start.
fn set_lock(app: &AppHandle, locked: bool, remember: bool) -> Result<(), String> {
    let state = app.state::<OverlayState>();
    if locked && !state.lock_hotkey.load(Ordering::Acquire) {
        return Err("The unlock hotkey is unavailable. Overlay remains interactive.".into());
    }
    let window = app.get_webview_window(LABEL).ok_or("Overlay is not open")?;
    // Locked or not, the meter never takes focus from the game (`no_activate`).
    if locked {
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    } else {
        // Row hit-testing only adjusts a locked meter; stop it before restoring input.
        state.locked.store(false, Ordering::Release);
        window
            .set_ignore_cursor_events(false)
            .map_err(|e| e.to_string())?;
    }
    state.locked.store(locked, Ordering::Release);
    // The meter already follows the choice; a failed save only loses it at restart.
    if remember {
        if let Err(error) = crate::overlay_locks::save(app, LABEL, locked) {
            record_error(
                app,
                format!("Could not save the DPS overlay lock choice: {error}"),
            );
        }
    }
    // Tao never sees the raw no-activate show, so its flag update re-hides the overlay.
    schedule_visibility(app)
}

#[tauri::command]
pub async fn overlay_show(app: AppHandle) -> Result<Value, String> {
    show_overlay(app)
}
fn show_overlay(app: AppHandle) -> Result<Value, String> {
    show_menu(app.clone())?;
    if let Some(window) = app.get_webview_window(LABEL) {
        let _ = window;
        request_visibility(&app, LABEL, true)?;
        return Ok(overlay_status(app));
    }
    let window = WebviewWindowBuilder::new(
        &app,
        LABEL,
        WebviewUrl::App("index.html?view=overlay".into()),
    )
    .title(crate::ui_preferences::title(&app, "titleOverlay"))
    .inner_size(360.0, 300.0)
    .min_inner_size(300.0, 220.0)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    guard_activation(&app, &window);
    let rect = game_rect();
    let monitors = window.available_monitors().map_err(|e| e.to_string())?;
    let monitor = rect
        .and_then(|(left, top, right, bottom)| {
            monitors
                .iter()
                .find(|m| {
                    let center = (
                        (i64::from(left) + i64::from(right)) / 2,
                        (i64::from(top) + i64::from(bottom)) / 2,
                    );
                    center.0 >= i64::from(m.position().x)
                        && center.0 < i64::from(m.position().x) + i64::from(m.size().width)
                        && center.1 >= i64::from(m.position().y)
                        && center.1 < i64::from(m.position().y) + i64::from(m.size().height)
                })
                .cloned()
        })
        .or(window.primary_monitor().map_err(|e| e.to_string())?);
    // Right side of the game unless the user moved the meter before.
    let default = if let Some(monitor) = monitor {
        let scale = monitor.scale_factor();
        let (left, top, right, bottom) = rect.unwrap_or((
            monitor.position().x,
            monitor.position().y,
            monitor.position().x + monitor.size().width as i32,
            monitor.position().y + monitor.size().height as i32,
        ));
        let x = (f64::from(right) - 384.0 * scale).max(f64::from(left));
        let y = (f64::from(top) + 180.0 * scale)
            .min((f64::from(bottom) - 320.0 * scale).max(f64::from(top)));
        Some((x as i32, y as i32))
    } else {
        None
    };
    place_saved(&app, &window, default)?;
    // A new meter is unlocked unless the user locked it before. A saved lock is restored
    // only while the unlock hotkey works; otherwise the meter stays interactive this time.
    // Later shows reuse the window and keep the current lock.
    let saved = crate::overlay_locks::saved(&app, LABEL);
    let lock = saved
        && app
            .state::<OverlayState>()
            .lock_hotkey
            .load(Ordering::Acquire);
    if saved && !lock {
        record_error(
            &app,
            "The DPS overlay stays unlocked: the unlock hotkey is unavailable.".into(),
        );
    }
    if let Err(error) = set_lock(&app, lock, false) {
        if !lock {
            return Err(error);
        }
        record_error(&app, format!("Could not lock the DPS overlay: {error}"));
        set_lock(&app, false, false)?;
    }
    request_visibility(&app, LABEL, true)?;
    Ok(overlay_status(app))
}
#[tauri::command]
pub fn details_ready(app: AppHandle) {
    app.state::<OverlayState>()
        .details_ready
        .store(true, Ordering::Release);
}

fn valid_selection(report_id: Option<&str>, player: &str) -> bool {
    let token = |text: &str, max: usize| {
        !text.is_empty()
            && text.len() <= max
            && text
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    };
    token(player, 32) && report_id.is_none_or(|id| token(id, 128))
}

/// Opens (or retargets) the damage-details panel on one player of one fight. The fight
/// id is kept as given: the panel never moves to another fight on its own.
#[tauri::command]
pub async fn details_open(
    app: AppHandle,
    report_id: Option<String>,
    player: String,
) -> Result<Value, String> {
    if !valid_selection(report_id.as_deref(), &player) {
        return Err("Invalid damage-details selection".into());
    }
    details_window(&app)?;
    {
        let state = app.state::<OverlayState>();
        let mut details = state
            .details
            .lock()
            .map_err(|_| "Damage details unavailable")?;
        let revision = details["revision"].as_u64().unwrap_or(0) + 1;
        *details = json!({"revision":revision,"report_id":report_id,"player":player});
    }
    request_visibility(&app, DETAILS_LABEL, true)?;
    Ok(overlay_status(app))
}

#[tauri::command]
pub fn details_hide(app: AppHandle) -> Result<(), String> {
    request_visibility(&app, DETAILS_LABEL, false)
}

/// Control and row rectangles of the locked meter, `[x, y, width, height]` in physical client
/// pixels measured at device pixel ratio `scale`. An empty list clears them.
#[tauri::command]
pub fn overlay_hit_regions(
    app: AppHandle,
    regions: Vec<[f64; 4]>,
    scale: f64,
) -> Result<usize, String> {
    app.state::<OverlayState>()
        .hit
        .lock()
        .map_err(|_| "Overlay regions unavailable")?
        .set(&regions, scale, std::time::Instant::now())
}

/// Creates the hidden, resizable damage-details window beside the DPS meter if needed.
fn details_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(DETAILS_LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        DETAILS_LABEL,
        WebviewUrl::App("index.html?view=details".into()),
    )
    .title(crate::ui_preferences::title(app, "titleDetails"))
    .inner_size(600.0, 640.0)
    .min_inner_size(420.0, 320.0)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    .focusable(false)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    guard_activation(app, &window);
    let size = window.outer_size().map_err(|e| e.to_string())?;
    let meter = app
        .get_webview_window(LABEL)
        .and_then(|m| Some((m.outer_position().ok()?, m.scale_factor().ok()?)));
    let bounds = game_rect().or_else(|| {
        let monitor = window.primary_monitor().ok()??;
        let (p, s) = (monitor.position(), monitor.size());
        Some((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32))
    });
    let default = match (meter, bounds) {
        // Left of the meter, top-aligned, kept inside the game (or monitor) bounds.
        (Some((at, scale)), Some((left, top, right, bottom))) => {
            let gap = (12.0 * scale) as i32;
            let x = (at.x - size.width as i32 - gap)
                .min(right - size.width as i32)
                .max(left);
            let y = at.y.min(bottom - size.height as i32).max(top);
            Some((x, y))
        }
        _ => None,
    };
    // Where the user last dropped it wins over the spot beside the meter.
    place_saved(app, &window, default)
}

/// Keeps an in-game window from ever taking focus from the game; see `no_activate`.
pub(crate) fn guard_activation(app: &AppHandle, window: &tauri::WebviewWindow) {
    if let Err(error) = crate::no_activate::guard(window) {
        record_error(app, error);
    }
}

/// Puts a new overlay where the user last dropped it (kept on connected displays) or, the first
/// time, at `default` (centred without one), and saves the user's later drops.
fn place_saved(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    default: Option<(i32, i32)>,
) -> Result<(), String> {
    use crate::window_positions as positions;
    let saved = positions::saved(app, window.label());
    positions::place(window, saved, positions::size_of(window), default)?;
    if let Err(error) = positions::watch(window, positions::save_drop) {
        record_error(app, error);
    }
    Ok(())
}

/// Lets a locked meter take input only while the cursor is over a reported meter control.
/// The rest of the meter keeps `WS_EX_TRANSPARENT`, so clicks there reach the game
/// (`HTTRANSPARENT` would only forward them to windows of this thread). The style is
/// set directly: tao's flag update would re-hide the no-activate overlay, and tao's
/// own state stays "locked", which this restores whenever the cursor leaves a row.
#[cfg(all(windows, target_pointer_width = "64"))]
fn sync_row_input(app: &AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    let state = app.state::<OverlayState>();
    if !state.locked.load(Ordering::Acquire) {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let over_row = (|| {
        if !window.is_visible().ok()? {
            return None;
        }
        let cursor = app.cursor_position().ok()?;
        let origin = window.inner_position().ok()?;
        let client = window.inner_size().ok()?;
        let scale = window.scale_factor().ok()?;
        let regions = state.hit.lock().ok()?;
        Some(regions.contains(
            (
                cursor.x - f64::from(origin.x),
                cursor.y - f64::from(origin.y),
            ),
            (f64::from(client.width), f64::from(client.height)),
            scale,
            std::time::Instant::now(),
        ))
    })()
    .unwrap_or(false);
    // Toggles between exactly the unlocked and locked styles tao applies. WS_EX_NOACTIVATE
    // stays, so clicking a row never takes focus from the game.
    let passthrough = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
    unsafe {
        let style = GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE);
        let next = if over_row {
            style & !passthrough
        } else {
            style | passthrough
        };
        if next != style {
            SetWindowLongPtrW(hwnd.0, GWL_EXSTYLE, next);
        }
    }
}
#[cfg(not(all(windows, target_pointer_width = "64")))]
fn sync_row_input(_: &AppHandle) {}

#[tauri::command]
pub fn overlay_hide(app: AppHandle) -> Result<(), String> {
    request_visibility(&app, LABEL, false)
}
#[tauri::command]
pub fn overlay_workspace(app: AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or("Workspace is closed")?;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}
#[tauri::command]
pub async fn overlay_quit(app: AppHandle) -> Result<(), String> {
    crate::background::run(move || quit_and_save(app, "Quit was chosen in the app or tray")).await
}

/// Shared shutdown transaction for explicit Quit, tray and update handoff.
/// Call only on a blocking worker: capture joins and persistence can take time.
pub(crate) fn quit_and_save(app: AppHandle, reason: &str) -> Result<(), String> {
    let state = app.state::<OverlayState>();
    if state.quitting.swap(true, Ordering::AcqRel) {
        return Ok(());
    }
    let result = (|| {
        let status = app.state::<LiveCapture>().stop()?;
        if status["events"].as_u64().unwrap_or(0) > 0
            || status["history"].as_array().is_some_and(|h| !h.is_empty())
        {
            let path = crate::capture_commands::save_comparison(&app)?;
            *state
                .saved
                .lock()
                .map_err(|_| "Overlay state unavailable")? = path;
        }
        Ok::<(), String>(())
    })();
    if let Err(error) = result {
        state.quitting.store(false, Ordering::Release);
        // A failed save cancels quitting; the remaining app must keep collecting.
        if let Err(restart_error) = app.state::<LiveCapture>().start_automatic() {
            record_error(
                &app,
                format!("Could not resume live capture: {restart_error}"),
            );
        }
        let error = format!("Could not save before quitting: {error}");
        record_error(&app, error.clone());
        let _ = set_lock(&app, false, false);
        let _ = overlay_workspace(app.clone());
        return Err(error);
    }
    // A drop just before quitting may still be on its way to disk.
    crate::window_positions::flush(&app);
    crate::crash::note_quit(reason);
    app.exit(0);
    Ok(())
}

pub fn window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    // A restored workspace should draw immediately rather than wait for the focus worker.
    if matches!(event, tauri::WindowEvent::Resized(_)) {
        if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
            crate::webview_visibility::sync_window(&webview);
        }
    }
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        // Closing the inspector (its button, Escape or Alt+F4) only hides it.
        if window.label() == DETAILS_LABEL {
            let _ = details_hide(window.app_handle().clone());
            return;
        }
        if window.label() == GROUP_LABEL {
            let _ = group_hide(window.app_handle().clone());
            return;
        }
        if window.label() == TRACKERS_LABEL {
            let _ = trackers_hide(window.app_handle().clone());
            return;
        }
        if window.label() == crate::alert_window::LABEL {
            crate::alert_window::close_requested(window.app_handle());
            return;
        }
        if window.label() == crate::pet_window::LABEL {
            crate::pet_window::close_requested(window.app_handle());
            return;
        }
        if crate::activity_window::close_requested(window.app_handle(), window.label()) {
            return;
        }
        // X / Alt+F4 dismisses a window; only explicit Quit stops capture and exits.
        // Overlay intent must also change so the focus worker does not reopen it.
        let result = if OVERLAYS.contains(&window.label()) {
            request_visibility(window.app_handle(), window.label(), false)
        } else {
            window.hide().map_err(|error| error.to_string())
        };
        if let Err(error) = result {
            record_error(window.app_handle(), error);
        }
        if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
            crate::webview_visibility::sync_window(&webview);
        }
    }
}

/// Tray rows whose check mark shows the intent the row toggles.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayToggle {
    Menu,
    Overlay,
    Group,
    Trackers,
}

/// Tray rows in menu order: id, label key and the intent its check mark shows.
/// A separator precedes Quit.
const TRAY_ROWS: [(&str, &str, Option<TrayToggle>); 7] = [
    ("show-menu", "trayShowMenu", Some(TrayToggle::Menu)),
    ("show-overlay", "trayShowOverlay", Some(TrayToggle::Overlay)),
    ("hide-overlay", "trayHideOverlay", None),
    ("show-group", "trayToggleGroup", Some(TrayToggle::Group)),
    (
        "show-trackers",
        "trayShowTrackers",
        Some(TrayToggle::Trackers),
    ),
    ("workspace", "trayWorkspace", None),
    ("quit", "trayQuit", None),
];

/// Requests and the Group feature intent, never focus-gated visibility: the tray
/// opens while another app is focused and every overlay is hidden.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TrayIntent {
    menu: bool,
    overlay: bool,
    group: bool,
    trackers: bool,
}
impl TrayIntent {
    fn read(state: &OverlayState, group: bool) -> Self {
        let requested = state
            .visibility
            .lock()
            .map(|v| v.requested)
            .unwrap_or_default();
        Self {
            menu: requested[1],
            overlay: requested[0],
            group,
            trackers: state.trackers_requested.load(Ordering::Acquire),
        }
    }
    fn checked(self, toggle: TrayToggle) -> bool {
        match toggle {
            TrayToggle::Menu => self.menu,
            TrayToggle::Overlay => self.overlay,
            TrayToggle::Group => self.group,
            TrayToggle::Trackers => self.trackers,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TrayAction {
    Show(TrayToggle),
    Hide(TrayToggle),
    Workspace,
    Quit,
}

/// A checked row withdraws its intent and an unchecked row requests it.
fn tray_action(id: &str, intent: TrayIntent) -> Option<TrayAction> {
    Some(match id {
        "hide-overlay" => TrayAction::Hide(TrayToggle::Overlay),
        "workspace" => TrayAction::Workspace,
        "quit" => TrayAction::Quit,
        _ => {
            let (_, _, toggle) = TRAY_ROWS.iter().find(|(row, ..)| *row == id)?;
            let toggle = (*toggle)?;
            if intent.checked(toggle) {
                TrayAction::Hide(toggle)
            } else {
                TrayAction::Show(toggle)
            }
        }
    })
}

/// Check marks follow the authoritative intents whichever path changed them: tray,
/// hotkeys, window close, the in-app menu or Group automation. Main thread only. The
/// native menu flips a mark on click before its action runs; this also restores a
/// mark whose action failed.
fn sync_tray(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    // Closing Group holds this lock while it requests visibility on this thread.
    // Its mark catches up on the next pass.
    let group = state.group_auto.try_lock().ok().map(|auto| auto.enabled());
    let intent = TrayIntent::read(&state, group.unwrap_or(false));
    let rows = state
        .tray
        .lock()
        .map(|rows| rows.clone())
        .unwrap_or_default();
    for (toggle, item) in rows {
        if toggle == TrayToggle::Group && group.is_none() {
            continue;
        }
        let checked = intent.checked(toggle);
        if item.is_checked().ok() != Some(checked) {
            if let Err(error) = item.set_checked(checked) {
                record_error(app, error.to_string());
            }
        }
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let state = app.state::<OverlayState>();
    let group = state
        .group_auto
        .lock()
        .map(|auto| auto.enabled())
        .unwrap_or(false);
    let intent = TrayIntent::read(&state, group);
    let mut rows = Vec::new();
    let mut checks = Vec::new();
    for (id, key, toggle) in TRAY_ROWS {
        let text = crate::ui_preferences::text(app, key);
        let item = match toggle {
            Some(toggle) => {
                let item = CheckMenuItem::with_id(
                    app,
                    id,
                    text,
                    true,
                    intent.checked(toggle),
                    None::<&str>,
                )?;
                checks.push((toggle, item.clone()));
                MenuItemKind::Check(item)
            }
            None => MenuItemKind::MenuItem(MenuItem::with_id(app, id, text, true, None::<&str>)?),
        };
        rows.push((key, item));
    }
    let separator = PredefinedMenuItem::separator(app)?;
    let mut items: Vec<&dyn IsMenuItem<tauri::Wry>> = rows
        .iter()
        .map(|(_, item)| item as &dyn IsMenuItem<tauri::Wry>)
        .collect();
    items.insert(items.len() - 1, &separator);
    let menu = Menu::with_items(app, &items)?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(tauri::include_image!("./icons/tray.png"))
        .tooltip(crate::ui_preferences::title(app, "trayTooltip"))
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let app = app.clone();
            // Window creation must run outside the native menu callback on Windows.
            tauri::async_runtime::spawn(async move {
                let intent = {
                    let state = app.state::<OverlayState>();
                    let group = state
                        .group_auto
                        .lock()
                        .map(|auto| auto.enabled())
                        .unwrap_or(false);
                    TrayIntent::read(&state, group)
                };
                let result = match tray_action(event.id.as_ref(), intent) {
                    Some(TrayAction::Show(TrayToggle::Menu)) => {
                        menu_show(app.clone()).await.map(|_| ())
                    }
                    Some(TrayAction::Hide(TrayToggle::Menu)) => {
                        request_visibility(&app, MENU_LABEL, false)
                    }
                    Some(TrayAction::Show(TrayToggle::Overlay)) => {
                        overlay_show(app.clone()).await.map(|_| ())
                    }
                    Some(TrayAction::Hide(TrayToggle::Overlay)) => overlay_hide(app.clone()),
                    Some(TrayAction::Show(TrayToggle::Group)) => {
                        group_show(app.clone()).await.map(|_| ())
                    }
                    Some(TrayAction::Hide(TrayToggle::Group)) => group_hide(app.clone()),
                    Some(TrayAction::Show(TrayToggle::Trackers)) => {
                        trackers_show(app.clone()).await.map(|_| ())
                    }
                    Some(TrayAction::Hide(TrayToggle::Trackers)) => {
                        trackers_hide(app.clone()).map(|_| ())
                    }
                    Some(TrayAction::Workspace) => overlay_workspace(app.clone()),
                    Some(TrayAction::Quit) => overlay_quit(app.clone()).await,
                    None => Ok(()),
                };
                if let Err(error) = result {
                    record_error(&app, error);
                    // Restore the mark the native menu flipped for the failed action.
                    if let Err(error) = schedule_visibility(&app) {
                        record_error(&app, error);
                    }
                }
            });
        });
    tray.build(app)?;
    if let Ok(mut current) = state.tray.lock() {
        *current = checks;
    }
    crate::ui_preferences::register_menu(app, rows);
    Ok(())
}

pub fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    setup_tray(app)?;
    let edit = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F8);
    let show = Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::F9);
    app.plugin(
        tauri_plugin_global_shortcut::Builder::new()
            .with_handler(move |app, shortcut, event| {
                if event.state() != ShortcutState::Pressed {
                    return;
                }
                let action=app.state::<OverlayState>().shortcuts.lock().ok().and_then(|items|items.iter().find(|(key,_)|key==shortcut).map(|(_,action)|action.clone()));
                if let Some(action)=action {
                    // In-game actions only act while AION (or our overlay over it) is focused;
                    // visibility and lock stay global so the user can always recover.
                    let game_action=matches!(action.as_str(),"reset"|"copy_summary"|"compact_strip")||action.starts_with("preset:");
                    if game_action&&!app.state::<OverlayState>().visibility.lock().map(|v|v.active).unwrap_or(false){return;}
                    if game_action {
                        let app = app.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            let result = match action.as_str() {
                                "reset" => app.state::<LiveCapture>().reset().map(|_| ()),
                                "copy_summary" => app.state::<LiveCapture>().offline_summary(None, true)
                                    .and_then(|summary| crate::offline::clipboard(&app, &summary)),
                                "compact_strip" => app.state::<LiveCapture>().offline_toggle_compact(),
                                action if action.starts_with("preset:") => app.state::<LiveCapture>()
                                    .offline_configure(json!({"active_preset":action.trim_start_matches("preset:")})).map(|_| ()),
                                _ => Ok(()),
                            };
                            if let Err(error) = result { record_error(&app, error); }
                        });
                        return;
                    }
                    let result=match action.as_str(){
                        "toggle_lock"=>overlay_lock(app.clone(),!app.state::<OverlayState>().locked.load(Ordering::Acquire)).map(|_|()),
                        "toggle_overlay"=>{let requested=app.state::<OverlayState>().visibility.lock().map(|v|v.requested[0]).unwrap_or(false);if requested{overlay_hide(app.clone())}else{let handle=app.clone();tauri::async_runtime::spawn(async move{if let Err(e)=overlay_show(handle.clone()).await{record_error(&handle,e);}});Ok(())}},
                        _=>Ok(())
                    };if let Err(e)=result{record_error(app,e);}return;
                }
                let result = if shortcut == &edit {
                    let locked = app.state::<OverlayState>().locked.load(Ordering::Acquire);
                    overlay_lock(app.clone(), !locked).map(|_| ())
                } else if shortcut == &show {
                    let requested = app
                        .state::<OverlayState>()
                        .visibility
                        .lock()
                        .map(|v| v.requested[0])
                        .unwrap_or(false);
                    if requested {
                        overlay_hide(app.clone())
                    } else {
                        let handle = app.clone();
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = overlay_show(handle.clone()).await {
                                record_error(&handle, error);
                            }
                        });
                        Ok(())
                    }
                } else {
                    Ok(())
                };
                if let Err(error) = result {
                    record_error(app, error);
                }
            })
            .build(),
    )?;
    for (shortcut, name) in [(edit, "Ctrl+Shift+F8"), (show, "Ctrl+Shift+F9")] {
        match app.global_shortcut().register(shortcut) {
            Ok(()) => {
                let action = if shortcut == edit {
                    "toggle_lock"
                } else {
                    "toggle_overlay"
                };
                if let Ok(mut shortcuts) = app.state::<OverlayState>().shortcuts.lock() {
                    shortcuts.push((shortcut, action.into()));
                }
                if shortcut == edit {
                    app.state::<OverlayState>()
                        .lock_hotkey
                        .store(true, Ordering::Release);
                }
            }
            Err(error) => record_error(app, format!("{name} could not register: {error}")),
        }
    }
    let args: Vec<_> = std::env::args_os().collect();
    if let Ok(settings) = app.state::<LiveCapture>().offline_settings() {
        if let Err(error) = configure_hotkeys(app, &settings) {
            record_error(app, error);
        }
    }
    show_menu(app.clone()).map_err(std::io::Error::other)?;
    if args.iter().any(|a| a == "--overlay" || a == "--group") {
        if args.iter().any(|a| a == "--overlay") {
            show_overlay(app.clone()).map_err(std::io::Error::other)?;
        }
    } else if let Some(main) = app.get_webview_window("main") {
        main.show()?;
        main.set_focus()?;
    }
    if args.iter().any(|a| a == "--trackers") {
        // Smoke tests: request the surface with its saved arrange choice, like the UI does;
        // it still only shows over a focused game.
        show_trackers(app).map_err(std::io::Error::other)?;
    }
    // Opt into room-only display; this never forces an empty panel open.
    if args.iter().any(|a| a == "--group") {
        manual_group(app, true).map_err(std::io::Error::other)?;
    }
    start_focus_tracking(app);
    if let Some(index) = args.iter().position(|a| a == "--diagnostics-file") {
        if let Some(path) = args.get(index + 1) {
            let path = std::path::PathBuf::from(path);
            let app = app.clone();
            std::thread::spawn(move || loop {
                if path.with_extension("stop").exists() {
                    let _ = app.state::<LiveCapture>().finish_identity_diagnostic();
                    break;
                }
                let mut live = app
                    .state::<LiveCapture>()
                    .snapshot()
                    .unwrap_or_else(|error| json!({"error":error}));
                if let Some(object) = live.as_object_mut() {
                    if let Some(players) = object
                        .remove("players")
                        .and_then(|value| value.as_array().cloned())
                    {
                        object.insert("identity_players".into(), json!(players.iter().take(64).map(|p|
                            json!({"entity":p["entity"],"label":p["label"],"name":p["name"],"class":p["class"],"name_known":p["name_known"],"is_local":p["is_local"]})).collect::<Vec<_>>()));
                    }
                }
                let group=app.state::<LiveCapture>().group_snapshot().ok().map(|g|json!({"members":g["members"].as_array().map(Vec::len),"inspections":g["inspections"].as_array().map(Vec::len),"roster_age_ms":g["roster_age_ms"],"lobby_name":g["lobby_name"],"capacity":g["capacity"],"roster":g["members"],"unparsed_roster":app.state::<LiveCapture>().group_protocol_diagnostic().ok().flatten(),"protocol_diagnostic":app.state::<LiveCapture>().group_debug_snapshot().ok()}));
                let offline=app.state::<LiveCapture>().offline_status().ok().map(|o|json!({"library_count":o["library_count"],"event_count":o["report"]["events"].as_array().map(Vec::len),"coverage":o["report"]["coverage"],"duration_ms":o["report"]["duration_ms"],"end_reason":o["report"]["end_reason"],"catalogue":o["catalogue"],"capabilities":o["capabilities"],"error":o["error"]}));
                let status = json!({"pid":std::process::id(),"overlay":overlay_status(app.clone()),"live":live,"group":group,"offline":offline,"identity":app.state::<LiveCapture>().identity_diagnostic().ok()});
                if let Ok(bytes) = serde_json::to_vec(&status) {
                    let temp = path.with_extension("tmp");
                    if std::fs::write(&temp, bytes).is_ok() {
                        let _ = std::fs::rename(temp, &path);
                    }
                }
                std::thread::sleep(std::time::Duration::from_secs(1));
            });
        }
    }
    Ok(())
}

#[cfg(windows)]
pub(crate) fn game_rect() -> Option<(i32, i32, i32, i32)> {
    use windows_sys::Win32::{
        Foundation::{CloseHandle, HWND, INVALID_HANDLE_VALUE, LPARAM, RECT},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsWindowVisible,
        },
    };
    struct Search {
        ids: Vec<u32>,
        rect: Option<RECT>,
        area: i64,
    }
    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> i32 {
        let search = unsafe { &mut *(data as *mut Search) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(hwnd, &mut pid);
        }
        if search.ids.contains(&pid) && unsafe { IsWindowVisible(hwnd) } != 0 {
            let mut rect = RECT::default();
            if unsafe { GetWindowRect(hwnd, &mut rect) } != 0 {
                let area = i64::from(rect.right - rect.left) * i64::from(rect.bottom - rect.top);
                if rect.right - rect.left >= 640
                    && rect.bottom - rect.top >= 400
                    && area > search.area
                {
                    search.rect = Some(rect);
                    search.area = area;
                }
            }
        }
        1
    }
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let mut row = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut search = Search {
        ids: Vec::new(),
        rect: None,
        area: 0,
    };
    unsafe {
        let mut exists = Process32FirstW(snapshot, &mut row);
        while exists != 0 {
            let end = row
                .szExeFile
                .iter()
                .position(|&b| b == 0)
                .unwrap_or(row.szExeFile.len());
            if String::from_utf16_lossy(&row.szExeFile[..end]).eq_ignore_ascii_case("AION2.exe") {
                search.ids.push(row.th32ProcessID);
            }
            exists = Process32NextW(snapshot, &mut row);
        }
        CloseHandle(snapshot);
        EnumWindows(Some(visit), &mut search as *mut Search as LPARAM);
    }
    search.rect.map(|r| (r.left, r.top, r.right, r.bottom))
}
#[cfg(not(windows))]
pub(crate) fn game_rect() -> Option<(i32, i32, i32, i32)> {
    None
}

#[cfg(test)]
mod tests {
    use super::TrayToggle::{Group, Menu, Overlay, Trackers};
    use super::{tray_action, valid_selection, OverlayState, TrayAction, TrayIntent, TRAY_ROWS};
    use std::sync::atomic::Ordering;

    const SWITCHES: [(&str, super::TrayToggle); 4] = [
        ("show-menu", Menu),
        ("show-overlay", Overlay),
        ("show-group", Group),
        ("show-trackers", Trackers),
    ];

    fn checked(intent: TrayIntent, id: &str) -> Option<bool> {
        let (_, _, toggle) = TRAY_ROWS.iter().find(|(row, ..)| *row == id)?;
        toggle.map(|toggle| intent.checked(toggle))
    }

    #[test]
    fn tray_check_marks_show_requests_while_the_game_is_unfocused() {
        let state = OverlayState::default();
        {
            let mut visibility = state.visibility.lock().unwrap();
            // DPS meter and top menu requested; the tray opens with another app focused.
            visibility.requested = [true, true, false, false];
            assert!(!visibility.visible(0) && !visibility.visible(1));
        }
        state.trackers_requested.store(true, Ordering::Release);
        let on = TrayIntent::read(&state, true);
        for (id, _) in SWITCHES {
            assert_eq!(checked(on, id), Some(true), "{id} is not checked");
        }
        let off = TrayIntent::read(&OverlayState::default(), false);
        for (id, _) in SWITCHES {
            assert_eq!(checked(off, id), Some(false), "{id} is checked");
        }
        for id in ["hide-overlay", "workspace", "quit"] {
            assert_eq!(checked(on, id), None, "{id} is an action, not a switch");
        }
    }

    #[test]
    fn tray_switches_toggle_the_intent_their_check_mark_shows() {
        let on = TrayIntent {
            menu: true,
            overlay: true,
            group: true,
            trackers: true,
        };
        for (id, toggle) in SWITCHES {
            assert_eq!(
                tray_action(id, TrayIntent::default()),
                Some(TrayAction::Show(toggle))
            );
            assert_eq!(tray_action(id, on), Some(TrayAction::Hide(toggle)), "{id}");
        }
        for intent in [TrayIntent::default(), on] {
            assert_eq!(
                tray_action("hide-overlay", intent),
                Some(TrayAction::Hide(Overlay))
            );
            assert_eq!(
                tray_action("workspace", intent),
                Some(TrayAction::Workspace)
            );
            assert_eq!(tray_action("quit", intent), Some(TrayAction::Quit));
            assert_eq!(tray_action("other", intent), None);
        }
    }

    #[test]
    fn details_selection_accepts_only_native_ids() {
        assert!(valid_selection(Some("fight-1760000000000"), "1086"));
        assert!(valid_selection(None, "42"));
        assert!(!valid_selection(Some("../fight-1"), "42"));
        assert!(!valid_selection(Some("fight-1"), ""));
        assert!(!valid_selection(Some(""), "42"));
        assert!(!valid_selection(Some("fight-1"), &"9".repeat(33)));
    }
}
