//! Alert popup: a borderless, transparent, no-activate window that shows fresh alert
//! deliveries over the game. It follows the overlay focus rule (only while AION or one of
//! our overlays over it is focused), never takes focus, and expires each delivery
//! `TTL_MS` after it fired so nothing stale replays after alt-tabbing back. The one
//! exception is "maintenance complete" (`recovery`), which exists for when AION is closed:
//! outside the game the popup presents only those, still without activating. Development
//! builds also present explicit test previews there, so the Dev test toast is visible from
//! the workspace.
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "alert-popup";
/// Event carrying the popup's current deliveries to its webview.
const EVENT: &str = "alerts-popup";
/// A delivery is shown at most this long after it fired.
pub const TTL_MS: u64 = 10_000;
const LIMIT: usize = 8;
const DISMISSED_LIMIT: usize = 64;

/* Logical layout shared with AlertPopup.tsx: fixed card height so the
 * window can be sized natively without the webview measuring itself. */
const WIDTH: f64 = 340.0;
const PAD: f64 = 6.0;
const CARD: f64 = 56.0;
const GAP: f64 = 6.0;
const VISIBLE_CARDS: usize = 3;

/* Default spot (logical px, scaled by the game monitor's DPI): in the top band right of the
 * centred companion menu, left of the game's minimap and system buttons. */
/// Window gap after the menu's right edge; the card sits `PAD` further in, ~16 px clear.
const MENU_GAP: f64 = 10.0;
/// Kept clear at the game's right edge for its minimap and system buttons.
const GAME_HUD_RIGHT: f64 = 300.0;
/// Fallback top offset, below the menu, when the band beside it is too narrow.
const BELOW_MENU: f64 = 76.0;

#[derive(Default)]
pub struct AlertWindowState(Mutex<Inner>);

#[derive(Default)]
struct Inner {
    /// Every admitted delivery, whether or not the focus rule lets it show now.
    items: Vec<Value>,
    /// Whether the game context was active at the last focus heartbeat.
    active: bool,
    /// Ids and statuses last sent to the webview: `items` as the focus rule presents them.
    shown: Vec<(String, String)>,
    dismissed: VecDeque<String>,
    ready: bool,
    creating: bool,
    /// Visible card count and whether several are present, for native sizing.
    sized: Option<(usize, bool)>,
    /// The user's saved physical outer position, saved when a drag is dropped.
    position: Option<(i32, i32)>,
    path: Option<PathBuf>,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn fired(item: &Value) -> Option<u64> {
    item["fired_ms"]
        .as_f64()
        .filter(|v| *v >= 0.0)
        .map(|v| v as u64)
}

fn fresh(item: &Value, now: u64) -> bool {
    // A delivery from the future (clock skew) counts as fresh for at most the TTL.
    fired(item).is_some_and(|at| now.saturating_sub(at) < TTL_MS && at <= now + TTL_MS)
}

/// The popup set native wants on screen: fresh, popup-enabled, still delivered, not
/// dismissed in the popup, newest last, bounded.
fn admit(deliveries: &[Value], dismissed: &VecDeque<String>, now: u64) -> Vec<Value> {
    let mut items: Vec<Value> = Vec::new();
    for item in deliveries {
        let Some(id) = item["id"].as_str() else {
            continue;
        };
        if id.is_empty()
            || id.len() > 256
            || item["popup"].as_bool() == Some(false)
            || item["status"].as_str().is_some_and(|s| s != "delivered")
            || !fresh(item, now)
            || dismissed.iter().any(|d| d == id)
            || items.iter().any(|i| i["id"].as_str() == Some(id))
        {
            continue;
        }
        items.push(item.clone());
    }
    items.sort_by_key(|i| fired(i).unwrap_or(0));
    let extra = items.len().saturating_sub(LIMIT);
    items.drain(..extra);
    items
}

fn ids(items: &[Value]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|i| {
            (
                i["id"].as_str().unwrap_or("").to_string(),
                i["status"].as_str().unwrap_or("").to_string(),
            )
        })
        .collect()
}

