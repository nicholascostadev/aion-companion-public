import { DpsOverlay } from '../features/live/DpsOverlay';
import type { MeterLibrary } from '../features/live/MeterHistory';
import { useMeter } from '../features/live/meterState';
import { meterAlerts } from '../features/alerts/model';
import { useAlerts } from '../hooks/useAlerts';
import { useGroup } from '../hooks/useGroup';
import { HIT_SELECTOR, useHitRegions } from '../hooks/useHitRegions';
import { useLiveCapture } from '../hooks/useLiveCapture';
import { useOffline } from '../hooks/useOffline';
import { useOverlay } from '../hooks/useOverlay';
import { copyText } from '../lib/clipboard';
import type { ShugoProfile } from '../lib/shugo';
import { openProfileWindow } from '../services/profile';
import { useRef, useState } from 'react';
import { fitDpsOverlay, isNative, openDetails, startWindowDrag } from '../services/companion';
import { copyTextNative, listLogs, readLog } from '../services/offline';

/** History lists this many recent saved fights. */
const HISTORY_LIMIT = 8;
/** The meter mentions an alert only once it is this close (or open). */
const NEXT_ALERT_HORIZON_MS = 5 * 60_000;
const library: MeterLibrary = {
  list: () => listLogs({ sort: 'newest', limit: HISTORY_LIMIT }),
  // The meter's target scope: every target, or bosses and dummies while the fight met any.
  read: readLog,
};

export default function OverlayApp() {
  const native = isNative();
  const capture = useLiveCapture(native);
  const controls = useOverlay();
  // The live report is large; the meter itself still refreshes from live_status.
  const offline = useOffline(native, { minIntervalMs: 500 });
  // Native plays alert sounds and shows popups; the meter only previews what is open or next.
  const alerts = useAlerts(native, { intervalMs: 2000 });
  const nextAlerts = meterAlerts(alerts.dashboard, alerts.now(), NEXT_ALERT_HORIZON_MS);
  // The party room and run state: a dungeon group preparing for its run replaces the fight.
  const group = useGroup(native);
  // Odyle energy arrives with each live status; a failed read leaves it unknown, not stale.
  const status = capture.readFailed ? { ...capture.live, odyle: null } : capture.live;
  const settings = offline.status?.settings ?? null;
  const [actionError, setActionError] = useState('');
  // What the meter shows: the room, the strip or the fight, decided once for the meter and
  // its hit regions.
  const meter = useMeter({
    status,
    overlay: controls.overlay,
    error: capture.error || controls.error || offline.error || actionError,
    busy: capture.busy || offline.busy,
    offline: offline.status,
    group: { status: group.status, native },
    copyText: native ? copyTextNative : copyText,
    ...(native ? { library } : {}),
  });
  const root = useRef<HTMLElement>(null);
  // A locked meter is click-through except for its controls and rows. The compact strip has
  // none; a preparing dungeon group keeps the room or the full meter instead.
  useHitRegions(root, HIT_SELECTOR, native && meter.locked && meter.sheet !== 'strip');
  // Pins the details panel to the fight on screen now; a later fight never replaces it.
  const inspect = (reportId: string, player: string) =>
    void openDetails(reportId, player).then(
      () => setActionError(''),
      (cause: unknown) => setActionError(String(cause)),
    );
  // Opens the in-game character profile window; it shows over the game like this meter.
  const openProfile = (profile: ShugoProfile) =>
    void openProfileWindow(profile).then(
      () => setActionError(''),
      (cause: unknown) => setActionError(String(cause)),
    );
  // The window takes the meter's height; a failed fit leaves it at its last size.
  const fit = (height: number) => void fitDpsOverlay(height).catch(() => undefined);
  // Unlocked only (see DpsOverlay): the left button is still down, so native moves the window.
  const drag = () =>
    void startWindowDrag().then(
      () => setActionError(''),
      (cause: unknown) => setActionError(String(cause)),
    );
  return (
    <DpsOverlay
      meter={meter}
      onReset={() => void capture.reset()}
      onHide={() => void controls.hide()}
      {...(native
        ? { onInspect: inspect, onDrag: drag, onOpenProfile: openProfile, onFit: fit }
        : {})}
      hitRef={root}
      nextAlerts={nextAlerts}
      {...(settings
        ? {
            onEnterStrip: () => void offline.configure({ ...settings, compact_strip: true }),
            onExitStrip: () => void offline.configure({ ...settings, compact_strip: false }),
          }
        : {})}
    />
  );
}
