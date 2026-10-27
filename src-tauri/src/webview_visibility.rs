//! Keep the browser's visibility in step with its native host. Hiding an HWND (including
//! the no-activate overlay path) does not hide its WebView2 controller. Hidden controllers
//! let Chromium throttle page work. Low memory targets additionally let inactive browsers
//! release caches or page memory out while keeping their JavaScript and window state.
use tauri::{AppHandle, Manager, WebviewWindow};
#[cfg(windows)]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2Controller, ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
};
#[cfg(windows)]
use windows_core::Interface;

/// Read the host at execution time, rather than capturing a hide/show request that may be
/// overtaken while this callback waits for the main thread. Failed updates remain retryable.
#[cfg(any(windows, test))]
fn apply_latest(
    host_visible: impl FnOnce() -> Result<bool, String>,
    browser_visible: impl FnOnce() -> Result<bool, String>,
    set_browser_visible: impl FnOnce(bool) -> Result<(), String>,
) -> Result<(), String> {
    let want = host_visible()?;
    if browser_visible()? != want {
        set_browser_visible(want)?;
    }
    Ok(())
}

/// Memory advice is best effort: restore the normal budget before showing a browser,
/// and lower it after hiding. An advisory failure must never prevent visibility changes.
#[cfg(any(windows, test))]
fn apply_latest_with_memory(
    host_visible: impl FnOnce() -> Result<bool, String>,
    browser_visible: impl FnOnce() -> Result<bool, String>,
    set_browser_visible: impl FnOnce(bool) -> Result<(), String>,
    mut memory_policy: impl FnMut(bool) -> Result<(), String>,
) -> Result<(), String> {
    let visible = host_visible()?;
    let memory = if visible { memory_policy(true) } else { Ok(()) };
    let visibility = apply_latest(|| Ok(visible), browser_visible, set_browser_visible);
    let memory = if visible {
        memory
    } else {
        memory_policy(false)
    };
    visibility.and(memory)
}