/// Shown even outside the game: the user asked to hear when maintenance is officially
/// complete, typically while AION is closed.
fn outside_game(item: &Value) -> bool {
    shown_outside_game(item, crate::build_info::DEVELOPMENT)
}

/// `outside_game` for a given channel. Development builds also show explicit test previews
/// (`test`, only ever produced by the test action), so the Dev "Test toast" is visible from
/// the workspace; stable keeps tests to the game like every reminder.
fn shown_outside_game(item: &Value, development: bool) -> bool {
    match item["phase"].as_str() {
        Some("recovery") => true,
        Some("test") => development,
        _ => false,
    }
}

/// The deliveries the window presents: all of them while the game context is active,
/// otherwise only those meant for outside the game, so no game reminder leaks with them.
fn presented(items: &[Value], active: bool) -> Vec<Value> {
    items
        .iter()
        .filter(|item| active || outside_game(item))
        .cloned()
        .collect()
}

/// The presented list when it differs from what the webview last received.
fn changed_presentation(inner: &mut Inner) -> Option<Vec<Value>> {
    let shown = presented(&inner.items, inner.active);
    let next = ids(&shown);
    if next == inner.shown {
        return None;
    }
    inner.shown = next;
    Some(shown)
}

fn height(count: usize) -> f64 {
    let cards = count.min(VISIBLE_CARDS) as f64;
    PAD * 2.0 + cards * CARD + (cards - 1.0).max(0.0) * GAP
}

/// Physical default position for the popup within `area` (left, top, right, bottom): at the
/// top, just right of the companion menu (centred at the top, `MENU_WIDTH` wide), when it
/// fits left of the game's right-edge HUD; otherwise top centre, below the menu.
fn default_position(area: (i32, i32, i32, i32), scale: f64) -> (i32, i32) {
    let (left, top, right) = (f64::from(area.0), f64::from(area.1), f64::from(area.2));
    let centre = (left + right) / 2.0;
    let beside = centre + (crate::overlay::MENU_WIDTH / 2.0 + MENU_GAP) * scale;
    if beside + (WIDTH + GAME_HUD_RIGHT) * scale <= right {
        return (beside.round() as i32, area.1);
    }
    (
        (centre - WIDTH * scale / 2.0).max(left).round() as i32,
        (top + BELOW_MENU * scale).round() as i32,
    )
}

fn emit(app: &AppHandle, items: &[Value]) {
    let _ = app.emit_to(LABEL, EVENT, json!(items));
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("alert-popup.json");
    let position = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| crate::window_positions::point(&v));
    app.manage(AlertWindowState(Mutex::new(Inner {
        position,
        path: Some(path),
        ..Default::default()
    })));
    Ok(())
}

/// Adds or updates newly fired deliveries (e.g. a test preview) in the popup. Expired,
/// non-popup and popup-dismissed entries are ignored. Creates the hidden window on first use.
pub fn present(app: &AppHandle, deliveries: &[Value]) {
    update(app, deliveries, false);
}

/// Makes the popup show exactly the engine's current `active` deliveries, so one dismissed
/// or snoozed from the workspace leaves the popup too. Expected every engine tick.
pub fn replace(app: &AppHandle, active: &[Value]) {
    update(app, active, true);
}

fn update(app: &AppHandle, deliveries: &[Value], replace: bool) {
    let Some(state) = app.try_state::<AlertWindowState>() else {
        return;
    };
    let (shown, create) = {
        let Ok(mut inner) = state.0.lock() else {
            return;
        };
        let mut all = deliveries.to_vec();
        if !replace {
            // Newer copies (status updates) win over cached ones.
            all.extend(inner.items.iter().cloned());
        }
        inner.items = admit(&all, &inner.dismissed, now_ms());
        let create =
            !inner.items.is_empty() && !inner.creating && app.get_webview_window(LABEL).is_none();
        if create {
            inner.creating = true;
        }
        (changed_presentation(&mut inner), create)
    };
    if create {
        let handle = app.clone();
        // Window creation waits on the event loop, so it never runs on the caller's thread.
        tauri::async_runtime::spawn(async move {
            if let Err(error) = create_window(&handle) {
                eprintln!("alert popup: {error}");
                companion_capture::diagnostics::record("error", "alert-popup", &error);
            }
            if let Some(state) = handle.try_state::<AlertWindowState>() {
                if let Ok(mut inner) = state.0.lock() {
                    inner.creating = false;
                }
            }
        });
    }
    if let Some(items) = shown {
        emit(app, &items);
    }
}

