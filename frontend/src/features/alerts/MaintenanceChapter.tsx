import type { ReactNode } from 'react';
import { buttonClasses } from '../../components/ui/Button';
import { Switch } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { AlertConfig, AlertDashboard, ServerMaintenance } from '../../types/alerts';
import { maintenanceView, type MaintenanceView } from './maintenance';
import { ago, clockIn, dateTimeIn, localTimeZone, remaining, zoneAbbr } from './model';
import { Chapter, StateTag } from './parts';

type T = Translate<'alerts'>;

/** The official notice, opened outside the app; it never gets a handle on this window. */
export function NoticeLink({
  planned,
  children,
  className,
}: {
  planned: ServerMaintenance;
  children?: ReactNode;
  className?: string;
}) {
  const { t } = useTranslation('alerts');
  return (
    <a
      href={planned.url}
      target="_blank"
      rel="noopener noreferrer"
      title={planned.title || planned.url}
      className={cn(buttonClasses({ variant: 'link' }), 'inline-flex min-w-0 gap-1', className)}
    >
      <span className="truncate">{children ?? t(($) => $.maintenance.notice)}</span>
      <Icon name="external" size={12} />
    </a>
  );
}

/** "Checked 40 s ago": just-now reads on its own. */
const checkedAgo = (t: T, view: MaintenanceView, nowMs: number) =>
  view.checkedMs === null
    ? t(($) => $.maintenance.neverChecked)
    : nowMs - view.checkedMs < 60_000
      ? t(($) => $.maintenance.checkedNow)
      : t(($) => $.maintenance.checkedAgo, { age: ago(t, nowMs - view.checkedMs) });

function PhaseTag({ view }: { view: MaintenanceView }) {
  const { t } = useTranslation('alerts');
  if (view.check !== 'fresh')
    return (
      <StateTag kind="unknown" title={view.error ?? undefined}>
        {t(($) => $.maintenance.uncertain)}
      </StateTag>
    );
  switch (view.phase) {
    case 'now':
      return <StateTag kind="estimate">{t(($) => $.maintenance.now)}</StateTag>;
    case 'next':
      return <StateTag kind="neutral">{t(($) => $.maintenance.scheduled)}</StateTag>;
    case 'overdue':
      return <StateTag kind="unknown">{t(($) => $.maintenance.unconfirmed)}</StateTag>;
    case 'completed':
      return <StateTag kind="good">{t(($) => $.maintenance.completed)}</StateTag>;
    case 'none':
      return null;
  }
}

/**
 * The announced window in local time: start to end, the end marked "~" until the notice
 * says it is complete, with the full dates and zone in the title.
 */
