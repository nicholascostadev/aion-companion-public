import type { IconName } from '../../components/ui/Icon';
import type { Formatters } from '../../i18n/formatters';
import type { Translate } from '../../i18n/provider';
import type {
  AlertCatalogueEntry,
  AlertCategory,
  AlertConfig,
  AlertDashboard,
  AlertDelivery,
  AlertOccurrence,
  AlertRule,
  AlertSchedule,
  AlertSound,
  AlertTemplate,
  CatalogueCountdown,
  ObservedTimer,
} from '../../types/alerts';

/*
 * Pure alert helpers: labels, validation and rule edits. Native owns every schedule.
 * Text is built with the caller's translator (`T`) and formatters, never at module scope.
 */

type T = Translate<'alerts'>;

export const CATEGORY: Record<AlertCategory, { icon: IconName }> = {
  event: { icon: 'event' },
  world_boss: { icon: 'worldBoss' },
  field_boss: { icon: 'fieldBoss' },
  custom: { icon: 'custom' },
};
export const CATEGORY_ORDER: AlertCategory[] = ['event', 'world_boss', 'field_boss', 'custom'];

export const categoryLabel = (t: T, category: AlertCategory) =>
  t(($) => $.category[category].label);
export const categoryPlural = (t: T, category: AlertCategory) =>
  t(($) => $.category[category].plural);

/** Sounds in the order the pickers list them. */
export const SOUNDS: AlertSound[] = ['chime', 'bell', 'ping', 'beep', 'pulse', 'alarm', 'none'];
export const soundLabel = (t: T, sound: AlertSound) => t(($) => $.sound[sound]);

/** Weekday indexes as schedules store them: 0 = Monday … 6 = Sunday. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
/** Short weekday name in the interface language (1 January 2024 was a Monday). */
export const weekdayLabel = (fmt: Formatters, day: number) =>
  fmt.dateTimeWith({ weekday: 'short', timeZone: 'UTC' }).format(Date.UTC(2024, 0, 1 + day, 12));
const weekdayList = (fmt: Formatters, days: number[]) =>
  [...days]
    .sort((a, b) => a - b)
    .map((d) => weekdayLabel(fmt, d))
    .join(', ');
/** Reminder presets in seconds before start. */
export const LEAD_PRESETS = [0, 60, 300, 600, 900, 1800, 3600] as const;
export const MAX_LEADS = 8;
export const MAX_RULES = 200;
/** A popup delivery is shown at most this long after it fired (matches native). */
export const POPUP_TTL_MS = 10_000;
/** Snooze offered from the workspace's active list. */
export const SNOOZE_SECONDS = 300;
export const MUTE_OPTIONS = [900, 3600, 7200, 28_800] as const;
export const muteLabel = (t: T, seconds: number) =>
  seconds < 3600
    ? t(($) => $.mute.minutes, { minutes: seconds / 60 })
    : t(($) => $.mute.hours, { count: seconds / 3600 });

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const isClock = (value: string) => HHMM.test(value);

export function isTimeZone(zone: string) {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** IANA zones the runtime knows, for timezone pickers. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  const zones = intl.supportedValuesOf?.('timeZone') ?? [];
  return zones.includes('UTC') ? zones : ['UTC', ...zones];
}

export const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/* ---------- Formatting ---------- */

/** Seconds before start, in words: "At start", "5 min before", "1 h 30 min before". */
export function leadLabel(t: T, seconds: number) {
  if (seconds === 0) return t(($) => $.lead.atStart);
  if (seconds % 60) return t(($) => $.lead.seconds, { seconds });
  const minutes = seconds / 60;
  if (minutes < 60) return t(($) => $.lead.minutes, { minutes });
  const hours = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? t(($) => $.lead.hoursMinutes, { hours, minutes: m })
    : t(($) => $.lead.hours, { hours });
}

