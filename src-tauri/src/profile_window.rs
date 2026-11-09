//! The focus-gated character profile window. Native owns which character it shows: every
//! open from any window (meter, workspace, reports, damage details) replaces the selection
//! and bumps its revision, so the page always follows the latest request and can drop
//! answers for an earlier one. Geometry is saved when the user drops a move or resize. The
//! status also carries the saved characters (`profile_favorites.rs`), hidden with the names.
//! Unlike the other overlays, the profile is activated by a click like any dialog, and a
//! profile the user opens takes the foreground once, so the game lets go of the mouse; see
//! `profile_focus.rs`.
use crate::game_window::{Area, Drops, Geometry, Life, Policy, Request, Spec, Surface};
use crate::game_window_host::TauriHost;
use crate::profile_focus::{Lease, Step};
use companion_capture::{diagnostics, LiveCapture};
use serde_json::{json, Value};
use std::time::Instant;
use tauri::{AppHandle, Manager};

pub const LABEL: &str = "character-profile";
const WIDTH: f64 = 760.;
const HEIGHT: f64 = 640.;

/// The shared lifecycle (`game_window`) as the profile uses it: no lock, and a click may
/// activate it (`no_activate::Activation::OnClick`); shows by the focus gate still never do.
const SPEC: Spec = Spec {
    label: LABEL,
    view: "profile",
    title: "titleProfile",
    size: (WIDTH, HEIGHT),
    min_size: (400., 340.),
    focusable: true,
    min_saved: (360, 300),
    drops: Drops::Restorable,
    migrate: None,
    default_spot,
    monitor_fallback: false,
    request: Request::BeforeCreate,
    hide_clears_regions: false,
    lock: None,
    unavailable: "Profile window state unavailable",
};

/// First time: left of the DPS meter like damage details, inside the game's bounds.
fn default_spot((left, top, right, bottom): Area, scale: f64) -> (i32, i32) {
    let x = (f64::from(left) + 96. * scale)
        .min(f64::from(right) - WIDTH * scale)
        .max(f64::from(left));
    let y = (f64::from(top) + 96. * scale)
        .min(f64::from(bottom) - HEIGHT * scale)
        .max(f64::from(top));
    (x as i32, y as i32)
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Selection {
    revision: u64,
    server_id: u16,
    name: String,
}

/// The profile's own rules, kept under the same lock as its lifecycle (`Life`): which
/// character it shows, the hide-names setting and the foreground lease.
#[derive(Default)]
struct Profile {
    revision: u64,
    selection: Option<Selection>,
    /// The hide-names setting as native last applied it; focus sync never shows a character
    /// while it is set, whether or not the page has polled since.
    names_hidden: bool,
    /// Bumped by every applied setting, so a status poll that read the setting earlier
    /// cannot overwrite a newer one.
    privacy_epoch: u64,
    /// The foreground the user's open lends the window (`profile_focus`).
    lease: Lease,
}
impl Profile {
    /// A new character to show; any open replaces the previous one.
    fn select(&mut self, life: &mut Life, server_id: u16, name: String) -> u64 {
        self.revision += 1;
        life.set_requested(true);
        self.selection = Some(Selection {
            revision: self.revision,
            server_id,
            name,
        });
        self.revision
    }
    /// Hidden names: nothing that names a character may stay shown or selected.
    fn suppress(&mut self, life: &mut Life) {
        if life.requested() || self.selection.is_some() {
            self.revision += 1;
        }
        life.set_requested(false);
        self.selection = None;
        self.lease.forget();
    }
    /// A committed hide-names setting, applied at once.
    fn apply_names_hidden(&mut self, life: &mut Life, hidden: bool) {
        self.privacy_epoch += 1;
        self.names_hidden = hidden;
        if hidden {
            self.suppress(life);
        }
    }
    /// A setting read by a poll that started at `epoch`; an apply since then wins. Answers
    /// whether names are hidden now.
    fn observe_names_hidden(&mut self, life: &mut Life, epoch: u64, hidden: bool) -> bool {
        if self.privacy_epoch == epoch {
            self.names_hidden = hidden;
        }
        if self.names_hidden {
            self.suppress(life);
        }
        self.names_hidden
    }
}
impl Policy for Profile {
    /// Focus sync shows the window only while requested, the game context is active and
    /// names are not hidden.
    fn allows(&self) -> bool {
        !self.names_hidden
    }
}

pub struct ProfileWindow(Surface<Profile>);

fn window(app: &AppHandle) -> Result<tauri::State<'_, ProfileWindow>, String> {
    app.try_state::<ProfileWindow>()
        .ok_or_else(|| "Profile window state unavailable".to_string())
}

fn with<T>(app: &AppHandle, f: impl FnOnce(&mut Life, &mut Profile) -> T) -> Result<T, String> {
    window(app)?.0.with(f)
}

fn host(app: &AppHandle) -> TauriHost<'_> {
    TauriHost::new(app, sync, save_drop)
}

