import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { BrandMark, Icon } from '../../components/ui/Icon';
import { clock } from '../../i18n/formatters';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { CaptureState } from '../../lib/capture';
import { dpsRequested } from '../../lib/overlayState';
import type { OverlayStatus } from '../../types/companion';

/** The fold's 200 ms (`duration-200`) plus a few frames, after which the window may narrow. */
const FOLD_MS = 250;
const reducedMotion = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

interface MenuBarProps {
  native: boolean;
  overlay: OverlayStatus;
  known: boolean;
  busy: boolean;
  error: string;
  /** Background capture; it is never started or stopped from here. */
  capture: { state: CaptureState; durationMs: number; message: string };
  onToggleDps: () => void;
  onLock: (locked: boolean) => void;
  onWorkspace: () => void;
  onQuit: () => void;
  /** Native alert state for the bell; null until known. */
  alerts?: { enabled: boolean; muted: boolean; active: number } | null;
  /** Opens the workspace on its Alerts tab. */
  onAlerts: () => void;
  /** In-game pet radar request; null until native state is known. */
  pets?: { requested: boolean; busy: boolean } | null;
  onTogglePets?: () => void;
  timers?: { requested: boolean; busy: boolean } | null;
  onToggleTimers?: () => void;
  /** The Explore window (the workspace's Explore map); null until native state is known. */
  explore?: { requested: boolean; busy: boolean } | null;
  onToggleExplore?: () => void;
  /** Folded to the logo and the expand arrow, without the wordmark; the actions stay one click away. */
  collapsed?: boolean;
  onCollapse?: (collapsed: boolean) => void;
  /** The toolbar's logical width with its margin, whenever it changes; sizes the native window. */
  onFit?: (width: number) => void;
}

