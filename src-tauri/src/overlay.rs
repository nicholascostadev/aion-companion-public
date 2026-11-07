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
/// Click-through surface over the game window that draws tracker bars at their x/y.
/// Kept out of `OVERLAYS` so the shared focus `Visibility` slots stay unchanged.
const TRACKERS_LABEL: &str = "tracker-overlay";
/// Damage details for one player, opened from a DPS meter row.
const DETAILS_LABEL: &str = "dps-details";
/// The expanded toolbar's width, used to build and centre the menu before its page has
/// measured itself; `menu_fit` then sizes the window to the toolbar it actually draws.
pub(crate) const MENU_WIDTH: f64 = 508.0;
/// The 32 px pill plus a 2 px transparent margin (`MenuBar.tsx`), so no dead strip eats clicks.
const MENU_HEIGHT: f64 = 36.0;
/// Widths the menu page may ask for (logical px): the collapsed logo up to a long translation.
const MENU_FIT: (f64, f64) = (40.0, 720.0);
/// Heights the meter page may ask for (logical px): the compact strip up to a sane ceiling.
const METER_FIT: (f64, f64) = (24.0, 4096.0);
const TRAY_ID: &str = "companion-tray";
const OVERLAYS: [&str; crate::focus::PANELS] = [LABEL, MENU_LABEL, DETAILS_LABEL];

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
    /// The menu's doubled physical centre x and the spot the last fit placed it at.
    menu_centre: Mutex<Option<(i64, (i32, i32))>>,
    /// The logical height the meter page last asked for (`overlay_fit`).
    meter_height: Mutex<Option<f64>>,
    errors: Mutex<Vec<String>>,
    saved: Mutex<String>,
    visibility: Mutex<crate::focus::Visibility>,
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
            lock_hotkey: AtomicBool::new(false),
            quitting: AtomicBool::new(false),
            trackers_ready: AtomicBool::new(false),
            trackers_requested: AtomicBool::new(false),
            trackers_editing: AtomicBool::new(false),
            details_ready: AtomicBool::new(false),
            details: Mutex::new(Value::Null),
            hit: Mutex::new(crate::hit::HitRegions::default()),
            menu_centre: Mutex::new(None),
            meter_height: Mutex::new(None),
            errors: Mutex::new(Vec::new()),
            saved: Mutex::new(String::new()),
            visibility: Mutex::new(crate::focus::Visibility::default()),
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

/// Whether the last focus tick found AION itself in the foreground.
pub fn game_focused(app: &AppHandle) -> bool {
    app.state::<OverlayState>()
        .visibility
        .lock()
        .map(|v| v.game_focused)
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
        crate::no_activate::ensure(
            hwnd.0 as isize,
            crate::no_activate::activation(window.label()),
        )?;
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
                            &crate::profile_window::LABEL,
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
                    crate::profile_window::sync(&handle, game_active(&handle));
                })
                .is_err()
            {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    });
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
    let mut status = json!({"requested_visible":requested[0],"menu_requested":requested[1],"game_focused":game_focused,"focus_suppressed":!active,"locked":state.locked.load(Ordering::Acquire),"ready":state.ready.load(Ordering::Acquire),"menu_ready":state.menu_ready.load(Ordering::Acquire),"menu_visible":app.get_webview_window(MENU_LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"can_lock":state.lock_hotkey.load(Ordering::Acquire),"tray_ready":tray.is_some(),"tray_registered":tray_registered,"visible":app.get_webview_window(LABEL).is_some_and(|w|w.is_visible().unwrap_or(false)),"saved_path":state.saved.lock().map(|s|s.clone()).unwrap_or_default(),"errors":state.errors.lock().map(|v|v.clone()).unwrap_or_default()});
    status["details_requested"] = requested[2].into();
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
    use crate::window_positions as positions;
    let saved = positions::saved(&app, MENU_LABEL);
    positions::place(&window, saved, positions::size_of(&window), default)?;
    positions::center_anchor(
        &app,
        MENU_LABEL,
        window.outer_size().map_err(|e| e.to_string())?.width,
    );
    if let Err(error) = positions::watch(&window, save_menu_drop) {
        record_error(&app, error);
    }
    request_visibility(&app, MENU_LABEL, true)
}

