//! In-game pet radar: a borderless, transparent, resizable window over the game. Like every
//! overlay it is only visible while AION (or one of our overlays over it) is focused, and
//! closing it only hides it. It starts unlocked: the whole panel drags and resizes. Locked,
//! it is click-through except the controls the webview reports as hit regions (pins, lock,
//! hide), which take clicks without taking focus from the game. The lock choice is saved
//! (`overlay_locks`); position and size are saved when the user drops a move or resize
//! (`window_positions`).
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::{AppHandle, Manager, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "pet-radar";
const WIDTH: f64 = 340.0;
/// Compact: a few dense rows over the map.
const HEIGHT: f64 = 300.0;
/// Default height of earlier builds; a saved size still exactly at it was never resized.
const OLD_HEIGHT: f64 = 440.0;
const MIN_WIDTH: f64 = 260.0;
const MIN_HEIGHT: f64 = 180.0;
const MAX_ERRORS: usize = 8;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Geometry {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

struct Inner {
    requested: bool,
    ready: bool,
    locked: bool,
    creating: bool,
    hit: crate::hit::HitRegions,
    /// The user's saved geometry.
    geometry: Option<Geometry>,
    path: Option<PathBuf>,
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
            hit: crate::hit::HitRegions::default(),
            geometry: None,
            path: None,
            errors: Vec::new(),
        }
    }
}

#[derive(Default)]
pub struct PetWindowState(Mutex<Inner>);

fn parse_geometry(value: &Value) -> Option<Geometry> {
    let int = |key: &str| value[key].as_i64();
    let (x, y, width, height) = (int("x")?, int("y")?, int("width")?, int("height")?);
    let valid = (-100_000..=100_000).contains(&x)
        && (-100_000..=100_000).contains(&y)
        && (100..=16_384).contains(&width)
        && (100..=16_384).contains(&height);
    valid.then_some(Geometry {
        x: x as i32,
        y: y as i32,
        width: width as u32,
        height: height as u32,
    })
}

/// A saved size still exactly at the earlier default (at this scale) was never resized by the
/// user: it takes the compact default. Any other size is the user's and is kept.
fn migrate_default(g: Geometry, scale: f64) -> Geometry {
    let px = |v: f64| (v * scale).round() as u32;
    if g.width == px(WIDTH) && g.height == px(OLD_HEIGHT) {
        Geometry {
            height: px(HEIGHT),
            ..g
        }
    } else {
        g
    }
}

/// Registers the window state and the saved geometry. Call once from app setup.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("pet-radar-window.json");
    let geometry = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| parse_geometry(&v));
    app.manage(PetWindowState(Mutex::new(Inner {
        geometry,
        locked: crate::overlay_locks::saved(app, LABEL),
        path: Some(path),
        ..Default::default()
    })));
    Ok(())
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Inner) -> T) -> Result<T, String> {
    let state = app
        .try_state::<PetWindowState>()
        .ok_or("Pet radar is unavailable")?;
    let mut inner = state.0.lock().map_err(|_| "Pet radar state unavailable")?;
    Ok(f(&mut inner))
}

fn record_error(app: &AppHandle, error: String) {
    let _ = with(app, |inner| {
        if inner.errors.len() < MAX_ERRORS && !inner.errors.contains(&error) {
            inner.errors.push(error);
        }
    });
}

/// Applies the focus gate now, on the main thread.
fn schedule(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let active = crate::overlay::game_active(&handle);
        sync(&handle, active);
    })
    .map_err(|e| e.to_string())
}

/// Saves the geometry as the user's, through the shared position queue.
fn save(app: &AppHandle, g: Geometry) {
    let Ok(Some(path)) = with(app, |inner| {
        inner.geometry = Some(g);
        inner.path.clone()
    }) else {
        return;
    };
    crate::window_positions::save_file(
        app,
        path,
        &json!({"x":g.x,"y":g.y,"width":g.width,"height":g.height}),
    );
}

/// The user dropped a move or resize.
fn save_drop(app: &AppHandle, _: &str, dropped: crate::window_positions::Dropped) {
    if dropped.width > 0 && dropped.height > 0 {
        save(
            app,
            Geometry {
                x: dropped.x,
                y: dropped.y,
                width: dropped.width,
                height: dropped.height,
            },
        );
    }
}