/** Compact game toolbar; panel buttons reflect the saved visibility choices. */
export function MenuBar({
  native,
  overlay,
  known,
  busy,
  error,
  capture,
  onToggleDps,
  onLock,
  onWorkspace,
  onQuit,
  alerts = null,
  onAlerts,
  pets = null,
  onTogglePets,
  timers = null,
  onToggleTimers,
  explore = null,
  onToggleExplore,
  collapsed = false,
  onCollapse,
  onFit,
}: MenuBarProps) {
  const { t } = useTranslation(['menu', 'common']);
  const bar = useRef<HTMLDivElement>(null);
  const drawer = useRef<HTMLDivElement>(null);
  const actions = useRef<HTMLDivElement>(null);
  const drawerId = useId();
  // While the toolbar folds or unfolds, the actions stay drawn (inert once folding) so they
  // can fade out, and the window keeps room for all of them.
  const [folding, setFolding] = useState(false);
  const shown = !collapsed || folding;
  useEffect(() => {
    if (!folding) return;
    const done = setTimeout(() => setFolding(false), FOLD_MS);
    return () => clearTimeout(done);
  }, [folding, collapsed]);
  const fold = (next: boolean) => {
    setFolding(!reducedMotion());
    onCollapse?.(next);
  };
  // The window is exactly the toolbar, so no transparent strip beside it takes the game's
  // clicks. It is sized for the toolbar's resting width, not each frame of the fold: the
  // drawn actions' full width plus everything around the drawer. So it widens once before an
  // unfold and narrows once after a fold, around the same centre, while the toolbar animates
  // inside it. It follows font loading and translations through the observer.
  const sent = useRef(0);
  useLayoutEffect(() => {
    const element = bar.current;
    if (!element || !onFit) return;
    const fit = () => {
      const width = (node: HTMLElement | null) => node?.getBoundingClientRect().width ?? 0;
      // Less a hair under a layout unit, so float noise in the difference never adds a pixel.
      const resting = Math.ceil(
        width(element) - width(drawer.current) + width(actions.current) - 0.001,
      );
      if (resting === sent.current) return;
      sent.current = resting;
      onFit(resting);
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    if (actions.current) observer.observe(actions.current);
    return () => observer.disconnect();
  }, [onFit, shown]);
  const problem =
    error ||
    overlay.errors[0] ||
    (native && capture.state === 'error'
      ? capture.message || t(($) => $.capture.label.error, { ns: 'common' })
      : '');
  const capturing = capture.state === 'capturing';
  const dpsShown = known && dpsRequested(overlay);
  const lockLabel = overlay.locked ? t(($) => $.unlock) : t(($) => $.lock);
  const canToggleLock = known && overlay.visible && (overlay.locked || overlay.can_lock);
  const silent = alerts !== null && (!alerts.enabled || alerts.muted);
  const ringing = (alerts?.active ?? 0) > 0;
  const alertsLabel =
    alerts === null
      ? t(($) => $.alerts.label)
      : !alerts.enabled
        ? t(($) => $.alerts.off)
        : alerts.muted
          ? t(($) => $.alerts.muted)
          : ringing
            ? t(($) => $.alerts.ringing, { count: alerts.active })
            : t(($) => $.alerts.label);

  // The pill leaves a pixel around each button, so focus rings are drawn inside the button.
  const toolButton = 'text-ink-2 aria-pressed:border-accent-line focus-visible:-outline-offset-2';

  return (
    // The native window is MENU_HEIGHT tall and as wide as this toolbar (`menu_fit` in
    // overlay.rs): the bar floats in it as one pebble of glass, its 28 px buttons concentric
    // with the 32 px pill. Centred without shrinking, so a frame where the toolbar outgrows a
    // window that has not widened yet clips both ends evenly instead of shifting it.
    <div className="flex h-full justify-center overflow-hidden">
      <div ref={bar} className="flex h-full w-max shrink-0 items-center px-0.5">
        <nav
          className={cn(
            'flex h-8 cursor-move items-center overflow-hidden rounded-full border border-line-strong',
            'bg-shade/75 pr-px pl-3 text-xs text-ink text-halo inset-shadow-light select-none',
          )}
          aria-label={t(($) => $.label)}
          data-tauri-drag-region
        >
          <span
            className="flex shrink-0 items-center text-accent"
            data-tauri-drag-region="deep"
            title={t(($) => $.drag)}
          >
            <BrandMark size={14} />
          </span>
          {/* Everything but the logo and the arrow folds into the pill around its centre. */}
          <div
            ref={drawer}
            id={drawerId}
            className={cn(
              'h-full overflow-hidden transition-[width,opacity] duration-200 ease-grow [interpolate-size:allow-keywords]',
              collapsed ? 'w-0 opacity-0' : 'w-max',
            )}
            inert={collapsed}
            data-tauri-drag-region
          >
            <div
              ref={actions}
              className="flex h-full w-max items-center gap-1"
              data-tauri-drag-region
            >
              {shown && (
                <>
                  <span
                    className="ml-1.5 shrink-0 text-3xs font-bold tracking-caps text-ink"
                    data-tauri-drag-region="deep"
                    title={t(($) => $.drag)}
                  >
                    AION <b className="font-normal tracking-wide text-ink-3">Companion</b>
                  </span>
                  <output
                    className={cn(
                      // A fixed slot fits the fight clock; longer states truncate, with the full text on hover.
                      'flex w-16 shrink-0 items-center gap-1.5 pl-2 text-left text-2xs whitespace-nowrap',
                      problem ? 'text-danger' : capturing ? 'text-accent' : 'text-ink-3',
                    )}
                    aria-label={t(($) => $.status)}
                    title={
                      problem ||
                      (native
                        ? t(($) => $.capture.hint[capture.state], {
                            ns: 'common',
                          })
                        : undefined)
                    }
                    data-tauri-drag-region
                  >
                    {problem ? (
                      <>
                        <Icon name="warning" size={12} />
                        <span className="min-w-0 truncate">{problem}</span>
                      </>
                    ) : !native ? (
                      t(($) => $.preview)
                    ) : capturing ? (
                      <>
                        <i
                          className="size-1.5 shrink-0 animate-breathe rounded-full bg-current"
                          aria-hidden="true"
                        />
                        <span className="sr-only">{t(($) => $.live)}</span>
                        <span className="font-semibold figures">{clock(capture.durationMs)}</span>
                      </>
                    ) : (
                      <>
                        <i
                          className="size-1.5 shrink-0 rounded-full bg-current"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 truncate">
                          {t(($) => $.capture.label[capture.state], {
                            ns: 'common',
                          })}
                        </span>
                      </>
                    )}
                  </output>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={toolButton}
                    aria-label={t(($) => $.dps)}
                    aria-pressed={dpsShown}
                    aria-busy={busy}
                    title={t(($) => (dpsShown ? $.hideDps : $.showDps), {
                      key: 'Ctrl+Shift+F9',
                    })}
                    disabled={!native || !known || busy}
                    onClick={onToggleDps}
                  >
                    <Icon name="meter" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={toolButton}
                    aria-label={t(($) => $.radar)}
                    aria-pressed={pets?.requested ?? false}
                    aria-busy={pets?.busy ?? false}
                    title={pets?.requested ? t(($) => $.hideRadar) : t(($) => $.showRadar)}
                    disabled={!native || pets === null || pets.busy || !onTogglePets}
                    onClick={onTogglePets}
                  >
                    <Icon name="paw" />
                  </Button>
                  {(
                    [
                      {
                        id: 'timers',
                        label: t(($) => $.timers),
                        show: t(($) => $.showTimers),
                        hide: t(($) => $.hideTimers),
                        icon: 'timers',
                        state: timers,
                        toggle: onToggleTimers,
                      },
                      {
                        id: 'explore',
                        label: t(($) => $.explore),
                        show: t(($) => $.showExplore),
                        hide: t(($) => $.hideExplore),
                        icon: 'compass',
                        state: explore,
                        toggle: onToggleExplore,
                      },
                    ] as const
                  ).map(({ id, label, show, hide, icon, state, toggle }) => (
                    <Button
                      key={id}
                      variant="ghost"
                      size="sm"
                      iconOnly
                      className={toolButton}
                      aria-label={label}
                      aria-pressed={state?.requested ?? false}
                      aria-busy={state?.busy ?? false}
                      title={state?.requested ? hide : show}
                      disabled={!native || state === null || state.busy || !toggle}
                      onClick={toggle}
                    >
                      <Icon name={icon} />
                    </Button>
                  ))}
                  <Divider />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={toolButton}
                    aria-label={lockLabel}
                    aria-pressed={overlay.locked}
                    title={
                      !overlay.locked && !overlay.can_lock
                        ? t(($) => $.lockUnavailable, { key: 'Ctrl+Shift+F8' })
                        : t(($) => $.lockKey, {
                            action: lockLabel,
                            key: 'Ctrl+Shift+F8',
                          })
                    }
                    disabled={!native || busy || !canToggleLock}
                    onClick={() => onLock(!overlay.locked)}
                  >
                    <Icon name={overlay.locked ? 'lock' : 'unlock'} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={cn(
                      toolButton,
                      ringing && 'text-warn enabled:hover:text-warn-strong',
                    )}
                    aria-label={alertsLabel}
                    title={t(($) => $.alerts.open, { label: alertsLabel })}
                    disabled={!native || busy}
                    onClick={onAlerts}
                  >
                    <Icon name={silent ? 'bellOff' : ringing ? 'bellRing' : 'bell'} />
                    {ringing && (
                      <i
                        className="absolute top-1 right-1 size-1.5 animate-breathe rounded-full bg-warn text-warn ring-2 ring-shade"
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={toolButton}
                    aria-label={t(($) => $.workspace)}
                    title={t(($) => $.workspace)}
                    disabled={!native || busy}
                    onClick={onWorkspace}
                  >
                    <Icon name="workspace" />
                  </Button>
                  <Divider />
                  <Button
                    variant="ghost"
                    size="sm"
                    iconOnly
                    className={cn(
                      'text-danger focus-visible:-outline-offset-2',
                      'enabled:hover:bg-danger-soft enabled:hover:text-danger-strong',
                    )}
                    aria-label={t(($) => $.quit)}
                    title={t(($) => $.quit)}
                    disabled={!native || busy}
                    onClick={onQuit}
                  >
                    <Icon name="power" />
                  </Button>
                  <Divider />
                </>
              )}
            </div>
          </div>
          {/* One arrow both ways, so it keeps focus and turns as the toolbar folds. */}
          <Button
            variant="ghost"
            size="sm"
            iconOnly
            className={cn(toolButton, 'ml-1')}
            aria-label={collapsed ? t(($) => $.expand) : t(($) => $.collapse)}
            aria-expanded={!collapsed}
            aria-controls={drawerId}
            title={collapsed ? t(($) => $.expand) : t(($) => $.collapse)}
            disabled={!onCollapse}
            onClick={() => fold(!collapsed)}
          >
            <Icon
              name="chevronRight"
              className={cn(
                'transition-transform duration-200 ease-grow',
                !collapsed && 'rotate-180',
              )}
            />
          </Button>
        </nav>
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-line-strong" aria-hidden="true" />;
}
