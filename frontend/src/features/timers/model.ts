import type { Translate } from '../../i18n/provider';
import type { TimerRow } from '../../types/timers';

/** Passing a due time never proves an opening or a boss sighting. */
export function timerState(row: TimerRow, now: number, stale = false): TimerRow['state'] {
  if (row.state === 'unknown') return 'unknown';
  if (row.state === 'open' || row.state === 'alive') {
    if (stale || (row.ends_ms !== null && row.ends_ms <= now)) return 'unknown';
    return row.state;
  }
  return row.due_ms !== null && row.due_ms > now ? 'scheduled' : 'unknown';
}

export function countdown(ms: number, t: Translate<'timers'>): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return t(($) => $.countdown.hours, {
      hours,
      minutes: String(minutes % 60).padStart(2, '0'),
    });
  return t(($) => $.countdown.days, { days: Math.floor(hours / 24), hours: hours % 24 });
}

/**
 * The time in the game region's zone, always on a 24-hour clock; null for a zone this
 * system does not know. `locale` names the weekday.
 */
export function serverTime(
  ms: number,
  timezone: string,
  weekday = false,
  locale = 'en-GB',
): string | null {
  try {
    return new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      ...(weekday ? { weekday: 'short' as const } : {}),
    }).format(ms);
  } catch {
    return null;
  }
}

export function sortedTimers(rows: TimerRow[], now: number, stale: boolean): TimerRow[] {
  const rank = (row: TimerRow) => {
    const state = timerState(row, now, stale);
    return state === 'alive' || state === 'open' ? 0 : state === 'scheduled' ? 1 : 2;
  };
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.due_ms ?? Infinity) - (b.due_ms ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}