fn create_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        return Ok(window);
    }
    let (locked, saved) = with(app, |inner| (inner.locked, inner.geometry))?;
    let window = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?view=pet-radar".into()),
    )
    .title(crate::ui_preferences::title(app, "titlePets"))
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
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
    let scale = window.scale_factor().unwrap_or(1.0);
    let saved = saved.map(|g| (g, migrate_default(g, scale)));
    if let Some((old, g)) = saved {
        if g != old {
            // Saved now, so the migration happens only once.
            save(app, g);
        }
        window
            .set_size(PhysicalSize::new(g.width, g.height))
            .map_err(|e| e.to_string())?;
    }
    // Right side of the game, below the DPS meter's default place.
    let default = match crate::overlay::game_rect().or_else(|| {
        let m = window.primary_monitor().ok()??;
        let (p, s) = (m.position(), m.size());
        Some((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32))
    }) {
        Some((left, top, right, bottom)) => {
            let x = (f64::from(right) - (WIDTH + 24.0) * scale).max(f64::from(left));
            let y = (f64::from(top) + 500.0 * scale)
                .min((f64::from(bottom) - (HEIGHT + 24.0) * scale).max(f64::from(top)));
            Some((x as i32, y as i32))
        }
        None => None,
    };
    // The saved spot, kept on connected displays; the default only without one.
    let size = saved.map_or_else(
        || crate::window_positions::size_of(&window),
        |(_, g)| (g.width as i32, g.height as i32),
    );
    crate::window_positions::place(&window, saved.map(|(_, g)| (g.x, g.y)), size, default)?;
    if let Err(error) = crate::window_positions::watch(&window, save_drop) {
        record_error(app, error);
    }
    if locked {
        window
            .set_ignore_cursor_events(true)
            .map_err(|e| e.to_string())?;
    }
    Ok(window)
}

/// Focus heartbeat (main thread, every foreground check): shows the radar only while it is
/// requested and the game context is active.
pub fn sync(app: &AppHandle, active: bool) {
    let Ok(requested) = with(app, |inner| inner.requested) else {
        return;
    };
    if let Some(window) = app.get_webview_window(LABEL) {
        let want = requested && active;
        if window.is_visible().unwrap_or(false) != want {
            if let Err(error) = crate::overlay::set_visible_without_activation(&window, want) {
                record_error(app, error);
            }
        }
        if !want {
            let _ = with(app, |inner| inner.hit.clear());
        }
    }
}

