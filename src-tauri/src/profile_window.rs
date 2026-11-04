//! The focus-gated character profile window. Native owns which character it shows: every
//! open from any window (meter, workspace, reports, damage details) replaces the selection
//! and bumps its revision, so the page always follows the latest request and can drop
//! answers for an earlier one. Geometry is saved when the user drops a move or resize. The
//! status also carries the saved characters (`profile_favorites.rs`), hidden with the names.
//! Unlike the other overlays, the profile is activated by a click like any dialog, and a
//! profile the user opens takes the foreground once, so the game lets go of the mouse; see
//! `profile_focus.rs`.
use crate::profile_focus::{Lease, Step};
use companion_capture::{diagnostics, LiveCapture};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex, time::Instant};
use tauri::{AppHandle, Manager, PhysicalSize, WebviewUrl, WebviewWindowBuilder};

pub const LABEL: &str = "character-profile";
const WIDTH: f64 = 760.;
const HEIGHT: f64 = 640.;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Selection {
    revision: u64,
    server_id: u16,
    name: String,
}

#[derive(Default)]
struct Inner {
    requested: bool,
    ready: bool,
    creating: bool,
    revision: u64,
    selection: Option<Selection>,
    /// The user's saved geometry: x, y, width, height.
    geometry: Option<[i64; 4]>,
    path: Option<PathBuf>,
    errors: Vec<String>,
    /// The hide-names setting as native last applied it; focus sync never shows a character
    /// while it is set, whether or not the page has polled since.
    names_hidden: bool,
    /// Bumped by every applied setting, so a status poll that read the setting earlier
    /// cannot overwrite a newer one.
    privacy_epoch: u64,
    /// The foreground the user's open lends the window (`profile_focus`).
    lease: Lease,
}
impl Inner {
    /// A new character to show; any open replaces the previous one.
    fn select(&mut self, server_id: u16, name: String) -> u64 {
        self.revision += 1;
        self.requested = true;
        self.selection = Some(Selection {
            revision: self.revision,
            server_id,
            name,
        });
        self.revision
    }
    /// Hidden names: nothing that names a character may stay shown or selected.
    fn suppress(&mut self) {
        if self.requested || self.selection.is_some() {
            self.revision += 1;
        }
        self.requested = false;
        self.selection = None;
        self.lease.forget();
    }
    /// A committed hide-names setting, applied at once.
    fn apply_names_hidden(&mut self, hidden: bool) {
        self.privacy_epoch += 1;
        self.names_hidden = hidden;
        if hidden {
            self.suppress();
        }
    }
    /// A setting read by a poll that started at `epoch`; an apply since then wins. Answers
    /// whether names are hidden now.
    fn observe_names_hidden(&mut self, epoch: u64, hidden: bool) -> bool {
        if self.privacy_epoch == epoch {
            self.names_hidden = hidden;
        }
        if self.names_hidden {
            self.suppress();
        }
        self.names_hidden
    }
    /// Whether focus sync should show the window.
    fn shown(&self, active: bool) -> bool {
        self.requested && !self.names_hidden && active
    }
}

#[derive(Default)]
pub struct ProfileWindow(Mutex<Inner>);

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Inner) -> T) -> Result<T, String> {
    let state = app.state::<ProfileWindow>();
    let mut inner = state
        .0
        .lock()
        .map_err(|_| "Profile window state unavailable")?;
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
        && (360..=16384).contains(&g[2])
        && (300..=16384).contains(&g[3]))
    .then_some(g)
}

fn error(app: &AppHandle, e: String) {
    let _ = with(app, |s| {
        if s.errors.len() < 8 && !s.errors.contains(&e) {
            s.errors.push(e)
        }
    });
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    app.manage(ProfileWindow::default());
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("profile-window.json");
    let saved = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| geometry(&v));
    let hidden = hide_names(app);
    with(app, |s| {
        s.geometry = saved;
        s.path = Some(path);
        s.apply_names_hidden(hidden);
    })
}