/// Saves a menu drop as the spot the expanded menu would take with the same centre: the menu
/// is built expanded and then fitted around its centre, so a drop while collapsed comes back
/// to the same place at the next start.
fn save_menu_drop(app: &AppHandle, label: &str, dropped: crate::window_positions::Dropped) {
    crate::window_positions::center_anchor(app, label, dropped.width);
    let scale = app
        .get_webview_window(label)
        .and_then(|window| window.scale_factor().ok())
        .unwrap_or(1.0);
    let x = built_left(dropped.x, dropped.width, scale);
    crate::window_positions::save_drop(
        app,
        label,
        crate::window_positions::Dropped { x, ..dropped },
    );
}

/// Left edge of the menu as built (`MENU_WIDTH`) around the centre of one `width` wide at `x`.
fn built_left(x: i32, width: u32, scale: f64) -> i32 {
    let built = (MENU_WIDTH * scale).round() as i64;
    (2 * i64::from(x) + i64::from(width) - built).div_euclid(2) as i32
}

/// Fits the menu window to its toolbar: `width` is the toolbar's logical width with its margin,
/// measured by the page whenever it changes (collapse, expand, fonts, language). The window is
/// the toolbar's whole hit area, so no transparent strip beside it takes the game's clicks.
#[tauri::command]
pub fn menu_fit(app: AppHandle, width: f64) -> Result<(), String> {
    use crate::window_positions as positions;
    let window = app
        .get_webview_window(MENU_LABEL)
        .ok_or("Menu is not open")?;
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    let current = window.outer_size().map_err(|e| e.to_string())?;
    let size = menu_size(width, scale);
    if (current.width as i32, current.height as i32) == size {
        return Ok(());
    }
    let state = app.state::<OverlayState>();
    let mut kept = state
        .menu_centre
        .lock()
        .map_err(|_| "Menu state unavailable")?;
    // A drag in progress keeps its spot; the user's drop decides.
    if positions::moving(&app, MENU_LABEL) {
        *kept = None;
        return place_without_activation(&window, (at.x, at.y), size);
    }
    let (spot, centre) = menu_spot(
        (at.x, at.y),
        current.width,
        size,
        *kept,
        &positions::displays(&window),
    );
    place_without_activation(&window, spot, size)?;
    *kept = Some((centre, spot));
    Ok(())
}

/// Where the menu resized to `size` goes, and the doubled centre x it keeps. It stays centred
/// on the same spot at the same height, so the toolbar folds towards its middle; one that would
/// hang off the displays is pulled onto them. The centre carries over from the last fit while
/// the window is still where that fit put it (`kept`), so folding and unfolding never drifts
/// by a rounding pixel and a pulled-in toolbar returns once it is narrow again; after a drag
/// or a DPI move it is read from the window again.
fn menu_spot(
    at: (i32, i32),
    width: u32,
    size: (i32, i32),
    kept: Option<(i64, (i32, i32))>,
    displays: &[crate::window_positions::Display],
) -> ((i32, i32), i64) {
    let centre = match kept {
        Some((centre, placed)) if placed == at => centre,
        _ => 2 * i64::from(at.0) + i64::from(width),
    };
    let x = (centre - i64::from(size.0)).div_euclid(2) as i32;
    (
        crate::window_positions::restore((x, at.1), size, displays),
        centre,
    )
}

/// Physical size of the menu for a toolbar `width` (logical px) at `scale`. Rounded up, so the
/// page never gets a viewport a fraction narrower than its toolbar.
fn menu_size(width: f64, scale: f64) -> (i32, i32) {
    let width = if width.is_finite() {
        width.clamp(MENU_FIT.0, MENU_FIT.1)
    } else {
        MENU_WIDTH
    };
    (
        (width * scale).ceil() as i32,
        (MENU_HEIGHT * scale).round() as i32,
    )
}

/// Fits the DPS meter's height to its page: `height` is the logical height that shows its
/// caption, strips, up to five rows and its footer, measured whenever any of them changes
/// (`useMeterFit`). The width stays the user's. The meter is never taller than the work area
/// of its monitor and moves up from where it belongs only as far as it must to stay inside
/// it; its list scrolls for the rest. Fitting never saves a position, and a fit asked for
/// during the user's own move or resize waits for their drop (`save_meter_drop`).
#[tauri::command]
pub fn overlay_fit(window: tauri::WebviewWindow, height: f64) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Only the DPS meter can fit itself".into());
    }
    if !height.is_finite() || !(METER_FIT.0..=METER_FIT.1).contains(&height) {
        return Err("Invalid DPS meter height".into());
    }
    let app = window.app_handle();
    *app.state::<OverlayState>()
        .meter_height
        .lock()
        .map_err(|_| "DPS meter state unavailable")? = Some(height);
    fit_meter(app)
}