/// Lets the locked radar take input only while the cursor is over a reported control; the
/// rest stays `WS_EX_TRANSPARENT`, so clicks reach the game. Same approach as the locked
/// DPS meter: the style is toggled directly between tao's locked and unlocked styles and
/// `WS_EX_NOACTIVATE` stays, so a pin click never takes focus from the game.
#[cfg(all(windows, target_pointer_width = "64"))]
pub fn sync_input(app: &AppHandle) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    if !with(app, |inner| inner.locked).unwrap_or(false) {
        return;
    }
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let over = (|| {
        if !window.is_visible().ok()? {
            return None;
        }
        let cursor = app.cursor_position().ok()?;
        let origin = window.inner_position().ok()?;
        let client = window.inner_size().ok()?;
        let scale = window.scale_factor().ok()?;
        with(app, |inner| {
            inner.hit.contains(
                (cursor.x - f64::from(origin.x), cursor.y - f64::from(origin.y)),
                (f64::from(client.width), f64::from(client.height)),
                scale,
                Instant::now(),
            )
        })
        .ok()
    })()
    .unwrap_or(false);
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let passthrough = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
    unsafe {
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
#[cfg(not(all(windows, target_pointer_width = "64")))]
pub fn sync_input(_: &AppHandle) {}

/// Locked or not, the radar never takes focus from the game (`no_activate`).
fn apply_lock(window: &tauri::WebviewWindow, locked: bool) -> Result<(), String> {
    window
        .set_ignore_cursor_events(locked)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pets_overlay_status(app: AppHandle) -> Value {
    let window = app.get_webview_window(LABEL);
    let visible = window
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let active = crate::overlay::game_active(&app);
    with(&app, |inner| {
        json!({
            "requested": inner.requested,
            "visible": visible,
            "ready": inner.ready,
            "locked": inner.locked,
            "game_active": active,
            "regions": inner.hit.len(),
            "errors": inner.errors,
        })
    })
    .unwrap_or_else(|error| {
        json!({"requested":false,"visible":visible,"ready":false,"locked":false,"game_active":active,"errors":[error]})
    })
}

#[tauri::command]
pub fn pets_overlay_ready(app: AppHandle) {
    let _ = with(&app, |inner| inner.ready = true);
}

/// Requests the radar; it appears once AION (or an overlay over it) is focused.
#[tauri::command]
pub async fn pets_overlay_show(app: AppHandle) -> Result<Value, String> {
    // Window creation waits on the event loop, so only one caller creates it.
    let create = with(&app, |inner| {
        let create = !inner.creating && app.get_webview_window(LABEL).is_none();
        if create {
            inner.creating = true;
        }
        create
    })?;
    if create {
        let result = create_window(&app);
        let _ = with(&app, |inner| inner.creating = false);
        result?;
    }
    with(&app, |inner| inner.requested = true)?;
    schedule(&app)?;
    Ok(pets_overlay_status(app))
}

#[tauri::command]
pub fn pets_overlay_hide(app: AppHandle) -> Result<Value, String> {
    with(&app, |inner| inner.requested = false)?;
    schedule(&app)?;
    Ok(pets_overlay_status(app))
}

/// Locked: click-through except the reported controls. Unlocked: drags and resizes.
#[tauri::command]
pub fn pets_overlay_lock(app: AppHandle, locked: bool) -> Result<Value, String> {
    if let Some(window) = app.get_webview_window(LABEL) {
        if !locked {
            // Stop region toggling before tao restores normal input.
            with(&app, |inner| inner.locked = false)?;
        }
        if let Err(error) = apply_lock(&window, locked) {
            let _ = with(&app, |inner| inner.locked = !locked);
            return Err(error);
        }
    }
    with(&app, |inner| inner.locked = locked)?;
    // The radar already follows the choice; a failed save only loses it at restart.
    if let Err(error) = crate::overlay_locks::save(&app, LABEL, locked) {
        record_error(&app, format!("Could not save the pet radar lock choice: {error}"));
    }
    // Tao never sees the raw no-activate show, so its flag update can re-hide the window.
    schedule(&app)?;
    Ok(pets_overlay_status(app))
}

/// Control rectangles of the locked radar, `[x, y, width, height]` in physical client pixels
/// at device pixel ratio `scale`. An empty list clears them.
#[tauri::command]
pub fn pets_overlay_hit_regions(
    app: AppHandle,
    regions: Vec<[f64; 4]>,
    scale: f64,
) -> Result<usize, String> {
    with(&app, |inner| {
        inner.hit.set(&regions, scale, Instant::now())
    })?
}

/// Closing the radar (its button, Escape or Alt+F4) only hides it.
pub fn close_requested(app: &AppHandle) {
    if with(app, |inner| inner.requested = false).is_ok() {
        if let Err(error) = schedule(app) {
            record_error(app, error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_geometry_accepts_only_sane_bounds() {
        assert_eq!(
            parse_geometry(&json!({"x":-1200,"y":40,"width":340,"height":440})),
            Some(Geometry {
                x: -1200,
                y: 40,
                width: 340,
                height: 440
            })
        );
        assert_eq!(parse_geometry(&json!({"x":0,"y":0,"width":20,"height":440})), None);
        assert_eq!(parse_geometry(&json!({"x":0,"y":0,"width":340})), None);
        assert_eq!(
            parse_geometry(&json!({"x":0,"y":0,"width":340,"height":99999})),
            None
        );
        assert_eq!(
            parse_geometry(&json!({"x":"0","y":0,"width":340,"height":440})),
            None
        );
    }
    #[test]
    fn only_an_untouched_old_default_takes_the_compact_height() {
        let at = |width, height| Geometry {
            x: 10,
            y: 20,
            width,
            height,
        };
        assert_eq!(migrate_default(at(340, 440), 1.0), at(340, 300));
        assert_eq!(migrate_default(at(510, 660), 1.5), at(510, 450));
        // Resized by the user, or saved at another scale: kept as is.
        assert_eq!(migrate_default(at(340, 520), 1.0), at(340, 520));
        assert_eq!(migrate_default(at(300, 440), 1.0), at(300, 440));
        assert_eq!(migrate_default(at(340, 440), 1.25), at(340, 440));
    }
    #[test]
    fn starts_hidden_and_unlocked() {
        let inner = Inner::default();
        assert!(!inner.requested);
        assert!(!inner.locked);
        assert_eq!(inner.hit.len(), 0);
    }
}