/// Applies a committed settings change (`offline_configure`) at once, from the settings it
/// saved, so no poll or focus change can reshow a character after names are hidden.
pub fn settings_applied(app: &AppHandle, settings: &Value) {
    let hidden = settings["hide_names"].as_bool().unwrap_or(false);
    if with(app, |s| s.apply_names_hidden(hidden)).is_ok() && hidden {
        let _ = schedule(app);
    }
}

fn schedule(app: &AppHandle) -> Result<(), String> {
    let handle = app.clone();
    app.run_on_main_thread(move || sync(&handle, crate::overlay::game_active(&handle)))
        .map_err(|e| e.to_string())
}

fn create(app: &AppHandle) -> Result<(), String> {
    let saved = with(app, |s| s.geometry)?;
    if app.get_webview_window(LABEL).is_some() {
        return Ok(());
    }
    let window = WebviewWindowBuilder::new(
        app,
        LABEL,
        WebviewUrl::App("index.html?view=profile".into()),
    )
    .title(crate::ui_preferences::title(app, "titleProfile"))
    .inner_size(WIDTH, HEIGHT)
    .min_inner_size(400., 340.)
    .resizable(true)
    .maximizable(false)
    .minimizable(false)
    .decorations(false)
    .transparent(true)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(false)
    // Activated by the user's clicks (`no_activate::Activation::OnClick`); shows by the
    // focus gate still never activate it.
    .focusable(true)
    .visible(false)
    .build()
    .map_err(|e| e.to_string())?;
    crate::overlay::guard_activation(app, &window);
    if let Some(g) = saved {
        window
            .set_size(PhysicalSize::new(g[2] as u32, g[3] as u32))
            .map_err(|e| e.to_string())?;
    }
    // First time: left of the DPS meter like damage details, inside the game's bounds.
    let default = crate::overlay::game_rect().map(|(left, top, right, bottom)| {
        let scale = window.scale_factor().unwrap_or(1.);
        let x = (f64::from(left) + 96. * scale)
            .min(f64::from(right) - WIDTH * scale)
            .max(f64::from(left));
        let y = (f64::from(top) + 96. * scale)
            .min(f64::from(bottom) - HEIGHT * scale)
            .max(f64::from(top));
        (x as i32, y as i32)
    });
    let size = saved.map_or_else(
        || crate::window_positions::size_of(&window),
        |g| (g[2] as i32, g[3] as i32),
    );
    let wanted = saved.map(|g| (g[0] as i32, g[1] as i32));
    crate::window_positions::place(&window, wanted, size, default)?;
    if let Err(e) = crate::window_positions::watch(&window, save_drop) {
        error(app, e);
    }
    Ok(())
}

fn save_drop(app: &AppHandle, label: &str, d: crate::window_positions::Dropped) {
    if label != LABEL {
        return;
    }
    let value = json!({"x":d.x,"y":d.y,"width":d.width,"height":d.height});
    let Some(g) = geometry(&value) else {
        return;
    };
    if let Ok(Some(path)) = with(app, |s| {
        s.geometry = Some(g);
        s.path.clone()
    }) {
        crate::window_positions::save_file(app, path, &value);
    }
}

/// Shown only while requested and AION (or one of our overlays over it) is focused. Runs
/// on the main thread (every focus tick and after each request), which also runs the
/// window's foreground lease: a Close gives the game its foreground back before the
/// window hides, and an open's one request is made when its window is first shown.
pub fn sync(app: &AppHandle, active: bool) {
    let Ok(want) = with(app, |s| s.shown(active)) else {
        return;
    };
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let visible = window.is_visible().unwrap_or(false);
    if visible && !want {
        give_back(app, &window);
    }
    if visible != want {
        if let Err(e) = crate::overlay::set_visible_without_activation(&window, want) {
            error(app, e);
        }
    }
    let shown = want && window.is_visible().unwrap_or(false);
    let ours = foreground_is(&window);
    let game = game_foreground(app);
    let Ok(step) = with(app, |s| {
        let revision = s.selection.as_ref().filter(|_| shown).map(|c| c.revision);
        s.lease.next(revision, ours, game, Instant::now())
    }) else {
        return;
    };
    run(app, &window, step);
}

