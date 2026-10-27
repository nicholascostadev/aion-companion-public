export const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

/**
 * Categorical series hues, validated for the dark surface (#1a1510): lightness band,
 * chroma floor, adjacent CVD ΔE ≥ 8.4 and ≥ 3.6:1 contrast. Fixed order, never cycled
 * beyond eight; marks only, never text.
 */
export const seriesColors = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/** Formats elapsed time as m:ss. */
export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** Elapsed time with tenths, e.g. 1:04.3, for timelines. */
export function preciseClock(ms: number) {
  const tenths = Math.max(0, Math.floor(ms / 100));
  const seconds = Math.floor(tenths / 10);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.${tenths % 10}`;
}

/** Placeholder for a fact native has not observed. */
export const UNKNOWN = '—';

export const maybe = (value: number | null | undefined, format = number) =>
  value === null || value === undefined ? UNKNOWN : format.format(value);

/** 0..1 → "42.1%"; unknown → dash. */
export const pct = (value: number | null | undefined, digits = 1) =>
  value === null || value === undefined ? UNKNOWN : `${(value * 100).toFixed(digits)}%`;

export const seconds = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? UNKNOWN : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});
const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

export const dateTime = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? UNKNOWN : dateTimeFormat.format(ms);
export const timeOfDay = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? UNKNOWN : timeFormat.format(ms);

/** Short countdown, e.g. 1:05 or 42s or 3.4s. */
export function countdown(ms: number) {
  if (ms < 0) return '0s';
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 60_000) return `${Math.ceil(ms / 1000)}s`;
  if (ms < 3_600_000) return clock(ms);
  const h = Math.floor(ms / 3_600_000);
  return `${h}h ${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0')}m`;
}

const hourMinuteFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
/** Wall-clock hour and minute, e.g. 14:18; unknown → dash. */
export const hourMinute = (ms: number | null | undefined) =>
  ms === null || ms === undefined ? UNKNOWN : hourMinuteFormat.format(ms);
