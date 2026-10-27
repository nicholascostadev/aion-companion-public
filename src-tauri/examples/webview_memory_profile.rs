//! Isolated WebView2 memory-policy benchmark. No capture, app state or user profile.
//! Run with `baseline` or `low`; observe the process tree during `phase=measure`.
#[path = "../src/webview_visibility.rs"]
#[cfg(windows)]
mod webview_visibility;

// The production adapter reports native errors through the overlay owner. This isolated
// host has no overlay or capture owners and fails its benchmark on the same error.
#[cfg(windows)]
mod overlay {
    pub fn record_error(app: &tauri::AppHandle, error: String) {
        eprintln!("WebView policy failed: {error}");
        app.exit(1);
    }
}

#[cfg(windows)]
use std::time::{Duration, Instant};
#[cfg(windows)]
use tauri::{WebviewUrl, WebviewWindow, WebviewWindowBuilder};

#[cfg(windows)]
fn wait_for(window: &WebviewWindow, fragment: &str) {
    let deadline = Instant::now() + Duration::from_secs(30);
    while Instant::now() < deadline {
        if window.url().unwrap().fragment() == Some(fragment) {
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    panic!("The WebView did not reach {fragment}");
}

#[cfg(windows)]
fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "low".into());
    assert!(matches!(mode.as_str(), "baseline" | "low"));
    let mut context = tauri::generate_context!();
    context.config_mut().app.windows.clear();
    context.config_mut().app.security.csp = None;
    context.config_mut().identifier = "org.aioncompanion.memorybenchmark".into();
    tauri::Builder::default()
        .setup(move |app| {
            let window = WebviewWindowBuilder::new(
                app,
                "memory-profile",
                WebviewUrl::External("about:blank".parse().unwrap()),
            )
            .visible(false)
            .build()?;
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // The hidden page owns all test data; the policy must preserve it.
                window.eval(include_str!("webview_memory_fixture.js")).unwrap();
                wait_for(&window, "ready");
                std::thread::sleep(Duration::from_secs(5));
                if mode == "low" {
                    webview_visibility::sync(&handle);
                } else {
                    // Reproduce the former visibility-only policy on the same workload.
                    window.with_webview(|webview| unsafe {
                        webview.controller().SetIsVisible(false).unwrap();
                    }).unwrap();
                }
                std::thread::sleep(Duration::from_secs(10));
                println!("mode={mode} phase=measure pid={}", std::process::id());
                std::thread::sleep(Duration::from_secs(20));
                window.eval("location.hash = window.memoryFixture?.check() ? 'hidden-pass' : 'hidden-fail'").unwrap();
                wait_for(&window, "hidden-pass");
                // Check the API's normal budget too, without showing the synthetic
                // page. Production show/hide ordering is covered by the policy tests.
                window.with_webview(|webview| unsafe {
                    use windows_core::Interface;
                    use webview2_com::Microsoft::Web::WebView2::Win32::{ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL};
                    let memory = webview.controller().CoreWebView2().unwrap().cast::<ICoreWebView2_19>().unwrap();
                    memory.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL).unwrap();
                }).unwrap();
                window.eval("location.hash = window.memoryFixture?.check() ? 'restored-pass' : 'restored-fail'").unwrap();
                wait_for(&window, "restored-pass");
                println!("mode={mode} state_preserved=true scripts_running=true");
                }));
                // This benchmark never owns capture or durable app data.
                handle.exit(if result.is_ok() { 0 } else { 1 });
            });
            Ok(())
        })
        .run(context)
        .expect("Run isolated WebView memory benchmark");
}

#[cfg(not(windows))]
fn main() {
    eprintln!("The WebView2 memory benchmark requires Windows.");
    std::process::exit(2);
}