fn log(level: &str, message: &str) {
    diagnostics::record(level, "profile-window", message);
}

#[cfg(windows)]
fn foreground_is(window: &tauri::WebviewWindow) -> bool {
    window
        .hwnd()
        .is_ok_and(|h| crate::profile_focus::native::foreground() == h.0 as isize)
}
#[cfg(not(windows))]
fn foreground_is(window: &tauri::WebviewWindow) -> bool {
    window.is_focused().unwrap_or(false)
}

/// The foreground window when the focus tick found it to be AION's.
#[cfg(windows)]
fn game_foreground(app: &AppHandle) -> Option<isize> {
    crate::overlay::game_focused(app).then(crate::profile_focus::native::foreground)
}
#[cfg(not(windows))]
fn game_foreground(_: &AppHandle) -> Option<isize> {
    None
}

/// Runs one lease step with no lock held (taking the foreground sends this thread's
/// windows messages).
#[cfg(windows)]
fn run(app: &AppHandle, window: &tauri::WebviewWindow, step: Step) {
    use crate::profile_focus::native;
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let profile = hwnd.0 as isize;
    match step {
        Step::Nothing => {}
        Step::Grant(revision) => {
            let before = native::foreground();
            let restore =
                native::is_game_window(before, &crate::focus::game_process_ids()).then_some(before);
            let ok = native::take(profile);
            let _ = with(app, |s| s.lease.granted(revision, ok, restore));
            log(
                if ok { "info" } else { "warn" },
                &format!(
                    "Foreground for opened profile {revision}: {} (taken from AION: {})",
                    if ok { "granted" } else { "denied by Windows" },
                    restore.is_some()
                ),
            );
        }
        Step::Clicked(revision) => log(
            "info",
            &format!(
                "Profile {revision} activated by a click (AION to return to: {})",
                with(app, |s| s.lease.restores()).unwrap_or(false)
            ),
        ),
        Step::ReleaseClip => {
            // Only while the profile still holds the foreground, and only a confinement
            // that outlived the game's own release.
            if native::foreground() == profile && native::cursor_confined() {
                let released = native::release_cursor();
                let _ = with(app, |s| s.lease.cursor_released = released);
                log(
                    "info",
                    &format!(
                        "Cursor confinement left after the profile's grant released: {released}"
                    ),
                );
            }
        }
    }
}
#[cfg(not(windows))]
fn run(_: &AppHandle, _: &tauri::WebviewWindow, _: Step) {}

/// A Close while the profile still holds the foreground hands it back to the AION window
/// it was taken from, before the window hides.
fn give_back(app: &AppHandle, window: &tauri::WebviewWindow) {
    let ours = foreground_is(window);
    let Ok(Some(game)) = with(app, |s| s.lease.close(ours)) else {
        return;
    };
    #[cfg(windows)]
    {
        use crate::profile_focus::native;
        let ok =
            native::is_game_window(game, &crate::focus::game_process_ids()) && native::take(game);
        log(
            if ok { "info" } else { "warn" },
            &format!("Foreground returned to AION on Close: {ok}"),
        );
    }
    #[cfg(not(windows))]
    let _ = game;
}

pub(crate) fn hide_names(app: &AppHandle) -> bool {
    app.state::<LiveCapture>()
        .offline_settings()
        .map(|s| s["hide_names"].as_bool().unwrap_or(false))
        .unwrap_or(false)
}

/// The setting as capture state holds it, read after noting the apply epoch it is checked
/// against (see `Inner::observe_names_hidden`).
fn read_names_hidden(app: &AppHandle) -> Result<(u64, bool), String> {
    let epoch = with(app, |s| s.privacy_epoch)?;
    Ok((epoch, hide_names(app)))
}

