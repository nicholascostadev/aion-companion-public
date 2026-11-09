//! In-game pet radar: a borderless, transparent, resizable window over the game. Like every
//! overlay it is only visible while AION (or one of our overlays over it) is focused, and
//! closing it only hides it. It starts unlocked: the whole panel drags and resizes. Locked,
//! it is click-through except the controls the webview reports as hit regions (pins, lock,
//! hide), which take clicks without taking focus from the game. The lock choice is saved
//! (`overlay_locks`); position and size are saved when the user drops a move or resize
//! (`window_positions`). The lifecycle itself is the shared one (`game_window`); this module
//! keeps the radar's settings, commands and payloads.
use crate::game_window::{
    Area, AtCreate, Drops, Failure, Geometry, Lock, Pause, Request, Spec, Surface,
};
use crate::game_window_host::TauriHost;
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Manager};

pub const LABEL: &str = "pet-radar";
const WIDTH: f64 = 340.0;
/// Compact: a few dense rows over the map.
const HEIGHT: f64 = 300.0;
/// Default height of earlier builds; a saved size still exactly at it was never resized.
const OLD_HEIGHT: f64 = 440.0;
const MIN_WIDTH: f64 = 260.0;
const MIN_HEIGHT: f64 = 180.0;

const SPEC: Spec = Spec {
    label: LABEL,
    view: "pet-radar",
    title: "titlePets",
    size: (WIDTH, HEIGHT),
    min_size: (MIN_WIDTH, MIN_HEIGHT),
    focusable: false,
    min_saved: (100, 100),
    // Any drop with a size is the user's, even one smaller than a restored size.
    drops: Drops::Sized,
    migrate: Some(migrate_default),
    default_spot,
    monitor_fallback: true,
    // Requested once the window exists.
    request: Request::AfterCreate,
    hide_clears_regions: false,
    lock: Some(Lock {
        name: "pet radar",
        at_create: AtCreate::WhenLocked,
        // Stop region toggling before tao restores normal input.
        pause: Pause::Unlocking,
        clears_regions: false,
        failure: Failure::Opposite,
    }),
    unavailable: "Pet radar state unavailable",
};

pub struct PetWindowState(Surface);

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

/// Right side of the game, below the DPS meter's default place.
fn default_spot((left, top, right, bottom): Area, scale: f64) -> (i32, i32) {
    let x = (f64::from(right) - (WIDTH + 24.0) * scale).max(f64::from(left));
    let y = (f64::from(top) + 500.0 * scale)
        .min((f64::from(bottom) - (HEIGHT + 24.0) * scale).max(f64::from(top)));
    (x as i32, y as i32)
}

/// Registers the window state and the saved geometry. Call once from app setup.
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let radar = crate::game_window_host::load(app, SPEC, "pet-radar-window.json", ())?;
    app.manage(PetWindowState(radar));
    Ok(())
}

/// The radar's lifecycle; unavailable until `setup` has run (the focus worker starts first).
fn radar(app: &AppHandle) -> Result<tauri::State<'_, PetWindowState>, String> {
    app.try_state::<PetWindowState>()
        .ok_or_else(|| "Pet radar is unavailable".to_string())
}

fn host(app: &AppHandle) -> TauriHost<'_> {
    TauriHost::new(app, sync, save_drop)
}

/// The user dropped a move or resize.
fn save_drop(app: &AppHandle, _: &str, dropped: crate::window_positions::Dropped) {
    if let Ok(radar) = radar(app) {
        let at = Geometry {
            x: dropped.x,
            y: dropped.y,
            width: dropped.width,
            height: dropped.height,
        };
        radar.0.dropped(&host(app), at);
    }
}

/// Focus heartbeat (main thread, every foreground check): shows the radar only while it is
/// requested and the game context is active.
pub fn sync(app: &AppHandle, active: bool) {
    if let Ok(radar) = radar(app) {
        radar.0.sync(&host(app), active);
    }
}

