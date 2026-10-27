import { MenuBar } from '../features/menu/MenuBar';
import { useAlerts } from '../hooks/useAlerts';
import { useLiveCapture } from '../hooks/useLiveCapture';
import { useMenuControls } from '../hooks/useOverlay';
import { usePetWindow } from '../hooks/usePetWindow';
import { useActivityWindow } from '../hooks/useActivityWindow';
import { captureState } from '../lib/capture';
import { requestWorkspaceTab } from '../services/alerts';

export default function MenuApp() {
  const controls = useMenuControls();
  const capture = useLiveCapture(controls.native);
  const alerts = useAlerts(controls.native, { intervalMs: 3000 });
  const config = alerts.dashboard?.config ?? null;
  const pets = usePetWindow({ intervalMs: 1000 });
  const timers = useActivityWindow('timers', { intervalMs: 1000 });
  const explore = useActivityWindow('explore', { intervalMs: 1000 });
  return (
    <MenuBar
      native={controls.native}
      overlay={controls.overlay}
      known={controls.known}
      busy={controls.busy}
      error={controls.error || pets.error || timers.error || explore.error}
      capture={{
        state: captureState(capture.live),
        durationMs: capture.live.duration_ms,
        message: capture.live.message,
      }}
      alerts={
        config
          ? {
              enabled: config.enabled,
              muted: config.muted_until_ms !== null && config.muted_until_ms > alerts.now(),
              active: alerts.dashboard?.active.length ?? 0,
            }
          : null
      }
      onToggleDps={() => void controls.toggle()}
      onToggleGroup={() => void controls.toggleGroup()}
      pets={pets.known ? { requested: pets.status.requested, busy: pets.busy } : null}
      onTogglePets={() => void pets.toggle()}
      timers={timers.known ? { requested: timers.status.requested, busy: timers.busy } : null}
      onToggleTimers={() => void timers.toggle()}
      explore={explore.known ? { requested: explore.status.requested, busy: explore.busy } : null}
      onToggleExplore={() => void explore.toggle()}
      onLock={(locked) => void controls.lock(locked)}
      onWorkspace={() => void controls.workspace()}
      onAlerts={() =>
        // The workspace switches to Alerts first, then comes to the front.
        void requestWorkspaceTab('alerts')
          .catch(() => undefined)
          .then(() => controls.workspace())
      }
      onQuit={() => void controls.quit()}
    />
  );
}