fn status(app: &AppHandle, read: (u64, bool)) -> Result<Value, String> {
    let hidden_names = with(app, |s| s.observe_names_hidden(read.0, read.1))?;
    let visible = app
        .get_webview_window(LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let favorites = crate::profile_favorites::listed(app, hidden_names);
    with(app, |s| {
        let selection = s.selection.as_ref().map_or(
            Value::Null,
            |c| json!({"revision":c.revision,"server_id":c.server_id,"name":c.name}),
        );
        json!({"requested":s.requested,"visible":visible,"ready":s.ready,"game_active":crate::overlay::game_active(app),"hide_names":hidden_names,"selection":selection,"favorites":favorites,"favorites_max":crate::profile_favorites::MAX,"errors":s.errors,"focus":{"state":s.lease.state().word(),"revision":s.lease.revision(),"cursor_released":s.lease.cursor_released}})
    })
}

/// Reading the privacy setting waits on capture state, so it runs off the UI thread.
async fn checked_status(app: AppHandle) -> Result<Value, String> {
    crate::background::run(move || {
        let result = status(&app, read_names_hidden(&app)?);
        if result.as_ref().is_ok_and(|s| s["hide_names"] == true) {
            schedule(&app)?;
        }
        result
    })
    .await
}

#[tauri::command]
pub async fn profile_window_status(app: AppHandle) -> Result<Value, String> {
    checked_status(app).await
}

#[tauri::command]
pub fn profile_window_ready(app: AppHandle) -> Result<(), String> {
    with(&app, |s| s.ready = true)
}

/// Opens (or retargets) the profile window on one observed character.
#[tauri::command]
pub async fn profile_window_open(
    app: AppHandle,
    server_id: u16,
    name: String,
) -> Result<Value, String> {
    if crate::profile_identity::region(server_id).is_none()
        || !crate::profile_identity::valid_name(&name)
    {
        return Err("This character has no official profile to show.".into());
    }
    let handle = app.clone();
    let read = crate::background::run(move || read_names_hidden(&handle)).await?;
    let (create_now, revision) = with(&app, |s| {
        if s.observe_names_hidden(read.0, read.1) {
            return Err("Character names are hidden, so profiles are too.".to_string());
        }
        let revision = s.select(server_id, name);
        // The user's click on a profile mark: this open may take the foreground once.
        s.lease.request(revision, Instant::now());
        let create = !s.creating && app.get_webview_window(LABEL).is_none();
        if create {
            s.creating = true;
        }
        Ok((create, revision))
    })??;
    if create_now {
        let result = create(&app);
        with(&app, |s| {
            s.creating = false;
            if result.is_err() && s.revision == revision {
                s.requested = false;
            }
        })?;
        result?;
    }
    schedule(&app)?;
    checked_status(app).await
}

/// The page's "Use this window" button, after Windows refused the open's request: the
/// click on it lets this process ask for the foreground again, once.
#[tauri::command]
pub async fn profile_window_focus(app: AppHandle) -> Result<Value, String> {
    let handle = app.clone();
    let (sender, answer) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        if let Some(window) = handle.get_webview_window(LABEL) {
            if window.is_visible().unwrap_or(false) {
                if let Ok(Some(step)) = with(&handle, |s| {
                    s.selection
                        .as_ref()
                        .map(|c| c.revision)
                        .map(|revision| s.lease.ask_again(revision))
                }) {
                    run(&handle, &window, step);
                }
            }
        }
        let _ = sender.send(());
    })
    .map_err(|e| e.to_string())?;
    // The status then reports this request's answer.
    crate::background::run(move || {
        let _ = answer.recv_timeout(std::time::Duration::from_secs(2));
        Ok(())
    })
    .await?;
    checked_status(app).await
}

/// Saves or removes one character from the saved list; answers with the window status, which
/// carries the list. Refused while names are hidden.
#[tauri::command]
pub async fn profile_favorite_set(
    app: AppHandle,
    server_id: u16,
    name: String,
    saved: bool,
) -> Result<Value, String> {
    let handle = app.clone();
    crate::background::run(move || {
        if hide_names(&handle) {
            return Err("Character names are hidden, so saved characters are too.".into());
        }
        crate::profile_favorites::set(&handle, server_id, &name, saved).map(|_| ())
    })
    .await?;
    checked_status(app).await
}

