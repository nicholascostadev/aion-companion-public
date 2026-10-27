import type { Ref } from 'react';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionTitle,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { ActivityWindowStatus } from '../../types/activityWindows';
import type { TimerRow, TimersStatus } from '../../types/timers';
import { useWindowDrag } from '../live/windowDrag';
import { countdown, serverTime, sortedTimers, timerState } from './model';

interface Props {
  native: boolean;
  status: TimersStatus | null;
  now: number;
  stale: boolean;
  window: ActivityWindowStatus;
  busy: boolean;
  error: string;
  onLock: (locked: boolean) => void;
  onHide: () => void;
  onDrag?: () => void;
  onResize?: () => void;
  hitRef?: Ref<HTMLElement>;
}

function ActivityRow({
  row,
  now,
  stale,
  timezone,
}: {
  row: TimerRow;
  now: number;
  stale: boolean;
  timezone: string;
}) {
  const { t } = useTranslation('timers');
  const fmt = useFormat();
  const state = timerState(row, now, stale);
  const live = state === 'open' || state === 'alive';
  const category = t(($) => $.category[row.category]);
  return (
    <tr
      data-state={state}
      className={cn('h-7', live && 'bg-accent-soft')}
      title={t(($) => (row.estimated ? $.rowTitleEstimated : $.rowTitle), {
        category,
        basis: row.basis,
      })}
    >
      <th scope="row" className="max-w-0 truncate py-1 pr-1 pl-3 text-left text-xs font-medium">
        <span title={row.name}>{row.name}</span>
        <span className="sr-only"> · {category}</span>
      </th>
      {!live && (
        <td className="py-1 text-right text-2xs text-ink-3 tabular-nums">
          {state === 'scheduled' && row.due_ms !== null
            ? (serverTime(row.due_ms, row.timezone ?? timezone, false, fmt.intl) ??
              t(($) => $.state.unknown))
            : ''}
        </td>
      )}
      <td
        colSpan={live ? 2 : 1}
        className={cn(
          'py-1 pr-3 pl-2 text-right text-xs whitespace-nowrap tabular-nums',
          live
            ? 'font-semibold text-success'
            : state === 'scheduled'
              ? 'font-semibold text-accent'
              : 'text-ink-3',
        )}
      >
        {state === 'scheduled' ? '' : t(($) => $.state[state])}
        {state === 'open' && row.ends_ms !== null && (
          <span className="ml-1 text-2xs">
            {t(($) => $.left, { time: countdown(row.ends_ms - now, t) })}
          </span>
        )}
        {state === 'scheduled' && row.due_ms !== null && (
          <>
            {row.estimated && <span aria-label={t(($) => $.estimated)}>≈ </span>}
            {countdown(row.due_ms - now, t)}
          </>
        )}
      </td>
    </tr>
  );
}

export function Timers({
  native,
  status,
  now,
  stale,
  window: win,
  busy,
  error,
  onLock,
  onHide,
  onDrag,
  onResize,
  hitRef,
}: Props) {
  const { t } = useTranslation('timers');
  const fmt = useFormat();
  const drag = useWindowDrag(native && !win.locked ? onDrag : undefined);
  const problem = error || win.errors[0] || '';
  const rows = status ? sortedTimers(status.rows, now, stale) : [];
  return (
    <section
      ref={hitRef}
      className={overlayWindow({ editing: !win.locked })}
      aria-label={t(($) => $.title)}
      {...drag}
    >
      <OverlayCaption className="gap-1 pl-3">
        <CaptionTitle label={t(($) => $.title)} icon={<Icon name="timers" size={13} />} />
        <span
          className="min-w-0 max-w-32 truncate text-2xs text-ink-3"
          title={status ? `${status.region_name} · ${status.timezone}` : undefined}
        >
          {status?.region_name || t(($) => $.serverUnknown)}
        </span>
        <WindowButton
          data-hit
          aria-label={win.locked ? t(($) => $.unlock) : t(($) => $.lock)}
          title={win.locked ? t(($) => $.unlockTitle) : t(($) => $.lock)}
          aria-pressed={win.locked}
          disabled={!native || busy}
          onClick={() => onLock(!win.locked)}
        >
          <Icon name={win.locked ? 'lock' : 'unlock'} size={12} />
        </WindowButton>
        <WindowButton
          data-hit
          close
          aria-label={t(($) => $.hide)}
          title={t(($) => $.hide)}
          disabled={!native || busy}
          onClick={onHide}
        >
          <Icon name="close" size={13} />
        </WindowButton>
      </OverlayCaption>
      {problem ? (
        <output className="m-0 block border-b border-line-soft px-3 py-1 text-2xs text-warn">
          {problem}
        </output>
      ) : stale && status ? (
        <output className="m-0 block px-3 py-1 text-2xs text-warn">{t(($) => $.refreshing)}</output>
      ) : null}
      {status && (!status.clock_ready || status.clock_estimated) && (
        <p className="m-0 px-3 py-1 text-2xs text-warn">
          {status.clock_estimated ? t(($) => $.clockEstimated) : t(($) => $.clockWaiting)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto" data-hit-clip>
        {rows.length ? (
          <table aria-label={t(($) => $.table)} className="w-full table-fixed border-collapse">
            <colgroup>
              <col />
              <col className="w-12" />
              <col className="w-24" />
            </colgroup>
            <thead className="sr-only">
              <tr>
                <th>{t(($) => $.columns.activity)}</th>
                <th>{t(($) => $.columns.serverTime)}</th>
                <th>{t(($) => $.columns.status)}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <ActivityRow
                  key={row.id}
                  row={row}
                  now={now}
                  stale={stale}
                  timezone={status?.timezone ?? 'UTC'}
                />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="m-0 px-3 py-4 text-xs text-ink-3">
            {status ? t(($) => $.empty) : native ? t(($) => $.loading) : t(($) => $.needsDesktop)}
          </p>
        )}
      </div>
      {status && (
        <footer className="flex-none border-t border-line-strong py-1">
          {(['daily', 'weekly'] as const).map((kind) => {
            const due = kind === 'daily' ? status.resets.daily_ms : status.resets.weekly_ms;
            return (
              <div
                key={kind}
                className="flex h-6 items-center gap-2 px-3 text-2xs"
                title={`${status.resets.basis} · ${status.resets.timezone}`}
              >
                <Icon
                  name={kind === 'daily' ? 'reset' : 'calendar'}
                  size={12}
                  className="text-accent"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-ink-2">
                  {t(($) => $[kind])}
                </span>
                <span className="text-ink-3 tabular-nums">
                  {Number.isFinite(due) && due > now
                    ? (serverTime(due, status.resets.timezone, true, fmt.intl) ??
                      t(($) => $.state.unknown))
                    : ''}
                </span>
                <span className="min-w-16 text-right font-semibold text-accent tabular-nums">
                  {Number.isFinite(due) && due > now
                    ? countdown(due - now, t)
                    : t(($) => $.resetRefreshing)}
                </span>
              </div>
            );
          })}
        </footer>
      )}
      {native && !win.locked && onResize && (
        <WindowButton
          data-hit
          aria-label={t(($) => $.resize)}
          title={t(($) => $.resizeTitle)}
          className="absolute right-0 bottom-0 size-3 cursor-se-resize"
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onResize();
          }}
        >
          <Icon name="grip" size={10} />
        </WindowButton>
      )}
    </section>
  );
}