fn create_window(app: &AppHandle) -> Result<(), String> {
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?view=alert-popup".into()),
    )
    .title(crate::ui_preferences::title(app, "titleAlert"))
    .inner_size(WIDTH, height(1))
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
    crate::overlay::guard_activation(app, &window);
    let saved = app
        .state::<AlertWindowState>()
        .0
        .lock()
        .ok()
        .and_then(|inner| inner.position);
    // Beside the top menu over the game (or primary monitor), unless the user moved it before.
    let scale = window.scale_factor().unwrap_or(1.0);
    let default = crate::overlay::game_rect()
        .map(|area| {
            // The menu is laid out with the game monitor's scale; match it.
            let (left, top, right, bottom) = area;
            let scale = window
                .monitor_from_point(
                    (f64::from(left) + f64::from(right)) / 2.0,
                    (f64::from(top) + f64::from(bottom)) / 2.0,
                )
                .ok()
                .flatten()
                .map_or(scale, |m| m.scale_factor());
            (area, scale)
        })
        .or_else(|| {
            let m = window.primary_monitor().ok()??;
            let (p, s) = (m.position(), m.size());
            let area = (p.x, p.y, p.x + s.width as i32, p.y + s.height as i32);
            Some((area, m.scale_factor()))
        })
        .map(|(area, scale)| default_position(area, scale))
        .unwrap_or((0, 0));
    let size = (
        (WIDTH * scale).round() as i32,
        (height(1) * scale).round() as i32,
    );
    crate::window_positions::place(&window, saved, size, Some(default))?;
    crate::window_positions::watch(&window, save_drop)
}

/// The user dropped the popup somewhere.
fn save_drop(app: &AppHandle, _: &str, dropped: crate::window_positions::Dropped) {
    let Some(state) = app.try_state::<AlertWindowState>() else {
        return;
    };
    let path = state.0.lock().ok().and_then(|mut inner| {
        inner.position = Some((dropped.x, dropped.y));
        inner.path.clone()
    });
    if let Some(path) = path {
        crate::window_positions::save_file(app, path, &json!({"x":dropped.x,"y":dropped.y}));
    }
}

/// Focus heartbeat (main thread): shows the popup while it presents fresh deliveries (any
/// while the game context is active, only recovery ones (and Dev tests) outside it) and sizes
/// it to them.
pub fn sync(app: &AppHandle, active: bool) {
    let Some(state) = app.try_state::<AlertWindowState>() else {
        return;
    };
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let (shown, count, resize) = {
        let Ok(mut inner) = state.0.lock() else {
            return;
        };
        let now = now_ms();
        inner.items.retain(|item| fresh(item, now));
        inner.active = active;
        let shown = changed_presentation(&mut inner);
        let count = presented(&inner.items, active).len();
        let want = inner.ready && count > 0;
        let layout = Some((count.min(VISIBLE_CARDS), count > 1));
        let resize = want && inner.sized != layout;
        if resize {
            inner.sized = layout;
        }
        (shown, if want { count } else { 0 }, resize)
    };
    if let Some(items) = shown {
        emit(app, &items);
    }
    if resize {
        let _ = size_without_activation(&window, height(count));
    }
    let visible = window.is_visible().unwrap_or(false);
    if visible != (count > 0) {
        let _ = crate::overlay::set_visible_without_activation(&window, count > 0);
    }
}