function WindowFacts({
  view,
  planned,
  nowMs,
}: {
  view: MaintenanceView;
  planned: ServerMaintenance;
  nowMs: number;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const zone = zoneAbbr(fmt, localTimeZone(), planned.starts_ms);
  const estimated = !planned.completed;
  const relative =
    view.phase === 'now'
      ? t(($) => $.maintenance.endsIn, { time: remaining(t, planned.ends_ms - nowMs) })
      : view.phase === 'next'
        ? t(($) => $.maintenance.startsIn, { time: remaining(t, planned.starts_ms - nowMs) })
        : view.phase === 'overdue'
          ? t(($) => $.maintenance.overdue)
          : null;
  return (
    <div
      data-phase={view.phase}
      className={cn(
        'flex min-w-0 flex-col gap-1 rounded-lg border border-line-soft bg-surface-2 px-3 py-2.5',
        view.phase === 'now' && view.check === 'fresh' && 'border-warn-line',
      )}
    >
      <span
        className="text-md font-semibold text-ink tabular-nums"
        title={t(($) => $.maintenance.windowTitle, {
          start: dateTimeIn(fmt, planned.starts_ms),
          end: dateTimeIn(fmt, planned.ends_ms),
          zone,
        })}
      >
        {t(($) => $.maintenance.window, {
          start: clockIn(fmt, planned.starts_ms, undefined, nowMs),
          end: `${estimated ? '~' : ''}${clockIn(fmt, planned.ends_ms, undefined, planned.starts_ms)}`,
          zone,
        })}
      </span>
      <small className="text-xs text-ink-3">
        {[
          relative,
          estimated && view.phase !== 'overdue' ? t(($) => $.maintenance.estimatedEnd) : null,
        ]
          .filter(Boolean)
          .join(' · ')}
      </small>
      {planned.title && (
        <NoticeLink planned={planned} className="self-start text-xs">
          {planned.title}
        </NoticeLink>
      )}
    </div>
  );
}

/** Which servers the window is announced for, and whether yours is one. */
function scopeLine(t: T, view: MaintenanceView) {
  if (!view.affected) return null;
  const scope =
    view.affected === view.total
      ? t(($) => $.maintenance.allServers, { count: view.total })
      : t(($) => $.maintenance.someServers, { count: view.affected, total: view.total });
  if (!view.server || view.yoursListed === null) return scope;
  return `${scope} ${
    view.yoursListed
      ? t(($) => $.maintenance.yoursListed, { name: view.server.name })
      : t(($) => $.maintenance.yoursNotListed, { name: view.server.name })
  }`;
}

/**
 * Maintenance from the official notice board: the announced window (never a live health
 * check), how fresh that is, and the opt-in "maintenance complete" notification.
 */
export function MaintenanceChapter({
  dashboard,
  nowMs,
  busy,
  onConfigure,
}: {
  dashboard: AlertDashboard;
  nowMs: number;
  busy: boolean;
  onConfigure: (change: (config: AlertConfig) => AlertConfig) => Promise<boolean>;
}) {
  const { t } = useTranslation('alerts');
  const view = maintenanceView(dashboard, nowMs);
  const planned = view.window;
  const scope = scopeLine(t, view);
  return (
    <Chapter
      id="alerts-maintenance"
      title={t(($) => $.maintenance.title)}
      icon="wrench"
      actions={<PhaseTag view={view} />}
    >
      {planned ? (
        <WindowFacts view={view} planned={planned} nowMs={nowMs} />
      ) : (
        <p className="m-0 text-sm text-ink-2">
          {view.check === 'waiting'
            ? t(($) => $.maintenance.checking)
            : view.check === 'unreachable'
              ? t(($) => $.maintenance.unreachable)
              : t(($) => $.maintenance.none)}
        </p>
      )}
      {scope && view.phase === 'now' && <p className="m-0 text-xs text-ink-3">{scope}</p>}
      <p className="m-0 text-xs leading-snug text-ink-3">
        {view.check === 'stale'
          ? t(($) => $.maintenance.staleHint)
          : view.check === 'unreachable'
            ? t(($) => $.maintenance.unreachableHint)
            : view.phase === 'now' || view.phase === 'overdue'
              ? t(($) => $.maintenance.nowHint)
              : t(($) => $.maintenance.scheduleHint)}
      </p>
      {view.uncovered && (
        <p className="m-0 text-xs leading-snug text-warn">
          {t(($) => $.maintenance.uncovered, { region: view.uncovered })}
        </p>
      )}
      {view.error && view.check !== 'fresh' && (
        <small className="truncate font-mono text-2xs text-ink-4" title={view.error}>
          {view.error}
        </small>
      )}
      <Switch
        checked={dashboard.config.notify_server_back}
        disabled={busy}
        onCheckedChange={(notify_server_back) =>
          void onConfigure((c) => ({ ...c, notify_server_back }))
        }
        label={t(($) => $.maintenance.notifyBack)}
        hint={t(($) => $.maintenance.notifyBackHint)}
      />
      <small className="text-2xs text-ink-4">
        {t(($) => $.maintenance.cadence)} · {checkedAgo(t, view, nowMs)}
      </small>
    </Chapter>
  );
}