/// Applies the meter's last asked-for height, unless the user is moving or resizing it.
fn fit_meter(app: &AppHandle) -> Result<(), String> {
    use crate::window_positions as positions;
    let Some(height) = *app
        .state::<OverlayState>()
        .meter_height
        .lock()
        .map_err(|_| "DPS meter state unavailable")?
    else {
        return Ok(());
    };
    let window = app.get_webview_window(LABEL).ok_or("Overlay is not open")?;
    if positions::moving(app, LABEL) {
        return Ok(());
    }
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let at = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.outer_size().map_err(|e| e.to_string())?;
    // From where the meter belongs (the user's drop or its opening spot), so a meter that grew
    // and was pushed up comes back down once it shrinks.
    let top = positions::anchor(app, LABEL).map_or(at.y, |(_, y)| y);
    let work = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?)
        .map(|monitor| {
            let area = monitor.work_area();
            (
                area.position.y,
                area.size.height.min(i32::MAX as u32) as i32,
            )
        });
    let (y, physical) = meter_span(top, height, scale, work);
    if (at.y, size.height as i32) == (y, physical) {
        return Ok(());
    }
    place_without_activation(&window, (at.x, y), (size.width as i32, physical))
}

/// Top and physical height of a meter that wants `height` logical px at `scale` and belongs at
/// `top`: no taller than the work area (`(top, height)` of its monitor), and moved up only as
/// far as needed for its bottom to stay inside it. Rounded up, so the page never gets a
/// viewport a fraction shorter than it asked for.
fn meter_span(top: i32, height: f64, scale: f64, work: Option<(i32, i32)>) -> (i32, i32) {
    let wanted = ((height * scale).ceil() as i32).max(1);
    match work {
        Some((start, span)) => {
            let height = wanted.min(span.max(1));
            let end = i64::from(start) + i64::from(span) - i64::from(height);
            (i64::from(top).min(end).max(i64::from(start)) as i32, height)
        }
        None => (top, wanted),
    }
}

/// Saves the meter's drop, then fits it again: a fit asked for during the move or resize
/// waited for it, and dragging its bottom edge never outlasts the drop.
fn save_meter_drop(app: &AppHandle, label: &str, dropped: crate::window_positions::Dropped) {
    crate::window_positions::save_drop(app, label, dropped);
    let handle = app.clone();
    // Later, not inside the window procedure that reported the drop.
    let _ = app.run_on_main_thread(move || {
        if let Err(error) = fit_meter(&handle) {
            record_error(&handle, error);
        }
    });
}

#[cfg(windows)]
fn place_without_activation(
    window: &tauri::WebviewWindow,
    (x, y): (i32, i32),
    (width, height): (i32, i32),
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // No SWP_SHOWWINDOW: a hidden menu stays hidden; tao's flags are left alone.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            x,
            y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
    };
    if ok == 0 {
        return Err(format!("Could not resize the {} window", window.label()));
    }
    Ok(())
}
#[cfg(not(windows))]
fn place_without_activation(
    window: &tauri::WebviewWindow,
    (x, y): (i32, i32),
    (width, height): (i32, i32),
) -> Result<(), String> {
    window
        .set_position(PhysicalPosition::new(x, y))
        .and_then(|_| window.set_size(PhysicalSize::new(width as u32, height as u32)))
        .map_err(|e| e.to_string())
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
    // The page fits the height to its content (`overlay_fit`), down to the compact strip.
    .min_inner_size(300.0, METER_FIT.0)
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
    place_saved(&app, &window, default, save_meter_drop)?;
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
    place_saved(app, &window, default, crate::window_positions::save_drop)
}

/// Keeps an in-game window from ever taking focus from the game; see `no_activate`.
pub(crate) fn guard_activation(app: &AppHandle, window: &tauri::WebviewWindow) {
    if let Err(error) = crate::no_activate::guard(window) {
        record_error(app, error);
    }
}