pub fn setup(app: &AppHandle) -> Result<(), String> {
    let profile =
        crate::game_window_host::load(app, SPEC, "profile-window.json", Profile::default())?;
    app.manage(ProfileWindow(profile));
    let hidden = hide_names(app);
    with(app, |life, profile| {
        profile.apply_names_hidden(life, hidden)
    })
}

/// Applies a committed settings change (`offline_configure`) at once, from the settings it
/// saved, so no poll or focus change can reshow a character after names are hidden.
pub fn settings_applied(app: &AppHandle, settings: &Value) {
    let hidden = settings["hide_names"].as_bool().unwrap_or(false);
    let applied = with(app, |life, profile| {
        profile.apply_names_hidden(life, hidden)
    });
    if applied.is_ok() && hidden {
        let _ = schedule(app);
    }
}

fn schedule(app: &AppHandle) -> Result<(), String> {
    use crate::game_window::Host;
    host(app).schedule()
}

fn save_drop(app: &AppHandle, label: &str, d: crate::window_positions::Dropped) {
    if label != LABEL {
        return;
    }
    if let Ok(window) = window(app) {
        let at = Geometry {
            x: d.x,
            y: d.y,
            width: d.width,
            height: d.height,
        };
        window.0.dropped(&host(app), at);
    }
}

