import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Button } from '../components/ui/Button';
import { activePreset, TrackerBars } from '../features/offline/trackers';
import { useOffline } from '../hooks/useOffline';
import { useOverlayControls } from '../hooks/useOverlay';
import { useTranslation } from '../i18n/provider';
import { cn } from '../lib/cn';
import { isNative, markTrackersReady } from '../services/companion';
import { saveTrackerPositions } from '../services/offline';
import type { TrackerBar } from '../types/offline';

type Positions = Record<string, { x: number; y: number }>;
const LIMIT = 20000;
const clamp = (n: number) => Math.round(Math.max(-LIMIT, Math.min(LIMIT, n)));

/**
 * Transparent surface over the game that draws tracker bars at their saved x/y.
 * Native keeps it click-through; in arrange mode bars can be dragged, and each drop
 * patches only that bar's position into the current settings.
 */
export default function TrackerApp() {
  const native = isNative();
  const offline = useOffline(native, { minIntervalMs: 250 });
  // Reports `trackers_ready`; "Done" runs as an action, so no older poll can reopen arranging.
  const controls = useOverlayControls({ markReady: markTrackersReady });
  const { t } = useTranslation('trackers');
  /** Raw detail of the last failed save; worded at render so it follows the language. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const latest = useRef<Positions>({});
  const drag = useRef<{
    session: string;
    id: string;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);
  const settings = offline.status?.settings ?? null;
  const preset = activePreset(settings);
  const editing = controls.known && controls.overlay.trackers_editing === true;

  // One arrange session per (editing, preset). Leaving it or switching preset drops any
  // drag in progress and its unsaved overrides, so they can never resume or be saved.
  const session = editing && preset ? preset.id : null;
  const [overrides, setOverrides] = useState<{ session: string | null; positions: Positions }>({
    session: null,
    positions: {},
  });
  // Every transition (including leaving and re-entering the same preset) starts clean.
  const [lastSession, setLastSession] = useState<string | null>(null);
  if (lastSession !== session) {
    setLastSession(session);
    setOverrides({ session: null, positions: {} });
  }
  const positions = session !== null && overrides.session === session ? overrides.positions : {};
  useEffect(
    () => () => {
      drag.current = null;
      latest.current = {};
    },
    [session],
  );

  const onDragStart = (bar: TrackerBar, event: PointerEvent<HTMLElement>) => {
    if (session === null) return;
    const at = latest.current[bar.id] ?? bar;
    drag.current = {
      session,
      id: bar.id,
      dx: event.clientX - at.x,
      dy: event.clientY - at.y,
      x: at.x,
      y: at.y,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLElement>) => {
    const state = drag.current;
    if (!state || state.session !== session) return;
    latest.current = {
      ...latest.current,
      [state.id]: { x: clamp(event.clientX - state.dx), y: clamp(event.clientY - state.dy) },
    };
    setOverrides({ session: state.session, positions: latest.current });
  };
  const onUp = () => {
    const state = drag.current;
    drag.current = null;
    // A drag from an earlier session (cancelled arrange, preset switch) is never saved.
    if (!state || state.session !== session) return;
    const moved = latest.current[state.id];
    if (!moved || (moved.x === state.x && moved.y === state.y)) return;
    void saveTrackerPositions(state.session, [{ bar_id: state.id, ...moved }]).then(
      async () => {
        await offline.refresh();
        // Saved: the refreshed settings carry the position now.
        latest.current = Object.fromEntries(
          Object.entries(latest.current).filter(([id]) => id !== state.id),
        );
        setOverrides({ session: state.session, positions: { ...latest.current } });
        setSaveError(null);
      },
      (cause: unknown) => setSaveError(String(cause)),
    );
  };
  const message = saveError === null ? '' : t(($) => $.arrange.saveFailed, { detail: saveError });

  return (
    <main
      className={cn(
        'relative size-full select-none',
        editing && 'bg-shade/35 ring-2 ring-accent/70 ring-inset',
      )}
      data-state={editing ? 'arranging' : undefined}
      aria-label={t(($) => $.surface.label)}
      style={{ opacity: settings?.opacity ?? 1 }}
      onPointerMove={session !== null ? onMove : undefined}
      onPointerUp={session !== null ? onUp : undefined}
      onPointerCancel={session !== null ? onUp : undefined}
    >
      <TrackerBars
        settings={settings}
        trackers={offline.status?.trackers ?? []}

        positions={positions}
        {...(editing ? { onDragStart } : {})}
      />
      {editing && (
        <aside
          className="fixed top-[18%] left-1/2 flex max-w-90 -translate-x-1/2 animate-alight flex-col items-center gap-1.5 rounded-xl border border-accent-line bg-shade/90 px-4.5 py-3.5 text-center text-sm text-ink-2 text-halo shadow-3"
          aria-label={t(($) => $.arrange.title)}
        >
          <b className="text-md text-ink">{t(($) => $.arrange.title)}</b>
          <span>
            {preset
              ? preset.name
                ? t(($) => $.arrange.drag, { name: preset.name })
                : t(($) => $.arrange.dragUnnamed)
              : t(($) => $.arrange.noPreset)}
          </span>
          {(message || controls.error) && (
            <span className="text-danger">{message || controls.error}</span>
          )}
          <Button
            variant="primary"
            size="sm"
            className="mt-1"
            onClick={() => void controls.arrangeTrackers(false)}
          >
            {t(($) => $.arrange.done)}
          </Button>
        </aside>
      )}
    </main>
  );
}
