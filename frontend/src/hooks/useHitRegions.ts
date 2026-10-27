import { useEffect, type RefObject } from 'react';
import { setRowRegions } from '../services/companion';

type Region = [number, number, number, number];
/** Native receiver of a window's clickable regions. */
export type RegionSender = (regions: Region[], scale: number) => Promise<unknown>;

/**
 * Controls of the locked DPS meter that take clicks. `data-hit="row"` marks table rows,
 * any other value a control; controls are registered first so rows never crowd them out.
 */
export const HIT_SELECTOR = '[data-hit]:not(:disabled)';
/** Scroll viewports that clip the controls inside them. */
export const HIT_CLIP = 'data-hit-clip';

/** Native drops regions not refreshed within 3 s, so a frozen page falls back to click-through. */
const HEARTBEAT_MS = 500;
/** Must match `MAX_REGIONS` in `src-tauri/src/hit.rs`. */
export const MAX_REGIONS = 32;

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
const intersect = (a: Box, b: Box): Box => ({
  left: Math.max(a.left, b.left),
  top: Math.max(a.top, b.top),
  right: Math.min(a.right, b.right),
  bottom: Math.min(a.bottom, b.bottom),
});

/**
 * Physical client-pixel rectangles of the elements matching `selector` inside `root`,
 * clipped to the root, the window and every scroll viewport (`data-hit-clip`) between
 * the element and the root, so a row scrolled out of its list never covers the header
 * or footer. `getBoundingClientRect` already includes CSS zoom, so only the device
 * pixel ratio is applied.
 */
export function measureRegions(root: HTMLElement, selector: string, scale: number): Region[] {
  const viewport = intersect(root.getBoundingClientRect(), {
    left: 0,
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
  });
  const elements = [...root.querySelectorAll<HTMLElement>(selector)];
  const ordered = [
    ...elements.filter((e) => e.dataset.hit !== 'row'),
    ...elements.filter((e) => e.dataset.hit === 'row'),
  ];
  const regions: Region[] = [];
  for (const element of ordered) {
    let clip = intersect(element.getBoundingClientRect(), viewport);
    for (let node = element.parentElement; node && node !== root; node = node.parentElement) {
      if (node.hasAttribute(HIT_CLIP)) clip = intersect(clip, node.getBoundingClientRect());
    }
    if (clip.right - clip.left < 1 || clip.bottom - clip.top < 1) continue;
    // Shrink inward to whole pixels so a region never covers more than the control.
    const px = Math.ceil(clip.left * scale);
    const py = Math.ceil(clip.top * scale);
    const width = Math.floor(clip.right * scale) - px;
    const height = Math.floor(clip.bottom * scale) - py;
    if (width >= 1 && height >= 1) regions.push([px, py, width, height]);
    if (regions.length === MAX_REGIONS) break;
  }
  return regions;
}

/**
 * While `enabled`, keeps native informed of which controls of a locked, click-through
 * meter may take clicks. Everything else on the meter stays click-through. Regions
 * are cleared when disabled or unmounted; a failed report simply leaves the meter
 * click-through.
 */
export function useHitRegions(
  root: RefObject<HTMLElement | null>,
  selector: string,
  enabled: boolean,
  /** Defaults to the DPS meter; other locked panels pass their own native command. */
  sender: RegionSender = setRowRegions,
) {
  useEffect(() => {
    if (!enabled) return;
    let last = '';
    let cancelled = false;
    const send = (regions: Region[], scale: number) =>
      Promise.resolve()
        .then(() => sender(regions, scale))
        .catch(() => {
          // Native keeps the meter click-through without fresh regions.
        });
    const report = (force: boolean) => {
      const element = root.current;
      if (cancelled) return;
      const scale = window.devicePixelRatio || 1;
      // A meter that is not mounted (e.g. switched to the strip) has nothing clickable.
      const regions = element ? measureRegions(element, selector, scale) : [];
      const text = JSON.stringify([regions, scale]);
      if (!force && text === last) return;
      last = text;
      void send(regions, scale);
    };
    report(true);
    const heartbeat = setInterval(() => report(true), HEARTBEAT_MS);
    const changed = () => report(false);
    const element = root.current;
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed);
    if (element) observer?.observe(element);
    const mutations =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(changed);
    if (element) mutations?.observe(element, { childList: true, subtree: true });
    // Scroll does not bubble; capture it from any nested viewport.
    element?.addEventListener('scroll', changed, { passive: true, capture: true });
    window.addEventListener('resize', changed);
    // A move to a monitor with another DPI changes the ratio without a resize.
    let media: MediaQueryList | null = null;
    const watchScale = () => {
      media?.removeEventListener('change', onScale);
      media =
        typeof window.matchMedia === 'function'
          ? window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
          : null;
      media?.addEventListener('change', onScale);
    };
    function onScale() {
      watchScale();
      changed();
    }
    watchScale();
    return () => {
      cancelled = true;
      clearInterval(heartbeat);
      observer?.disconnect();
      mutations?.disconnect();
      element?.removeEventListener('scroll', changed, { capture: true });
      window.removeEventListener('resize', changed);
      media?.removeEventListener('change', onScale);
      void send([], window.devicePixelRatio || 1);
    };
  }, [root, selector, enabled, sender]);
}
