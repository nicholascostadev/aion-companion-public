import { DpsOverlay } from '../features/live/DpsOverlay';
import type { MeterLibrary } from '../features/live/MeterHistory';
import { soonest } from '../features/alerts/model';
import { useAlerts } from '../hooks/useAlerts';
import { HIT_SELECTOR, useHitRegions } from '../hooks/useHitRegions';
import { useLiveCapture } from '../hooks/useLiveCapture';
import { useOffline } from '../hooks/useOffline';
import { useOverlay } from '../hooks/useOverlay';
import { copyText } from '../lib/clipboard';
import { useRef, useState } from 'react';
import { isNative, openDetails, startWindowDrag } from '../services/companion';
import { copyTextNative, listLogs, readLog } from '../services/offline';

/** History lists this many recent saved fights. */
const HISTORY_LIMIT = 8;
/** The meter mentions an alert only once it is this close (or open). */
const NEXT_ALERT_HORIZON_MS = 5 * 60_000;
const library: MeterLibrary = {
  list: () => listLogs({ sort: 'newest', limit: HISTORY_LIMIT }),
  // The meter's automatic view: bosses and dummies when the fight met any, else every monster.
  read: (id) => readLog(id, true),
};

export default function OverlayApp() {
  const native = isNative();
  const capture = useLiveCapture(native);
  const controls = useOverlay();
  // The live report is large; the meter itself still refreshes from live_status.
  const offline = useOffline(native, { minIntervalMs: 500 });
  // Native plays alert sounds and shows popups; the meter only previews the next one.
  const alerts = useAlerts(native, { intervalMs: 2000 });
  const nextAlert = soonest(alerts.dashboard, alerts.now(), NEXT_ALERT_HORIZON_MS);
  // Odyle energy arrives with each live status; a failed read leaves it unknown, not stale.
  const status = capture.readFailed ? { ...capture.live, odyle: null } : capture.live;
  const settings = offline.status?.settings ?? null;
  const [actionError, setActionError] = useState('');
  const root = useRef<HTMLElement>(null);
  // A locked meter is click-through except for its controls and rows.
  useHitRegions(root, HIT_SELECTOR, native && controls.overlay.locked && !settings?.compact_strip);
  // Pins the details panel to the fight on screen now; a later fight never replaces it.
  const inspect = (reportId: string, player: string) =>
    void openDetails(reportId, player).then(
      () => setActionError(''),
      (cause: unknown) => setActionError(String(cause)),
    );
  // Unlocked only (see DpsOverlay): the left button is still down, so native moves the window.
  const drag = () =>
    void startWindowDrag().then(
      () => setActionError(''),
      (cause: unknown) => setActionError(String(cause)),
    );
  return (
    <DpsOverlay
      status={status}
      overlay={controls.overlay}
      error={capture.error || controls.error || offline.error || actionError}
      busy={capture.busy || offline.busy}
      offline={offline.status}
      onReset={() => void capture.reset()}
      onHide={() => void controls.hide()}
      onQuit={() => void controls.quit()}
      onCopyText={native ? copyTextNative : copyText}
      {...(native ? { onInspect: inspect, onDrag: drag, library } : {})}
      hitRef={root}
      nextAlert={nextAlert}
      {...(settings
        ? { onExitStrip: () => void offline.configure({ ...settings, compact_strip: false }) }
        : {})}
    />
  );
}
