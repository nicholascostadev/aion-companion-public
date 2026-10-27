import { INTL_LOCALES, type UiLocale } from './locale';

/** Placeholder for a fact native has not observed. */
export const UNKNOWN = '—';

type Maybe = number | null | undefined;
const known = (value: Maybe): value is number => value !== null && value !== undefined;

/** Unit symbols that differ between the interface languages. */
const UNITS: Record<UiLocale, { hours: string; minutes: string; seconds: string }> = {
  en: { hours: 'h', minutes: 'm', seconds: 's' },
  'pt-BR': { hours: 'h', minutes: 'min', seconds: 's' },
};

/**
 * Numbers, percentages, durations, dates and times in one interface language. Display
 * only: never parse these strings back into recordings, settings or wire values.
 */
export interface Formatters {
  locale: UiLocale;
  /** The `Intl` locale, for a formatter this set does not cover. */
  intl: string;
  /** Up to one decimal, grouped: 12,345.6. */
  number: Intl.NumberFormat;
  /** Whole numbers, grouped. */
  integer: Intl.NumberFormat;
  /** 12.3K in every language. */
  compact: Intl.NumberFormat;
  /** A cached number formatter with these options; compact notation is always English. */
  numberWith(options: Intl.NumberFormatOptions): Intl.NumberFormat;
  /** A cached date/time formatter with these options (the machine's time zone unless given). */
  dateTimeWith(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat;
  /** `format` (default `number`) or the unknown dash. */
  maybe(value: Maybe, format?: Intl.NumberFormat): string;
  /** 0..1 → "42.1%"; unknown → dash. */
  pct(value: Maybe, digits?: number): string;
  /** Milliseconds as seconds with decimals: 3.25s. */
  seconds(ms: Maybe): string;
  /** Elapsed m:ss with tenths: 1:04.3. */
  preciseClock(ms: number): string;
  /** Short countdown: 1:05, 42s, 3.4s or 2h 05m. */
  countdown(ms: number): string;
  /** Date and time, medium date and short time. */
  dateTime(ms: Maybe): string;
  /** Time of day with seconds. */
  timeOfDay(ms: Maybe): string;
  /** Wall-clock hour and minute, e.g. 14:18. */
  hourMinute(ms: Maybe): string;
  /** "a, b and c". */
  list(items: readonly string[], type?: Intl.ListFormatType): string;
}

/** Elapsed time as m:ss: the same notation in every language. */
export function clock(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function create(locale: UiLocale): Formatters {
  const intl = INTL_LOCALES[locale];
  const units = UNITS[locale];
  const numbers = new Map<string, Intl.NumberFormat>();
  const dates = new Map<string, Intl.DateTimeFormat>();
  const lists = new Map<string, Intl.ListFormat>();
  const numberWith = (options: Intl.NumberFormatOptions) => {
    const key = JSON.stringify(options);
    let format = numbers.get(key);
    if (!format) {
      // Compact figures use English notation in every language: 12.3K, 4.5M, not 12,3 mil.
      const locale = options.notation === 'compact' ? INTL_LOCALES.en : intl;
      numbers.set(key, (format = new Intl.NumberFormat(locale, options)));
    }
    return format;
  };
  const dateTimeWith = (options: Intl.DateTimeFormatOptions) => {
    const key = JSON.stringify(options);
    let format = dates.get(key);
    if (!format) dates.set(key, (format = new Intl.DateTimeFormat(intl, options)));
    return format;
  };
  const fixed = (value: number, digits: number) =>
    numberWith({ minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const number = numberWith({ maximumFractionDigits: 1 });
  const decimal = fixed(0.5, 1).charAt(1);

  return {
    locale,
    intl,
    number,
    integer: numberWith({ maximumFractionDigits: 0 }),
    compact: numberWith({ notation: 'compact', maximumFractionDigits: 1 }),
    numberWith,
    dateTimeWith,
    maybe: (value, format = number) => (known(value) ? format.format(value) : UNKNOWN),
    pct: (value, digits = 1) =>
      known(value)
        ? numberWith({
            style: 'percent',
            minimumFractionDigits: digits,
            maximumFractionDigits: digits,
          }).format(value)
        : UNKNOWN,
    seconds: (ms) =>
      known(ms) ? `${fixed(ms / 1000, ms < 10_000 ? 2 : 1)}${units.seconds}` : UNKNOWN,
    preciseClock(ms) {
      const tenths = Math.max(0, Math.floor(ms / 100));
      return `${clock(Math.floor(tenths / 10) * 1000)}${decimal}${tenths % 10}`;
    },
    countdown(ms) {
      if (ms < 0) return `0${units.seconds}`;
      if (ms < 10_000) return `${fixed(ms / 1000, 1)}${units.seconds}`;
      if (ms < 60_000) return `${Math.ceil(ms / 1000)}${units.seconds}`;
      if (ms < 3_600_000) return clock(ms);
      const h = Math.floor(ms / 3_600_000);
      const m = String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, '0');
      return `${h}${units.hours} ${m}${units.minutes}`;
    },
    dateTime: (ms) =>
      known(ms) ? dateTimeWith({ dateStyle: 'medium', timeStyle: 'short' }).format(ms) : UNKNOWN,
    timeOfDay: (ms) => (known(ms) ? dateTimeWith({ timeStyle: 'medium' }).format(ms) : UNKNOWN),
    hourMinute: (ms) =>
      known(ms) ? dateTimeWith({ hour: '2-digit', minute: '2-digit' }).format(ms) : UNKNOWN,
    list(items, type = 'conjunction') {
      let format = lists.get(type);
      if (!format) lists.set(type, (format = new Intl.ListFormat(intl, { type })));
      return format.format(items);
    },
  };
}

const cache = new Map<UiLocale, Formatters>();

/** The formatters for a language, created once and shared by every caller. */
export function formattersFor(locale: UiLocale): Formatters {
  let formatters = cache.get(locale);
  if (!formatters) cache.set(locale, (formatters = create(locale)));
  return formatters;
}