/** Short lead chip: "Start", "5m", "1h 30m". */
export function leadChip(t: T, seconds: number) {
  if (seconds === 0) return t(($) => $.leadChip.start);
  if (seconds % 60) return t(($) => $.leadChip.seconds, { seconds });
  const minutes = seconds / 60;
  if (minutes < 60) return t(($) => $.leadChip.minutes, { minutes });
  const hours = Math.floor(minutes / 60);
  return minutes % 60
    ? t(($) => $.leadChip.hoursMinutes, { hours, minutes: minutes % 60 })
    : t(($) => $.leadChip.hours, { hours });
}

/** A reminder choice in a picker: "Only when it starts", "5 minutes before". */
export function leadOption(t: T, seconds: number) {
  if (seconds === 0) return t(($) => $.leadOption.start);
  if (seconds % 60) return t(($) => $.leadOption.seconds, { seconds });
  const minutes = seconds / 60;
  if (minutes < 60) return t(($) => $.leadOption.minutes, { count: minutes });
  const hours = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m
    ? t(($) => $.leadOption.hoursMinutes, { hours, minutes: m })
    : t(($) => $.leadOption.hours, { hours });
}

export function durationLabel(t: T, seconds: number) {
  if (seconds <= 0) return t(($) => $.duration.unknown);
  if (seconds % 3600 === 0) return t(($) => $.duration.hours, { value: seconds / 3600 });
  if (seconds % 60 === 0) return t(($) => $.duration.minutes, { value: seconds / 60 });
  return t(($) => $.duration.seconds, { value: seconds });
}

/** "Every …" for an interval, in the largest whole unit. */
export function everyLabel(t: T, seconds: number) {
  if (seconds % 86_400 === 0)
    return seconds === 86_400
      ? t(($) => $.every.day)
      : t(($) => $.every.days, { days: seconds / 86_400 });
  if (seconds % 3600 === 0)
    return seconds === 3600
      ? t(($) => $.every.hour)
      : t(($) => $.every.hours, { hours: seconds / 3600 });
  if (seconds % 60 === 0) return t(($) => $.every.minutes, { minutes: seconds / 60 });
  return t(($) => $.every.seconds, { seconds });
}

/** A display formatter in `zone` (or the PC clock); an unknown zone falls back to the PC's. */
function zoned(fmt: Formatters, zone: string | undefined, options: Intl.DateTimeFormatOptions) {
  if (!zone) return fmt.dateTimeWith(options);
  try {
    return fmt.dateTimeWith({ ...options, timeZone: zone });
  } catch {
    return fmt.dateTimeWith(options);
  }
}

