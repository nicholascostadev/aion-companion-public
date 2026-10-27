import { Button } from '../../components/ui/Button';
import { BrandMark, Icon } from '../../components/ui/Icon';
import { clock } from '../../i18n/formatters';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { CaptureState } from '../../lib/capture';
import { dpsRequested, groupEnabled as groupOn } from '../../lib/overlayState';
import type { OverlayStatus } from '../../types/companion';

interface MenuBarProps {
  native: boolean;
  overlay: OverlayStatus;
  known: boolean;
  busy: boolean;
  error: string;
  /** Background capture; it is never started or stopped from here. */
  capture: { state: CaptureState; durationMs: number; message: string };
  onToggleDps: () => void;
  onToggleGroup: () => void;
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
  onToggleGroup,
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
}: MenuBarProps) {
  const { t } = useTranslation(['menu', 'common']);
  const problem =
    error ||
    overlay.errors[0] ||
    (native && capture.state === 'error'
      ? capture.message || t(($) => $.capture.label.error, { ns: 'common' })
      : '');
  const capturing = capture.state === 'capturing';
  const dpsShown = known && dpsRequested(overlay);
  const groupEnabled = known && groupOn(overlay);
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
    // The 512×36 native window (MENU_WIDTH × MENU_HEIGHT in overlay.rs): the bar floats in it
    // as one pebble of glass, its 28 px buttons concentric with the 32 px pill.
    <div className="flex h-full items-center px-0.5">
      <nav
        className={cn(
          'flex h-8 w-full cursor-move items-center gap-1 overflow-hidden rounded-full border border-line-strong',
          'bg-shade/75 pr-px pl-3 text-xs text-ink text-halo inset-shadow-light select-none',
        )}
        aria-label={t(($) => $.label)}
        data-tauri-drag-region
      >
        <span
          className="flex shrink-0 items-center gap-1.5 text-accent"
          data-tauri-drag-region="deep"
          title={t(($) => $.drag)}
        >
          <BrandMark size={14} />
          <span
            className="text-3xs font-bold tracking-caps text-ink max-[511px]:hidden"
            data-tauri-drag-region
          >
            AION{' '}
            <b className="font-normal tracking-wide text-ink-3" data-tauri-drag-region>
              Companion
            </b>
          </span>
        </span>
        <output
          className={cn(
            'flex min-w-0 flex-1 items-center gap-1.5 pl-2 text-left text-2xs whitespace-nowrap',
            problem ? 'text-danger' : capturing ? 'text-accent' : 'text-ink-3',
          )}
          aria-label={t(($) => $.status)}
          title={
            problem ||
            (native ? t(($) => $.capture.hint[capture.state], { ns: 'common' }) : undefined)
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
              <span className="font-semibold tabular-nums">{clock(capture.durationMs)}</span>
            </>
          ) : (
            <>
              <i className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />
              <span className="min-w-0 truncate">
                {t(($) => $.capture.label[capture.state], { ns: 'common' })}
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
          title={t(($) => (dpsShown ? $.hideDps : $.showDps), { key: 'Ctrl+Shift+F9' })}
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
          aria-label={t(($) => $.group)}
          aria-pressed={groupEnabled}
          aria-busy={busy}
          title={groupEnabled ? t(($) => $.groupDisable) : t(($) => $.groupEnable)}
          disabled={!native || !known || busy}
          onClick={onToggleGroup}
        >
          <Icon name="group" />
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
              : t(($) => $.lockKey, { action: lockLabel, key: 'Ctrl+Shift+F8' })
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
          className={cn(toolButton, ringing && 'text-warn enabled:hover:text-warn-strong')}
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
      </nav>
    </div>
  );
}

function Divider() {
  return <span className="mx-0.5 h-4 w-px shrink-0 bg-line-strong" aria-hidden="true" />;
}
