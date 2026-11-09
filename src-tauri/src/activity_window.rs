//! Focus-gated Timers and Explore windows. Each keeps its
//! geometry in its own file, saved when the user drops a move or resize (`window_positions`).
//! Both run the shared lifecycle (`game_window`); this module keeps what tells them apart
//! and their commands and payloads.
use crate::game_window::{
    Area, AtCreate, Drops, Failure, Geometry, Lock, Pause, Request, Spec, Surface,
};
use crate::game_window_host::TauriHost;
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Manager};
pub const TIMERS: &str = "timers-overlay";
pub const EXPLORE: &str = "explore-overlay";
const WIDTH: f64 = 340.;
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
    /// How far right of the game's left edge the window first opens.
    fn offset(self) -> f64 {
        match self {
            Self::Timers => 24.,
            Self::Explore => 736.,
        }
    }
    fn startup_arg(self, arg: &str) -> bool {
        match self {
            Self::Timers => arg == "--timers",
            Self::Explore => matches!(arg, "--explore" | "--maps" | "--cubes" | "--gathering"),
        }
    }
    /// The first-time spot: along the top of the game, inside its bounds.
    fn default_spot(self, (left, top, right, bottom): Area, scale: f64) -> (i32, i32) {
        let x = (f64::from(left) + self.offset() * scale)
            .min(f64::from(right) - WIDTH * scale)
            .max(f64::from(left));
        let y = (f64::from(top) + 110. * scale)
            .min(f64::from(bottom) - self.height() * scale)
            .max(f64::from(top));
        (x as i32, y as i32)
    }
    fn spec(self) -> Spec {
        Spec {
            label: self.label(),
            view: self.view(),
            title: self.title_key(),
            size: (WIDTH, self.height()),
            min_size: (260., 160.),
            focusable: false,
            min_saved: (260, 160),
            drops: Drops::Restorable,
            migrate: None,
            default_spot: match self {
                Self::Timers => timers_spot,
                Self::Explore => explore_spot,
            },
            monitor_fallback: false,
            request: Request::BeforeCreate,
            hide_clears_regions: true,
            lock: Some(Lock {
                name: self.view(),
                at_create: AtCreate::Always,
                pause: Pause::Always,
                clears_regions: true,
                failure: Failure::Restore,
            }),
            unavailable: "Activity window state unavailable",
        }
    }
    fn file(self) -> String {
        format!("{}-window.json", self.view())
    }
}
fn timers_spot(area: Area, scale: f64) -> (i32, i32) {
    Kind::Timers.default_spot(area, scale)
}
fn explore_spot(area: Area, scale: f64) -> (i32, i32) {
    Kind::Explore.default_spot(area, scale)
}
struct Windows {
    timers: Surface,
    explore: Surface,
}
impl Windows {
    fn of(&self, kind: Kind) -> &Surface {
        match kind {
            Kind::Timers => &self.timers,
            Kind::Explore => &self.explore,
        }
    }
}
fn windows(app: &AppHandle) -> Result<tauri::State<'_, Windows>, String> {
    app.try_state::<Windows>()
        .ok_or_else(|| "Activity window state unavailable".to_string())
}
fn host(app: &AppHandle) -> TauriHost<'_> {
    TauriHost::new(app, sync, save_drop)
}
fn error(app: &AppHandle, kind: Kind, e: String) {
    if let Ok(windows) = windows(app) {
        windows.of(kind).note(e);
    }
}
pub fn setup(app: &AppHandle) -> Result<(), String> {
    let load = |kind: Kind| crate::game_window_host::load(app, kind.spec(), &kind.file(), ());
    let windows = Windows {
        timers: load(Kind::Timers)?,
        explore: load(Kind::Explore)?,
    };
    app.manage(windows);
    Ok(())
}
/// The user dropped a move or resize of an activity window.
fn save_drop(app: &AppHandle, label: &str, d: crate::window_positions::Dropped) {
    let Some(kind) = Kind::from_label(label) else {
        return;
    };
    if let Ok(windows) = windows(app) {
        let at = Geometry {
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
        };
        windows.of(kind).dropped(&host(app), at);
    }
}
pub fn sync(app: &AppHandle, active: bool) {
    let Ok(windows) = windows(app) else {
        return;
    };
    for kind in [Kind::Timers, Kind::Explore] {
        windows.of(kind).sync(&host(app), active);
    }
}
pub fn sync_input(app: &AppHandle) {
    let Ok(windows) = windows(app) else {
        return;
    };
    for kind in [Kind::Timers, Kind::Explore] {
        windows.of(kind).sync_input(&host(app), Instant::now());
    }
}
fn status(app: &AppHandle, kind: Kind) -> Result<Value, String> {
    let visible = app
        .get_webview_window(kind.label())
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let active = host(app).game_active();
    windows(app)?.of(kind).with(
        |s, _| json!({"requested":s.requested(),"visible":visible,"ready":s.ready(),"locked":s.locked(),"game_active":active,"errors":s.errors()}),
    )
}
#[tauri::command]
pub fn activity_window_status(app: AppHandle, kind: String) -> Result<Value, String> {
    status(&app, Kind::parse(&kind)?)
}
#[tauri::command]
pub fn activity_window_ready(app: AppHandle, kind: String) -> Result<(), String> {
    windows(&app)?.of(Kind::parse(&kind)?).ready()
}
#[tauri::command]
pub async fn activity_window_show(app: AppHandle, kind: String) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    windows(&app)?.of(kind).show(&host(&app))?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_hide(app: AppHandle, kind: String) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    windows(&app)?.of(kind).hide(&host(&app))?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_lock(app: AppHandle, kind: String, locked: bool) -> Result<Value, String> {
    let kind = Kind::parse(&kind)?;
    windows(&app)?.of(kind).lock(&host(&app), locked)?;
    status(&app, kind)
}
#[tauri::command]
pub fn activity_window_hit_regions(
    app: AppHandle,
    kind: String,
    regions: Vec<[f64; 4]>,
    scale: f64,
) -> Result<usize, String> {
    windows(&app)?
        .of(Kind::parse(&kind)?)
        .set_regions(&regions, scale, Instant::now())
}
pub fn close_requested(app: &AppHandle, label: &str) -> bool {
    let Some(kind) = Kind::from_label(label) else {
        return false;
    };
    if let Ok(windows) = windows(app) {
        let _ = windows.of(kind).close(&host(app));
    }
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
    fn finder_names_share_one_window() {
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
    }
    #[test]
    fn each_window_keeps_its_own_page_file_and_size() {
        let (timers, explore) = (Kind::Timers.spec(), Kind::Explore.spec());
        assert_eq!(
            (timers.label, timers.view, timers.title),
            (TIMERS, "timers", "titleTimers")
        );
        assert_eq!(
            (explore.label, explore.view, explore.title),
            (EXPLORE, "explore", "titleExplore")
        );
        assert_eq!((timers.size, explore.size), ((340., 360.), (340., 400.)));
        assert_eq!(Kind::Timers.file(), "timers-window.json");
        assert_eq!(Kind::Explore.file(), "explore-window.json");
        assert_eq!(
            timers
                .lock
                .map(|l| l.name)
                .zip(explore.lock.map(|l| l.name)),
            Some(("timers", "explore"))
        );
    }
    #[test]
    fn invalid_geometry_is_ignored() {
        for spec in [Kind::Timers.spec(), Kind::Explore.spec()] {
            assert!(spec
                .saved(&json!({"x":0,"y":0,"width":20,"height":600}))
                .is_none());
            assert!(spec
                .saved(&json!({"x":0,"y":0,"width":340,"height":600}))
                .is_some());
            assert!(spec
                .saved(&json!({"x":0,"y":0,"width":260,"height":160}))
                .is_some());
            assert!(spec
                .saved(&json!({"x":0,"y":0,"width":260,"height":159}))
                .is_none());
        }
    }
    #[test]
    fn the_windows_first_open_along_the_top_of_the_game() {
        let game = (0, 0, 1920, 1080);
        assert_eq!(
            (timers_spot(game, 1.0), explore_spot(game, 1.0)),
            ((24, 110), (736, 110))
        );
        assert_eq!(timers_spot((100, 50, 2660, 1490), 1.5), (136, 215));
        // A narrow or short game keeps them inside it, never left of or above it.
        assert_eq!(explore_spot((0, 0, 800, 450), 1.0), (460, 50));
        assert_eq!(explore_spot((0, 0, 300, 300), 1.0), (0, 0));
    }
}
