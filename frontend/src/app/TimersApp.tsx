import { getCurrentWindow } from '@tauri-apps/api/window';
import { useCallback, useRef } from 'react';
import { Timers } from '../features/timers/Timers';
import { useActivityWindow } from '../hooks/useActivityWindow';
import { HIT_SELECTOR, useHitRegions } from '../hooks/useHitRegions';
import { useTimers } from '../hooks/useTimers';
import { setActivityHitRegions } from '../services/activityWindows';
import { startWindowDrag } from '../services/companion';

const drag = () => void startWindowDrag().catch(() => undefined);
const resize = () =>
  void getCurrentWindow()
    .startResizeDragging('SouthEast')
    .catch(() => undefined);

/** `timers-overlay`, launched natively with `?view=timers`. */
export default function TimersApp() {
  const win = useActivityWindow('timers', { markReady: true });
  const timers = useTimers(win.native, { paused: win.known && !win.status.visible });
  const root = useRef<HTMLElement>(null);
  const send = useCallback(
    (regions: [number, number, number, number][], scale: number) =>
      setActivityHitRegions('timers', regions, scale),
    [],
  );
  useHitRegions(root, HIT_SELECTOR, win.native && win.status.locked, send);
  return (
    <Timers
      native={win.native}
      status={timers.status}
      now={timers.now}
      stale={timers.stale}
      window={win.status}
      busy={win.busy}
      error={win.error || timers.error}
      onLock={(locked) => void win.lock(locked)}
      onHide={() => void win.hide()}
      onDrag={drag}
      onResize={resize}
      hitRef={root}
    />
  );
}
