//! Interactive regions of the locked DPS meter.
//!
//! A locked meter is click-through (`WS_EX_TRANSPARENT`). `HTTRANSPARENT` from
//! `WM_NCHITTEST` only forwards clicks to windows of the same thread, never to the game,
//! so instead the overlay timer compares the cursor with these regions and lifts the
//! transparent style only while the cursor is over a meter control (toolbar, menu item
//! or table row). Regions are client pixels reported by the webview; anything stale,
//! unscaled or out of bounds is ignored, which always falls back to full click-through.
use std::time::{Duration, Instant};

/// Controls are re-reported at least this often while the meter is mounted and locked.
pub const STALE_AFTER: Duration = Duration::from_millis(3000);
/// Caption tabs, toolbar, history menu items and visible rows; matches `MAX_REGIONS`
/// in `frontend/src/hooks/useHitRegions.ts`.
const MAX_REGIONS: usize = 32;
/// Larger than any monitor; rejects nonsense before it reaches the timer.
const MAX_EXTENT: f64 = 16384.0;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rect {
    pub left: f64,
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
}

#[derive(Default)]
pub struct HitRegions {
    rects: Vec<Rect>,
    /// Device pixel ratio the webview measured with.
    scale: f64,
    updated: Option<Instant>,
}

impl HitRegions {
    /// Replaces the regions. `regions` are `[x, y, width, height]` in physical client
    /// pixels; an empty list (or any invalid entry) clears every region.
    pub fn set(&mut self, regions: &[[f64; 4]], scale: f64, now: Instant) -> Result<usize, String> {
        self.rects.clear();
        self.updated = None;
        if regions.is_empty() {
            return Ok(0);
        }
        if regions.len() > MAX_REGIONS {
            return Err("Too many interactive regions".into());
        }
        if !scale.is_finite() || !(0.5..=8.0).contains(&scale) {
            return Err("Invalid display scale".into());
        }
        let mut rects = Vec::with_capacity(regions.len());
        for &[x, y, width, height] in regions {
            let valid = [x, y, width, height].iter().all(|v| v.is_finite())
                && x >= 0.0
                && y >= 0.0
                && width >= 1.0
                && height >= 1.0
                && x + width <= MAX_EXTENT
                && y + height <= MAX_EXTENT;
            if !valid {
                return Err("Invalid interactive region".into());
            }
            rects.push(Rect { left: x, top: y, right: x + width, bottom: y + height });
        }
        self.rects = rects;
        self.scale = scale;
        self.updated = Some(now);
        Ok(self.rects.len())
    }

    pub fn clear(&mut self) {
        self.rects.clear();
        self.updated = None;
    }

    pub fn len(&self) -> usize {
        self.rects.len()
    }

    /// True when `point` (client pixels) is inside a fresh region of a window whose
    /// client area is `client` pixels and whose current scale factor is `scale`.
    pub fn contains(&self, point: (f64, f64), client: (f64, f64), scale: f64, now: Instant) -> bool {
        let Some(updated) = self.updated else {
            return false;
        };
        if now.saturating_duration_since(updated) > STALE_AFTER
            || (scale - self.scale).abs() > 0.01
        {
            return false;
        }
        let (x, y) = point;
        if x < 0.0 || y < 0.0 || x >= client.0 || y >= client.1 {
            return false;
        }
        self.rects
            .iter()
            .any(|r| x >= r.left && x < r.right.min(client.0) && y >= r.top && y < r.bottom.min(client.1))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(now: Instant) -> HitRegions {
        let mut regions = HitRegions::default();
        regions
            .set(&[[10.0, 100.0, 300.0, 27.0], [10.0, 129.0, 300.0, 27.0]], 1.5, now)
            .unwrap();
        regions
    }

    #[test]
    fn only_row_rectangles_take_input() {
        let now = Instant::now();
        let regions = rows(now);
        let client = (420.0, 360.0);
        assert!(regions.contains((50.0, 110.0), client, 1.5, now));
        assert!(regions.contains((309.0, 155.0), client, 1.5, now));
        // Header, gap between rows, footer and outside the window stay click-through.
        assert!(!regions.contains((50.0, 20.0), client, 1.5, now));
        assert!(!regions.contains((50.0, 127.5), client, 1.5, now));
        assert!(!regions.contains((50.0, 300.0), client, 1.5, now));
        assert!(!regions.contains((-5.0, 110.0), client, 1.5, now));
    }

    #[test]
    fn stale_rescaled_or_cleared_regions_fall_back_to_click_through() {
        let now = Instant::now();
        let mut regions = rows(now);
        let client = (420.0, 360.0);
        assert!(!regions.contains((50.0, 110.0), client, 1.5, now + STALE_AFTER + Duration::from_millis(1)));
        // Moved to a monitor with another DPI: wait for the webview to re-measure.
        assert!(!regions.contains((50.0, 110.0), client, 2.0, now));
        // A window shrunk below a row clips it.
        assert!(!regions.contains((50.0, 110.0), (420.0, 105.0), 1.5, now));
        regions.set(&[], 1.5, now).unwrap();
        assert_eq!(regions.len(), 0);
        assert!(!regions.contains((50.0, 110.0), client, 1.5, now));
        let mut regions = rows(now);
        regions.clear();
        assert!(!regions.contains((50.0, 110.0), client, 1.5, now));
    }

    #[test]
    fn invalid_reports_clear_previous_regions() {
        let now = Instant::now();
        let mut regions = rows(now);
        assert!(regions.set(&[[f64::NAN, 0.0, 10.0, 10.0]], 1.0, now).is_err());
        assert_eq!(regions.len(), 0);
        let mut regions = rows(now);
        assert!(regions.set(&[[0.0, 0.0, 10.0, 10.0]], 0.0, now).is_err());
        assert_eq!(regions.len(), 0);
        assert!(regions.set(&[[-1.0, 0.0, 10.0, 10.0]], 1.0, now).is_err());
        assert!(regions.set(&[[0.0, 0.0, 0.0, 10.0]], 1.0, now).is_err());
        assert!(regions.set(&[[0.0, 0.0, 10.0, 10.0]; 33], 1.0, now).is_err());
        // A full meter: caption tabs, toolbar, history menu and visible rows.
        assert_eq!(regions.set(&[[0.0, 0.0, 10.0, 10.0]; 32], 1.0, now), Ok(32));
        assert!(regions.set(&[[0.0, 0.0, 20000.0, 10.0]], 1.0, now).is_err());
    }
}
