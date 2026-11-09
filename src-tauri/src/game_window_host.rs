//! Tauri and Win32 for the in-game window lifecycle (`game_window`): the real `Host`, plus
//! the pieces every in-game window shares even when it keeps its own lifecycle (the DPS
//! meter, menu, trackers, damage details and alert popup): the builder chain and the locked
//! window's click-through toggle.
use crate::game_window::{Area, Build, Geometry, Host, Pointer, Policy, Saved, Spec, Surface};
use serde_json::{json, Value};
use std::path::PathBuf;
use tauri::{AppHandle, Manager, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

/// Builds a hidden in-game window. Call off the event loop's thread or from setup: window
/// creation waits on the event loop.
pub fn build(app: &AppHandle, plan: &Build) -> Result<WebviewWindow, String> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        plan.label,
        WebviewUrl::App(format!("index.html?view={}", plan.view).into()),
    )
    .title(crate::ui_preferences::title(app, plan.title))
    .inner_size(plan.size.0, plan.size.1);
    if let Some((width, height)) = plan.min_size {
        builder = builder.min_inner_size(width, height);
    }
    if let Some(resizable) = plan.resizable {
        builder = builder.resizable(resizable);
    }
    builder
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .focusable(plan.focusable)
        .visible(false)
        .build()
        .map_err(|e| e.to_string())
}

/// The cursor over a visible window, in its client pixels.
pub fn pointer(app: &AppHandle, window: &WebviewWindow) -> Option<Pointer> {
    if !window.is_visible().ok()? {
        return None;
    }
    let cursor = app.cursor_position().ok()?;
    let origin = window.inner_position().ok()?;
    let client = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?;
    Some(Pointer {
        at: (
            cursor.x - f64::from(origin.x),
            cursor.y - f64::from(origin.y),
        ),
        client: (f64::from(client.width), f64::from(client.height)),
        scale,
    })
}

/// Lets a locked window pass clicks to the game (`WS_EX_TRANSPARENT`) or take them. The
/// style is toggled directly between exactly the locked and unlocked styles tao applies:
/// tao's own flag update would re-hide the no-activate window, and `HTTRANSPARENT` would
/// only forward clicks to windows of this thread. `WS_EX_NOACTIVATE` stays, so a click on a
/// control never takes focus from the game.
#[cfg(all(windows, target_pointer_width = "64"))]
pub fn pass_through(window: &WebviewWindow, pass: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let passthrough = (WS_EX_TRANSPARENT | WS_EX_LAYERED) as isize;
    unsafe {
        let style = GetWindowLongPtrW(hwnd.0, GWL_EXSTYLE);
        let next = if pass {
            style | passthrough
        } else {
            style & !passthrough
        };
        if next != style {
            SetWindowLongPtrW(hwnd.0, GWL_EXSTYLE, next);
        }
    }
}
#[cfg(not(all(windows, target_pointer_width = "64")))]
pub fn pass_through(_: &WebviewWindow, _: bool) {}

/// A window's lifecycle with its saved geometry (`file` in the app data folder) and, when it
/// can be locked, its saved lock choice. Call from app setup, after `overlay_locks::setup`.
pub fn load<X: Policy>(
    app: &AppHandle,
    spec: Spec,
    file: &str,
    policy: X,
) -> Result<Surface<X>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(file);
    let geometry = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| spec.saved(&value));
    let locked = spec.lock.is_some() && crate::overlay_locks::saved(app, spec.label);
    let saved = Saved {
        geometry,
        path: Some(path),
        locked,
    };
    Ok(Surface::new(spec, saved, policy))
}

/// The real `Host` of one window module: the app, the module's focus pass (run by
/// `schedule`) and what it does with a dropped move or resize.
pub struct TauriHost<'a> {
    app: &'a AppHandle,
    pass: fn(&AppHandle, bool),
    on_drop: crate::window_positions::OnDrop,
}

