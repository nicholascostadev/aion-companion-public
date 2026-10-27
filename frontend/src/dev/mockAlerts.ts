import catalogueData from '../../../crates/companion-capture/data/alert-catalogue.json';
import serverData from '../../../crates/companion-capture/data/alert-servers.json';
import { delivery, rule } from '../features/alerts/fixtures';
import { FRESH, LONG, NOTICES } from './mockScenario';
import type {
  AlertCatalogueEntry,
  AlertConfig,
  AlertDelivery,
  AlertRule,
  CatalogueCountdown,
  ObservedTimer,
  ServerMaintenance,
  ServerStatusSnapshot,
} from '../types/alerts';

/*
 * DEV ONLY (`?mock`). The alerts engine in miniature: the bundled event calendar and boss
 * roster, a few enabled reminders, open popups and history, and observed boss timers.
 */

const MINUTE = 60_000;
const REGIONS = [
  { id: 'global', name: 'Custom server clock', timezone: 'UTC' },
  {
    id: 'na-west',
    name: 'North America West',
    timezone: 'America/Los_Angeles',
  },
  { id: 'na-east', name: 'North America East', timezone: 'America/New_York' },
  { id: 'eu', name: 'Europe', timezone: 'Europe/Berlin' },
  { id: 'latam', name: 'South America', timezone: 'America/Sao_Paulo' },
  { id: 'asia', name: 'Asia', timezone: 'Asia/Tokyo' },
  { id: 'kr', name: 'Korea', timezone: 'Asia/Seoul' },
  { id: 'tw', name: 'Taiwan', timezone: 'Asia/Taipei' },
];
const CALENDAR_NAMES: Record<string, [string, 'event' | 'world_boss']> = {
  festival: ['Shugo Festival', 'event'],
  invasion: ['Invasion', 'event'],
  rift: ['Spacetime Rift', 'event'],
  'watcher-kaira': ['Watcher Kaira', 'world_boss'],
  'siege-bosses': ['Siege Bosses', 'world_boss'],
  'guardian-nahma': ['Guardian Lord Nahma', 'world_boss'],
};

