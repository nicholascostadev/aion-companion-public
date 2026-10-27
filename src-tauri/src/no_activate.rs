//! In-game overlays never take activation from AION: clicking one must leave the game in the
//! foreground (AION silences its audio in the background). Every in-game window is built
//! with `focusable(false)` (tao's `WS_EX_NOACTIVATE`, which stops a click from making it the
//! foreground window) and gets this guard on its top-level window, which:
//! - answers `WM_MOUSEACTIVATE` with `MA_NOACTIVATE`, so a click is delivered without even
//!   activating the window inside this process (the webview's own child windows ask it);
//! - keeps `WS_EX_NOACTIVATE` through every later style change (lock, click-through, tao's
//!   flag updates), so no path can make an overlay activatable again;
//! - runs window moves and resizes itself, with mouse capture and `SWP_NOACTIVATE`, instead
//!   of the system move/size loop, whose start moves focus into the webview (wry handles
//!   `WM_ENTERSIZEMOVE` that way). `startDragging`, `startResizeDragging` and Tauri's
//!   undecorated resize borders all post `WM_NCLBUTTONDOWN` with a hit-test code; the guard
//!   takes those over and ends with `WM_EXITSIZEMOVE`, so saved positions and tao's drag
//!   state behave as after a system move. Windows only lets a window that is not in the
//!   foreground keep the mouse captured while a button is held, and the guard checks the
//!   button on every move as well, so a move or resize can never keep the mouse after
//!   release. A drag shorter than the webview's round trip just ends at once.
//!
//! Every overlay is built hidden, and `set_visible_without_activation` (on the window's own
//! thread) installs the guard again before each show, so none is shown without it: a failed
//! install leaves the window hidden and is reported by the caller.
//!
//! Typing is the one deliberate exception: keyboard input only reaches the foreground
//! window, so `overlay_take_keyboard` brings an overlay forward when the user clicks into
//! one of its text fields. Nothing here touches the game process or its input.

/// Win32 hit-test codes the guard moves or resizes for (`HTCAPTION`, `HTLEFT`..`HTBOTTOMRIGHT`).
const CAPTION: u32 = 2;
const LEFT: u32 = 10;
const RIGHT: u32 = 11;
const TOP: u32 = 12;
const TOP_LEFT: u32 = 13;
const TOP_RIGHT: u32 = 14;
const BOTTOM: u32 = 15;
const BOTTOM_LEFT: u32 = 16;
const BOTTOM_RIGHT: u32 = 17;

fn tracks(hit: u32) -> bool {
    hit == CAPTION || (LEFT..=BOTTOM_RIGHT).contains(&hit)
}

/// A window rectangle in physical screen pixels.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Bounds {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

/// Where a move (`CAPTION`) or an edge/corner resize leaves a window that started at `start`
/// once the cursor has moved by `delta`. Sizes stay within `min`..=`max` and the edges that
/// are not dragged stay where they were.
fn track(
    start: Bounds,
    hit: u32,
    (dx, dy): (i32, i32),
    min: (i32, i32),
    max: (i32, i32),
) -> Bounds {
    if hit == CAPTION {
        return Bounds {
            left: start.left + dx,
            top: start.top + dy,
            right: start.right + dx,
            bottom: start.bottom + dy,
        };
    }
    let (min_w, min_h) = (min.0.max(1), min.1.max(1));
    let (max_w, max_h) = (max.0.max(min_w), max.1.max(min_h));
    let mut next = start;
    if matches!(hit, LEFT | TOP_LEFT | BOTTOM_LEFT) {
        next.left = (start.left + dx).clamp(start.right - max_w, start.right - min_w);
    }
    if matches!(hit, RIGHT | TOP_RIGHT | BOTTOM_RIGHT) {
        next.right = (start.right + dx).clamp(start.left + min_w, start.left + max_w);
    }
    if matches!(hit, TOP | TOP_LEFT | TOP_RIGHT) {
        next.top = (start.top + dy).clamp(start.bottom - max_h, start.bottom - min_h);
    }
    if matches!(hit, BOTTOM | BOTTOM_LEFT | BOTTOM_RIGHT) {
        next.bottom = (start.bottom + dy).clamp(start.top + min_h, start.top + max_h);
    }
    next
}