impl<'a> TauriHost<'a> {
    pub fn new(
        app: &'a AppHandle,
        pass: fn(&AppHandle, bool),
        on_drop: crate::window_positions::OnDrop,
    ) -> Self {
        Self { app, pass, on_drop }
    }

    /// True while AION (or one of our overlays over it) is focused: the overlay focus gate.
    pub fn game_active(&self) -> bool {
        crate::overlay::game_active(self.app)
    }

    fn window(&self, label: &str) -> Result<WebviewWindow, String> {
        self.app
            .get_webview_window(label)
            .ok_or_else(|| format!("The {label} window is not open"))
    }
}

impl Host for TauriHost<'_> {
    fn exists(&self, label: &str) -> bool {
        self.app.get_webview_window(label).is_some()
    }
    fn visible(&self, label: &str) -> bool {
        self.app
            .get_webview_window(label)
            .is_some_and(|window| window.is_visible().unwrap_or(false))
    }
    fn scale(&self, label: &str) -> f64 {
        self.app
            .get_webview_window(label)
            .and_then(|window| window.scale_factor().ok())
            .unwrap_or(1.0)
    }
    fn game_area(&self) -> Option<Area> {
        crate::overlay::game_rect()
    }
    fn monitor_area(&self, label: &str) -> Option<Area> {
        let monitor = self
            .app
            .get_webview_window(label)?
            .primary_monitor()
            .ok()??;
        let (p, s) = (monitor.position(), monitor.size());
        Some((p.x, p.y, p.x + s.width as i32, p.y + s.height as i32))
    }
    fn built_size(&self, label: &str) -> (i32, i32) {
        self.app
            .get_webview_window(label)
            .map_or((1, 1), |window| crate::window_positions::size_of(&window))
    }
    fn pointer(&self, label: &str) -> Option<Pointer> {
        pointer(self.app, &self.app.get_webview_window(label)?)
    }
    fn build(&self, plan: &Build) -> Result<(), String> {
        build(self.app, plan).map(|_| ())
    }
    fn guard(&self, label: &str) {
        if let Some(window) = self.app.get_webview_window(label) {
            crate::overlay::guard_activation(self.app, &window);
        }
    }
    fn resize(&self, label: &str, width: u32, height: u32) -> Result<(), String> {
        self.window(label)?
            .set_size(PhysicalSize::new(width, height))
            .map_err(|e| e.to_string())
    }
    fn place(
        &self,
        label: &str,
        wanted: Option<(i32, i32)>,
        size: (i32, i32),
        default: Option<(i32, i32)>,
    ) -> Result<(), String> {
        crate::window_positions::place(&self.window(label)?, wanted, size, default)
    }
    fn watch(&self, label: &str) -> Result<(), String> {
        crate::window_positions::watch(&self.window(label)?, self.on_drop)
    }
    fn click_through(&self, label: &str, on: bool) -> Result<(), String> {
        // Locked or not, the window never takes focus from the game (`no_activate`).
        self.window(label)?
            .set_ignore_cursor_events(on)
            .map_err(|e| e.to_string())
    }
    fn show(&self, label: &str, visible: bool) -> Result<(), String> {
        crate::overlay::set_visible_without_activation(&self.window(label)?, visible)
    }
    fn pass_through(&self, label: &str, pass: bool) {
        if let Some(window) = self.app.get_webview_window(label) {
            pass_through(&window, pass);
        }
    }
    fn schedule(&self) -> Result<(), String> {
        let (handle, pass) = (self.app.clone(), self.pass);
        self.app
            .run_on_main_thread(move || pass(&handle, crate::overlay::game_active(&handle)))
            .map_err(|e| e.to_string())
    }
    fn save_geometry(&self, path: PathBuf, at: Geometry) {
        crate::window_positions::save_file(
            self.app,
            path,
            &json!({"x":at.x,"y":at.y,"width":at.width,"height":at.height}),
        );
    }
    fn save_lock(&self, label: &str, locked: bool) -> Result<(), String> {
        crate::overlay_locks::save(self.app, label, locked)
    }
}
