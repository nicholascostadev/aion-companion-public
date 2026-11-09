//! One lifecycle for the focus-gated in-game windows: pet radar, Timers, Explore and the
//! character profile. A `Surface` owns what they share: the request and ready flags, the
//! create-once guard with its rollback, the focus gate, the click-through lock with its
//! rollback, the saved geometry, the capped error list, and a close that only hides. Each
//! window module keeps its own rules (commands, payloads, privacy, foreground lease) and
//! describes its differences in a `Spec`.
//!
//! Tauri and Win32 sit behind `Host`. `game_window_host::TauriHost` is the real adapter; the
//! tests here drive the same state machine through an in-memory one, so the order of native
//! calls and every rollback is checked without an `AppHandle`. No lock is held across a
//! `Host` call that can wait on the event loop or re-enter this module.
use crate::hit::HitRegions;
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex, time::Instant};

const MAX_ERRORS: usize = 8;

/// Left, top, right and bottom in physical screen pixels.
pub type Area = (i32, i32, i32, i32);

/// A window's outer top-left and client size in physical pixels, as saved in its own file.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Which drops of a move or resize are saved.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Drops {
    /// Any drop that has a size, even one too small to be restored at the next start.
    Sized,
    /// Only a drop that `Spec::saved` would restore.
    Restorable,
}

/// When a show records the request, relative to creating the window.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Request {
    /// Before: a hide that arrives while the window is being created wins, and a failed
    /// create withdraws the request unless a newer one was made meanwhile.
    BeforeCreate,
    /// After: a failed create leaves the request as it was, and a hide that arrives while
    /// the window is being created is overtaken by the show.
    AfterCreate,
}

/// Whether a new window has its click-through state applied.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AtCreate {
    /// Always, locked or not.
    Always,
    /// Only when it starts locked.
    WhenLocked,
}

/// When a lock change drops the lock flag (which stops region hit-testing) before the
/// native change.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Pause {
    Always,
    /// Only before an unlock.
    Unlocking,
}

/// What a lock change that the window refused leaves behind.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Failure {
    /// The previous click-through state is applied again and the previous flag kept.
    Restore,
    /// The flag takes the opposite of what was asked; nothing is applied again.
    Opposite,
}

/// How a lockable window locks.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Lock {
    /// Names the window in the error recorded when the choice cannot be saved.
    pub name: &'static str,
    pub at_create: AtCreate,
    pub pause: Pause,
    /// Whether a lock change drops the reported control regions.
    pub clears_regions: bool,
    pub failure: Failure,
}

/// One window's settings: what it is built with and where it differs from the others.
#[derive(Clone, Copy)]
pub struct Spec {
    pub label: &'static str,
    /// The page: `index.html?view=<view>`.
    pub view: &'static str,
    /// Key of the localized window title.
    pub title: &'static str,
    /// Logical size and minimum size the window is built with.
    pub size: (f64, f64),
    pub min_size: (f64, f64),
    /// Whether a click may activate the window.
    pub focusable: bool,
    /// The smallest saved physical size that is restored.
    pub min_saved: (u32, u32),
    pub drops: Drops,
    /// Rewrites a saved geometry once the window's scale is known; a changed one is saved.
    pub migrate: Option<fn(Geometry, f64) -> Geometry>,
    /// The first-time spot inside an area (the game window) at a scale.
    pub default_spot: fn(Area, f64) -> (i32, i32),
    /// Whether the primary monitor stands in for the area when the game has no window.
    pub monitor_fallback: bool,
    pub request: Request,
    /// Whether a hide drops the reported control regions at once, before the focus pass.
    pub hide_clears_regions: bool,
    pub lock: Option<Lock>,
    /// The error when the state cannot be read.
    pub unavailable: &'static str,
}

impl Spec {
    /// A saved geometry, if it is one this window can be restored with.
    pub fn saved(&self, value: &Value) -> Option<Geometry> {
        let int = |key: &str| value[key].as_i64();
        self.usable(int("x")?, int("y")?, int("width")?, int("height")?)
    }

    fn usable(&self, x: i64, y: i64, width: i64, height: i64) -> Option<Geometry> {
        let valid = (-100_000..=100_000).contains(&x)
            && (-100_000..=100_000).contains(&y)
            && (i64::from(self.min_saved.0)..=16_384).contains(&width)
            && (i64::from(self.min_saved.1)..=16_384).contains(&height);
        valid.then_some(Geometry {
            x: x as i32,
            y: y as i32,
            width: width as u32,
            height: height as u32,
        })
    }

    /// The geometry a drop is saved as, if this window saves it.
    fn dropped(&self, at: Geometry) -> Option<Geometry> {
        match self.drops {
            Drops::Sized => (at.width > 0 && at.height > 0).then_some(at),
            Drops::Restorable => self.usable(
                i64::from(at.x),
                i64::from(at.y),
                i64::from(at.width),
                i64::from(at.height),
            ),
        }
    }

    fn build(&self) -> Build<'static> {
        Build {
            label: self.label,
            view: self.view,
            title: self.title,
            size: self.size,
            min_size: Some(self.min_size),
            resizable: Some(true),
            focusable: self.focusable,
        }
    }
}

/// What an in-game window is built with. Everything else is the same for all of them:
/// hidden, undecorated, transparent, shadowless, always on top, off the taskbar, unfocused,
/// never maximizable or minimizable.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Build<'a> {
    pub label: &'a str,
    pub view: &'a str,
    pub title: &'a str,
    pub size: (f64, f64),
    pub min_size: Option<(f64, f64)>,
    /// `None` leaves the builder's own choice.
    pub resizable: Option<bool>,
    pub focusable: bool,
}

/// The cursor over a visible window: its client position, the client size and the scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pointer {
    pub at: (f64, f64),
    pub client: (f64, f64),
    pub scale: f64,
}

/// Lets one caller create a window whose creation waits on the event loop.
#[derive(Default)]
pub struct CreateOnce(bool);
impl CreateOnce {
    /// True for the one caller that should create the window; it must call `finish`.
    /// `absent` is only asked while nobody is creating it.
    pub fn begin(&mut self, absent: impl FnOnce() -> bool) -> bool {
        if self.0 || !absent() {
            return false;
        }
        self.0 = true;
        true
    }
    pub fn finish(&mut self) {
        self.0 = false;
    }
}