/// Shown only while requested and AION (or one of our overlays over it) is focused. Runs
/// on the main thread (every focus tick and after each request), which also runs the
/// window's foreground lease: a Close gives the game its foreground back before the
/// window hides, and an open's one request is made when its window is first shown.
pub fn sync(app: &AppHandle, active: bool) {
    let Ok(state) = window(app) else {
        return;
    };
    let before_hide = || {
        if let Some(window) = app.get_webview_window(LABEL) {
            give_back(app, &window);
        }
    };
    let Some(want) = state.0.gate(&host(app), active, before_hide) else {
        return;
    };
    let Some(window) = app.get_webview_window(LABEL) else {
        return;
    };
    let shown = want && window.is_visible().unwrap_or(false);
    let ours = foreground_is(&window);
    let game = game_foreground(app);
    let Ok(step) = with(app, |_, s| {
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
            let _ = with(app, |_, s| s.lease.granted(revision, ok, restore));
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
                with(app, |_, s| s.lease.restores()).unwrap_or(false)
            ),
        ),
        Step::ReleaseClip => {
            // Only while the profile still holds the foreground, and only a confinement
            // that outlived the game's own release.
            if native::foreground() == profile && native::cursor_confined() {
                let released = native::release_cursor();
                let _ = with(app, |_, s| s.lease.cursor_released = released);
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
    let Ok(Some(game)) = with(app, |_, s| s.lease.close(ours)) else {
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
/// against (see `Profile::observe_names_hidden`).
fn read_names_hidden(app: &AppHandle) -> Result<(u64, bool), String> {
    let epoch = with(app, |_, s| s.privacy_epoch)?;
    Ok((epoch, hide_names(app)))
}

fn status(app: &AppHandle, read: (u64, bool)) -> Result<Value, String> {
    let hidden_names = with(app, |life, s| s.observe_names_hidden(life, read.0, read.1))?;
    let visible = app
        .get_webview_window(LABEL)
        .is_some_and(|w| w.is_visible().unwrap_or(false));
    let favorites = crate::profile_favorites::listed(app, hidden_names);
    let active = host(app).game_active();
    with(app, |life, s| {
        let selection = s.selection.as_ref().map_or(
            Value::Null,
            |c| json!({"revision":c.revision,"server_id":c.server_id,"name":c.name}),
        );
        json!({"requested":life.requested(),"visible":visible,"ready":life.ready(),"game_active":active,"hide_names":hidden_names,"selection":selection,"favorites":favorites,"favorites_max":crate::profile_favorites::MAX,"errors":life.errors(),"focus":{"state":s.lease.state().word(),"revision":s.lease.revision(),"cursor_released":s.lease.cursor_released}})
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
    window(&app)?.0.ready()
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
    // The shared lifecycle creates the window once, withdraws the request of a failed
    // create and schedules the focus pass; the admission runs in the same lock.
    window(&app)?.0.open(&host(&app), |life, s| {
        if s.observe_names_hidden(life, read.0, read.1) {
            return Err("Character names are hidden, so profiles are too.".to_string());
        }
        let revision = s.select(life, server_id, name);
        // The user's click on a profile mark: this open may take the foreground once.
        s.lease.request(revision, Instant::now());
        Ok(())
    })?;
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
                if let Ok(Some(step)) = with(&handle, |_, s| {
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
    window(&app)?.0.hide(&host(&app))?;
    checked_status(app).await
}

pub fn close_requested(app: &AppHandle, label: &str) -> bool {
    if label != LABEL {
        return false;
    }
    if let Ok(window) = window(app) {
        let _ = window.0.close(&host(app));
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The profile's rules with the lifecycle state they share a lock with.
    #[derive(Default)]
    struct Pair {
        life: Life,
        profile: Profile,
    }
    impl Pair {
        fn select(&mut self, server_id: u16, name: &str) -> u64 {
            self.profile.select(&mut self.life, server_id, name.into())
        }
        fn suppress(&mut self) {
            self.profile.suppress(&mut self.life)
        }
        fn apply_names_hidden(&mut self, hidden: bool) {
            self.profile.apply_names_hidden(&mut self.life, hidden)
        }
        fn observe_names_hidden(&mut self, epoch: u64, hidden: bool) -> bool {
            self.profile
                .observe_names_hidden(&mut self.life, epoch, hidden)
        }
        /// Whether focus sync shows the window.
        fn shown(&self, active: bool) -> bool {
            self.life.wanted(&self.profile, active)
        }
    }

    #[test]
    fn every_open_replaces_the_selection_with_a_newer_revision() {
        let mut state = Pair::default();
        let first = state.select(2403, "foxyyyynm");
        let second = state.select(1304, "Aahz");
        assert!(second > first);
        let shown = state.profile.selection.clone().unwrap();
        assert_eq!(
            (shown.revision, shown.server_id, shown.name.as_str()),
            (second, 1304, "Aahz")
        );
        assert!(state.life.requested());
        // Reopening the same character is still a new request (a refresh of what it shows).
        assert!(state.select(1304, "Aahz") > second);
    }

    #[test]
    fn hidden_names_close_the_window_and_forget_the_character() {
        let mut state = Pair::default();
        let opened = state.select(2403, "foxyyyynm");
        state.suppress();
        assert!(!state.life.requested());
        assert!(state.profile.selection.is_none());
        assert!(state.profile.revision > opened);
        let quiet = state.profile.revision;
        state.suppress();
        assert_eq!(state.profile.revision, quiet);
    }

    #[test]
    fn hiding_names_takes_effect_before_any_poll_and_survives_refocus() {
        let mut state = Pair::default();
        state.select(2403, "foxyyyynm");
        assert!(state.shown(true));
        // A status poll reads the setting (still off) just before the workspace hides names.
        let stale = state.profile.privacy_epoch;
        state.apply_names_hidden(true);
        assert!(
            !state.shown(true),
            "refocusing the game must not reshow the character"
        );
        assert!(state.profile.selection.is_none() && !state.life.requested());
        // The poll that read the old setting lands afterwards: it cannot unhide anything.
        assert!(state.observe_names_hidden(stale, false));
        assert!(!state.shown(true));
        // Turning names back on again allows a new open; a fresh poll agrees with it.
        state.apply_names_hidden(false);
        let epoch = state.profile.privacy_epoch;
        assert!(!state.observe_names_hidden(epoch, false));
        state.select(2403, "foxyyyynm");
        assert!(state.shown(true) && !state.shown(false));
    }

    #[test]
    fn a_poll_reports_a_setting_changed_outside_the_settings_path() {
        let mut state = Pair::default();
        state.apply_names_hidden(false);
        state.select(1304, "Aahz");
        let epoch = state.profile.privacy_epoch;
        assert!(state.observe_names_hidden(epoch, true));
        assert!(state.profile.selection.is_none() && !state.shown(true));
    }

    #[test]
    fn hiding_names_drops_the_open_foreground_request() {
        use crate::profile_focus::State;
        let mut state = Pair::default();
        let now = Instant::now();
        let revision = state.select(2403, "foxyyyynm");
        state.profile.lease.request(revision, now);
        state.apply_names_hidden(true);
        assert_eq!(state.profile.lease.state(), State::Idle);
        // Nothing is shown or asked for, and a Close afterwards restores nothing.
        assert_eq!(
            state
                .profile
                .lease
                .next(Some(revision), false, Some(0x100), now),
            Step::Nothing
        );
        assert_eq!(state.profile.lease.close(true), None);
    }

    #[test]
    fn saved_geometry_must_be_a_usable_window() {
        let saved = |width: u32, height: u32| {
            SPEC.saved(&json!({"x":0,"y":0,"width":width,"height":height}))
        };
        assert!(saved(200, 600).is_none());
        assert!(saved(760, 640).is_some());
        assert!(saved(360, 300).is_some());
        assert!(saved(359, 300).is_none() && saved(360, 299).is_none());
        assert!(SPEC.saved(&json!({"x":0,"y":0,"width":760})).is_none());
    }

    #[test]
    fn the_profile_is_the_one_window_a_click_activates_and_it_never_locks() {
        assert!(SPEC.focusable && SPEC.lock.is_none());
        assert_eq!(
            crate::no_activate::activation(SPEC.label),
            crate::no_activate::Activation::OnClick
        );
        // First time: near the game's top-left corner, inside its bounds.
        assert_eq!(default_spot((0, 0, 1920, 1080), 1.0), (96, 96));
        assert_eq!(default_spot((100, 50, 2660, 1490), 1.5), (244, 194));
        assert_eq!(default_spot((0, 0, 800, 600), 1.0), (40, 0));
    }
}
