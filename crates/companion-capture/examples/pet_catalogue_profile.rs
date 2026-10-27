//! Synthetic native pet-catalogue benchmark; does not start capture or open a profile.
//! Run in release mode with `baseline` (the previous JSON-tree implementation) or `compact`.
use companion_capture::{pet_catalogue, LiveCapture};
use serde_json::{json, Value};
use std::{
    alloc::{GlobalAlloc, Layout, System},
    sync::atomic::{AtomicUsize, Ordering},
    time::Instant,
};

struct Allocations;
static LIVE: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);

unsafe impl GlobalAlloc for Allocations {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = System.alloc(layout);
        if !pointer.is_null() {
            let live = LIVE.fetch_add(layout.size(), Ordering::Relaxed) + layout.size();
            PEAK.fetch_max(live, Ordering::Relaxed);
        }
        pointer
    }

    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        LIVE.fetch_sub(layout.size(), Ordering::Relaxed);
        System.dealloc(pointer, layout);
    }
}

#[global_allocator]
static ALLOCATOR: Allocations = Allocations;

fn main() {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "compact".into());
    assert!(matches!(mode.as_str(), "baseline" | "compact"));
    let capture = LiveCapture::default();
    let baseline = LIVE.load(Ordering::Relaxed);
    let full: Option<Value> = if mode == "baseline" {
        Some(serde_json::from_str(pet_catalogue()).unwrap())
    } else {
        // Validate a real native preference so the production collector metadata is loaded.
        // A default collector has no storage owner, so this does not write a profile.
        drop(
            capture
                .pets_configure(json!({"revision":0,"pinned_ids":[1004]}))
                .unwrap(),
        );
        None
    };
    let retained = LIVE.load(Ordering::Relaxed);
    PEAK.store(retained, Ordering::Relaxed);
    let start = Instant::now();
    let response = match &full {
        Some(full) => {
            // Reproduce the former command's full-tree clone and JSON serialization.
            let reply = full.clone();
            let response = serde_json::to_string(&reply).unwrap();
            std::hint::black_box(&reply);
            response
        }
        None => pet_catalogue().to_owned(),
    };
    let elapsed = start.elapsed();
    let peak = PEAK.load(Ordering::Relaxed);
    println!("mode={mode} retained_metadata_bytes={} response_peak_bytes={} response_bytes={} response_us={}",
        retained - baseline, peak - baseline, response.len(), elapsed.as_micros());
    // This measures requested heap bytes, not allocator overhead, WebView memory, or
    // end-to-end IPC. Check response compatibility outside the measured interval.
    let value: Value = serde_json::from_str(&response).unwrap();
    assert_eq!(value["pets"].as_array().unwrap().len(), 207);
    std::hint::black_box((&full, &capture, &response));
}