/// Everything the lifecycle asks of Tauri and Win32, by window label.
pub trait Host {
    fn exists(&self, label: &str) -> bool;
    fn visible(&self, label: &str) -> bool;
    /// The built window's scale factor (1 when unknown).
    fn scale(&self, label: &str) -> f64;
    /// The game's window, when it has one.
    fn game_area(&self) -> Option<Area>;
    /// The primary monitor as the window sees it.
    fn monitor_area(&self, label: &str) -> Option<Area>;
    /// The physical size a freshly built window is placed with.
    fn built_size(&self, label: &str) -> (i32, i32);
    /// The cursor over the window; `None` while it is hidden or unknown.
    fn pointer(&self, label: &str) -> Option<Pointer>;

    /// Builds the hidden window. Waits on the event loop.
    fn build(&self, plan: &Build) -> Result<(), String>;
    /// Keeps the window from taking focus from the game (`no_activate`).
    fn guard(&self, label: &str);
    fn resize(&self, label: &str, width: u32, height: u32) -> Result<(), String>;
    /// Places a new window at `wanted` kept on the displays, else `default`, else centred.
    fn place(
        &self,
        label: &str,
        wanted: Option<(i32, i32)>,
        size: (i32, i32),
        default: Option<(i32, i32)>,
    ) -> Result<(), String>;
    /// Reports the end of the user's moves and resizes to the window's module.
    fn watch(&self, label: &str) -> Result<(), String>;
    /// The window ignores the cursor (locked) or takes it.
    fn click_through(&self, label: &str, on: bool) -> Result<(), String>;
    /// Shows or hides without activating.
    fn show(&self, label: &str, visible: bool) -> Result<(), String>;
    /// A locked window passes clicks to the game, or takes them over a reported control.
    fn pass_through(&self, label: &str, pass: bool);
    /// Runs the window module's focus pass on the main thread, now or soon.
    fn schedule(&self) -> Result<(), String>;
    fn save_geometry(&self, path: PathBuf, at: Geometry);
    fn save_lock(&self, label: &str, locked: bool) -> Result<(), String>;
}

/// A window's own condition on being shown, kept under the same lock as its lifecycle.
pub trait Policy {
    fn allows(&self) -> bool {
        true
    }
}
impl Policy for () {}

/// What the lifecycle starts from: the saved geometry, its file and the saved lock choice.
#[derive(Default)]
pub struct Saved {
    pub geometry: Option<Geometry>,
    pub path: Option<PathBuf>,
    pub locked: bool,
}

/// The shared state of one window.
#[derive(Default)]
pub struct Life {
    requested: bool,
    ready: bool,
    locked: bool,
    creating: CreateOnce,
    /// Bumped by every change of the request, so a failed create only withdraws its own.
    generation: u64,
    geometry: Option<Geometry>,
    path: Option<PathBuf>,
    hit: HitRegions,
    errors: Vec<String>,
}
impl Life {
    pub fn requested(&self) -> bool {
        self.requested
    }
    /// The user's intent; the focus gate decides when it shows.
    pub fn set_requested(&mut self, requested: bool) {
        self.requested = requested;
        self.generation += 1;
    }
    pub fn ready(&self) -> bool {
        self.ready
    }
    pub fn locked(&self) -> bool {
        self.locked
    }
    pub fn regions(&self) -> usize {
        self.hit.len()
    }
    pub fn errors(&self) -> &[String] {
        &self.errors
    }
    /// Whether the focus gate shows the window: requested, allowed by its own policy and
    /// the game context active.
    pub fn wanted(&self, policy: &impl Policy, active: bool) -> bool {
        self.requested && policy.allows() && active
    }
    fn note(&mut self, error: String) {
        if self.errors.len() < MAX_ERRORS && !self.errors.contains(&error) {
            self.errors.push(error);
        }
    }
}

/// One in-game window: its settings, its shared state and its own policy `X` under one lock.
pub struct Surface<X = ()> {
    spec: Spec,
    state: Mutex<(Life, X)>,
}

impl<X: Policy> Surface<X> {
    pub fn new(spec: Spec, saved: Saved, policy: X) -> Self {
        let life = Life {
            geometry: saved.geometry,
            path: saved.path,
            locked: saved.locked,
            ..Life::default()
        };
        Self {
            spec,
            state: Mutex::new((life, policy)),
        }
    }

    /// Reads or changes the state. `f` must not call a `Host` that waits or re-enters.
    pub fn with<T>(&self, f: impl FnOnce(&mut Life, &mut X) -> T) -> Result<T, String> {
        let mut state = self.state.lock().map_err(|_| self.spec.unavailable)?;
        let (life, policy) = &mut *state;
        Ok(f(life, policy))
    }

    /// Records an error for the window's status: at most eight, each once.
    pub fn note(&self, error: String) {
        let _ = self.with(|life, _| life.note(error));
    }

    /// The window's page has mounted.
    pub fn ready(&self) -> Result<(), String> {
        self.with(|life, _| life.ready = true)
    }

    /// Requests the window; it appears once the game context is active.
    pub fn show(&self, host: &impl Host) -> Result<(), String> {
        self.open(host, |_, _| Ok(()))
    }

    /// `show`, after the window's own `admit` step: it runs in the same lock as the request,
    /// and when it refuses, nothing is requested, created or scheduled.
    pub fn open(
        &self,
        host: &impl Host,
        admit: impl FnOnce(&mut Life, &mut X) -> Result<(), String>,
    ) -> Result<(), String> {
        let label = self.spec.label;
        match self.spec.request {
            Request::BeforeCreate => {
                let (create, generation) = self.with(|life, policy| {
                    admit(life, policy)?;
                    life.set_requested(true);
                    let create = life.creating.begin(|| !host.exists(label));
                    Ok::<_, String>((create, life.generation))
                })??;
                if create {
                    let result = self.create(host);
                    self.with(|life, _| {
                        life.creating.finish();
                        if result.is_err() && life.generation == generation {
                            life.requested = false;
                        }
                    })?;
                    result?;
                }
            }
            Request::AfterCreate => {
                let create = self.with(|life, policy| {
                    admit(life, policy)?;
                    Ok::<_, String>(life.creating.begin(|| !host.exists(label)))
                })??;
                if create {
                    let result = self.create(host);
                    let _ = self.with(|life, _| life.creating.finish());
                    result?;
                }
                self.with(|life, _| life.set_requested(true))?;
            }
        }
        host.schedule()
    }