/// Puts a new overlay where the user last dropped it (kept on connected displays) or, the first
/// time, at `default` (centred without one), and saves the user's later drops with `on_drop`.
fn place_saved(
    app: &AppHandle,
    window: &tauri::WebviewWindow,
    default: Option<(i32, i32)>,
    on_drop: crate::window_positions::OnDrop,
) -> Result<(), String> {
    use crate::window_positions as positions;
    let saved = positions::saved(app, window.label());
    positions::place(window, saved, positions::size_of(window), default)?;
    if let Err(error) = positions::watch(window, on_drop) {
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
        if crate::profile_window::close_requested(window.app_handle(), window.label()) {
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
    Trackers,
}

/// Tray rows in menu order: id, label key and the intent its check mark shows.
/// A separator precedes Quit.
const TRAY_ROWS: [(&str, &str, Option<TrayToggle>); 6] = [
    ("show-menu", "trayShowMenu", Some(TrayToggle::Menu)),
    ("show-overlay", "trayShowOverlay", Some(TrayToggle::Overlay)),
    ("hide-overlay", "trayHideOverlay", None),
    (
        "show-trackers",
        "trayShowTrackers",
        Some(TrayToggle::Trackers),
    ),
    ("workspace", "trayWorkspace", None),
    ("quit", "trayQuit", None),
];

/// Requests, never focus-gated visibility: the tray
/// opens while another app is focused and every overlay is hidden.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
struct TrayIntent {
    menu: bool,
    overlay: bool,
    trackers: bool,
}
impl TrayIntent {
    fn read(state: &OverlayState) -> Self {
        let requested = state
            .visibility
            .lock()
            .map(|v| v.requested)
            .unwrap_or_default();
        Self {
            menu: requested[1],
            overlay: requested[0],
            trackers: state.trackers_requested.load(Ordering::Acquire),
        }
    }
    fn checked(self, toggle: TrayToggle) -> bool {
        match toggle {
            TrayToggle::Menu => self.menu,
            TrayToggle::Overlay => self.overlay,
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
/// hotkeys, window close or the in-app menu. Main thread only. The
/// native menu flips a mark on click before its action runs; this also restores a
/// mark whose action failed.
fn sync_tray(app: &AppHandle) {
    let state = app.state::<OverlayState>();
    let intent = TrayIntent::read(&state);
    let rows = state
        .tray
        .lock()
        .map(|rows| rows.clone())
        .unwrap_or_default();
    for (toggle, item) in rows {
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
    let intent = TrayIntent::read(&state);
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
                let intent = TrayIntent::read(&app.state::<OverlayState>());
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
    if args.iter().any(|a| a == "--overlay") {
        show_overlay(app.clone()).map_err(std::io::Error::other)?;
    } else if let Some(main) = app.get_webview_window("main") {
        main.show()?;
        main.set_focus()?;
    }
    if args.iter().any(|a| a == "--trackers") {
        // Smoke tests: request the surface with its saved arrange choice, like the UI does;
        // it still only shows over a focused game.
        show_trackers(app).map_err(std::io::Error::other)?;
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
                let group=app.state::<LiveCapture>().group_snapshot().ok().map(|g|json!({"members":g["members"].as_array().map(Vec::len),"inspections":g["inspections"].as_array().map(Vec::len),"roster_age_ms":g["roster_age_ms"],"lobby_name":g["lobby_name"],"capacity":g["capacity"],"room":g["room"],"dungeon_id":g["dungeon_id"],"run":g["run"],"preparing":g["preparing"],"roster":g["members"],"unparsed_roster":app.state::<LiveCapture>().group_protocol_diagnostic().ok().flatten(),"protocol_diagnostic":app.state::<LiveCapture>().group_debug_snapshot().ok()}));
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
    use super::TrayToggle::{Menu, Overlay, Trackers};
    use super::{
        built_left, menu_size, menu_spot, meter_span, tray_action, valid_selection, OverlayState,
        TrayAction, TrayIntent, MENU_FIT, MENU_WIDTH, TRAY_ROWS,
    };
    use std::sync::atomic::Ordering;

    const SWITCHES: [(&str, super::TrayToggle); 3] = [
        ("show-menu", Menu),
        ("show-overlay", Overlay),
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
            visibility.requested = [true, true, false];
            assert!(!visibility.visible(0) && !visibility.visible(1));
        }
        state.trackers_requested.store(true, Ordering::Release);
        let on = TrayIntent::read(&state);
        for (id, _) in SWITCHES {
            assert_eq!(checked(on, id), Some(true), "{id} is not checked");
        }
        let off = TrayIntent::read(&OverlayState::default());
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
    fn the_meter_takes_its_content_height_inside_the_work_area() {
        // A 1080 p monitor with a 40 px taskbar at the bottom.
        let work = Some((0, 1040));
        // Logical content heights become physical ones, rounded up, where the meter belongs.
        assert_eq!(meter_span(180, 224.0, 1.0, work), (180, 224));
        assert_eq!(meter_span(180, 224.2, 1.5, work), (180, 337));
        // Fewer rows shrink it from the top; the compact strip is only as tall as itself.
        assert_eq!(meter_span(180, 30.0, 1.0, work), (180, 30));
        // Dropped low, a grown meter moves up just enough for its bottom to stay inside...
        assert_eq!(meter_span(900, 224.0, 1.0, work), (816, 224));
        // ...and taller than the work area, it is as tall as the area from its top.
        assert_eq!(meter_span(300, 5_000.0, 1.0, work), (0, 1040));
        // Above the area (a taskbar at the top): back inside it.
        assert_eq!(meter_span(10, 200.0, 1.0, Some((40, 1040))), (40, 200));
        // A monitor above the primary, with negative coordinates.
        assert_eq!(
            meter_span(-200, 400.0, 1.25, Some((-1024, 984))),
            (-540, 500)
        );
        // Without monitor information it takes the height where it is.
        assert_eq!(meter_span(-5_000, 224.0, 2.0, None), (-5_000, 448));
    }

    #[test]
    fn the_menu_fits_its_toolbar_around_its_centre() {
        use crate::window_positions::{Display, Rect};
        let screen = Rect {
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
        };
        let displays = [Display {
            bounds: screen,
            work: Rect {
                height: 1040,
                ..screen
            },
        }];
        // Logical toolbar widths become physical window sizes, rounded up so the page never
        // gets a viewport narrower than its toolbar.
        assert_eq!(menu_size(148.0, 1.0), (148, 36));
        assert_eq!(menu_size(148.0, 1.25), (185, 45));
        assert_eq!(menu_size(499.2, 1.5), (749, 54));
        // A broken or absurd measurement never makes the window vanish or span the screen.
        assert_eq!(menu_size(f64::NAN, 1.0), (MENU_WIDTH as i32, 36));
        assert_eq!(menu_size(0.0, 1.0).0, MENU_FIT.0 as i32);
        assert_eq!(menu_size(10_000.0, 2.0).0, (MENU_FIT.1 * 2.0) as i32);

        // The default top-centre menu folds and unfolds about the screen's centre at the same
        // height, at every scale, and an odd width difference never walks it sideways.
        for scale in [1.0, 1.25, 1.5] {
            let (open, closed) = (menu_size(508.0, scale), menu_size(155.4, scale));
            let home = ((1920 - open.0) / 2, 12);
            let (mut at, mut width, mut kept) = (home, open.0 as u32, None);
            for size in [closed, open, closed, open, closed, open] {
                let (spot, centre) = menu_spot(at, width, size, kept, &displays);
                assert!((2 * spot.0 + size.0 - 1920).abs() <= 1, "{scale} {size:?}");
                assert_eq!(spot.1, 12);
                (at, width, kept) = (spot, size.0 as u32, Some((centre, spot)));
            }
            assert_eq!(at, home, "{scale}");
        }

        // A dragged menu keeps the centre it was dropped with, not the screen's; a centre
        // kept from before the drag is ignored.
        let (dropped, closed) = ((300, 400), (156, 36));
        let (spot, _) = menu_spot(dropped, 508, closed, None, &displays);
        assert_eq!(spot, (476, 400));
        let stale = Some((1920, (706, 12)));
        let (spot, _) = menu_spot(dropped, 508, closed, stale, &displays);
        assert_eq!(spot, (476, 400));

        // Unfolding at the right edge pulls the toolbar on screen; folding again returns it.
        let edge = (1700, 12);
        let (open, centre) = menu_spot(edge, 156, (508, 36), None, &displays);
        assert_eq!(open, (1412, 12));
        let kept = Some((centre, open));
        assert_eq!(menu_spot(open, 508, (156, 36), kept, &displays).0, edge);
    }

    #[test]
    fn a_menu_drop_is_saved_for_the_expanded_menu_with_the_same_centre() {
        // Dropped collapsed (156 px at x 882): built expanded, it starts at 706 and fits back.
        assert_eq!(built_left(882, 156, 1.0), 706);
        assert_eq!(built_left(706, 508, 1.0), 706);
        assert_eq!(menu_spot((706, 12), 508, (156, 36), None, &[]).0, (882, 12));
        // At 150 % the expanded menu is 762 px wide.
        assert_eq!(built_left(1000, 234, 1.5), 736);
        let closed = (234, 54);
        assert_eq!(menu_spot((736, 18), 762, closed, None, &[]).0, (1000, 18));
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
