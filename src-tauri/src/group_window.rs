//! Fits the Group window to its content: the panel reports the logical size that shows
//! the whole roster without scrolling, and the window takes it, clamped to the work area
//! of its monitor and moved from its anchor (`window_positions`) only as far as needed to
//! stay inside it. Fitting never saves a position. Never activates, shows or hides the
//! window; visibility stays with the room automation in `overlay.rs`.
use tauri::Manager;

const LABEL: &str = "group-overlay";
/// Smallest content the panel can draw (a collapsed caption) and a sane logical ceiling.
const MIN_WIDTH: f64 = 240.0;
const MIN_HEIGHT: f64 = 24.0;
const MAX_LOGICAL: f64 = 4096.0;

/// Physical window geometry: top-left and size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Rect {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

/// The geometry for a logical content size at `scale`: the size in physical pixels, no
/// larger than the work area, and the window kept where it is unless that would leave
/// part of it outside, in which case it moves back in.
fn fit(window: Rect, work: Rect, width: f64, height: f64, scale: f64) -> Rect {
    let width = ((width * scale).ceil() as i32).clamp(1, work.width.max(1));
    let height = ((height * scale).ceil() as i32).clamp(1, work.height.max(1));
    Rect {
        x: window.x.min(work.x + work.width - width).max(work.x),
        y: window.y.min(work.y + work.height - height).max(work.y),
        width,
        height,
    }
}

fn valid(width: f64, height: f64) -> bool {
    width.is_finite()
        && height.is_finite()
        && (MIN_WIDTH..=MAX_LOGICAL).contains(&width)
        && (MIN_HEIGHT..=MAX_LOGICAL).contains(&height)
}

/// Group webview: size the window to `width` × `height` logical pixels of content.
#[tauri::command]
pub fn group_fit(window: tauri::WebviewWindow, width: f64, height: f64) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Only the Group window can fit itself".into());
    }
    if !valid(width, height) {
        return Err("Invalid Group window size".into());
    }
    let position = window.outer_position().map_err(|e| e.to_string())?;
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let current = Rect {
        x: position.x,
        y: position.y,
        width: size.width as i32,
        height: size.height as i32,
    };
    // Fitting starts from where the window belongs (the user's drop or its opening spot), so a
    // roster that grew and pushed it up comes back down when it shrinks. During a drag it
    // starts from the pointer's spot instead, so the window never jumps away from the cursor.
    let app = window.app_handle();
    let anchor = crate::window_positions::anchor(app, LABEL)
        .filter(|_| !crate::window_positions::moving(app, LABEL))
        .map_or(current, |(x, y)| Rect { x, y, ..current });
    let monitor = window
        .current_monitor()
        .map_err(|e| e.to_string())?
        .or(window.primary_monitor().map_err(|e| e.to_string())?);
    let (work, scale) = match monitor {
        Some(monitor) => {
            let area = monitor.work_area();
            (
                Rect {
                    x: area.position.x,
                    y: area.position.y,
                    width: area.size.width as i32,
                    height: area.size.height as i32,
                },
                monitor.scale_factor(),
            )
        }
        None => (
            Rect { x: i32::MIN / 2, y: i32::MIN / 2, width: i32::MAX, height: i32::MAX },
            window.scale_factor().map_err(|e| e.to_string())?,
        ),
    };
    let next = fit(anchor, work, width, height, scale);
    if next == current {
        return Ok(());
    }
    place_without_activation(&window, next)
}

#[cfg(windows)]
fn place_without_activation(window: &tauri::WebviewWindow, rect: Rect) -> Result<(), String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOZORDER,
    };
    let hwnd = window.hwnd().map_err(|e| e.to_string())?;
    // Moves and sizes in one step; no SWP_SHOWWINDOW, so a hidden window stays hidden.
    let ok = unsafe {
        SetWindowPos(
            hwnd.0,
            std::ptr::null_mut(),
            rect.x,
            rect.y,
            rect.width,
            rect.height,
            SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
        )
    };
    if ok == 0 {
        return Err("Could not size the Group window".into());
    }
    Ok(())
}
#[cfg(not(windows))]
fn place_without_activation(window: &tauri::WebviewWindow, rect: Rect) -> Result<(), String> {
    window
        .set_size(tauri::PhysicalSize::new(rect.width as u32, rect.height as u32))
        .map_err(|e| e.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(rect.x, rect.y))
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    const WORK: Rect = Rect { x: 0, y: 0, width: 1920, height: 1040 };

    #[test]
    fn scales_logical_content_to_physical_pixels() {
        let at = Rect { x: 100, y: 120, width: 320, height: 360 };
        assert_eq!(fit(at, WORK, 320.0, 241.5, 1.0), Rect { x: 100, y: 120, width: 320, height: 242 });
        assert_eq!(fit(at, WORK, 600.0, 400.0, 1.5), Rect { x: 100, y: 120, width: 900, height: 600 });
    }

    #[test]
    fn clamps_to_the_work_area_and_moves_back_inside() {
        let low = Rect { x: 1700, y: 900, width: 320, height: 360 };
        // A raid grows the window past the right and bottom edges: it moves in.
        assert_eq!(fit(low, WORK, 600.0, 420.0, 1.0), Rect { x: 1320, y: 620, width: 600, height: 420 });
        // Taller than the work area: as tall as it, from its top (the panel scrolls).
        assert_eq!(fit(low, WORK, 320.0, 5000.0, 1.0), Rect { x: 1600, y: 0, width: 320, height: 1040 });
        // A second monitor left of the primary, with a taskbar at its top.
        let left = Rect { x: -1280, y: 40, width: 1280, height: 984 };
        let at = Rect { x: -200, y: 10, width: 320, height: 360 };
        assert_eq!(fit(at, left, 600.0, 300.0, 1.0), Rect { x: -600, y: 40, width: 600, height: 300 });
    }

    #[test]
    fn keeps_a_window_that_already_fits_where_it_is() {
        let at = Rect { x: 24, y: 96, width: 600, height: 380 };
        assert_eq!(fit(at, WORK, 600.0, 380.0, 1.0), at);
        // Collapsing only shrinks it, from the top.
        assert_eq!(fit(at, WORK, 600.0, 34.0, 1.0), Rect { height: 34, ..at });
    }

    #[test]
    fn fitting_from_the_anchor_returns_a_pushed_window_to_the_users_spot() {
        // The user dropped the panel low; a full raid pushes it up to stay on screen...
        let dropped = Rect { x: 1500, y: 700, width: 320, height: 200 };
        let grown = fit(dropped, WORK, 400.0, 600.0, 1.0);
        assert_eq!(grown, Rect { x: 1500, y: 440, width: 400, height: 600 });
        // ...and back at its dropped top-left once the roster shrinks, fitting from the anchor
        // rather than from where the clamp left it.
        assert_eq!(fit(dropped, WORK, 320.0, 200.0, 1.0), dropped);
        assert_ne!(fit(grown, WORK, 320.0, 200.0, 1.0), dropped);
    }

    #[test]
    fn rejects_nonsense_sizes() {
        assert!(valid(320.0, 34.0));
        assert!(!valid(f64::NAN, 300.0));
        assert!(!valid(320.0, f64::INFINITY));
        assert!(!valid(10.0, 300.0));
        assert!(!valid(320.0, 0.0));
        assert!(!valid(320.0, 100_000.0));
    }
}