    /// Builds the hidden window: guard, saved size, place, drop watch, then the lock.
    fn create(&self, host: &impl Host) -> Result<(), String> {
        let spec = &self.spec;
        let label = spec.label;
        let (saved, locked) = self.with(|life, _| (life.geometry, life.locked))?;
        if host.exists(label) {
            return Ok(());
        }
        host.build(&spec.build())?;
        host.guard(label);
        let scale = host.scale(label);
        let saved = saved.map(|old| match spec.migrate {
            Some(migrate) => {
                let next = migrate(old, scale);
                if next != old {
                    // Saved now, so the migration happens only once.
                    self.save(host, next);
                }
                next
            }
            None => old,
        });
        if let Some(g) = saved {
            host.resize(label, g.width, g.height)?;
        }
        let area = host.game_area().or_else(|| {
            spec.monitor_fallback
                .then(|| host.monitor_area(label))
                .flatten()
        });
        let default = area.map(|area| (spec.default_spot)(area, scale));
        // The saved spot, kept on connected displays; the default only without one.
        let size = saved.map_or_else(
            || host.built_size(label),
            |g| (g.width as i32, g.height as i32),
        );
        host.place(label, saved.map(|g| (g.x, g.y)), size, default)?;
        if let Err(error) = host.watch(label) {
            self.note(error);
        }
        match spec.lock.map(|lock| lock.at_create) {
            Some(AtCreate::Always) => host.click_through(label, locked)?,
            Some(AtCreate::WhenLocked) if locked => host.click_through(label, true)?,
            _ => {}
        }
        Ok(())
    }

    /// Withdraws the request; the focus pass hides the window.
    pub fn hide(&self, host: &impl Host) -> Result<(), String> {
        self.with(|life, _| {
            life.set_requested(false);
            if self.spec.hide_clears_regions {
                life.hit.clear();
            }
        })?;
        host.schedule()
    }

    /// Closing the window (its button, Escape or Alt+F4) only hides it: the window, its
    /// page and its place stay for the next show.
    pub fn close(&self, host: &impl Host) -> Result<(), String> {
        self.hide(host)
    }

    /// Locked: click-through except the reported controls. Unlocked: drags and resizes.
    /// The choice is saved; a refused change is rolled back as the window's `Lock` says.
    pub fn lock(&self, host: &impl Host, locked: bool) -> Result<(), String> {
        let rule = self.spec.lock.ok_or("This window cannot be locked")?;
        let label = self.spec.label;
        let previous = self.with(|life, _| {
            let previous = life.locked;
            if rule.pause == Pause::Always || !locked {
                // Stop region toggling before the window's input changes.
                life.locked = false;
            }
            if rule.clears_regions {
                life.hit.clear();
            }
            previous
        })?;
        if host.exists(label) {
            if let Err(error) = host.click_through(label, locked) {
                match rule.failure {
                    Failure::Restore => {
                        let _ = host.click_through(label, previous);
                        self.with(|life, _| life.locked = previous)?;
                    }
                    Failure::Opposite => {
                        let _ = self.with(|life, _| life.locked = !locked);
                    }
                }
                return Err(error);
            }
        }
        self.with(|life, _| life.locked = locked)?;
        // The window already follows the choice; a failed save only loses it at restart.
        if let Err(error) = host.save_lock(label, locked) {
            self.note(format!(
                "Could not save the {} lock choice: {error}",
                rule.name
            ));
        }
        // The raw no-activate show is unknown to the windowing library, whose flag update
        // can re-hide the window: the focus pass shows it again.
        host.schedule()
    }

    /// The focus pass (main thread): shows the window only while it is wanted.
    pub fn sync(&self, host: &impl Host, active: bool) {
        self.gate(host, active, || {});
    }

    /// `sync`, with `before_hide` run just before a visible window is hidden. Answers
    /// whether the window is wanted, or `None` when there is no window (or state) yet.
    pub fn gate(&self, host: &impl Host, active: bool, before_hide: impl FnOnce()) -> Option<bool> {
        let label = self.spec.label;
        let want = self
            .with(|life, policy| {
                let want = life.wanted(policy, active);
                if !want {
                    life.hit.clear();
                }
                want
            })
            .ok()?;
        if !host.exists(label) {
            return None;
        }
        let visible = host.visible(label);
        if visible && !want {
            before_hide();
        }
        if visible != want {
            if let Err(error) = host.show(label, want) {
                self.note(error);
            }
        }
        Some(want)
    }

    /// Lets a locked window take input only while the cursor is over a reported control;
    /// the rest passes clicks to the game.
    pub fn sync_input(&self, host: &impl Host, now: Instant) {
        if !self.with(|life, _| life.locked).unwrap_or(false) {
            return;
        }
        let label = self.spec.label;
        if !host.exists(label) {
            return;
        }
        let over = host
            .pointer(label)
            .and_then(|pointer| {
                self.with(|life, _| {
                    life.hit
                        .contains(pointer.at, pointer.client, pointer.scale, now)
                })
                .ok()
            })
            .unwrap_or(false);
        host.pass_through(label, !over);
    }

    /// Control rectangles of the locked window, `[x, y, width, height]` in physical client
    /// pixels at device pixel ratio `scale`. An empty list clears them.
    pub fn set_regions(
        &self,
        regions: &[[f64; 4]],
        scale: f64,
        now: Instant,
    ) -> Result<usize, String> {
        self.with(|life, _| life.hit.set(regions, scale, now))?
    }

    /// The user dropped a move or resize.
    pub fn dropped(&self, host: &impl Host, at: Geometry) {
        if let Some(at) = self.spec.dropped(at) {
            self.save(host, at);
        }
    }