const hhmm = (minute: number) =>
  `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;

function catalogue(timezone: string): AlertCatalogueEntry[] {
  const out: AlertCatalogueEntry[] = [];
  for (const calendar of catalogueData.calendars.global) {
    const known = CALENDAR_NAMES[calendar.id];
    if (!known) continue;
    const [name, category] = known;
    out.push({
      id: calendar.id,
      name,
      category,
      map_id: null,
      map: null,
      faction: 'all',
      members: calendar.npc_ids.flatMap((id) => {
        const boss = catalogueData.bosses.find((b) => b.npc_id === id);
        return boss ? [{ id, name: boss.name }] : [];
      }),
      rule: rule({
        id: `preset-${calendar.id}`,
        name,
        category,
        enabled: false,
        preset_id: calendar.id,
        schedule: {
          type: 'calendar',
          times: calendar.minutes.map(hhmm),
          weekdays: calendar.weekdays.length === 7 ? [] : calendar.weekdays,
        },
        timezone,
        lead_seconds: [300],
        volume: 0.6,
        duration_seconds: calendar.duration_seconds,
        npc_ids: calendar.npc_ids,
        event_ids: calendar.event_ids,
      }),
      source: 'Bundled regional game calendar',
      note: 'Global calendar',
      recharge_minute: calendar.recharge_minute ?? null,
    });
  }
  for (const boss of catalogueData.bosses.filter((b) => !b.scheduled)) {
    const id = `field-${boss.npc_id}`;
    out.push({
      id,
      name: boss.name,
      category: 'field_boss',
      map_id: boss.map_id,
      map: boss.map,
      faction: boss.faction as AlertCatalogueEntry['faction'],
      members: [{ id: boss.npc_id, name: boss.name }],
      rule: rule({
        id: `preset-${id}`,
        name: boss.name,
        category: 'field_boss',
        enabled: false,
        preset_id: id,
        schedule: { type: 'observed' },
        lead_seconds: [300],
        volume: 0.6,
        duration_seconds: 0,
        npc_id: boss.npc_id,
        event_id: boss.event_id,
      }),
      source: 'Bundled game boss roster; local game observations',
      note: 'Spawn times update from your own game traffic. No local observation yet means the time is unknown.',
      recharge_minute: null,
    });
  }
  return out;
}

/** Wall-clock parts of `ms` in `timezone`. */
function wall(ms: number, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(ms)
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  return Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
}

/** Next calendar time after `now`; weekdays 0 = Monday. */
function nextCalendar(times: string[], weekdays: number[], timezone: string, now: number) {
  const offset = wall(now, timezone) - now;
  const today = new Date(wall(now, timezone));
  let best: number | null = null;
  for (let day = 0; day < 8; day++)
    for (const time of times) {
      const [h, m] = time.split(':').map(Number) as [number, number];
      const local = Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + day,
        h,
        m,
      );
      const weekday = (new Date(local).getUTCDay() + 6) % 7;
      if (weekdays.length && !weekdays.includes(weekday)) continue;
      const due = local - offset;
      if (due > now && (best === null || due < best)) best = due;
    }
  return best;
}

const servers = serverData.filter((s) => s.region === 'eu');
const detected = servers[0] ?? null;
const start = Date.now();

const config: AlertConfig = {
  version: 1,
  revision: 7,
  enabled: true,
  region: 'eu',
  server: '',
  timezone: 'Europe/Berlin',
  background_sound: true,
  muted_until_ms: null,
  quiet_hours: { start: '01:00', end: '07:30' },
  volume: 0.9,
  faction: 'auto',
  alert_when_game_closed: false,
  notify_server_back: NOTICES === 'maintenance' || NOTICES === 'maintenance-done',
  rules: [],
};
const entries = catalogue(config.timezone);
const enable = (id: string, patch: Partial<AlertRule> = {}) => {
  const base = entries.find((e) => e.id === id)?.rule;
  if (base) config.rules.push({ ...base, enabled: true, ...patch });
};
enable('festival', { lead_seconds: [120, 0] });
enable('rift', { favorite: true, lead_seconds: [600, 300, 0], sound: 'bell' });
enable('siege-bosses', { lead_seconds: [900, 300] });
enable('field-2100076', { favorite: true, respawn_seconds: 3600 });
enable('field-2101122', { respawn_seconds: 5400 });
config.rules.push(
  rule({
    id: 'custom-raid-night',
    name: 'Legion raid night',
    category: 'custom',
    schedule: { type: 'calendar', times: ['20:30'], weekdays: [1, 3, 5] },
    lead_seconds: [1800, 300],
    sound: 'alarm',
    volume: 1,
    duration_seconds: 7200,
    notes: 'Meet at the Sanctum gate.',
  }),
  rule({
    id: 'custom-dailies',
    name: 'Daily quests reset',
    category: 'custom',
    enabled: false,
    schedule: { type: 'calendar', times: ['06:00'], weekdays: [] },
    lead_seconds: [0],
    sound: 'ping',
  }),
);

const observed: ObservedTimer[] = [
  {
    id: 'obs-2100076',
    name: 'Kusan the Mad Gladiator',
    category: 'field_boss',
    npc_id: 2100076,
    event_id: null,
    due_ms: start + 34 * MINUTE,
    observed_ms: start - 26 * MINUTE,
    server: detected?.name ?? '',
    state: 'defeated',
    basis: 'Observed defeat + your 60 min respawn',
    estimated: true,
  },
  {
    id: 'obs-2101122',
    name: 'Soul Ruler Kashapa',
    category: 'field_boss',
    npc_id: 2101122,
    event_id: null,
    due_ms: start + 81 * MINUTE,
    observed_ms: start - 9 * MINUTE,
    server: detected?.name ?? '',
    state: 'defeated',
    basis: 'Observed defeat + your 90 min respawn',
    estimated: true,
  },
  {
    id: 'obs-2100077',
    name: 'Ritualist Garshim',
    category: 'field_boss',
    npc_id: 2100077,
    event_id: null,
    due_ms: null,
    observed_ms: start - 3 * MINUTE,
    server: detected?.name ?? '',
    state: 'spawned',
    basis: 'Seen alive in your game traffic',
    estimated: false,
  },
];

let active: AlertDelivery[] = [
  delivery({
    id: 'preset-rift:1',
    rule_id: 'preset-rift',
    name: 'Spacetime Rift',
    category: 'event',
    due_ms: start + 4 * MINUTE,
    fired_ms: start - MINUTE,
    lead_seconds: 300,
    phase: 'before',
    sound: 'bell',
  }),
  delivery({
    id: 'preset-festival:1',
    rule_id: 'preset-festival',
    name: 'Shugo Festival',
    category: 'event',
    due_ms: start - 20_000,
    fired_ms: start - 20_000,
    lead_seconds: 0,
    phase: 'start',
  }),
];
let history: AlertDelivery[] = [
  ['preset-festival', 'Shugo Festival', 62, 'start', 'dismissed'],
  ['preset-rift', 'Spacetime Rift', 175, 'before', 'delivered'],
  ['custom-raid-night', 'Legion raid night', 300, 'before', 'snoozed'],
  ['preset-field-2100076', 'Kusan the Mad Gladiator', 420, 'start', 'quiet'],
  ['preset-festival', 'Shugo Festival', 485, 'start', 'muted'],
].map(([rule_id, name, ago, phase, status], i) =>
  delivery({
    id: `${String(rule_id)}:h${i}`,
    rule_id: String(rule_id),
    name: String(name),
    category: String(rule_id).startsWith('custom') ? 'custom' : 'event',
    due_ms: start - Number(ago) * MINUTE,
    fired_ms: start - Number(ago) * MINUTE,
    lead_seconds: phase === 'before' ? 300 : 0,
    phase: phase as AlertDelivery['phase'],
    status: status as AlertDelivery['status'],
  }),
);

// Long strings (`?mock=long`): the longest boss names of the roster are up next, and the
// raid reminder has a long name of its own.
if (LONG) {
  const longest = catalogueData.bosses
    .filter((b) => !b.scheduled)
    .sort((a, b) => b.name.length - a.name.length)
    .slice(0, 3);
  longest.forEach((boss, i) => {
    enable(`field-${boss.npc_id}`, {
      favorite: i === 0,
      respawn_seconds: 3600,
    });
    observed.unshift({
      id: `obs-${boss.npc_id}`,
      name: boss.name,
      category: 'field_boss',
      npc_id: boss.npc_id,
      event_id: null,
      due_ms: start + (3 + i * 11) * MINUTE,
      observed_ms: start - (57 - i * 11) * MINUTE,
      server: detected?.name ?? '',
      state: 'defeated',
      basis: 'Observed defeat + your 60 min respawn',
      estimated: true,
    });
  });
  const raid = config.rules.find((r) => r.id === 'custom-raid-night');
  if (raid) raid.name = 'Legion raid night at the Sanctum gate with the whole alliance';
}

// A first run (`?mock=fresh`): no reminder turned on, nothing seen, ringing or delivered yet.
if (FRESH) {
  config.rules = [];
  observed.length = 0;
  active = [];
  history = [];
}

/*
 * Official maintenance notices. The busy evening has one announced for tomorrow morning on
 * the Global clock; the notice scenarios move it into the present or mark it complete.
 * Outside a window every server stays unknown: the notices never say a server is up.
 */
const HOUR = 60 * MINUTE;
const tomorrow = (() => {
  const day = new Date(start);
  day.setUTCHours(6, 30, 0, 0);
  return day.getTime() + 24 * HOUR;
})();
const notice: ServerMaintenance | null = FRESH
  ? null
  : NOTICES === 'maintenance' || NOTICES === 'maintenance-done'
    ? {
        title: 'Scheduled maintenance for all Global servers',
        url: 'https://example.invalid/aion2/notice/maintenance',
        starts_ms: start - 50 * MINUTE,
        ends_ms: start + 4 * HOUR + 40 * MINUTE,
        completed: NOTICES === 'maintenance-done',
      }
    : {
        title: 'Scheduled maintenance for all Global servers',
        url: 'https://example.invalid/aion2/notice/maintenance',
        starts_ms: tomorrow,
        ends_ms: tomorrow + 5.5 * HOUR,
        completed: false,
      };
const gameRunning = FRESH || NOTICES === 'game-closed' ? false : true;

if (NOTICES === 'maintenance-done') {
  const back = delivery({
    id: 'maintenance-complete:1',
    rule_id: 'maintenance-complete',
    name: 'Official maintenance complete',
    category: 'custom',
    due_ms: start - 10_000,
    fired_ms: start - 10_000,
    lead_seconds: 0,
    phase: 'recovery',
    sound: 'bell',
  });
  active = [back];
  history = [back, ...history];
}
if (NOTICES === 'maintenance' || NOTICES === 'maintenance-done' || NOTICES === 'game-closed') {
  const held = NOTICES === 'game-closed' ? 'game_closed' : 'server_down';
  active = NOTICES === 'maintenance-done' ? active : [];
  history = [
    delivery({
      id: `preset-festival:held`,
      rule_id: 'preset-festival',
      name: 'Shugo Festival',
      category: 'event',
      due_ms: start - 30 * MINUTE,
      fired_ms: start - 30 * MINUTE,
      lead_seconds: 0,
      phase: 'start',
      status: held,
    }),
    ...history,
  ];
}

function serverStatus(now: number): ServerStatusSnapshot {
  if (FRESH)
    return {
      checked_ms: null,
      last_attempt_ms: null,
      stale: true,
      error: null,
      source: '',
      maintenance: null,
      servers: [],
    };
  // Native reads the notices once a minute; the last read is that long ago at most.
  const checked = NOTICES === 'notices-down' ? start - 7 * MINUTE : now - ((now - start) % MINUTE);
  const during =
    notice !== null && !notice.completed && now >= notice.starts_ms && now < notice.ends_ms;
  return {
    checked_ms: checked,
    last_attempt_ms: NOTICES === 'notices-down' ? now - ((now - start) % MINUTE) : checked,
    stale: NOTICES === 'notices-down',
    error: NOTICES === 'notices-down' ? 'Request to the notice board timed out after 10 s' : null,
    source:
      'https://api-global-community.plaync.com/aion2_global/board/notice_en/article/search/moreArticle?isVote=true&moreSize=18&moreDirection=BEFORE&previousArticleId=0',
    maintenance: notice,
    servers: serverData.map((s) => ({
      ...s,
      status: during ? 'maintenance' : 'unknown',
      population: null,
      character_creation_open: null,
    })),
  };
}

/** Why reminders are held, as native decides it: an announced window first, then the game. */
function deliveryPaused(status: ServerStatusSnapshot, now: number) {
  const fresh =
    !status.stale && status.checked_ms !== null && now - status.checked_ms <= 3 * MINUTE;
  const mine = config.server || detected?.id || '';
  if (fresh && status.servers.some((s) => s.id === mine && s.status === 'maintenance'))
    return 'server_down' as const;
  if (!gameRunning && !config.alert_when_game_closed) return 'game_closed' as const;
  return null;
}

function countdown(entry: AlertCatalogueEntry, now: number): CatalogueCountdown {
  const saved = config.rules.find((r) => r.preset_id === entry.id);
  const schedule = (saved ?? entry.rule).schedule;
  const seen = observed.find((o) => o.npc_id !== null && entry.rule.npc_id === o.npc_id);
  let due: number | null = null;
  let state: CatalogueCountdown['state'] = 'unknown';
  let clock: CatalogueCountdown['clock'] = 'observed';
  let basis = 'No local sighting yet';
  if (schedule?.type === 'calendar') {
    due = nextCalendar(schedule.times, schedule.weekdays, config.timezone, now);
    clock = 'server';
    basis = `Calendar · ${config.timezone}`;
    state = due === null ? 'unknown' : 'scheduled';
  } else if (seen) {
    due = seen.due_ms;
    state = seen.state === 'spawned' ? 'open' : 'scheduled';
    basis = seen.basis;
  }
  return {
    entry_id: entry.id,
    rule_id: saved?.id ?? entry.rule.id,
    name: entry.name,
    category: entry.category,
    due_ms: due,
    remaining_ms: due === null ? null : due - now,
    state,
    clock,
    timezone: clock === 'server' ? config.timezone : null,
    basis,
    estimated: seen?.estimated ?? false,
    notify: saved?.enabled ? 'on' : 'off',
    server: detected?.name ?? null,
  };
}

export function dashboard() {
  const now = Date.now();
  const countdowns = entries.map((e) => countdown(e, now));
  const status = serverStatus(now);
  const upcoming = config.rules
    .filter((r) => r.enabled)
    .map((r) => {
      const fromCatalogue = countdowns.find((c) => c.entry_id === r.preset_id);
      const due =
        fromCatalogue?.due_ms ??
        (r.schedule?.type === 'calendar'
          ? nextCalendar(r.schedule.times, r.schedule.weekdays, r.timezone ?? config.timezone, now)
          : null);
      return {
        rule_id: r.id,
        name: r.name,
        category: r.category,
        due_ms: due,
        remaining_ms: due === null ? null : due - now,
        state: fromCatalogue?.state ?? (due === null ? 'unknown' : 'scheduled'),
        basis: fromCatalogue?.basis ?? `Calendar · ${config.timezone}`,
        estimated: fromCatalogue?.estimated ?? false,
        source: null,
        server: detected?.name ?? null,
      };
    })
    .sort((a, b) => (a.due_ms ?? Infinity) - (b.due_ms ?? Infinity));
  return {
    now_ms: now,
    config,
    upcoming,
    catalogue_upcoming: countdowns,
    active,
    history,
    observed,
    regions: REGIONS,
    servers: serverData,
    detected_server: detected,
    templates: entries
      .filter((e) => e.category !== 'field_boss')
      .map((e) => ({
        id: e.id,
        name: e.name,
        category: e.category,
        schedule: e.rule.schedule,
        duration_seconds: e.rule.duration_seconds,
        regions: [],
        source: e.source,
        notes: e.note,
        verified: false,
        npc_id: e.rule.npc_ids[0] ?? null,
      })),
    bosses: catalogueData.bosses.map((b) => ({ id: b.npc_id, name: b.name })),
    catalogue: entries,
    effective_region: config.region,
    effective_timezone: config.timezone,
    effective_faction: 'elyos',
    clock_ready: true,
    clock_estimated: false,
    clock_source: 'server',
    game_running: gameRunning,
    delivery_paused: deliveryPaused(status, now),
    server_status: status,
    error: null,
  };
}

export function configure(next: unknown) {
  const value = (next ?? {}) as Partial<AlertConfig>;
  if (value.revision !== undefined && value.revision !== config.revision)
    throw new Error('Alert settings changed in another window; reload and try again.');
  Object.assign(config, value, { revision: config.revision + 1 });
  return dashboard();
}

const retire = (ids: string[], status: AlertDelivery['status']) => {
  const gone = active.filter((d) => ids.includes(d.id));
  active = active.filter((d) => !ids.includes(d.id));
  history = [...gone.map((d) => ({ ...d, status })), ...history];
};

export function action(args: Record<string, unknown>) {
  const id = typeof args.id === 'string' ? args.id : null;
  const seconds = typeof args.seconds === 'number' ? args.seconds : 300;
  switch (args.action) {
    case 'dismiss':
      if (id) retire([id], 'dismissed');
      break;
    case 'dismiss_all':
      retire(
        active.map((d) => d.id),
        'dismissed',
      );
      break;
    case 'snooze':
      if (id) retire([id], 'snoozed');
      break;
    case 'clear_history':
      history = [];
      break;
    case 'mute':
      config.muted_until_ms = Date.now() + seconds * 1000;
      break;
    case 'unmute':
      config.muted_until_ms = null;
      break;
  }
  return dashboard();
}

/** Deliveries the popup window shows. */
/**
 * Deliveries the popup window shows, re-fired just now: popup cards expire after a few
 * seconds, so the harness keeps pushing fresh copies while any delivery is open.
 */
export function popupDeliveries() {
  const now = Date.now();
  return active
    .filter((d) => d.popup)
    .map((d, i) => {
      const fired = now - 1_000 - i * 2_500;
      return { ...d, fired_ms: fired, due_ms: fired + d.lead_seconds * 1000 };
    });
}