#[tauri::command]
pub async fn profile_window_hide(app: AppHandle) -> Result<Value, String> {
    with(&app, |s| s.requested = false)?;
    schedule(&app)?;
    checked_status(app).await
}

pub fn close_requested(app: &AppHandle, label: &str) -> bool {
    if label != LABEL {
        return false;
    }
    if with(app, |s| s.requested = false).is_ok() {
        let _ = schedule(app);
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_open_replaces_the_selection_with_a_newer_revision() {
        let mut state = Inner::default();
        let first = state.select(2403, "foxyyyynm".into());
        let second = state.select(1304, "Aahz".into());
        assert!(second > first);
        let shown = state.selection.clone().unwrap();
        assert_eq!(
            (shown.revision, shown.server_id, shown.name.as_str()),
            (second, 1304, "Aahz")
        );
        assert!(state.requested);
        // Reopening the same character is still a new request (a refresh of what it shows).
        assert!(state.select(1304, "Aahz".into()) > second);
    }

    #[test]
    fn hidden_names_close_the_window_and_forget_the_character() {
        let mut state = Inner::default();
        let opened = state.select(2403, "foxyyyynm".into());
        state.suppress();
        assert!(!state.requested);
        assert!(state.selection.is_none());
        assert!(state.revision > opened);
        let quiet = state.revision;
        state.suppress();
        assert_eq!(state.revision, quiet);
    }

    #[test]
    fn hiding_names_takes_effect_before_any_poll_and_survives_refocus() {
        let mut state = Inner::default();
        state.select(2403, "foxyyyynm".into());
        assert!(state.shown(true));
        // A status poll reads the setting (still off) just before the workspace hides names.
        let stale = state.privacy_epoch;
        state.apply_names_hidden(true);
        assert!(
            !state.shown(true),
            "refocusing the game must not reshow the character"
        );
        assert!(state.selection.is_none() && !state.requested);
        // The poll that read the old setting lands afterwards: it cannot unhide anything.
        assert!(state.observe_names_hidden(stale, false));
        assert!(!state.shown(true));
        // Turning names back on again allows a new open; a fresh poll agrees with it.
        state.apply_names_hidden(false);
        let epoch = state.privacy_epoch;
        assert!(!state.observe_names_hidden(epoch, false));
        state.select(2403, "foxyyyynm".into());
        assert!(state.shown(true) && !state.shown(false));
    }

    #[test]
    fn a_poll_reports_a_setting_changed_outside_the_settings_path() {
        let mut state = Inner::default();
        state.apply_names_hidden(false);
        state.select(1304, "Aahz".into());
        let epoch = state.privacy_epoch;
        assert!(state.observe_names_hidden(epoch, true));
        assert!(state.selection.is_none() && !state.shown(true));
    }

    #[test]
    fn hiding_names_drops_the_open_foreground_request() {
        use crate::profile_focus::State;
        let mut state = Inner::default();
        let now = Instant::now();
        let revision = state.select(2403, "foxyyyynm".into());
        state.lease.request(revision, now);
        state.apply_names_hidden(true);
        assert_eq!(state.lease.state(), State::Idle);
        // Nothing is shown or asked for, and a Close afterwards restores nothing.
        assert_eq!(
            state.lease.next(Some(revision), false, Some(0x100), now),
            Step::Nothing
        );
        assert_eq!(state.lease.close(true), None);
    }

    #[test]
    fn saved_geometry_must_be_a_usable_window() {
        assert!(geometry(&json!({"x":0,"y":0,"width":200,"height":600})).is_none());
        assert!(geometry(&json!({"x":0,"y":0,"width":760,"height":640})).is_some());
        assert!(geometry(&json!({"x":0,"y":0,"width":760})).is_none());
    }
}
