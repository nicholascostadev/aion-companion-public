import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card, Panel } from '../../components/ui/Panel';
import { Ticking } from '../../components/ui/Ticking';
import type { Formatters } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { AlertDelivery } from '../../types/alerts';
import type { AlertsController } from '../alerts/AlertsPanel';
import { CategoryIcon, Countdown } from '../alerts/parts';
import {
  categoryLabel,
  clockIn,
  nextUp,
  deliveryName,
  phaseLabel,
  snoozable,
  remaining,
  SNOOZE_SECONDS,
  zoneAbbr,
  type NextRow,
} from '../alerts/model';

type T = Translate<'alerts'>;

/** Within this long, an opening is close at hand and its countdown warms. */
const SOON_MS = 5 * 60_000;

/** Alerts ringing right now, answered in place: snooze or dismiss. */
export function RingingNow({
  active,
  busy,
  onAction,
}: {
  active: AlertDelivery[];
  busy: boolean;
  onAction: AlertsController['action'];
}) {
  const { t } = useTranslation('alerts');
  const titleId = useId();
  if (!active.length) return null;
  return (
    <Panel
      as="section"
      padding="none"
      aria-labelledby={titleId}
      data-home="ringing"
      className="mb-5 animate-alight border-warn-line px-5 py-3.5 max-[760px]:px-4"
    >
      <div className="grid items-start gap-x-6 gap-y-2 min-[900px]:grid-cols-[16rem_minmax(0,1fr)]">
        <div className="flex items-center gap-2.5 pt-1">
          <span className="grid size-8 animate-breathe place-items-center rounded-full bg-warn-soft text-warn">
            <Icon name="bellRing" size={16} />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="m-0 text-md font-semibold tracking-tight">
              {t(($) => $.home.ringing)}
            </h2>
            <p className="m-0 text-xs text-ink-3">
              {t(($) => $.home.reminders, { count: active.length })}
            </p>
          </div>
          {active.length > 1 && (
            <Button
              size="xs"
              variant="ghost"
              className="ml-auto"
              disabled={busy}
              onClick={() => void onAction('dismiss_all')}
            >
              {t(($) => $.home.dismissAll)}
            </Button>
          )}
        </div>
        <ul className="m-0 flex min-w-0 list-none flex-col p-0">
          {active.map((d) => {
            const name = deliveryName(t, d, true);
            return (
              <li
                key={d.id}
                className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft py-1.5 first:border-t-0"
              >
                <CategoryIcon category={d.category} size="sm" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <b className="truncate text-sm font-semibold text-ink" title={deliveryName(t, d)}>
                    {deliveryName(t, d)}
                  </b>
                  <small className="truncate text-xs text-ink-3">
                    {phaseLabel(t, d)}
                    {snoozable(d) && (
                      <Ticking>
                        {(now) =>
                          d.due_ms > now
                            ? ` · ${t(($) => $.home.startsIn, { time: remaining(t, d.due_ms - now) })}`
                            : ''
                        }
                      </Ticking>
                    )}
                  </small>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {snoozable(d) && (
                    <Button
                      size="xs"
                      disabled={busy}
                      icon={<Icon name="snooze" size={12} />}
                      aria-label={t(($) => $.home.snooze, { name })}
                      onClick={() => void onAction('snooze', d.id, SNOOZE_SECONDS)}
                    >
                      {t(($) => $.home.snoozeShort)}
                    </Button>
                  )}
                  <Button
                    size="xs"
                    disabled={busy}
                    aria-label={t(($) => $.home.dismiss, { name })}
                    onClick={() => void onAction('dismiss', d.id)}
                  >
                    {t(($) => $.actions.dismiss, { ns: 'common' })}
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

/** Time left as the alerts tab writes it; `open` and `now` read as words. */
function left(t: T, row: NextRow, now: number) {
  if (row.state === 'open') return t(($) => $.home.openNow);
  const ms = (row.due_ms ?? now) - now;
  return `${row.estimated ? '~' : ''}${remaining(t, ms)}`;
}

function tone(row: NextRow, now: number) {
  if (row.state === 'open') return 'open' as const;
  const ms = (row.due_ms ?? now) - now;
  return ms > 0 && ms <= SOON_MS ? ('soon' as const) : undefined;
}

/** When it opens on the server clock, with this PC's time beside it. */
function when(t: T, fmt: Formatters, row: NextRow, now: number) {
  if (row.due_ms === null) return row.basis;
  const server = `${clockIn(fmt, row.due_ms, row.zone, now)} ${zoneAbbr(fmt, row.zone, row.due_ms)}`;
  const local = clockIn(fmt, row.due_ms, undefined, now);
  return server === local ? server : t(($) => $.home.withLocal, { server, local });
}

/** How far ahead the day thread looks. */
const THREAD_MS = 3 * 3_600_000;
/** Seeds closer than this share one place on the thread. */
const CLUSTER = 0.05;

/**
 * The next three hours as one thread: the hours marked on the server clock and every timed
 * opening a seed at its place, so the rhythm of the evening reads at a glance. Seeds that
 * would overlap gather into one with a count. The list below says the same in words, so the
 * thread itself is hidden from assistive technology.
 */
function DayThread({ rows, now, zone }: { rows: NextRow[]; now: number; zone: string }) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const seeds: { at: number; rows: NextRow[] }[] = [];
  for (const row of rows) {
    if (row.state !== 'scheduled' || row.due_ms === null) continue;
    const at = (row.due_ms - now) / THREAD_MS;
    if (at <= 0 || at > 1) continue;
    const near = seeds.find((s) => Math.abs(s.at - at) < CLUSTER);
    if (near) near.rows.push(row);
    else seeds.push({ at, rows: [row] });
  }
  const hours: { at: number; label: string }[] = [];
  for (let h = Math.ceil(now / 3_600_000) * 3_600_000; h <= now + THREAD_MS; h += 3_600_000)
    hours.push({ at: (h - now) / THREAD_MS, label: clockIn(fmt, h, zone) });
  // Nothing hangs over the edge of the now light.
  const place = (at: number) => ({
    left: `${(Math.max(at, 0.025) * 100).toFixed(2)}%`,
  });
  return (
    <div aria-hidden="true" className="mt-1 mb-5 select-none" data-home="thread">
      <span className="block text-2xs font-semibold tracking-caps text-ink-3 uppercase">
        {t(($) => $.home.nextHours)}
      </span>
      <div className="flex">
        <span className="relative h-12 w-9 flex-none">
          <span className="absolute top-3 left-1 grid size-4 place-items-center">
            <span className="size-2 animate-breathe rounded-full bg-accent shadow-glow" />
          </span>
          <span className="absolute top-7 left-0 text-2xs font-semibold text-accent">
            {t(($) => $.home.now)}
          </span>
          {/* The thread leaves the now light … */}
          <span className="absolute top-5 right-0 left-4 h-px bg-accent-line" />
        </span>
        <div className="relative h-12 flex-1 -translate-y-1">
          {/* … and runs on towards later. */}
          <span className="absolute inset-x-0 top-6 h-px bg-line" />
          {hours.map((h) => (
            <span key={h.at} className="absolute top-5 -translate-x-1/2" style={place(h.at)}>
              <span className="mx-auto block h-2 w-px bg-line-strong" />
              <span className="mt-1.5 block text-2xs text-ink-3 tabular-nums">{h.label}</span>
            </span>
          ))}
          {seeds.map((seed) => {
            const first = seed.rows[0]!;
            const soon = (first.due_ms ?? now) - now <= SOON_MS;
            return (
              <span
                key={first.key}
                className="absolute top-3 -translate-x-1/2"
                style={place(seed.at)}
                title={seed.rows
                  .map(
                    (r) =>
                      `${r.name} · ${r.due_ms === null ? '' : clockIn(fmt, r.due_ms, r.zone, now)}`,
                  )
                  .join('\n')}
              >
                <CategoryIcon
                  category={first.category}
                  size="sm"
                  className={cn(soon && 'shadow-[0_0_0_3px_var(--color-warn-soft)]')}
                />
                {seed.rows.length > 1 && (
                  <span className="absolute -top-1.5 -right-2 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-surface-3 px-0.5 text-3xs font-semibold text-ink-2 tabular-nums ring-1 ring-line">
                    {seed.rows.length}
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * What opens next, the first one as the page's headline figure and the rest hung on a
 * thread, each counting down on its own tick so the page around them stays still.
 */
export function NextUpCard({
  alerts,
  onOpenAlerts,
  className,
}: {
  alerts: AlertsController;
  onOpenAlerts: () => void;
  className?: string;
}) {
  const { t } = useTranslation('alerts');
  const fmt = useFormat();
  const { dashboard, offsetMs } = alerts;
  const timed = dashboard
    ? nextUp(dashboard, 40).filter((r) => r.state !== 'unknown' && r.due_ms !== null)
    : [];
  const [first, ...rest] = timed.slice(0, 4);
  const zone = dashboard?.effective_timezone;
  const zoneTag = dashboard ? zoneAbbr(fmt, zone ?? 'UTC', dashboard.now_ms) : '';
  return (
    <Card
      title={t(($) => $.home.nextUp)}
      className={cn('mb-0', className)}
      subtitle={
        dashboard
          ? dashboard.clock_estimated
            ? t(($) => $.home.fallbackClock, { zone: zoneTag })
            : dashboard.detected_server
              ? t(($) => $.home.serverTimeNamed, {
                  zone: zoneTag,
                  server: dashboard.detected_server.name,
                })
              : t(($) => $.home.serverTime, { zone: zoneTag })
          : t(($) => $.home.waiting)
      }
      actions={
        <Button variant="link" size="sm" onClick={onOpenAlerts}>
          {t(($) => $.home.allAlerts)} <Icon name="arrowRight" size={13} />
        </Button>
      }
    >
      {!first ? (
        <EmptyState
          compact
          icon={<Icon name="hourglass" size={18} />}
          title={t(($) => $.home.emptyTitle)}
        >
          {dashboard ? t(($) => $.home.emptyReady) : t(($) => $.home.emptyWaiting)}
        </EmptyState>
      ) : (
        <Ticking offset={offsetMs}>
          {(now) => (
            <>
              <div
                className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 pb-5"
                data-home="next-first"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <CategoryIcon
                    category={first.category}
                    className={cn(
                      tone(first, now) === 'soon' && 'shadow-[0_0_0_4px_var(--color-warn-soft)]',
                      tone(first, now) === 'open' && 'shadow-glow',
                    )}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">
                      {categoryLabel(t, first.category)}
                      {first.notify === 'on' && (
                        <span className="ml-1.5 inline-flex items-center gap-1 align-[-1px] normal-case tracking-normal text-ink-2">
                          <Icon name="bellRing" size={11} />
                          <span>{t(($) => $.home.remindsYou)}</span>
                        </span>
                      )}
                    </span>
                    <b className="text-lg leading-tight font-semibold tracking-tight text-balance break-words text-ink">
                      {first.name || t(($) => $.unnamed)}
                    </b>
                    <small className="truncate text-xs text-ink-3" title={first.basis}>
                      {first.state === 'open'
                        ? t(($) => $.home.openNowAt, { when: when(t, fmt, first, now) })
                        : t(($) => $.home.opensAt, { when: when(t, fmt, first, now) })}
                    </small>
                  </span>
                </div>
                <Countdown
                  tone={tone(first, now)}
                  aria-label={t(($) => $.home.timeUntil, {
                    name: first.name || t(($) => $.unnamedLower),
                  })}
                  className="text-3xl leading-none tracking-tight"
                >
                  {left(t, first, now)}
                </Countdown>
              </div>
              <DayThread rows={timed} now={now} zone={zone ?? 'UTC'} />
              {rest.length > 0 && (
                <ol
                  aria-label={t(($) => $.home.later)}
                  className={cn(
                    'relative m-0 list-none p-0',
                    'before:absolute before:top-5 before:bottom-3 before:left-[11.5px] before:w-px before:bg-line',
                  )}
                >
                  {rest.map((row) => (
                    <li
                      key={row.key}
                      className="relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-1.5"
                    >
                      <CategoryIcon category={row.category} size="sm" />
                      <span className="flex min-w-0 flex-col">
                        <b className="truncate text-sm font-semibold text-ink" title={row.name}>
                          {row.name || t(($) => $.unnamed)}
                        </b>
                        <small className="truncate text-xs text-ink-3" title={row.basis}>
                          {categoryLabel(t, row.category)} · {when(t, fmt, row, now)}
                        </small>
                      </span>
                      <Countdown
                        size="sm"
                        tone={tone(row, now)}
                        aria-label={t(($) => $.home.timeUntil, {
                          name: row.name || t(($) => $.unnamedLower),
                        })}
                      >
                        {left(t, row, now)}
                      </Countdown>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </Ticking>
      )}
    </Card>
  );
}
