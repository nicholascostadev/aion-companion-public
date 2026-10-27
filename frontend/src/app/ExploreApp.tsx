import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useRef } from 'react';
import { ExploreOverlay } from '../features/finder/ExploreOverlay';
import { useActivityWindow } from '../hooks/useActivityWindow';
import { useCubes } from '../hooks/useCubes';
import { useFinderPreferences } from '../hooks/useFinderPreferences';
import { HIT_SELECTOR, useHitRegions } from '../hooks/useHitRegions';
import { usePageVisible } from '../hooks/usePageVisible';
import { useRecentlyShown } from '../hooks/useRecentlyShown';
import { setActivityHitRegions } from '../services/activityWindows';
import { startWindowDrag } from '../services/companion';

const drag = () => void startWindowDrag().catch(() => undefined);
const resize = () =>
  void getCurrentWindow()
    .startResizeDragging('SouthEast')
    .catch(() => undefined);

/**
 * `explore-overlay`, launched natively with `?view=explore`: the workspace's Explore choices
 * over the game. One cube read (every 250 ms, only while shown) carries the capture context
 * every layer draws with; the saved choices follow native's change events.
 */
export default function ExploreApp() {
  const win = useActivityWindow('explore', { markReady: true });
  const hidden = win.known && !win.status.visible;
  const cubes = useCubes(win.native, { paused: hidden });
  const prefs = useFinderPreferences(win.native);
  // A window left hidden lets its map art go; it is drawn again as the window shows.
  const shown = usePageVisible() && !hidden;
  const drawArt = useRecentlyShown(shown);
  const root = useRef<HTMLElement>(null);
  const send = useCallback(
    (regions: [number, number, number, number][], scale: number) =>
      setActivityHitRegions('explore', regions, scale),
    [],
  );
  useHitRegions(root, HIT_SELECTOR, win.native && win.status.locked, send);
  return (
    <ExploreOverlay
      native={win.native}
      status={cubes.status}
      fresh={cubes.fresh}
      prefs={prefs}
      window={win.status}
      busy={win.busy}
      clearing={cubes.clearing}
      error={cubes.error}
      windowError={win.error}
      drawArt={drawArt}
      animate={shown}
      onClear={() => void cubes.clear()}
      onLock={(locked) => void win.lock(locked)}
      onHide={() => void win.hide()}
      onDrag={drag}
      onResize={resize}
      hitRef={root}
    />
  );
}