#[cfg(windows)]
fn sync_memory(controller: &ICoreWebView2Controller, visible: bool) -> Result<(), String> {
    // All COM access stays on the controller's owning thread in with_webview. Older
    // runtimes lack this optional interface; their existing visibility behavior remains.
    let core = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
    let memory = match core.cast::<ICoreWebView2_19>() {
        Ok(memory) => memory,
        Err(error) if error.code().0 == windows_sys::Win32::Foundation::E_NOINTERFACE => {
            return Ok(())
        }
        Err(error) => return Err(error.to_string()),
    };
    let target = if visible {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
    } else {
        COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
    };
    let mut current = COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL;
    unsafe { memory.MemoryUsageTargetLevel(&mut current) }.map_err(|error| error.to_string())?;
    if current != target {
        unsafe { memory.SetMemoryUsageTargetLevel(target) }.map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(windows)]
pub fn sync_window(window: &WebviewWindow) {
    let host = window.clone();
    let label = window.label().to_owned();
    if let Err(error) = window.with_webview(move |webview| {
        let controller = webview.controller();
        let result = apply_latest_with_memory(
            || {
                host.is_visible()
                    .and_then(|visible| host.is_minimized().map(|minimized| visible && !minimized))
                    .map_err(|e| e.to_string())
            },
            || {
                let mut visible = Default::default();
                // The callback runs on the WebView's owning thread; the COM controller
                // remains alive for both the read and the update below.
                unsafe { controller.IsVisible(&mut visible) }.map_err(|e| e.to_string())?;
                Ok(visible.as_bool())
            },
            |visible| unsafe { controller.SetIsVisible(visible) }.map_err(|e| e.to_string()),
            |visible| sync_memory(&controller, visible),
        );
        if let Err(error) = result {
            crate::overlay::record_error(
                host.app_handle(),
                format!(
                    "Could not synchronize {} browser state: {error}",
                    host.label()
                ),
            );
        }
    }) {
        crate::overlay::record_error(
            window.app_handle(),
            format!("Could not schedule {label} browser state: {error}"),
        );
    }
}

#[cfg(not(windows))]
pub fn sync_window(_: &WebviewWindow) {}

/// The existing focus worker calls this at its slower cadence. This also covers windows
/// created hidden and workspace minimize/restore, which do not pass through overlay showing.
pub fn sync(app: &AppHandle) {
    for window in app.webview_windows().values() {
        sync_window(window);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    #[test]
    fn hidden_windows_lower_memory_and_restore_the_budget_before_showing() {
        use std::cell::RefCell;
        let browser = Cell::new(true);
        let low = Cell::new(false);
        let operations = RefCell::new(Vec::new());
        for visible in [false, false, true, true, false] {
            apply_latest_with_memory(
                || Ok(visible),
                || Ok(browser.get()),
                |visible| {
                    operations
                        .borrow_mut()
                        .push(if visible { "show" } else { "hide" });
                    browser.set(visible);
                    Ok(())
                },
                |visible| {
                    if low.get() == visible {
                        operations
                            .borrow_mut()
                            .push(if visible { "normal" } else { "low" });
                        low.set(!visible);
                    }
                    Ok(())
                },
            )
            .unwrap();
        }
        assert_eq!(
            *operations.borrow(),
            ["hide", "low", "normal", "show", "hide", "low"]
        );
    }

    #[test]
    fn memory_advice_failure_cannot_block_a_reopened_browser() {
        let browser = Cell::new(false);
        let result = apply_latest_with_memory(
            || Ok(true),
            || Ok(browser.get()),
            |visible| {
                browser.set(visible);
                Ok(())
            },
            |_| Err("memory hint unavailable".into()),
        );
        assert!(result.is_err());
        assert!(browser.get());
    }

    #[test]
    fn queued_memory_update_reads_a_reopened_host_and_can_retry() {
        let host = Cell::new(false);
        let browser = Cell::new(false);
        let low = Cell::new(true);
        let sync = |fail| {
            apply_latest_with_memory(
                || Ok(host.get()),
                || Ok(browser.get()),
                |visible| {
                    browser.set(visible);
                    Ok(())
                },
                |visible| {
                    if fail {
                        return Err("temporary failure".into());
                    }
                    low.set(!visible);
                    Ok(())
                },
            )
        };
        host.set(true);
        assert!(sync(true).is_err());
        assert!(browser.get());
        assert!(low.get());
        sync(false).unwrap();
        assert!(browser.get());
        assert!(!low.get());
    }

    #[test]
    fn hidden_startup_and_minimize_release_browser_then_restore_it() {
        let browser = Cell::new(true);
        let writes = Cell::new(0);
        for host in [false, false, true, false, false, true] {
            apply_latest(
                || Ok(host),
                || Ok(browser.get()),
                |visible| {
                    browser.set(visible);
                    writes.set(writes.get() + 1);
                    Ok(())
                },
            )
            .unwrap();
            assert_eq!(browser.get(), host);
        }
        assert_eq!(
            writes.get(),
            4,
            "unchanged visibility never repeats an update"
        );
    }

    #[test]
    fn queued_hide_reads_reopened_host_when_it_executes() {
        let host = Cell::new(false);
        let browser = Cell::new(true);
        let queued = || {
            apply_latest(
                || Ok(host.get()),
                || Ok(browser.get()),
                |visible| {
                    browser.set(visible);
                    Ok(())
                },
            )
        };
        host.set(true);
        queued().unwrap();
        assert!(browser.get());
    }

    #[test]
    fn failed_controller_update_can_retry_without_another_host_transition() {
        let browser = Cell::new(true);
        assert!(apply_latest(|| Ok(false), || Ok(browser.get()), |_| Err("busy".into())).is_err());
        assert!(browser.get());
        apply_latest(
            || Ok(false),
            || Ok(browser.get()),
            |visible| {
                browser.set(visible);
                Ok(())
            },
        )
        .unwrap();
        assert!(!browser.get());
    }
}