/** Wall-clock time in `zone` (or the PC clock), with a weekday when not today. */
export function clockIn(fmt: Formatters, ms: number, zone?: string, now?: number) {
  const time = zoned(fmt, zone, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(
    ms,
  );
  if (now === undefined) return time;
  const day = zoned(fmt, zone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (day.format(ms) === day.format(now)) return time;
  return `${zoned(fmt, zone, { weekday: 'short' }).format(ms)} ${time}`;
}

export function dateTimeIn(fmt: Formatters, ms: number, zone?: string) {
  return zoned(fmt, zone, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

/** Abbreviated zone name, e.g. "CET" or "GMT+9". */
export function zoneAbbr(fmt: Formatters, zone: string, at: number) {
  const part = zoned(fmt, zone, { timeZoneName: 'short' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName');
  return part?.value ?? zone;
}

/** Countdown: 42s, 4:05, 1h 05m, 2d 3h. */
export function remaining(t: T, ms: number) {
  if (ms <= 0) return t(($) => $.remaining.now);
  const s = Math.ceil(ms / 1000);
  if (s < 60) return t(($) => $.remaining.seconds, { seconds: s });
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 86_400)
    return t(($) => $.remaining.hours, {
      hours: Math.floor(s / 3600),
      minutes: String(Math.floor((s % 3600) / 60)).padStart(2, '0'),
    });
  return t(($) => $.remaining.days, {
    days: Math.floor(s / 86_400),
    hours: Math.floor((s % 86_400) / 3600),
  });
}

export function describeSchedule(
  t: T,
  fmt: Formatters,
  schedule: AlertSchedule | null,
  zone: string,
): string {
  if (!schedule) return t(($) => $.schedule.unknown);
  switch (schedule.type) {
    case 'once':
      return t(($) => $.schedule.once, { date: dateTimeIn(fmt, schedule.at_ms) });
    case 'interval':
      return t(($) => $.schedule.interval, {
        every: everyLabel(t, schedule.every_seconds),
        date: dateTimeIn(fmt, schedule.anchor_ms),
      });
    case 'calendar': {
      const times = schedule.times.length
        ? schedule.times.join(', ')
        : t(($) => $.schedule.noTimes);
      const days =
        schedule.weekdays.length === 0 || schedule.weekdays.length === 7
          ? t(($) => $.schedule.daily)
          : weekdayList(fmt, schedule.weekdays);
      return t(($) => $.schedule.calendar, { days, times, zone });
    }
    case 'observed':
      return t(($) => $.schedule.observed);
  }
}

export function phaseLabel(t: T, delivery: AlertDelivery) {
  switch (delivery.phase) {
    case 'before':
      return leadLabel(t, delivery.lead_seconds);
    case 'start':
      return t(($) => $.phase.start);
    case 'snooze':
      return t(($) => $.phase.snooze);
    case 'test':
      return t(($) => $.phase.test);
    case 'recovery':
      return t(($) => $.phase.recovery);
  }
}

/** Native's rule id for the official "maintenance complete" notification. */
export const RECOVERY_RULE_ID = 'maintenance-complete';

/**
 * What a delivery is called. Native names "maintenance complete" in English, so it is
 * worded here in the user's language; other names are the user's or the catalogue's own.
 */
export function deliveryName(t: T, delivery: AlertDelivery, lower = false) {
  if (delivery.phase === 'recovery' || delivery.rule_id === RECOVERY_RULE_ID)
    return t(($) => $.recovery.name);
  return delivery.name || (lower ? t(($) => $.unnamedLower) : t(($) => $.unnamed));
}

/** Previews and "maintenance complete" happen once; there is nothing to remind again. */
export const snoozable = (delivery: AlertDelivery) =>
  delivery.phase !== 'test' && delivery.phase !== 'recovery';

export const statusLabel = (t: T, status: AlertDelivery['status']) => t(($) => $.status[status]);

/* ---------- Validation ---------- */

export type RuleErrors = Partial<
  Record<
    | 'name'
    | 'schedule'
    | 'at_ms'
    | 'anchor_ms'
    | 'every_seconds'
    | 'times'
    | 'timezone'
    | 'lead_seconds'
    | 'volume'
    | 'duration_seconds'
    | 'respawn_seconds'
    | 'binding'
    | 'notes',
    string
  >
>;

const isInt = (n: number) => Number.isInteger(n);

/** Field → message, in the language of `t`. Recomputed on every render, never stored. */
export function validateRule(t: T, rule: AlertRule): RuleErrors {
  const errors: RuleErrors = {};
  const name = rule.name.trim();
  if (!name) errors.name = t(($) => $.validation.nameRequired);
  else if (name.length > 80) errors.name = t(($) => $.validation.maxLength, { max: 80 });
  const s = rule.schedule;
  if (s?.type === 'once' && (!isInt(s.at_ms) || s.at_ms <= 0))
    errors.at_ms = t(($) => $.validation.dateTime);
  if (s?.type === 'interval') {
    if (!isInt(s.anchor_ms) || s.anchor_ms <= 0) errors.anchor_ms = t(($) => $.validation.anchor);
    if (!isInt(s.every_seconds) || s.every_seconds < 60 || s.every_seconds > 30 * 86_400)
      errors.every_seconds = t(($) => $.validation.every);
  }
  if (s?.type === 'calendar') {
    if (!s.times.length) errors.times = t(($) => $.validation.timesRequired);
    else if (s.times.length > 48) errors.times = t(($) => $.validation.timesMax, { max: 48 });
    else if (s.times.some((time) => !isClock(time)))
      errors.times = t(($) => $.validation.timesFormat);
    else if (new Set(s.times).size !== s.times.length)
      errors.times = t(($) => $.validation.timesUnique);
  }
  if (s?.type === 'observed' && rule.npc_id === null && rule.event_id === null)
    errors.binding = t(($) => $.validation.binding);
  if (rule.timezone !== null && !isTimeZone(rule.timezone))
    errors.timezone = t(($) => $.validation.timezone);
  const leads = rule.lead_seconds;
  if (!leads.length) errors.lead_seconds = t(($) => $.validation.leadsRequired);
  else if (leads.length > MAX_LEADS)
    errors.lead_seconds = t(($) => $.validation.leadsMax, { max: MAX_LEADS });
  else if (leads.some((l) => !isInt(l) || l < 0 || l > 86_400))
    errors.lead_seconds = t(($) => $.validation.leadsRange);
  else if (new Set(leads).size !== leads.length)
    errors.lead_seconds = t(($) => $.validation.leadsUnique);
  if (!(rule.volume >= 0 && rule.volume <= 1)) errors.volume = t(($) => $.validation.volume);
  if (!isInt(rule.duration_seconds) || rule.duration_seconds < 0 || rule.duration_seconds > 86_400)
    errors.duration_seconds = t(($) => $.validation.duration);
  if (
    rule.respawn_seconds !== null &&
    (!isInt(rule.respawn_seconds) || rule.respawn_seconds < 60 || rule.respawn_seconds > 7 * 86_400)
  )
    errors.respawn_seconds = t(($) => $.validation.respawn);
  if (rule.notes.length > 500) errors.notes = t(($) => $.validation.maxLength, { max: 500 });
  return errors;
}

export type ConfigErrors = Partial<Record<'quiet_hours' | 'timezone', string>>;

export function validateQuietHours(t: T, start: string, end: string): string | null {
  if (!isClock(start) || !isClock(end)) return t(($) => $.validation.timesFormat);
  if (start === end) return t(($) => $.validation.quietDiffer);
  return null;
}

/* ---------- Time ---------- */

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

const dayClocks = new Map<string, Intl.DateTimeFormat>();
/** A calculation-only clock in `zone`: fixed digits, independent of the interface language. */
function dayClock(zone: string) {
  let f = dayClocks.get(zone);
  if (!f) {
    const options = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const;
    try {
      f = new Intl.DateTimeFormat('en-US', { ...options, timeZone: zone });
    } catch {
      f = new Intl.DateTimeFormat('en-US', options);
    }
    dayClocks.set(zone, f);
  }
  return f;
}

/** Minutes since midnight in `zone`. */
export function minuteOfDay(ms: number, zone: string) {
  const parts = dayClock(zone)
    .formatToParts(ms)
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return (Number(parts.hour) % 24) * 60 + Number(parts.minute);
}

/** Whether `minute` (since midnight) is inside quiet hours; windows may span midnight. */
export function inQuietHours(minute: number, quiet: { start: string; end: string } | null) {
  if (!quiet || !isClock(quiet.start) || !isClock(quiet.end)) return false;
  const start = minutesOf(quiet.start);
  const end = minutesOf(quiet.end);
  if (start === end) return false;
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** `datetime-local` value (PC clock) ↔ epoch ms. */
export function toLocalInput(ms: number) {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function fromLocalInput(value: string): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/* ---------- Rules ---------- */

const randomId = () => Math.random().toString(36).slice(2, 8);
export const newRuleId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}-${randomId()}`.slice(0, 64);

export function newRule(category: AlertCategory = 'custom'): AlertRule {
  return {
    id: newRuleId('rule'),
    name: '',
    category,
    enabled: true,
    favorite: false,
    schedule: { type: 'calendar', times: [], weekdays: [] },
    timezone: null,
    lead_seconds: [300, 0],
    sound: 'chime',
    volume: 0.8,
    popup: true,
    duration_seconds: 0,
    npc_id: null,
    event_id: null,
    respawn_seconds: null,
    notes: '',
    preset_id: null,
    npc_ids: [],
    event_ids: [],
    schedule_override: false,
  };
}

/**
 * A rule draft from a built-in template; an unknown time stays unknown and disabled. The
 * notes are written once, in the language the draft is made in: they are the user's then.
 */
export function ruleFromTemplate(t: T, template: AlertTemplate): AlertRule {
  const schedule = template.schedule;
  return {
    ...newRule(template.category),
    id: newRuleId(`tpl-${template.id}`.slice(0, 32)),
    name: template.name,
    schedule,
    enabled: schedule !== null,
    duration_seconds: template.duration_seconds,
    npc_id: template.npc_id,
    // Rules have no source field; keep where the time came from with the notes.
    notes: [
      template.notes.trim(),
      template.source ? t(($) => $.draft.source, { source: template.source }) : '',
      template.verified ? '' : t(($) => $.draft.unverified),
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 500),
  };
}

/** A copy is always a custom alert: it keeps its own schedule and never rehydrates. */
export function duplicateRule(t: T, rule: AlertRule): AlertRule {
  return {
    ...rule,
    id: newRuleId('rule'),
    name: t(($) => $.draft.copyName, { name: rule.name }).slice(0, 80),
    favorite: false,
    preset_id: null,
    npc_ids: [],
    event_ids: [],
    schedule_override: false,
  };
}

/** A rule watching an observed in-game timer, bound only to ids native reported. */
export function ruleFromObserved(
  t: T,
  timer: {
    name: string;
    category: 'event' | 'field_boss' | 'world_boss';
    npc_id: number | null;
    event_id: number | null;
  },
): AlertRule {
  return {
    ...newRule(timer.category),
    id: newRuleId('watch'),
    name:
      timer.name ||
      (timer.npc_id !== null
        ? t(($) => $.draft.npc, { id: timer.npc_id })
        : t(($) => $.draft.observedEvent)),
    schedule: { type: 'observed' },
    lead_seconds: [60, 0],
    npc_id: timer.npc_id,
    event_id: timer.event_id,
  };
}

export const upsertRule = (config: AlertConfig, rule: AlertRule): AlertConfig => ({
  ...config,
  rules: config.rules.some((r) => r.id === rule.id)
    ? config.rules.map((r) => (r.id === rule.id ? rule : r))
    : [...config.rules, rule],
});

export const patchRule = (
  config: AlertConfig,
  id: string,
  patch: Partial<AlertRule>,
): AlertConfig => ({
  ...config,
  rules: config.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)),
});

export const removeRule = (config: AlertConfig, id: string): AlertConfig => ({
  ...config,
  rules: config.rules.filter((r) => r.id !== id),
});

/** Search over the name, notes and category word as the interface shows it. */
export function matchesQuery(t: T, rule: AlertRule, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [rule.name, rule.notes, categoryLabel(t, rule.category)]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

/** The effective calendar clock for a rule; `zone` is the dashboard's effective clock. */
export const ruleZone = (rule: AlertRule, zone: string) => rule.timezone ?? zone;

/**
 * True when a custom calendar alert runs on the fallback clock because no server region
 * is known and the alert sets no zone of its own.
 */
export function needsClock(rule: AlertRule, clockReady: boolean) {
  return rule.schedule?.type === 'calendar' && rule.timezone === null && !clockReady;
}

/* ---------- Ready-made catalogue ---------- */

/** The saved rule for a catalogue entry, or its untouched default. */
export const presetRule = (config: AlertConfig, entry: AlertCatalogueEntry): AlertRule =>
  config.rules.find((r) => r.preset_id === entry.id) ?? entry.rule;

/** True once the user saved any setting for this entry. */
export const isConfigured = (config: AlertConfig, entry: AlertCatalogueEntry) =>
  config.rules.some((r) => r.preset_id === entry.id);

/**
 * Applies a change to a catalogue entry's rule, saving its default first when the user
 * never touched it. Built-in names and bindings stay native's.
 */
export function patchPreset(
  config: AlertConfig,
  entry: AlertCatalogueEntry,
  patch: Partial<AlertRule>,
): AlertConfig {
  const current = presetRule(config, entry);
  return upsertRule(config, { ...current, ...patch, id: current.id, preset_id: entry.id });
}

/**
 * Turns an entry on. The first alert anyone enables also switches alerts on, so one
 * click is enough to start getting reminders.
 */
export function enablePreset(config: AlertConfig, entry: AlertCatalogueEntry): AlertConfig {
  const first = !config.enabled && !config.rules.some((r) => r.enabled);
  const next = patchPreset(config, entry, { enabled: true });
  return first ? { ...next, enabled: true } : next;
}

/** Custom alerts: everything the user built themselves, plus anything orphaned. */
export const customRules = (config: AlertConfig, catalogue: AlertCatalogueEntry[]) => {
  const ids = new Set(catalogue.map((e) => e.id));
  return config.rules.filter((r) => r.preset_id === null || !ids.has(r.preset_id));
};

/** Reminder minutes offered inline; anything else stays editable in More options. */
export const QUICK_LEADS = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60].map((m) => m * 60);

/** The single "N minutes before" reminder, 0 for start only, or null when several. */
export function primaryLead(leads: number[]): number | null {
  const before = leads.filter((l) => l > 0);
  if (before.length > 1) return null;
  return before[0] ?? 0;
}

/** Replaces the before-start reminders with one, keeping the at-start choice. */
export function withPrimaryLead(leads: number[], seconds: number): number[] {
  const atStart = leads.includes(0) || seconds === 0;
  return [...(seconds > 0 ? [seconds] : []), ...(atStart ? [0] : [])];
}

/** Toggles the at-start reminder; one reminder always remains. */
export function withAtStart(leads: number[], on: boolean): number[] {
  const before = leads.filter((l) => l > 0);
  if (!on && !before.length) return leads;
  return on ? [...before, 0] : before;
}

/** Faction names are the game's own; only "both" is the app's wording. */
export const factionLabel = (t: T, faction: 'elyos' | 'asmodian' | 'all') =>
  t(($) => $.faction[faction]);

/** The faction the list follows: the user's choice, or the detected character's. */
export function viewFaction(dashboard: AlertDashboard): 'elyos' | 'asmodian' | 'all' {
  const choice = dashboard.config.faction;
  if (choice !== 'auto') return choice;
  return dashboard.effective_faction ?? 'all';
}

export const factionMatches = (entry: AlertCatalogueEntry, faction: 'elyos' | 'asmodian' | 'all') =>
  faction === 'all' || entry.faction === 'all' || entry.faction === faction;

export function catalogueMatches(entry: AlertCatalogueEntry, query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [entry.name, entry.map ?? '', entry.note, ...entry.members.map((m) => m.name)]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

/**
 * Short form of a daily time list: "Every hour at :30", "Every 3 h · 02:00, 05:00, …",
 * or the times themselves when few.
 */
export function compactTimes(t: T, times: string[]) {
  const sorted = [...times].filter(isClock).sort();
  if (sorted.length < 4) return sorted.join(', ');
  const minutes = sorted.map(minutesOf);
  const step = minutes[1]! - minutes[0]!;
  const even =
    step > 0 &&
    (24 * 60) % step === 0 &&
    minutes.length === (24 * 60) / step &&
    minutes.every((m, i) => i === 0 || m - minutes[i - 1]! === step);
  if (even && step === 60) return t(($) => $.summary.hourly, { minute: sorted[0]!.slice(3) });
  if (even && step % 60 === 0)
    return t(($) => $.summary.everyHours, {
      hours: step / 60,
      times: sorted.slice(0, 2).join(', '),
    });
  return `${sorted.slice(0, 3).join(', ')} +${sorted.length - 3}`;
}

/** One-line schedule for a ready-made row: no zone names, the clock is shown once above. */
export function scheduleSummary(t: T, fmt: Formatters, rule: AlertRule) {
  const s = rule.schedule;
  if (!s) return t(($) => $.summary.unknown);
  const open =
    rule.duration_seconds > 0
      ? t(($) => $.summary.open, { duration: durationLabel(t, rule.duration_seconds) })
      : '';
  const parts = (...segments: string[]) => segments.filter(Boolean).join(' · ');
  switch (s.type) {
    case 'calendar': {
      const days =
        s.weekdays.length === 0 || s.weekdays.length === 7 ? '' : weekdayList(fmt, s.weekdays);
      return parts(days, compactTimes(t, s.times) || t(($) => $.summary.noTimes), open);
    }
    case 'observed':
      return rule.respawn_seconds
        ? t(($) => $.summary.respawn, { duration: durationLabel(t, rule.respawn_seconds) })
        : t(($) => $.summary.sightings);
    case 'interval':
      return parts(everyLabel(t, s.every_seconds), open);
    case 'once':
      return t(($) => $.schedule.once, { date: dateTimeIn(fmt, s.at_ms) });
  }
}

/** How long a local spawn sighting counts as "up", as in the native timers (activities.rs). */
export const SPAWN_FRESH_MS = 120_000;

/**
 * A spawn is a local sighting, not a promise that the boss is still alive: it reads as up only
 * within two minutes of being seen, and never while native says no capture is observing.
 * Anything older is a past sighting whose current state is unknown.
 */
export function spawnFresh(sighting: ObservedTimer, nowMs: number, live?: boolean) {
  return (
    sighting.state === 'Spawned' &&
    live !== false &&
    sighting.observed_ms <= nowMs &&
    nowMs < sighting.observed_ms + SPAWN_FRESH_MS
  );
}

/** The newest in-game sighting of any NPC or event an entry covers, on this server. */
export function latestObservation(
  observed: ObservedTimer[],
  entry: AlertCatalogueEntry,
  rule: AlertRule,
): ObservedTimer | null {
  const npcs = new Set([...entry.members.map((m) => m.id), ...rule.npc_ids]);
  if (rule.npc_id !== null) npcs.add(rule.npc_id);
  const events = new Set(rule.event_ids);
  if (rule.event_id !== null) events.add(rule.event_id);
  let best: ObservedTimer | null = null;
  for (const t of observed) {
    const hit =
      (t.npc_id !== null && npcs.has(t.npc_id)) || (t.event_id !== null && events.has(t.event_id));
    if (hit && (!best || t.observed_ms > best.observed_ms)) best = t;
  }
  return best;
}

/** Elapsed time, coarse: "just now", "12 min", "3 h 05 min", "2 d". */
export function ago(t: T, ms: number) {
  if (ms < 60_000) return t(($) => $.ago.justNow);
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return t(($) => $.ago.minutes, { minutes });
  if (minutes < 1440)
    return t(($) => $.ago.hours, {
      hours: Math.floor(minutes / 60),
      minutes: String(minutes % 60).padStart(2, '0'),
    });
  return t(($) => $.ago.days, { days: Math.floor(minutes / 1440) });
}

/** Minute of the server day as HH:mm. */
export const minuteClock = (minute: number) => {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/** Live remaining time for an occurrence, re-based on the native clock. */
export function occurrenceRemaining(o: AlertOccurrence, nowMs: number) {
  return o.due_ms === null ? null : o.due_ms - nowMs;
}

/** Whether a row will sound or pop up: on, off (countdown only), or waiting for a clock. */
export type NotifyState = CatalogueCountdown['notify'];

/** One row of the Next up list: a countdown, and whether it also notifies. */
export interface NextRow {
  key: string;
  ruleId: string;
  /** Catalogue entry the row belongs to; null for custom alerts and snoozes. */
  entryId: string | null;
  name: string;
  category: AlertCategory;
  due_ms: number | null;
  state: 'scheduled' | 'open' | 'unknown';
  estimated: boolean;
  /** Built-in time on the fallback clock, before the server is known. */
  fallback: boolean;
  basis: string;
  zone: string;
  server: string | null;
  notify: NotifyState;
  /** Native has a matching reminder occurrence that the user can skip. */
  skippable: boolean;
}

/**
 * Next up: every timed catalogue countdown, whether or not it notifies, plus custom
 * alerts and snoozes. Entries without a known time are listed only when their
 * notification is on. Older engines without catalogue countdowns list reminders only.
 */
export function nextUp(dashboard: AlertDashboard, limit: number): NextRow[] {
  const config = dashboard.config;
  const clock = dashboard.effective_timezone;
  const presetIds = new Set(dashboard.catalogue.map((e) => e.id));
  const ruleOf = (id: string) => config.rules.find((r) => r.id === id);
  const rows: NextRow[] = [];
  const countdowns = dashboard.catalogue_upcoming;
  for (const c of countdowns) {
    const timed = c.state !== 'unknown' && c.due_ms !== null;
    if (!timed && c.notify === 'off') continue;
    const reminder = dashboard.upcoming.find((o) => o.rule_id === c.rule_id);
    rows.push({
      key: `entry-${c.entry_id}`,
      ruleId: c.rule_id,
      entryId: c.entry_id,
      name: c.name,
      category: c.category,
      due_ms: c.due_ms,
      state: timed ? c.state : 'unknown',
      estimated: c.estimated,
      fallback: c.clock === 'fallback',
      basis: c.basis,
      zone: c.timezone ?? clock,
      server: c.server,
      notify: c.notify,
      skippable:
        c.notify === 'on' &&
        reminder?.state === 'scheduled' &&
        reminder.due_ms !== null &&
        reminder.due_ms === c.due_ms,
    });
  }
  for (const o of dashboard.upcoming) {
    if (o.state === 'disabled') continue;
    const rule = ruleOf(o.rule_id);
    const preset = rule?.preset_id != null && presetIds.has(rule.preset_id);
    // With catalogue countdowns, built-in entries are already listed above.
    if (countdowns.length && (preset || countdowns.some((c) => c.rule_id === o.rule_id))) continue;
    const timed = o.state !== 'unknown' && o.due_ms !== null;
    rows.push({
      key: `rule-${o.rule_id}-${o.due_ms ?? 'unknown'}`,
      ruleId: o.rule_id,
      entryId: preset ? (rule?.preset_id ?? null) : null,
      name: o.name,
      category: o.category,
      due_ms: o.due_ms,
      state: timed ? o.state : 'unknown',
      estimated: o.estimated,
      fallback: false,
      basis: o.basis,
      zone: rule ? (rule.timezone ?? (preset ? clock : config.timezone)) : clock,
      server: o.server,
      notify: config.enabled ? 'on' : 'off',
      skippable: config.enabled && o.state === 'scheduled' && o.due_ms !== null && !!rule,
    });
  }
  const known = rows
    .filter((r) => r.state !== 'unknown')
    .sort((a, b) => (a.due_ms ?? 0) - (b.due_ms ?? 0));
  const unknown = rows.filter((r) => r.state === 'unknown');
  return [...known, ...unknown].slice(0, limit);
}

/** Template is listed for the chosen region (an empty list means everywhere). */
export const templateEligible = (t: AlertTemplate, region: string) =>
  t.regions.length === 0 || t.regions.includes(region);

/** Next upcoming reminders soon enough to show beside the DPS meter. */
export function soonest(dashboard: AlertDashboard | null, nowMs: number, horizonMs: number) {
  if (!dashboard?.config.enabled) return null;
  let best: { name: string; remainingMs: number; open: boolean } | null = null;
  for (const o of dashboard.upcoming) {
    if (o.state === 'disabled' || o.state === 'unknown') continue;
    const left = occurrenceRemaining(o, nowMs);
    if (left === null) continue;
    const open = o.state === 'open';
    if (!open && (left < 0 || left > horizonMs)) continue;
    if (!best || (open ? -1 : left) < (best.open ? -1 : best.remainingMs))
      best = { name: o.name, remainingMs: left, open };
  }
  return best;
}