    /// Keeps the geometry as the user's and queues its file.
    fn save(&self, host: &impl Host, at: Geometry) {
        if let Ok(Some(path)) = self.with(|life, _| {
            life.geometry = Some(at);
            life.path.clone()
        }) {
            host.save_geometry(path, at);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::{Cell, RefCell};
    use std::collections::BTreeMap;
    use std::rc::Rc;

    const LABEL: &str = "radar";
    const GAME: Area = (0, 0, 1920, 1080);

    fn corner(area: Area, scale: f64) -> (i32, i32) {
        (
            area.0 + (10.0 * scale) as i32,
            area.1 + (20.0 * scale) as i32,
        )
    }

    const LOCK: Lock = Lock {
        name: "radar",
        at_create: AtCreate::Always,
        pause: Pause::Always,
        clears_regions: true,
        failure: Failure::Restore,
    };

    fn spec() -> Spec {
        Spec {
            label: LABEL,
            view: "radar",
            title: "titleRadar",
            size: (340.0, 300.0),
            min_size: (260.0, 160.0),
            focusable: false,
            min_saved: (260, 160),
            drops: Drops::Restorable,
            migrate: None,
            default_spot: corner,
            monitor_fallback: false,
            request: Request::BeforeCreate,
            hide_clears_regions: false,
            lock: Some(LOCK),
            unavailable: "Radar state unavailable",
        }
    }

    fn surface(spec: Spec) -> Surface {
        Surface::new(spec, Saved::default(), ())
    }

    const AT: Geometry = Geometry {
        x: 40,
        y: 60,
        width: 400,
        height: 320,
    };

    fn saved_at(spec: Spec, locked: bool) -> Surface {
        let saved = Saved {
            geometry: Some(AT),
            path: Some(PathBuf::from("radar.json")),
            locked,
        };
        Surface::new(spec, saved, ())
    }

    #[derive(Default)]
    struct Window {
        visible: bool,
        click_through: bool,
        pass_through: bool,
    }

    type Hook = Box<dyn FnOnce(&Fake)>;

    /// The in-memory adapter: windows are rows in a map and every native call is logged.
    struct Fake {
        log: RefCell<Vec<String>>,
        windows: RefCell<BTreeMap<String, Window>>,
        active: Cell<bool>,
        game: Cell<Option<Area>>,
        monitor: Cell<Option<Area>>,
        scale: Cell<f64>,
        pointer: Cell<Option<Pointer>>,
        /// Operations that fail the next time they run, each once.
        failing: RefCell<Vec<&'static str>>,
        /// Runs inside the named operation, once: what arrives while it waits.
        during: RefCell<Option<(&'static str, Hook)>>,
        scheduled: Cell<usize>,
    }
    impl Fake {
        fn new() -> Self {
            Self {
                log: RefCell::default(),
                windows: RefCell::default(),
                active: Cell::new(false),
                game: Cell::new(Some(GAME)),
                monitor: Cell::new(Some((0, 0, 2560, 1440))),
                scale: Cell::new(1.0),
                pointer: Cell::new(None),
                failing: RefCell::default(),
                during: RefCell::new(None),
                scheduled: Cell::new(0),
            }
        }
        fn fail(&self, operation: &'static str) {
            self.failing.borrow_mut().push(operation);
        }
        fn during(&self, operation: &'static str, hook: impl FnOnce(&Fake) + 'static) {
            *self.during.borrow_mut() = Some((operation, Box::new(hook)));
        }
        /// Logs one native call, lets a pending arrival in, and fails it when asked to.
        fn call(&self, operation: &'static str, line: String) -> Result<(), String> {
            self.log.borrow_mut().push(line);
            let hook = {
                let mut during = self.during.borrow_mut();
                match during.as_ref() {
                    Some((at, _)) if *at == operation => during.take().map(|(_, hook)| hook),
                    _ => None,
                }
            };
            if let Some(hook) = hook {
                hook(self);
            }
            let mut failing = self.failing.borrow_mut();
            match failing.iter().position(|f| *f == operation) {
                Some(index) => {
                    failing.remove(index);
                    Err(format!("{operation} failed"))
                }
                None => Ok(()),
            }
        }
        /// The native calls since the last look.
        fn calls(&self) -> Vec<String> {
            std::mem::take(&mut *self.log.borrow_mut())
        }
        fn window<T>(&self, f: impl FnOnce(&Window) -> T) -> T {
            f(&self.windows.borrow()[LABEL])
        }
        /// Runs the focus passes that were scheduled, as the main thread would.
        fn pump<X: Policy>(&self, surface: &Surface<X>) {
            while self.scheduled.get() > 0 {
                self.scheduled.set(self.scheduled.get() - 1);
                surface.sync(self, self.active.get());
            }
        }
        /// A focus tick: the foreground changed (or not) and the pass runs.
        fn focus<X: Policy>(&self, surface: &Surface<X>, active: bool) {
            self.active.set(active);
            surface.sync(self, active);
        }
    }
    impl Host for Fake {
        fn exists(&self, label: &str) -> bool {
            self.windows.borrow().contains_key(label)
        }
        fn visible(&self, label: &str) -> bool {
            self.windows.borrow().get(label).is_some_and(|w| w.visible)
        }
        fn scale(&self, _: &str) -> f64 {
            self.scale.get()
        }
        fn game_area(&self) -> Option<Area> {
            self.game.get()
        }
        fn monitor_area(&self, _: &str) -> Option<Area> {
            self.monitor.get()
        }
        fn built_size(&self, _: &str) -> (i32, i32) {
            (340, 300)
        }
        fn pointer(&self, label: &str) -> Option<Pointer> {
            self.pointer.get().filter(|_| self.visible(label))
        }
        fn build(&self, plan: &Build) -> Result<(), String> {
            self.call(
                "build",
                format!(
                    "build {} view={} title={} {:?} min={:?} resizable={:?} focusable={}",
                    plan.label,
                    plan.view,
                    plan.title,
                    plan.size,
                    plan.min_size,
                    plan.resizable,
                    plan.focusable
                ),
            )?;
            self.windows
                .borrow_mut()
                .insert(plan.label.to_string(), Window::default());
            Ok(())
        }
        fn guard(&self, label: &str) {
            let _ = self.call("guard", format!("guard {label}"));
        }
        fn resize(&self, label: &str, width: u32, height: u32) -> Result<(), String> {
            self.call("resize", format!("resize {label} {width}x{height}"))
        }
        fn place(
            &self,
            label: &str,
            wanted: Option<(i32, i32)>,
            size: (i32, i32),
            default: Option<(i32, i32)>,
        ) -> Result<(), String> {
            self.call(
                "place",
                format!("place {label} wanted={wanted:?} size={size:?} default={default:?}"),
            )
        }
        fn watch(&self, label: &str) -> Result<(), String> {
            self.call("watch", format!("watch {label}"))
        }
        fn click_through(&self, label: &str, on: bool) -> Result<(), String> {
            self.call("click-through", format!("click-through {label} {on}"))?;
            self.windows
                .borrow_mut()
                .get_mut(label)
                .unwrap()
                .click_through = on;
            Ok(())
        }
        fn show(&self, label: &str, visible: bool) -> Result<(), String> {
            self.call("show", format!("show {label} {visible}"))?;
            self.windows.borrow_mut().get_mut(label).unwrap().visible = visible;
            Ok(())
        }
        fn pass_through(&self, label: &str, pass: bool) {
            let changed = {
                let mut windows = self.windows.borrow_mut();
                let window = windows.get_mut(label).unwrap();
                std::mem::replace(&mut window.pass_through, pass) != pass
            };
            // Like the real style toggle, an unchanged style is not written again.
            if changed {
                let _ = self.call("pass-through", format!("pass-through {label} {pass}"));
            }
        }
        fn schedule(&self) -> Result<(), String> {
            self.call("schedule", "schedule".into())?;
            self.scheduled.set(self.scheduled.get() + 1);
            Ok(())
        }
        fn save_geometry(&self, path: PathBuf, at: Geometry) {
            let _ = self.call(
                "save-geometry",
                format!(
                    "save-geometry {} {},{} {}x{}",
                    path.display(),
                    at.x,
                    at.y,
                    at.width,
                    at.height
                ),
            );
        }
        fn save_lock(&self, label: &str, locked: bool) -> Result<(), String> {
            self.call("save-lock", format!("save-lock {label} {locked}"))
        }
    }

    fn requested<X: Policy>(surface: &Surface<X>) -> bool {
        surface.with(|life, _| life.requested()).unwrap()
    }
    fn locked<X: Policy>(surface: &Surface<X>) -> bool {
        surface.with(|life, _| life.locked()).unwrap()
    }
    fn regions<X: Policy>(surface: &Surface<X>) -> usize {
        surface.with(|life, _| life.regions()).unwrap()
    }
    fn errors<X: Policy>(surface: &Surface<X>) -> Vec<String> {
        surface.with(|life, _| life.errors().to_vec()).unwrap()
    }
    fn report(surface: &Surface, now: Instant) {
        assert_eq!(
            surface.set_regions(&[[10.0, 10.0, 50.0, 20.0]], 1.0, now),
            Ok(1)
        );
    }

    const BUILD: &str = "build radar view=radar title=titleRadar (340.0, 300.0) \
                         min=Some((260.0, 160.0)) resizable=Some(true) focusable=false";

    #[test]
    fn a_show_builds_the_hidden_window_once_and_waits_for_the_game() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        assert_eq!(
            host.calls(),
            [
                BUILD,
                "guard radar",
                "place radar wanted=None size=(340, 300) default=Some((10, 20))",
                "watch radar",
                "click-through radar false",
                "schedule",
            ]
        );
        // Another app is focused: requested, built, still hidden.
        host.pump(&radar);
        assert!(requested(&radar) && !host.visible(LABEL));
        assert!(host.calls().is_empty());
        host.focus(&radar, true);
        assert_eq!(host.calls(), ["show radar true"]);
        // Later shows reuse the window.
        radar.show(&host).unwrap();
        host.pump(&radar);
        assert_eq!(host.calls(), ["schedule"]);
        assert!(errors(&radar).is_empty());
    }

    #[test]
    fn a_saved_window_is_sized_before_it_is_placed_and_locked_last() {
        let (host, radar) = (Fake::new(), saved_at(spec(), true));
        radar.show(&host).unwrap();
        assert_eq!(
            host.calls(),
            [
                BUILD,
                "guard radar",
                "resize radar 400x320",
                "place radar wanted=Some((40, 60)) size=(400, 320) default=Some((10, 20))",
                "watch radar",
                "click-through radar true",
                "schedule",
            ]
        );
        assert!(locked(&radar) && host.window(|w| w.click_through));
    }

    #[test]
    fn a_new_window_takes_its_lock_always_only_when_locked_or_never() {
        let when_locked = Spec {
            lock: Some(Lock {
                at_create: AtCreate::WhenLocked,
                ..LOCK
            }),
            ..spec()
        };
        let unlockable = Spec {
            lock: None,
            ..spec()
        };
        let lock_calls = |spec: Spec, locked: bool| -> Vec<String> {
            let (host, radar) = (Fake::new(), saved_at(spec, locked));
            radar.show(&host).unwrap();
            let calls = host.calls();
            calls
                .into_iter()
                .filter(|call| call.starts_with("click-through"))
                .collect()
        };
        assert_eq!(lock_calls(spec(), false), ["click-through radar false"]);
        assert_eq!(lock_calls(spec(), true), ["click-through radar true"]);
        assert!(lock_calls(when_locked, false).is_empty());
        assert_eq!(lock_calls(when_locked, true), ["click-through radar true"]);
        assert!(lock_calls(unlockable, true).is_empty());
        // A window without a lock refuses one and changes nothing.
        let (host, profile) = (Fake::new(), surface(unlockable));
        assert!(profile.lock(&host, true).is_err());
        assert!(host.calls().is_empty() && !locked(&profile));
    }

    #[test]
    fn the_window_is_built_with_its_own_page_size_and_activation() {
        let profile = Spec {
            label: "profile",
            view: "profile",
            title: "titleProfile",
            size: (760.0, 640.0),
            min_size: (400.0, 340.0),
            focusable: true,
            lock: None,
            ..spec()
        };
        let (host, window) = (Fake::new(), surface(profile));
        window.show(&host).unwrap();
        assert_eq!(
            host.calls()[0],
            "build profile view=profile title=titleProfile (760.0, 640.0) \
             min=Some((400.0, 340.0)) resizable=Some(true) focusable=true"
        );
    }

    #[test]
    fn the_first_spot_follows_the_game_then_the_monitor_only_when_allowed() {
        let place = |spec: Spec, game: Option<Area>, scale: f64| -> String {
            let (host, radar) = (Fake::new(), surface(spec));
            host.game.set(game);
            host.scale.set(scale);
            radar.show(&host).unwrap();
            let calls = host.calls();
            calls
                .into_iter()
                .find(|call| call.starts_with("place"))
                .unwrap()
        };
        let fallback = Spec {
            monitor_fallback: true,
            ..spec()
        };
        assert!(place(spec(), Some((100, 50, 900, 700)), 1.5).ends_with("default=Some((115, 80))"));
        // Without a game window: centred, unless the window falls back to the monitor.
        assert!(place(spec(), None, 1.0).ends_with("default=None"));
        assert!(place(fallback, None, 1.0).ends_with("default=Some((10, 20))"));
        assert!(
            place(fallback, Some((100, 50, 900, 700)), 1.0).ends_with("default=Some((110, 70))")
        );
    }

    #[test]
    fn the_focus_gate_shows_only_a_requested_window_over_the_game() {
        let (host, radar) = (Fake::new(), surface(spec()));
        // Nothing requested, nothing built: focus changes do nothing.
        host.focus(&radar, true);
        assert!(host.calls().is_empty());
        radar.show(&host).unwrap();
        host.active.set(true);
        host.pump(&radar);
        host.calls();
        assert!(host.visible(LABEL));
        // A pass that changes nothing calls nothing.
        host.focus(&radar, true);
        assert!(host.calls().is_empty());
        // Switching away hides it and keeps the request; coming back shows it again.
        host.focus(&radar, false);
        assert_eq!(host.calls(), ["show radar false"]);
        assert!(requested(&radar));
        host.focus(&radar, false);
        assert!(host.calls().is_empty());
        host.focus(&radar, true);
        assert_eq!(host.calls(), ["show radar true"]);
        // A hide withdraws the request first, then the pass hides the window.
        radar.hide(&host).unwrap();
        assert!(!requested(&radar) && host.visible(LABEL));
        assert_eq!(host.calls(), ["schedule"]);
        host.pump(&radar);
        assert_eq!(host.calls(), ["show radar false"]);
        // The game coming back does not reopen it.
        host.focus(&radar, false);
        host.focus(&radar, true);
        assert!(host.calls().is_empty() && !host.visible(LABEL));
    }

    #[test]
    fn a_failed_show_or_hide_of_the_window_is_reported_and_retried() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        host.fail("show");
        host.focus(&radar, true);
        assert!(!host.visible(LABEL));
        assert_eq!(errors(&radar), ["show failed"]);
        // The next pass tries again.
        host.focus(&radar, true);
        assert!(host.visible(LABEL));
    }

    struct Veto(bool);
    impl Policy for Veto {
        fn allows(&self) -> bool {
            !self.0
        }
    }

    #[test]
    fn a_window_policy_can_keep_a_requested_window_hidden() {
        let host = Fake::new();
        let profile = Surface::new(spec(), Saved::default(), Veto(false));
        profile.show(&host).unwrap();
        host.active.set(true);
        host.pump(&profile);
        assert!(host.visible(LABEL));
        host.calls();
        profile.with(|_, veto| veto.0 = true).unwrap();
        // What the window does before it hides runs before the hide, and only then.
        let order = Rc::new(RefCell::new(Vec::new()));
        let seen = order.clone();
        let want = profile.gate(&host, true, || seen.borrow_mut().push(host.visible(LABEL)));
        assert_eq!(want, Some(false));
        assert_eq!(*order.borrow(), [true]);
        assert_eq!(host.calls(), ["show radar false"]);
        assert!(requested(&profile));
        let want = profile.gate(&host, true, || panic!("nothing is hidden twice"));
        assert_eq!(want, Some(false));
        profile.with(|_, veto| veto.0 = false).unwrap();
        assert_eq!(profile.gate(&host, true, || panic!("shown")), Some(true));
        assert!(host.visible(LABEL));
        // Without a window the pass has nothing to answer for.
        let unbuilt = Surface::new(spec(), Saved::default(), Veto(false));
        assert_eq!(unbuilt.gate(&Fake::new(), true, || {}), None);
    }

    #[test]
    fn a_refused_open_requests_and_builds_nothing() {
        let (host, radar) = (Fake::new(), surface(spec()));
        let refused = radar.open(&host, |_, _| Err("Not now".into()));
        assert_eq!(refused, Err("Not now".to_string()));
        assert!(!requested(&radar) && host.calls().is_empty());
        // The admission runs in the same lock as the request it admits.
        radar
            .open(&host, |life, _| {
                assert!(!life.requested());
                Ok(())
            })
            .unwrap();
        assert!(requested(&radar));
    }

    #[test]
    fn a_hide_that_arrives_during_create_wins_when_the_request_came_first() {
        let (host, radar) = (Fake::new(), Rc::new(surface(spec())));
        host.active.set(true);
        let arriving = radar.clone();
        host.during("build", move |host| arriving.hide(host).unwrap());
        radar.show(&host).unwrap();
        assert!(!requested(&radar));
        host.pump(&radar);
        assert!(host.exists(LABEL) && !host.visible(LABEL));
        assert!(!host.calls().iter().any(|call| call.starts_with("show")));
    }

    #[test]
    fn a_show_that_requests_after_create_overtakes_a_hide_during_it() {
        let after = Spec {
            request: Request::AfterCreate,
            ..spec()
        };
        let (host, radar) = (Fake::new(), Rc::new(surface(after)));
        host.active.set(true);
        let arriving = radar.clone();
        host.during("build", move |host| {
            // Not requested yet while the window is being built.
            assert!(!requested(&arriving));
            arriving.hide(host).unwrap();
        });
        radar.show(&host).unwrap();
        assert!(requested(&radar));
        host.pump(&radar);
        assert!(host.visible(LABEL));
    }

    #[test]
    fn a_second_show_during_create_never_builds_a_second_window() {
        let (host, radar) = (Fake::new(), Rc::new(surface(spec())));
        let arriving = radar.clone();
        host.during("build", move |host| arriving.show(host).unwrap());
        radar.show(&host).unwrap();
        let calls = host.calls();
        assert_eq!(
            calls
                .iter()
                .filter(|call| call.starts_with("build"))
                .count(),
            1
        );
        // The show that arrived only scheduled a pass; the creator scheduled its own.
        assert_eq!(calls.iter().filter(|call| *call == "schedule").count(), 2);
        assert!(requested(&radar));
    }

    #[test]
    fn a_failed_create_withdraws_its_request_and_lets_the_next_show_retry() {
        let (host, radar) = (Fake::new(), surface(spec()));
        host.active.set(true);
        host.fail("build");
        assert_eq!(radar.show(&host), Err("build failed".to_string()));
        assert!(!requested(&radar) && !host.exists(LABEL));
        // Nothing is scheduled for a window that does not exist.
        assert_eq!(host.calls(), [BUILD]);
        // The guard was released: the next show builds it.
        radar.show(&host).unwrap();
        host.pump(&radar);
        assert!(requested(&radar) && host.visible(LABEL));
    }

    #[test]
    fn a_failed_create_keeps_a_request_made_while_it_was_failing() {
        let (host, radar) = (Fake::new(), Rc::new(surface(spec())));
        let arriving = radar.clone();
        host.fail("build");
        host.during("build", move |host| arriving.show(host).unwrap());
        assert!(radar.show(&host).is_err());
        // The newer request is not the failed one's to withdraw.
        assert!(requested(&radar));
        // A hide during the failing create stays a hide.
        let (host, radar) = (Fake::new(), Rc::new(surface(spec())));
        let arriving = radar.clone();
        host.fail("build");
        host.during("build", move |host| arriving.hide(host).unwrap());
        assert!(radar.show(&host).is_err());
        assert!(!requested(&radar));
    }

    #[test]
    fn a_failed_create_leaves_a_request_after_create_as_it_was() {
        let after = Spec {
            request: Request::AfterCreate,
            ..spec()
        };
        let (host, radar) = (Fake::new(), surface(after));
        host.fail("build");
        assert!(radar.show(&host).is_err());
        assert!(!requested(&radar));
        assert_eq!(host.calls().len(), 1);
        radar.show(&host).unwrap();
        assert!(requested(&radar) && host.exists(LABEL));
    }

    #[test]
    fn a_window_that_cannot_be_placed_fails_the_show_but_a_missing_watch_does_not() {
        let (host, radar) = (Fake::new(), surface(spec()));
        host.fail("watch");
        radar.show(&host).unwrap();
        assert_eq!(errors(&radar), ["watch failed"]);
        assert!(requested(&radar));
        let (host, radar) = (Fake::new(), surface(spec()));
        host.fail("place");
        assert_eq!(radar.show(&host), Err("place failed".to_string()));
        assert!(!requested(&radar));
        let calls = host.calls();
        assert_eq!(
            calls.last().unwrap(),
            "place radar wanted=None size=(340, 300) default=Some((10, 20))"
        );
    }

    #[test]
    fn locking_changes_the_window_before_the_flag_and_unlocking_the_flag_first() {
        let pause = |pause: Pause, from: bool, to: bool| -> bool {
            let rule = Lock { pause, ..LOCK };
            let spec = Spec {
                lock: Some(rule),
                ..spec()
            };
            let (host, radar) = (Fake::new(), Rc::new(saved_at(spec, from)));
            radar.show(&host).unwrap();
            let (seen, watching) = (Rc::new(Cell::new(None)), radar.clone());
            let flag = seen.clone();
            host.during("click-through", move |_| flag.set(Some(locked(&watching))));
            radar.lock(&host, to).unwrap();
            assert_eq!(locked(&radar), to);
            seen.get().unwrap()
        };
        // The flag the region hit-test reads, as it is while the window's input changes.
        assert!(!pause(Pause::Unlocking, true, false));
        assert!(!pause(Pause::Unlocking, false, true));
        assert!(pause(Pause::Unlocking, true, true));
        assert!(!pause(Pause::Always, true, false));
        assert!(!pause(Pause::Always, true, true));

        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        host.active.set(true);
        host.pump(&radar);
        host.calls();
        radar.lock(&host, true).unwrap();
        // Input, then the saved choice, then the pass that re-shows a re-hidden window.
        assert_eq!(
            host.calls(),
            [
                "click-through radar true",
                "save-lock radar true",
                "schedule"
            ]
        );
        assert!(locked(&radar) && host.window(|w| w.click_through));
    }

    #[test]
    fn a_lock_before_the_window_exists_is_kept_and_saved() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.lock(&host, true).unwrap();
        assert_eq!(host.calls(), ["save-lock radar true", "schedule"]);
        assert!(locked(&radar));
        radar.show(&host).unwrap();
        assert!(host
            .calls()
            .contains(&"click-through radar true".to_string()));
    }