/// Installs the guard on an in-game window (on the thread that owns it). Idempotent.
#[cfg(windows)]
pub fn guard(window: &tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Manager;
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let app = window.app_handle().clone();
    // A subclass is installed on the thread that owns the window.
    window
        .run_on_main_thread(move || {
            if let Err(error) = native::install(hwnd) {
                crate::overlay::record_error(&app, error);
            }
        })
        .map_err(|e| e.to_string())
}
#[cfg(not(windows))]
pub fn guard(_: &tauri::WebviewWindow) -> Result<(), String> {
    Ok(())
}

/// Installs the guard now; call only on the thread that owns `hwnd`. Idempotent.
#[cfg(windows)]
pub fn ensure(hwnd: isize) -> Result<(), String> {
    native::install(hwnd)
}

/// The user clicked into a text field of an in-game window: make that window the foreground
/// window so the keyboard reaches it. The click just delivered to this process is what lets
/// Windows grant it; the game comes back when the user clicks it again.
#[tauri::command]
pub fn overlay_take_keyboard(window: tauri::WebviewWindow) -> Result<bool, String> {
    if window.label() == "main" {
        return Ok(false);
    }
    take_keyboard(&window)
}
#[cfg(windows)]
fn take_keyboard(window: &tauri::WebviewWindow) -> Result<bool, String> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, SetForegroundWindow};
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0;
    if !window.is_visible().map_err(|e| e.to_string())? {
        return Ok(false);
    }
    Ok(unsafe { GetForegroundWindow() == hwnd || SetForegroundWindow(hwnd) != 0 })
}
#[cfg(not(windows))]
fn take_keyboard(window: &tauri::WebviewWindow) -> Result<bool, String> {
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(true)
}

