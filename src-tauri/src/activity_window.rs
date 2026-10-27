//! Focus-gated Timers and Explore windows. Each keeps its
//! geometry in its own file, saved when the user drops a move or resize (`window_positions`).
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, time::Instant};
use tauri::{AppHandle, Manager, PhysicalSize, WebviewUrl, WebviewWindowBuilder};
pub const TIMERS: &str = "timers-overlay";
pub const EXPLORE: &str = "explore-overlay";
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Timers,
    Explore,
}
impl Kind {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "timers" => Ok(Self::Timers),
            "explore" | "maps" | "finder" | "cubes" | "gathering" => Ok(Self::Explore),
            _ => Err("Unknown activity window".into()),
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Timers => TIMERS,
            Self::Explore => EXPLORE,
        }
    }
    fn title_key(self) -> &'static str {
        match self {
            Self::Timers => "titleTimers",
            Self::Explore => "titleExplore",
        }
    }
    fn view(self) -> &'static str {
        match self {
            Self::Timers => "timers",
            Self::Explore => "explore",
        }
    }
    fn from_label(label: &str) -> Option<Self> {
        match label {
            TIMERS => Some(Self::Timers),
            EXPLORE => Some(Self::Explore),
            _ => None,
        }
    }
    fn height(self) -> f64 {
        match self {
            Self::Timers => 360.,
            Self::Explore => 400.,
        }
    }
    fn startup_arg(self, arg: &str) -> bool {
        match self {
            Self::Timers => arg == "--timers",
            Self::Explore => matches!(arg, "--explore" | "--maps" | "--cubes" | "--gathering"),
        }
    }
}
struct Inner {
    requested: bool,
    ready: bool,
    locked: bool,
    creating: bool,
    revision: u64,
    /// The user's saved geometry: x, y, width, height.
    geometry: Option<[i64; 4]>,
    path: Option<PathBuf>,
    hit: crate::hit::HitRegions,
    errors: Vec<String>,
}
impl Default for Inner {
    fn default() -> Self {
        Self {
            requested: false,
            ready: false,
            // Unlocked until the user locks it; `setup` restores a saved choice.
            locked: false,
            creating: false,
            revision: 0,
            geometry: None,
            path: None,
            hit: Default::default(),
            errors: Vec::new(),
        }
    }
}
#[derive(Default)]
struct Windows {
    timers: Mutex<Inner>,
    explore: Mutex<Inner>,
}
fn with<T>(app: &AppHandle, kind: Kind, f: impl FnOnce(&mut Inner) -> T) -> Result<T, String> {
    let state = app.state::<Windows>();
    let lock = match kind {
        Kind::Timers => &state.timers,
        Kind::Explore => &state.explore,
    };
    let mut inner = lock
        .lock()
        .map_err(|_| "Activity window state unavailable")?;
    Ok(f(&mut inner))
}
fn geometry(value: &Value) -> Option<[i64; 4]> {
    let g = [
        value["x"].as_i64()?,
        value["y"].as_i64()?,
        value["width"].as_i64()?,
        value["height"].as_i64()?,
    ];
    ((-100_000..=100_000).contains(&g[0])
        && (-100_000..=100_000).contains(&g[1])
        && (260..=16384).contains(&g[2])
        && (160..=16384).contains(&g[3]))
    .then_some(g)
}
fn error(app: &AppHandle, kind: Kind, e: String) {
    let _ = with(app, kind, |s| {
        if s.errors.len() < 8 && !s.errors.contains(&e) {
            s.errors.push(e)
        }
    });
}
pub fn setup(app: &AppHandle) -> Result<(), String> {
    app.manage(Windows::default());
    for kind in [Kind::Timers, Kind::Explore] {
        let path = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join(format!("{}-window.json", kind.view()));
        let saved = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|v| geometry(&v));
        let locked = crate::overlay_locks::saved(app, kind.label());
        with(app, kind, |s| {
            s.geometry = saved;
            s.path = Some(path);
            s.locked = locked;
        })?;
    }
    Ok(())
}
fn schedule(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || sync(&handle, crate::overlay::game_active(&handle)))
        .map_err(|e| e.to_string())
}
fn create(app: &AppHandle, kind: Kind) -> Result<(), String> {
    let (saved, locked) = with(app, kind, |s| (s.geometry, s.locked))?;
    if app.get_webview_window(kind.label()).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        kind.label(),
        WebviewUrl::App(format!("index.html?view={}", kind.view()).into()),
    )
    .title(crate::ui_preferences::title(app, kind.title_key()))
    .inner_size(340., kind.height())
    .min_inner_size(260., 160.)
    .resizable(true)
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
    crate::overlay::guard_activation(app, &window);
    if let Some(g) = saved {
        window
            .set_size(PhysicalSize::new(g[2] as u32, g[3] as u32))
            .map_err(|e| e.to_string())?;
    }
    let default = crate::overlay::game_rect().map(|(left, top, right, bottom)| {
        let scale = window.scale_factor().unwrap_or(1.);
        let offset = match kind {
            Kind::Timers => 24.,
            Kind::Explore => 736.,
        };
        let x = (f64::from(left) + offset * scale)
            .min(f64::from(right) - 340. * scale)
            .max(f64::from(left));
        let y = (f64::from(top) + 110. * scale)
            .min(f64::from(bottom) - kind.height() * scale)
            .max(f64::from(top));
        (x as i32, y as i32)
    });
    // The saved spot, kept on connected displays; the default only without one.
    let size = saved.map_or_else(
        || crate::window_positions::size_of(&window),
        |g| (g[2] as i32, g[3] as i32),
    );
    let wanted = saved.map(|g| (g[0] as i32, g[1] as i32));
    crate::window_positions::place(&window, wanted, size, default)?;
    if let Err(e) = crate::window_positions::watch(&window, save_drop) {
        error(app, kind, e);
    }
    window
        .set_ignore_cursor_events(locked)
        .map_err(|e| e.to_string())?;
    Ok(())
}
/// The user dropped a move or resize of an activity window.
fn save_drop(app: &AppHandle, label: &str, d: crate::window_positions::Dropped) {
    let Some(kind) = Kind::from_label(label) else {
        return;
    };
    let value = json!({"x":d.x,"y":d.y,"width":d.width,"height":d.height});
    let Some(g) = geometry(&value) else {
        return;
    };
    if let Ok(Some(path)) = with(app, kind, |s| {
        s.geometry = Some(g);
        s.path.clone()
    }) {
        crate::window_positions::save_file(app, path, &value);
    }
}
pub fn sync(app: &AppHandle, active: bool) {
    for kind in [Kind::Timers, Kind::Explore] {
        let Ok(requested) = with(app, kind, |s| {
            if !active || !s.requested {
                s.hit.clear();
            }
            s.requested
        }) else {
            continue;
        };
        if let Some(window) = app.get_webview_window(kind.label()) {
            let want = requested && active;
            if window.is_visible().unwrap_or(false) != want {
                if let Err(e) = crate::overlay::set_visible_without_activation(&window, want) {
                    error(app, kind, e);
                }
            }
        }
    }
}
#[cfg(all(windows, target_pointer_width = "64"))]
pub fn sync_input(app: &AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    for kind in [Kind::Timers, Kind::Explore] {
        if !with(app, kind, |s| s.locked).unwrap_or(false) {
            continue;
        }
        let Some(window) = app.get_webview_window(kind.label()) else {
            continue;
        };
        let over = (|| {
            if !window.is_visible().ok()? {
                return None;
            }
            let cursor = app.cursor_position().ok()?;
            let origin = window.inner_position().ok()?;
            let client = window.inner_size().ok()?;
            let scale = window.scale_factor().ok()?;
            with(app, kind, |s| {
                s.hit.contains(
                    (
                        cursor.x - f64::from(origin.x),
                        cursor.y - f64::from(origin.y),
                    ),
                    (f64::from(client.width), f64::from(client.height)),
                    scale,
                    Instant::now(),
                )
            })
            .ok()
        })()
        .unwrap_or(false);
        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let passthrough = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
                let style = GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE);
                let next = if over {
                    style & !passthrough
                } else {
                    style | passthrough
                };
                if next != style {
                    SetWindowLongPtrW(hwnd.0, GWL_EXSTYLE, next);
                }
            }
        }
    }
}
#[cfg(not(all(windows, target_pointer_width = "64")))]
pub fn sync_input(_: &AppHandle) {}
fn status(app: &AppHandle, kind: Kind) -> Result<Value, String> {
    let visible = app
        .get_webview_window(kind.label())
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    with(
        app,
        kind,
        |s| json!({"requested":s.requested,"visible":visible,"ready":s.ready,"locked":s.locked,"game_active":crate::overlay::game_active(app),"errors":s.errors}),
    )
}
#[tauri::command]
pub fn activity_window_status(app: AppHandle, kind: String) -> Result<Value, String> {
    status(&app, Kind::parse(&kind)?)
}
#[tauri::command]
pub fn activity_window_ready(app: AppHandle, kind: String) -> Result<(), String> {
    with(&app, Kind::parse(&kind)?, |s| s.ready = true)
}
#[tauri::command]
pub async fn activity_window_show(app: AppHandle, kind: String) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    let (create_now, revision) = with(&app, kind, |s| {
        s.requested = true;
        s.revision += 1;
        let create = !s.creating && app.get_webview_window(kind.label()).is_none();
        if create {
            s.creating = true;
        }
        (create, s.revision)
    })?;
    if create_now {
        let result = create(&app, kind);
        with(&app, kind, |s| {
            s.creating = false;
            if result.is_err() && s.revision == revision {
                s.requested = false;
            }
        })?;
        result?;
    }
    schedule(&app)?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_hide(app: AppHandle, kind: String) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    with(&app, kind, |s| {
        s.requested = false;
        s.revision += 1;
        s.hit.clear();
    })?;
    schedule(&app)?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_lock(app: AppHandle, kind: String, locked: bool) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    let previous = with(&app, kind, |s| {
        let old = s.locked;
        s.locked = false;
        s.hit.clear();
        old
    })?;
    if let Some(window) = app.get_webview_window(kind.label()) {
        // Locked or not, the window never takes focus from the game (`no_activate`).
        let result = window
            .set_ignore_cursor_events(locked)
            .map_err(|e| e.to_string());
        if let Err(e) = result {
            let _ = window.set_ignore_cursor_events(previous);
            with(&app, kind, |s| s.locked = previous)?;
            return Err(e);
        }
    }
    with(&app, kind, |s| s.locked = locked)?;
    // The window already follows the choice; a failed save only loses it at restart.
    if let Err(e) = crate::overlay_locks::save(&app, kind.label(), locked) {
        error(
            &app,
            kind,
            format!("Could not save the {} lock choice: {e}", kind.view()),
        );
    }
    schedule(&app)?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_hit_regions(
    app: AppHandle,
    kind: String,
    regions: Vec<[f64; 4]>,
    scale: f64,
) -> Result<usize, String> {
    with(&app, Kind::parse(&kind)?, |s| {
        s.hit.set(&regions, scale, Instant::now())
    })?
}
pub fn close_requested(app: &AppHandle, label: &str) -> bool {
    let Some(kind) = Kind::from_label(label) else {
        return false;
    };
    let _ = activity_window_hide(app.clone(), kind.view().into());
    true
}