    #[test]
    fn a_refused_lock_rolls_back_as_the_window_says() {
        // Restore: the previous input state is applied again and the previous flag kept.
        let (host, radar) = (Fake::new(), saved_at(spec(), true));
        radar.show(&host).unwrap();
        host.calls();
        host.fail("click-through");
        assert_eq!(
            radar.lock(&host, false),
            Err("click-through failed".to_string())
        );
        assert_eq!(
            host.calls(),
            ["click-through radar false", "click-through radar true"]
        );
        assert!(locked(&radar) && host.window(|w| w.click_through));
        // Nothing was saved and no pass scheduled; a later change still works.
        radar.lock(&host, false).unwrap();
        assert!(!locked(&radar) && !host.window(|w| w.click_through));

        // Opposite: the flag takes the other state and nothing is applied again.
        let opposite = Spec {
            lock: Some(Lock {
                failure: Failure::Opposite,
                pause: Pause::Unlocking,
                ..LOCK
            }),
            ..spec()
        };
        for (from, to) in [(false, true), (true, false), (true, true)] {
            let (host, radar) = (Fake::new(), saved_at(opposite, from));
            radar.show(&host).unwrap();
            host.calls();
            host.fail("click-through");
            assert!(radar.lock(&host, to).is_err());
            assert_eq!(host.calls(), [format!("click-through radar {to}")]);
            assert_eq!(locked(&radar), !to, "{from} to {to}");
        }
    }