#[cfg(windows)]
mod native {
    use super::{track, tracks, Bounds, CAPTION};
    use std::cell::Cell;
    use windows_sys::Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        UI::{
            Input::KeyboardAndMouse::{
                GetAsyncKeyState, GetCapture, GetKeyState, ReleaseCapture, SetCapture, VK_LBUTTON,
                VK_RBUTTON,
            },
            Shell::{DefSubclassProc, GetWindowSubclass, RemoveWindowSubclass, SetWindowSubclass},
            WindowsAndMessaging::{
                GetCursorPos, GetSystemMetrics, GetWindowRect, LoadCursorW, SendMessageW,
                SetCursor, SetWindowPos, GWL_EXSTYLE, IDC_SIZENESW, IDC_SIZENS, IDC_SIZENWSE,
                IDC_SIZEWE, MA_NOACTIVATE, MINMAXINFO, SM_CXMAXTRACK, SM_CYMAXTRACK, SM_SWAPBUTTON,
                STYLESTRUCT, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
                WM_CAPTURECHANGED, WM_EXITSIZEMOVE, WM_GETMINMAXINFO, WM_LBUTTONDOWN, WM_LBUTTONUP,
                WM_MOUSEACTIVATE, WM_MOUSEMOVE, WM_NCDESTROY, WM_NCLBUTTONDOWN, WM_STYLECHANGING,
                WS_EX_NOACTIVATE,
            },
        },
    };

    const ID: usize = 0x4149_4e41;

    #[derive(Clone, Copy)]
    struct Drag {
        hit: u32,
        cursor: POINT,
        start: Bounds,
        min: (i32, i32),
        max: (i32, i32),
    }

    #[derive(Default)]
    struct Guard {
        drag: Cell<Option<Drag>>,
    }

    pub fn install(hwnd: isize) -> Result<(), String> {
        let hwnd = hwnd as HWND;
        let mut existing = 0;
        if unsafe { GetWindowSubclass(hwnd, Some(proc), ID, &mut existing) } != 0 {
            return Ok(());
        }
        let guard = Box::into_raw(Box::<Guard>::default());
        if unsafe { SetWindowSubclass(hwnd, Some(proc), ID, guard as usize) } == 0 {
            drop(unsafe { Box::from_raw(guard) });
            return Err("Could not keep an overlay from taking focus from the game".into());
        }
        Ok(())
    }

    /// `MK_LBUTTON` in a mouse message's `wParam`: the primary button is down.
    const MK_LBUTTON: WPARAM = 0x0001;

    /// The primary button is down, as this thread's input state or the hardware reports it.
    /// The hardware read (`GetAsyncKeyState`) can be unavailable: it returns zero when UIPI or
    /// desktop access keeps this process from the foreground thread, which may be the game's.
    fn primary_down() -> bool {
        pressed_here() || pressed_anywhere()
    }

    /// The primary button in this thread's input state, which follows the mouse messages the
    /// thread has read (`WM_LBUTTONDOWN`/`UP`; the webview's windows share the state when
    /// their input is attached to this thread). It can lag a release still in the queue.
    fn pressed_here() -> bool {
        (unsafe { GetKeyState(i32::from(VK_LBUTTON)) } as u16 & 0x8000) != 0
    }

    /// The primary button as the user has it (the physical right one when swapped).
    fn pressed_anywhere() -> bool {
        #[cfg(test)]
        if let Some(pressed) = tests::HARDWARE.with(std::cell::Cell::get) {
            return pressed;
        }
        let key = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        (unsafe { GetAsyncKeyState(i32::from(key)) } as u16 & 0x8000) != 0
    }

    fn cursor() -> Option<POINT> {
        let mut point = POINT { x: 0, y: 0 };
        (unsafe { GetCursorPos(&mut point) } != 0).then_some(point)
    }

    fn bounds(hwnd: HWND) -> Option<Bounds> {
        let mut rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        (unsafe { GetWindowRect(hwnd, &mut rect) } != 0).then_some(Bounds {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        })
    }

    /// Size limits as tao reports them (the window's min/max inner size, as outer size).
    fn limits(hwnd: HWND) -> ((i32, i32), (i32, i32)) {
        let mut info: MINMAXINFO = unsafe { std::mem::zeroed() };
        info.ptMinTrackSize = POINT { x: 1, y: 1 };
        info.ptMaxTrackSize = POINT {
            x: unsafe { GetSystemMetrics(SM_CXMAXTRACK) },
            y: unsafe { GetSystemMetrics(SM_CYMAXTRACK) },
        };
        unsafe {
            SendMessageW(
                hwnd,
                WM_GETMINMAXINFO,
                0,
                &mut info as *mut MINMAXINFO as LPARAM,
            )
        };
        (
            (info.ptMinTrackSize.x, info.ptMinTrackSize.y),
            (info.ptMaxTrackSize.x, info.ptMaxTrackSize.y),
        )
    }

    fn resize_cursor(hit: u32) {
        use super::{BOTTOM, BOTTOM_LEFT, BOTTOM_RIGHT, LEFT, RIGHT, TOP, TOP_LEFT, TOP_RIGHT};
        let shape = match hit {
            LEFT | RIGHT => IDC_SIZEWE,
            TOP | BOTTOM => IDC_SIZENS,
            TOP_LEFT | BOTTOM_RIGHT => IDC_SIZENWSE,
            TOP_RIGHT | BOTTOM_LEFT => IDC_SIZENESW,
            _ => return,
        };
        unsafe { SetCursor(LoadCursorW(std::ptr::null_mut(), shape)) };
    }

    /// Starts a move or resize, or ends it at once when the button is no longer `held` (a
    /// click shorter than the round trip from the webview).
    fn begin(hwnd: HWND, guard: &Guard, hit: u32, held: bool) {
        crate::window_positions::begin_user_move(hwnd as isize);
        let (Some(cursor), Some(start)) = (cursor(), bounds(hwnd)) else {
            return finish(hwnd, guard);
        };
        if !held {
            return finish(hwnd, guard);
        }
        let (min, max) = limits(hwnd);
        guard.drag.set(Some(Drag {
            hit,
            cursor,
            start,
            min,
            max,
        }));
        unsafe { SetCapture(hwnd) };
        resize_cursor(hit);
    }

    /// Follows a mouse message whose `wParam` reports the buttons held at the time.
    fn follow(hwnd: HWND, guard: &Guard, buttons: WPARAM) {
        let Some(drag) = guard.drag.get() else {
            return;
        };
        if buttons & MK_LBUTTON == 0 && !pressed_anywhere() {
            return finish(hwnd, guard);
        }
        let Some(at) = cursor() else {
            return;
        };
        let next = track(
            drag.start,
            drag.hit,
            (at.x - drag.cursor.x, at.y - drag.cursor.y),
            drag.min,
            drag.max,
        );
        // A move keeps whatever size Windows gives the window on another display's scale.
        let size = if drag.hit == CAPTION { SWP_NOSIZE } else { 0 };
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                next.left,
                next.top,
                next.right - next.left,
                next.bottom - next.top,
                SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER | size,
            );
        }
        resize_cursor(drag.hit);
    }

    /// Ends a move or resize like the system loop does: `WM_EXITSIZEMOVE` saves the drop
    /// (`window_positions`) and clears tao's drag state.
    fn finish(hwnd: HWND, guard: &Guard) {
        guard.drag.set(None);
        unsafe {
            if GetCapture() == hwnd {
                ReleaseCapture();
            }
            SendMessageW(hwnd, WM_EXITSIZEMOVE, 0, 0);
        }
    }

    unsafe extern "system" fn proc(
        hwnd: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        id: usize,
        data: usize,
    ) -> LRESULT {
        let guard = unsafe { &*(data as *const Guard) };
        // Nothing may unwind into the window procedure.
        let handled = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match message {
            WM_MOUSEACTIVATE => Some(MA_NOACTIVATE as LRESULT),
            WM_STYLECHANGING if wparam as i32 == GWL_EXSTYLE => {
                if lparam != 0 {
                    let style = unsafe { &mut *(lparam as *mut STYLESTRUCT) };
                    style.styleNew |= WS_EX_NOACTIVATE;
                }
                None
            }
            WM_NCLBUTTONDOWN if tracks(wparam as u32) => {
                if guard.drag.get().is_none() {
                    begin(hwnd, guard, wparam as u32, primary_down());
                }
                Some(0)
            }
            WM_MOUSEMOVE if guard.drag.get().is_some() => {
                follow(hwnd, guard, wparam);
                Some(0)
            }
            WM_LBUTTONUP if guard.drag.get().is_some() => {
                finish(hwnd, guard);
                Some(0)
            }
            // A new press while moving: the release was never seen (e.g. it came before the
            // move started), so that move is stale. The press goes on as usual.
            WM_LBUTTONDOWN if guard.drag.get().is_some() => {
                finish(hwnd, guard);
                None
            }
            // Something else took the mouse (or the capture was released): the drag is over.
            WM_CAPTURECHANGED if guard.drag.get().is_some() && lparam as HWND != hwnd => {
                finish(hwnd, guard);
                None
            }
            _ => None,
        }))
        .unwrap_or(None);
        if let Some(result) = handled {
            return result;
        }
        if message == WM_NCDESTROY {
            unsafe {
                RemoveWindowSubclass(hwnd, Some(proc), id);
                drop(Box::from_raw(data as *mut Guard));
            }
        }
        unsafe { DefSubclassProc(hwnd, message, wparam, lparam) }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            CreateWindowExW, DefWindowProcW, DestroyWindow, GetWindowLongPtrW, RegisterClassW,
            SetWindowLongPtrW, HTCLIENT, MA_ACTIVATE, WNDCLASSW, WS_CHILD, WS_EX_TOOLWINDOW,
            WS_POPUP,
        };

        unsafe extern "system" fn plain(
            hwnd: HWND,
            message: u32,
            wparam: WPARAM,
            lparam: LPARAM,
        ) -> LRESULT {
            unsafe { DefWindowProcW(hwnd, message, wparam, lparam) }
        }

        fn class() -> Vec<u16> {
            let name: Vec<u16> = "AionNoActivateTest\0".encode_utf16().collect();
            let class = WNDCLASSW {
                style: 0,
                lpfnWndProc: Some(plain),
                cbClsExtra: 0,
                cbWndExtra: 0,
                hInstance: std::ptr::null_mut(),
                hIcon: std::ptr::null_mut(),
                hCursor: std::ptr::null_mut(),
                hbrBackground: std::ptr::null_mut(),
                lpszMenuName: std::ptr::null(),
                lpszClassName: name.as_ptr(),
            };
            unsafe { RegisterClassW(&class) };
            name
        }

        fn window(class: &[u16], style: u32, parent: HWND) -> HWND {
            let hwnd = unsafe {
                CreateWindowExW(
                    WS_EX_TOOLWINDOW,
                    class.as_ptr(),
                    std::ptr::null(),
                    style,
                    0,
                    0,
                    200,
                    100,
                    parent,
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null(),
                )
            };
            assert!(!hwnd.is_null());
            hwnd
        }

        /// Real (hidden) windows answering real messages: the guarded top-level window and a
        /// child that defers to it, as the webview's container window does.
        #[test]
        fn guarded_windows_refuse_click_activation_and_keep_the_style() {
            let class = class();
            let top = window(&class, WS_POPUP, std::ptr::null_mut());
            let child = window(&class, WS_CHILD, top);
            let ask = |hwnd| unsafe {
                SendMessageW(
                    hwnd,
                    WM_MOUSEACTIVATE,
                    top as WPARAM,
                    (WM_LBUTTONDOWN_HT) as LPARAM,
                )
            };
            assert_eq!(ask(top), MA_ACTIVATE as LRESULT);
            install(top as isize).unwrap();
            install(top as isize).unwrap();
            assert_eq!(ask(top), MA_NOACTIVATE as LRESULT);
            assert_eq!(ask(child), MA_NOACTIVATE as LRESULT);
            unsafe {
                SetWindowLongPtrW(top, GWL_EXSTYLE, WS_EX_TOOLWINDOW as isize);
                assert_ne!(
                    GetWindowLongPtrW(top, GWL_EXSTYLE) as u32 & WS_EX_NOACTIVATE,
                    0
                );
                // A move whose button is already up ends at once: nothing moves and the mouse
                // is never captured. (The button state is given, never the user's real one.)
                let before = bounds(top);
                let quick = Guard::default();
                begin(top, &quick, CAPTION, false);
                assert!(quick.drag.get().is_none());
                assert_eq!(bounds(top), before);
                assert!(GetCapture() != top);
                DestroyWindow(top);
            }
        }

        /// `HTCLIENT` in the low word, `WM_LBUTTONDOWN` in the high word.
        const WM_LBUTTONDOWN_HT: usize = (HTCLIENT as usize) | (0x0201 << 16);

        /// The drag the guard of `hwnd` is running, if any.
        fn dragging(hwnd: HWND) -> bool {
            let mut data = 0;
            assert_ne!(
                unsafe { GetWindowSubclass(hwnd, Some(proc), ID, &mut data) },
                0
            );
            unsafe { &*(data as *const Guard) }.drag.get().is_some()
        }

        thread_local! {
            /// What the hardware read reports on this test thread, instead of the user's mouse.
            pub(super) static HARDWARE: Cell<Option<bool>> = const { Cell::new(None) };
        }

        /// The hardware read reports the button up (unavailable) until dropped, whatever the
        /// user's mouse does while the tests run.
        struct HardwareUnavailable;
        impl HardwareUnavailable {
            fn new() -> Self {
                HARDWARE.with(|hardware| hardware.set(Some(false)));
                Self
            }
        }
        impl Drop for HardwareUnavailable {
            fn drop(&mut self) {
                HARDWARE.with(|hardware| hardware.set(None));
            }
        }

        /// This thread's input state has the primary button down until dropped, as it has
        /// while the webview holds the press that asked for the move.
        struct PressedHere([u8; 256]);
        impl PressedHere {
            fn new() -> Self {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
                    GetKeyboardState, SetKeyboardState,
                };
                let mut saved = [0u8; 256];
                assert_ne!(unsafe { GetKeyboardState(saved.as_mut_ptr()) }, 0);
                let mut pressed = saved;
                pressed[usize::from(VK_LBUTTON)] |= 0x80;
                assert_ne!(unsafe { SetKeyboardState(pressed.as_ptr()) }, 0);
                Self(saved)
            }
        }
        impl Drop for PressedHere {
            fn drop(&mut self) {
                use windows_sys::Win32::UI::Input::KeyboardAndMouse::SetKeyboardState;
                unsafe { SetKeyboardState(self.0.as_ptr()) };
            }
        }

        /// Sends `WM_NCLBUTTONDOWN` with `HTCAPTION`, as `startDragging` posts it, while the
        /// press is held in this thread's input state.
        fn start_move(top: HWND) {
            let _pressed = PressedHere::new();
            unsafe { SendMessageW(top, WM_NCLBUTTONDOWN, CAPTION as WPARAM, 0) };
        }

        /// A move follows the press the window's own input reports, from `startDragging`'s
        /// `WM_NCLBUTTONDOWN` through its mouse messages, and ends when they report the release.
        #[test]
        fn moves_follow_the_windows_own_press_and_release() {
            let class = class();
            let top = window(&class, WS_POPUP, std::ptr::null_mut());
            install(top as isize).unwrap();
            let _hardware = HardwareUnavailable::new();
            let send = |message, wparam| unsafe { SendMessageW(top, message, wparam, 0) };
            start_move(top);
            assert!(dragging(top), "a held press must start the move");
            assert_eq!(unsafe { GetCapture() }, top);
            // Moves that still carry the button keep the drag; the first without it ends it.
            send(WM_MOUSEMOVE, MK_LBUTTON);
            assert!(
                dragging(top),
                "a move with the button held must not end the drag"
            );
            send(WM_MOUSEMOVE, 0);
            assert!(!dragging(top));
            assert!(unsafe { GetCapture() } != top);
            // Nothing is left behind: the next press moves the window again.
            start_move(top);
            assert!(dragging(top));
            send(WM_LBUTTONUP, 0);
            assert!(!dragging(top));
            assert!(unsafe { GetCapture() } != top);
            unsafe { DestroyWindow(top) };
        }

        /// A release that was still queued when the move started (the input state lagged
        /// behind it) never leaves a move running: the next move without the button, or the
        /// next press, ends it.
        #[test]
        fn a_release_before_the_move_never_leaves_it_running() {
            let class = class();
            let top = window(&class, WS_POPUP, std::ptr::null_mut());
            install(top as isize).unwrap();
            let _hardware = HardwareUnavailable::new();
            let send = |message, wparam| unsafe { SendMessageW(top, message, wparam, 0) };
            let before = bounds(top);
            start_move(top);
            assert!(dragging(top));
            send(WM_MOUSEMOVE, 0);
            assert!(!dragging(top));
            assert!(unsafe { GetCapture() } != top);
            assert_eq!(bounds(top), before);
            start_move(top);
            assert!(dragging(top));
            send(WM_LBUTTONDOWN, MK_LBUTTON);
            assert!(
                !dragging(top),
                "a new press must end a move whose release was missed"
            );
            assert!(unsafe { GetCapture() } != top);
            unsafe { DestroyWindow(top) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const START: Bounds = Bounds {
        left: 100,
        top: 100,
        right: 400,
        bottom: 300,
    };

    #[test]
    fn moves_keep_the_size() {
        assert_eq!(
            track(START, CAPTION, (-150, 40), (1, 1), (9999, 9999)),
            Bounds {
                left: -50,
                top: 140,
                right: 250,
                bottom: 340
            }
        );
    }

    #[test]
    fn resizes_move_only_the_dragged_edges_within_the_limits() {
        let limits = ((260, 180), (1000, 800));
        assert_eq!(
            track(START, BOTTOM_RIGHT, (50, 30), limits.0, limits.1),
            Bounds {
                left: 100,
                top: 100,
                right: 450,
                bottom: 330
            }
        );
        // Shrinking past the minimum stops at it; the opposite edges never move.
        assert_eq!(
            track(START, BOTTOM_RIGHT, (-200, -200), limits.0, limits.1),
            Bounds {
                left: 100,
                top: 100,
                right: 360,
                bottom: 280
            }
        );
        assert_eq!(
            track(START, TOP_LEFT, (100, 100), limits.0, limits.1),
            Bounds {
                left: 140,
                top: 120,
                right: 400,
                bottom: 300
            }
        );
        assert_eq!(
            track(START, LEFT, (-2000, 0), limits.0, limits.1),
            Bounds {
                left: -600,
                top: 100,
                right: 400,
                bottom: 300
            }
        );
        assert_eq!(
            track(START, TOP, (0, -10), limits.0, limits.1),
            Bounds {
                left: 100,
                top: 90,
                right: 400,
                bottom: 300
            }
        );
    }

    #[test]
    fn only_move_and_border_codes_are_taken_over() {
        assert!(tracks(CAPTION));
        assert!((LEFT..=BOTTOM_RIGHT).all(tracks));
        // HTCLIENT, HTSYSMENU, HTCLOSE and HTBORDER stay with Windows.
        assert!(![1, 3, 20, 18].into_iter().any(tracks));
    }
}