#[cfg(windows)]
fn size_without_activation(
    window: &tauri::WebviewWindow,
    logical_height: f64,
) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let scale = window.scale_factor().map_err(|e| e.to_string())?;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            0,
            0,
            (WIDTH * scale).round() as i32,
            (logical_height * scale).round() as i32,
            SWP_NOACTIVATE | SWP_NOMOVE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        );
    }
    Ok(())
}
#[cfg(not(windows))]
fn size_without_activation(
    window: &tauri::WebviewWindow,
    logical_height: f64,
) -> Result<(), String> {
    window
        .set_size(tauri::LogicalSize::new(WIDTH, logical_height))
        .map_err(|e| e.to_string())
}

/// Popup webview mounted: returns the deliveries it should show now.
#[tauri::command]
pub fn alerts_popup_ready(app: AppHandle) -> Value {
    let state = app.state::<AlertWindowState>();
    let Ok(mut inner) = state.0.lock() else {
        return json!([]);
    };
    inner.ready = true;
    let now = now_ms();
    inner.items.retain(|item| fresh(item, now));
    let shown = presented(&inner.items, inner.active);
    inner.shown = ids(&shown);
    json!(shown)
}

/// Removes one delivery from the popup only (after an engine dismiss/snooze, or when
/// the engine no longer lists it). Engine state is changed through `alerts_action`.
#[tauri::command]
pub fn alerts_popup_dismiss(app: AppHandle, id: String) -> Result<(), String> {
    if id.is_empty() || id.len() > 256 {
        return Err("Invalid alert id".into());
    }
    let items = {
        let state = app.state::<AlertWindowState>();
        let mut inner = state.0.lock().map_err(|_| "Alert popup unavailable")?;
        inner
            .items
            .retain(|item| item["id"].as_str() != Some(id.as_str()));
        if !inner.dismissed.contains(&id) {
            inner.dismissed.push_back(id);
            if inner.dismissed.len() > DISMISSED_LIMIT {
                inner.dismissed.pop_front();
            }
        }
        let shown = presented(&inner.items, inner.active);
        inner.shown = ids(&shown);
        shown
    };
    emit(&app, &items);
    Ok(())
}