    #[test]
    fn a_lock_choice_that_cannot_be_saved_still_locks_and_is_reported() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        host.fail("save-lock");
        radar.lock(&host, true).unwrap();
        assert!(locked(&radar));
        assert_eq!(
            errors(&radar),
            ["Could not save the radar lock choice: save-lock failed"]
        );
    }

    #[test]
    fn a_locked_window_takes_input_only_over_its_reported_controls() {
        let (host, radar) = (Fake::new(), surface(spec()));
        let now = Instant::now();
        let at = |x: f64, y: f64| {
            host.pointer.set(Some(Pointer {
                at: (x, y),
                client: (340.0, 300.0),
                scale: 1.0,
            }))
        };
        radar.show(&host).unwrap();
        host.active.set(true);
        host.pump(&radar);
        report(&radar, now);
        host.calls();
        // Unlocked: the style is left alone wherever the cursor is.
        at(20.0, 20.0);
        radar.sync_input(&host, now);
        assert!(host.calls().is_empty());
        radar.lock(&host, true).unwrap();
        // A lock change drops the regions; the page reports them again.
        assert_eq!(regions(&radar), 0);
        report(&radar, now);
        host.pump(&radar);
        host.calls();
        at(200.0, 200.0);
        radar.sync_input(&host, now);
        assert_eq!(host.calls(), ["pass-through radar true"]);
        at(20.0, 20.0);
        radar.sync_input(&host, now);
        assert_eq!(host.calls(), ["pass-through radar false"]);
        // Stale regions fall back to click-through.
        radar.sync_input(&host, now + crate::hit::STALE_AFTER * 2);
        assert_eq!(host.calls(), ["pass-through radar true"]);
        // Hidden: click-through, and the regions are dropped until the page reports again.
        at(20.0, 20.0);
        radar.sync_input(&host, now);
        host.focus(&radar, false);
        host.calls();
        assert_eq!(regions(&radar), 0);
        radar.sync_input(&host, now);
        assert_eq!(host.calls(), ["pass-through radar true"]);
    }

    #[test]
    fn regions_are_kept_or_dropped_by_hide_and_lock_as_the_window_says() {
        let now = Instant::now();
        let keeps = Spec {
            lock: Some(Lock {
                clears_regions: false,
                ..LOCK
            }),
            ..spec()
        };
        let drops = Spec {
            hide_clears_regions: true,
            ..spec()
        };
        let (host, radar) = (Fake::new(), surface(keeps));
        report(&radar, now);
        radar.lock(&host, true).unwrap();
        radar.hide(&host).unwrap();
        // Kept until the focus pass hides the window.
        assert_eq!(regions(&radar), 1);
        host.pump(&radar);
        assert_eq!(regions(&radar), 0);
        let (host, radar) = (Fake::new(), surface(drops));
        report(&radar, now);
        radar.hide(&host).unwrap();
        assert_eq!(regions(&radar), 0);
        // An invalid report clears and is refused.
        report(&radar, now);
        assert!(radar
            .set_regions(&[[0.0, 0.0, 0.0, 10.0]], 1.0, now)
            .is_err());
        assert_eq!(regions(&radar), 0);
    }

    #[test]
    fn saved_geometry_is_restored_only_above_the_windows_own_minimum() {
        let small = Spec {
            min_saved: (100, 100),
            ..spec()
        };
        let at = |width: u32, height: u32| json!({"x":-1200,"y":40,"width":width,"height":height});
        assert_eq!(
            spec().saved(&at(260, 160)),
            Some(Geometry {
                x: -1200,
                y: 40,
                width: 260,
                height: 160
            })
        );
        assert_eq!(spec().saved(&at(259, 160)), None);
        assert_eq!(spec().saved(&at(260, 159)), None);
        assert!(small.saved(&at(100, 100)).is_some());
        assert_eq!(small.saved(&at(99, 100)), None);
        // Common to every window: on-screen coordinates, a sane ceiling, whole numbers.
        for spec in [spec(), small] {
            assert!(spec.saved(&at(16_384, 16_384)).is_some());
            assert_eq!(spec.saved(&at(16_385, 300)), None);
            assert_eq!(
                spec.saved(&json!({"x":100_001,"y":0,"width":340,"height":300})),
                None
            );
            assert_eq!(
                spec.saved(&json!({"x":0,"y":-100_001,"width":340,"height":300})),
                None
            );
            assert_eq!(spec.saved(&json!({"x":0,"y":0,"width":340})), None);
            assert_eq!(
                spec.saved(&json!({"x":"0","y":0,"width":340,"height":300})),
                None
            );
        }
    }

    #[test]
    fn a_drop_is_saved_as_the_users_geometry_when_the_window_keeps_it() {
        let sized = Spec {
            drops: Drops::Sized,
            ..spec()
        };
        let drop = |width: u32, height: u32| Geometry {
            x: 7,
            y: -9,
            width,
            height,
        };
        let (host, radar) = (Fake::new(), saved_at(spec(), false));
        radar.dropped(&host, drop(300, 200));
        assert_eq!(host.calls(), ["save-geometry radar.json 7,-9 300x200"]);
        // Too small to be restored: not saved, and the earlier geometry stays.
        radar.dropped(&host, drop(200, 200));
        assert!(host.calls().is_empty());
        radar.show(&host).unwrap();
        assert!(host.calls().contains(&"resize radar 300x200".to_string()));
        // A window that saves every sized drop.
        let (host, radar) = (Fake::new(), saved_at(sized, false));
        radar.dropped(&host, drop(200, 120));
        assert_eq!(host.calls(), ["save-geometry radar.json 7,-9 200x120"]);
        radar.dropped(&host, drop(0, 120));
        radar.dropped(&host, drop(200, 0));
        assert!(host.calls().is_empty());
        // Without a file nothing is queued.
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.dropped(&host, drop(300, 200));
        assert!(host.calls().is_empty());
    }

    #[test]
    fn a_migrated_geometry_is_saved_once_and_used_for_the_window() {
        fn shorter(g: Geometry, scale: f64) -> Geometry {
            if g.height == (320.0 * scale) as u32 {
                Geometry { height: 200, ..g }
            } else {
                g
            }
        }
        let migrating = Spec {
            migrate: Some(shorter),
            ..spec()
        };
        let (host, radar) = (Fake::new(), saved_at(migrating, false));
        radar.show(&host).unwrap();
        let calls = host.calls();
        assert_eq!(
            calls[2..5],
            [
                "save-geometry radar.json 40,60 400x200",
                "resize radar 400x200",
                "place radar wanted=Some((40, 60)) size=(400, 200) default=Some((10, 20))",
            ]
        );
        // At another scale the saved size is not the old default: kept, nothing saved.
        let (host, radar) = (Fake::new(), saved_at(migrating, false));
        host.scale.set(1.5);
        radar.show(&host).unwrap();
        let calls = host.calls();
        assert!(!calls.iter().any(|call| call.starts_with("save-geometry")));
        assert!(calls.contains(&"resize radar 400x320".to_string()));
    }

    #[test]
    fn closing_hides_the_window_and_keeps_it_for_the_next_show() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        host.active.set(true);
        host.pump(&radar);
        radar.ready().unwrap();
        host.calls();
        radar.close(&host).unwrap();
        host.pump(&radar);
        assert_eq!(host.calls(), ["schedule", "show radar false"]);
        assert!(host.exists(LABEL) && !requested(&radar));
        // The page stays mounted, and the next show reuses the window.
        assert!(radar.with(|life, _| life.ready()).unwrap());
        radar.show(&host).unwrap();
        host.pump(&radar);
        assert_eq!(host.calls(), ["schedule", "show radar true"]);
    }

    #[test]
    fn a_pass_that_cannot_be_scheduled_fails_the_request_it_follows() {
        let (host, radar) = (Fake::new(), surface(spec()));
        radar.show(&host).unwrap();
        host.fail("schedule");
        assert_eq!(radar.hide(&host), Err("schedule failed".to_string()));
        // The intent changed all the same; the next focus tick applies it.
        assert!(!requested(&radar));
    }

    #[test]
    fn errors_are_kept_once_each_up_to_a_limit() {
        let radar = surface(spec());
        for index in [0, 0, 1, 1, 0] {
            radar.note(format!("error {index}"));
        }
        assert_eq!(errors(&radar), ["error 0", "error 1"]);
        for index in 0..12 {
            radar.note(format!("error {index}"));
        }
        let errors = errors(&radar);
        assert_eq!(errors.len(), MAX_ERRORS);
        assert_eq!(errors[7], "error 7");
    }

    #[test]
    fn only_one_caller_creates_and_only_while_the_window_is_absent() {
        let mut guard = CreateOnce::default();
        assert!(!guard.begin(|| false));
        assert!(guard.begin(|| true));
        assert!(!guard.begin(|| panic!("not asked while someone is creating")));
        guard.finish();
        assert!(guard.begin(|| true));
    }
}