/// Optional startup requests follow the same focus gate and saved layout as the UI.
pub fn startup(app: &AppHandle) {
    let args: Vec<String> = std::env::args().collect();
    for kind in [Kind::Timers, Kind::Explore] {
        if args.iter().any(|arg| kind.startup_arg(arg)) {
            let handle = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = activity_window_show(handle.clone(), kind.view().into()).await {
                    error(&handle, kind, e);
                }
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finder_names_share_one_window_and_start_hidden_unlocked() {
        assert_ne!(Kind::Explore.label(), Kind::Timers.label());
        for name in ["explore", "maps", "finder", "cubes", "gathering"] {
            assert!(Kind::parse(name).unwrap() == Kind::Explore);
        }
        assert!(Kind::from_label(EXPLORE) == Some(Kind::Explore));
        assert!(Kind::from_label("cubes-overlay").is_none());
        assert!(Kind::from_label("gathering-overlay").is_none());
        assert_eq!(Kind::Explore.view(), "explore");
        assert_eq!(Kind::Explore.title_key(), "titleExplore");
        for arg in ["--explore", "--maps", "--cubes", "--gathering"] {
            assert!(Kind::Explore.startup_arg(arg));
        }
        assert!(!Kind::Explore.startup_arg("--timers"));
        assert!(Kind::parse("pets").is_err());
        let a = Inner::default();
        assert!(!a.requested && !a.locked);
    }
    #[test]
    fn invalid_geometry_is_ignored() {
        assert!(geometry(&json!({"x":0,"y":0,"width":20,"height":600})).is_none());
        assert!(geometry(&json!({"x":0,"y":0,"width":340,"height":600})).is_some());
    }
}