/// Closing the popup (it cannot be activated, but Alt+F4 is guarded anyway) clears it.
pub fn close_requested(app: &AppHandle) {
    if let Some(state) = app.try_state::<AlertWindowState>() {
        if let Ok(mut inner) = state.0.lock() {
            let ids: Vec<String> = inner
                .items
                .drain(..)
                .filter_map(|i| i["id"].as_str().map(str::to_string))
                .collect();
            for id in ids {
                inner.dismissed.push_back(id);
            }
            while inner.dismissed.len() > DISMISSED_LIMIT {
                inner.dismissed.pop_front();
            }
            inner.shown.clear();
        }
    }
    emit(app, &[]);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn delivery(id: &str, fired: u64, status: &str, popup: bool) -> Value {
        json!({"id":id,"fired_ms":fired,"status":status,"popup":popup})
    }
    #[test]
    fn admits_only_fresh_delivered_popups_once() {
        let now = 1_000_000;
        assert!(fresh(
            &delivery("edge", now - 9_999, "delivered", true),
            now
        ));
        assert!(!fresh(
            &delivery("edge", now - 10_000, "delivered", true),
            now
        ));
        let dismissed = VecDeque::from(vec!["gone".to_string()]);
        let items = admit(
            &[
                delivery("a", now - 1_000, "delivered", true),
                delivery("a", now - 1_000, "delivered", true),
                delivery("stale", now - TTL_MS - 1, "delivered", true),
                delivery("quiet", now, "quiet", true),
                delivery("silent", now, "delivered", false),
                delivery("gone", now, "delivered", true),
                delivery("b", now - 5_000, "delivered", true),
            ],
            &dismissed,
            now,
        );
        let ids: Vec<_> = items.iter().map(|i| i["id"].as_str().unwrap()).collect();
        assert_eq!(ids, ["b", "a"]);
    }
    #[test]
    fn outside_the_game_presents_recovery_and_dev_tests_only() {
        let now = 1_000_000;
        let mut recovery = delivery("maintenance-complete:1", now - 2_000, "delivered", true);
        recovery["phase"] = json!("recovery");
        let mut reminder = delivery("festival:1", now - 1_000, "delivered", true);
        reminder["phase"] = json!("before");
        let mut test = delivery("test:1", now, "delivered", true);
        test["phase"] = json!("test");
        let items = admit(&[recovery, reminder, test], &VecDeque::new(), now);
        let shown = |active| -> Vec<String> {
            presented(&items, active)
                .iter()
                .map(|i| i["id"].as_str().unwrap().to_string())
                .collect()
        };
        assert_eq!(
            shown(true),
            ["maintenance-complete:1", "festival:1", "test:1"]
        );
        // Development builds also show the explicit test preview outside the game.
        if crate::build_info::DEVELOPMENT {
            assert_eq!(shown(false), ["maintenance-complete:1", "test:1"]);
        } else {
            assert_eq!(shown(false), ["maintenance-complete:1"]);
        }
        let outside = |development| -> Vec<&str> {
            items
                .iter()
                .filter(|i| shown_outside_game(i, development))
                .map(|i| i["id"].as_str().unwrap())
                .collect()
        };
        assert_eq!(outside(false), ["maintenance-complete:1"]);
        assert_eq!(outside(true), ["maintenance-complete:1", "test:1"]);

        // Focus changes re-send the presented list once each way, never on a repeat.
        let mut inner = Inner {
            items: items.clone(),
            active: true,
            ..Default::default()
        };
        assert_eq!(changed_presentation(&mut inner).map(|v| v.len()), Some(3));
        assert!(changed_presentation(&mut inner).is_none());
        inner.active = false;
        let outside_count = if crate::build_info::DEVELOPMENT { 2 } else { 1 };
        assert_eq!(
            changed_presentation(&mut inner).map(|v| v.len()),
            Some(outside_count)
        );
        assert!(changed_presentation(&mut inner).is_none());
        // Once those cards expire or are dismissed, nothing is presented outside the game.
        inner.items.retain(|i| !outside_game(i));
        assert_eq!(changed_presentation(&mut inner), Some(Vec::new()));
    }
    #[test]
    fn bounds_to_the_newest_and_sizes_by_visible_cards() {
        let now = 1_000_000;
        let many: Vec<_> = (0..12)
            .map(|i| delivery(&format!("d{i}"), now - 12 + i, "delivered", true))
            .collect();
        let items = admit(&many, &VecDeque::new(), now);
        assert_eq!(items.len(), LIMIT);
        assert_eq!(items.last().unwrap()["id"], "d11");
        assert_eq!(height(1), 68.0);
        assert_eq!(height(5), height(3));
        assert_eq!(height(2), 130.0);
        assert_eq!(height(3), 192.0);
    }
    #[test]
    fn defaults_beside_the_top_menu_when_it_fits() {
        // The reported 1904×812 game: the 512 px menu spans 696..1208, the card lands in
        // the free band right of it (x 1224..1552, y 6..62), clear of the HUD from x 1595.
        let (x, y) = default_position((0, 0, 1904, 812), 1.0);
        assert_eq!((x, y), (1218, 0));
        assert_eq!(x + PAD as i32, 1224);
        assert!(x + WIDTH as i32 <= 1595);
        // Higher DPI scales the menu, gap and width with it.
        assert_eq!(default_position((0, 0, 3840, 2160), 1.5), (2319, 0));
        assert_eq!(default_position((0, 0, 2560, 1440), 1.25), (1613, 0));
        // Offset and negative origins (a monitor left of or above the primary).
        assert_eq!(
            default_position((-1904, -200, 0, 612), 1.0),
            (1218 - 1904, -200)
        );
    }
    #[test]
    fn falls_back_below_the_menu_when_the_band_is_too_narrow() {
        assert_eq!(default_position((0, 0, 1280, 720), 1.0), (470, 76));
        assert_eq!(default_position((0, 0, 2560, 1440), 1.5), (1025, 114));
        assert_eq!(default_position((-1280, 100, 0, 820), 1.0), (-810, 176));
        // Never left of the game, even when it is narrower than the popup.
        assert_eq!(default_position((50, 0, 250, 400), 1.0).0, 50);
    }
}