/// Lets the locked radar take input only while the cursor is over a reported control; the
/// rest stays click-through, so clicks reach the game. Same approach as the locked DPS meter
/// (`game_window_host::pass_through`), so a pin click never takes focus from the game.
pub fn sync_input(app: &AppHandle) {
    if let Ok(radar) = radar(app) {
        radar.0.sync_input(&host(app), Instant::now());
    }
}

#[tauri::command]
pub fn pets_overlay_status(app: AppHandle) -> Value {
    let window = app.get_webview_window(LABEL);
    let visible = window
        .as_ref()
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let active = host(&app).game_active();
    radar(&app)
        .and_then(|radar| {
            radar.0.with(|life, _| {
                json!({
                    "requested": life.requested(),
                    "visible": visible,
                    "ready": life.ready(),
                    "locked": life.locked(),
                    "game_active": active,
                    "regions": life.regions(),
                    "errors": life.errors(),
                })
            })
        })
        .unwrap_or_else(|error| {
            json!({"requested":false,"visible":visible,"ready":false,"locked":false,"game_active":active,"errors":[error]})
        })
}

#[tauri::command]
pub fn pets_overlay_ready(app: AppHandle) {
    if let Ok(radar) = radar(&app) {
        let _ = radar.0.ready();
    }
}

/// Requests the radar; it appears once AION (or an overlay over it) is focused.
#[tauri::command]
pub async fn pets_overlay_show(app: AppHandle) -> Result<Value, String> {
    // Window creation waits on the event loop, so only one caller creates it.
    radar(&app)?.0.show(&host(&app))?;
    Ok(pets_overlay_status(app))
}

#[tauri::command]
pub fn pets_overlay_hide(app: AppHandle) -> Result<Value, String> {
    radar(&app)?.0.hide(&host(&app))?;
    Ok(pets_overlay_status(app))
}

/// Locked: click-through except the reported controls. Unlocked: drags and resizes.
#[tauri::command]
pub fn pets_overlay_lock(app: AppHandle, locked: bool) -> Result<Value, String> {
    radar(&app)?.0.lock(&host(&app), locked)?;
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
    radar(&app)?.0.set_regions(&regions, scale, Instant::now())
}

/// Closing the radar (its button, Escape or Alt+F4) only hides it.
pub fn close_requested(app: &AppHandle) {
    if let Ok(radar) = radar(app) {
        if let Err(error) = radar.0.close(&host(app)) {
            radar.0.note(error);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn saved_geometry_accepts_only_sane_bounds() {
        assert_eq!(
            SPEC.saved(&json!({"x":-1200,"y":40,"width":340,"height":440})),
            Some(Geometry {
                x: -1200,
                y: 40,
                width: 340,
                height: 440
            })
        );
        // Smaller than the window's minimum is still the user's; below 100 px is not.
        assert!(SPEC
            .saved(&json!({"x":0,"y":0,"width":100,"height":100}))
            .is_some());
        assert_eq!(
            SPEC.saved(&json!({"x":0,"y":0,"width":20,"height":440})),
            None
        );
        assert_eq!(SPEC.saved(&json!({"x":0,"y":0,"width":340})), None);
        assert_eq!(
            SPEC.saved(&json!({"x":0,"y":0,"width":340,"height":99999})),
            None
        );
        assert_eq!(
            SPEC.saved(&json!({"x":"0","y":0,"width":340,"height":440})),
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
    fn the_first_spot_is_right_of_the_game_below_the_meter() {
        assert_eq!(default_spot((0, 0, 1920, 1080), 1.0), (1556, 500));
        assert_eq!(default_spot((100, 50, 2660, 1490), 1.5), (2114, 800));
        // A game too small for the offsets: never left of or above it.
        assert_eq!(default_spot((0, 0, 300, 400), 1.0), (0, 76));
        assert_eq!(default_spot((0, 0, 300, 200), 1.0), (0, 0));
    }
}
