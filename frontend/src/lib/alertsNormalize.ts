import type {
  AlertBoss,
  AlertCatalogueEntry,
  AlertCategory,
  AlertConfig,
  AlertDashboard,
  AlertDelivery,
  AlertOccurrence,
  AlertRegion,
  AlertRule,
  AlertSchedule,
  AlertServer,
  AlertSound,
  AlertTemplate,
  CatalogueCountdown,
  ObservedTimer,
  ServerMaintenance,
  ServerStatusRow,
  ServerStatusSnapshot,
} from '../types/alerts';

/*
 * Native alert payloads are untrusted shapes. Unknown times stay null; nothing is
 * guessed. Config and rules keep any extra native fields so a save never drops them.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const str = (value: unknown): string | null => (typeof value === 'string' ? value : null);
const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

export const DELIVERY_STATUSES = [
  'delivered',
  'quiet',
  'muted',
  'dismissed',
  'snoozed',
  'server_down',
  'game_closed',
] as const;
export const SERVER_STATES = ['online', 'maintenance', 'offline', 'unknown'] as const;

export const CATEGORIES = ['event', 'world_boss', 'field_boss', 'custom'] as const;
export const ALERT_SOUNDS = ['none', 'chime', 'bell', 'ping', 'beep', 'pulse', 'alarm'] as const;

const ids = (value: unknown) =>
  list(value).flatMap((n) => (typeof n === 'number' && Number.isInteger(n) ? [n] : []));
const category = (value: unknown): AlertCategory => oneOf(value, CATEGORIES, 'custom');
const sound = (value: unknown): AlertSound => oneOf(value, ALERT_SOUNDS, 'chime');

export function normalizeSchedule(value: unknown): AlertSchedule | null {
  const v = bag(value);
  switch (v.type) {
    case 'once': {
      const at = num(v.at_ms);
      return at === null ? null : { type: 'once', at_ms: at };
    }
    case 'interval': {
      const anchor = num(v.anchor_ms);
      const every = num(v.every_seconds);
      return anchor === null || every === null
        ? null
        : { type: 'interval', anchor_ms: anchor, every_seconds: every };
    }
    case 'calendar':
      return {
        type: 'calendar',
        times: list(v.times).flatMap((t) => (typeof t === 'string' ? [t] : [])),
        weekdays: list(v.weekdays).flatMap((d) =>
          typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6 ? [d] : [],
        ),
      };
    case 'observed':
      return { type: 'observed' };
    default:
      return null;
  }
}

function rule(value: unknown, index: number): AlertRule {
  const v = bag(value);
  return {
    ...v,
    id: str(v.id) || `rule-${index + 1}`,
    name: str(v.name) ?? '',
    category: category(v.category),
    enabled: bool(v.enabled, false),
    favorite: bool(v.favorite, false),
    schedule: normalizeSchedule(v.schedule),
    timezone: str(v.timezone) || null,
    lead_seconds: list(v.lead_seconds).flatMap((s) => (num(s) === null ? [] : [s as number])),
    sound: sound(v.sound),
    volume: num(v.volume) ?? 0.8,
    popup: bool(v.popup, true),
    duration_seconds: num(v.duration_seconds) ?? 0,
    npc_id: num(v.npc_id),
    event_id: num(v.event_id),
    respawn_seconds: num(v.respawn_seconds),
    notes: str(v.notes) ?? '',
    preset_id: str(v.preset_id) || null,
    npc_ids: ids(v.npc_ids),
    event_ids: ids(v.event_ids),
    schedule_override: bool(v.schedule_override, false),
  };
}

export function normalizeConfig(value: unknown): AlertConfig | null {
  const v = bag(value);
  const revision = num(v.revision);
  if (revision === null) return null;
  const quiet = bag(v.quiet_hours);
  return {
    ...v,
    version: 1,
    revision,
    enabled: bool(v.enabled, false),
    region: str(v.region) ?? 'global',
    server: str(v.server) ?? '',
    timezone: str(v.timezone) || 'UTC',
    background_sound: bool(v.background_sound, true),
    muted_until_ms: num(v.muted_until_ms),
    quiet_hours:
      typeof quiet.start === 'string' && typeof quiet.end === 'string'
        ? { start: quiet.start, end: quiet.end }
        : null,
    volume: Math.min(1, Math.max(0, num(v.volume) ?? 1)),
    faction: oneOf(v.faction, ['auto', 'all', 'elyos', 'asmodian'] as const, 'auto'),
    // Older engines never alerted while the game was closed was a choice; off is the default.
    alert_when_game_closed: bool(v.alert_when_game_closed, false),
    notify_server_back: bool(v.notify_server_back, false),
    rules: list(v.rules).map(rule),
  };
}

function occurrence(value: unknown): AlertOccurrence | null {
  const v = bag(value);
  const id = str(v.rule_id);
  if (!id) return null;
  return {
    rule_id: id,
    name: str(v.name) ?? '',
    category: category(v.category),
    due_ms: num(v.due_ms),
    remaining_ms: num(v.remaining_ms),
    state: oneOf(v.state, ['scheduled', 'open', 'unknown', 'disabled'] as const, 'unknown'),
    basis: str(v.basis) ?? '',
    estimated: bool(v.estimated, false),
    source: str(v.source) || null,
    server: str(v.server) || null,
  };
}

function countdown(value: unknown): CatalogueCountdown | null {
  const v = bag(value);
  const entry = str(v.entry_id);
  if (!entry) return null;
  return {
    entry_id: entry,
    rule_id: str(v.rule_id) || `preset-${entry}`,
    name: str(v.name) ?? '',
    category: oneOf(v.category, ['event', 'world_boss', 'field_boss'] as const, 'event'),
    due_ms: num(v.due_ms),
    remaining_ms: num(v.remaining_ms),
    state: oneOf(v.state, ['scheduled', 'open', 'unknown'] as const, 'unknown'),
    clock: oneOf(v.clock, ['server', 'fallback', 'own', 'observed', 'none'] as const, 'none'),
    timezone: str(v.timezone) || null,
    basis: str(v.basis) ?? '',
    estimated: bool(v.estimated, false),
    notify: oneOf(v.notify, ['on', 'off', 'waiting_for_clock'] as const, 'off'),
    server: str(v.server) || null,
  };
}

export function normalizeDelivery(value: unknown): AlertDelivery | null {
  const v = bag(value);
  const id = str(v.id);
  const due = num(v.due_ms);
  const fired = num(v.fired_ms);
  if (!id || due === null || fired === null) return null;
  return {
    id,
    rule_id: str(v.rule_id) ?? '',
    name: str(v.name) ?? '',
    category: category(v.category),
    due_ms: due,
    fired_ms: fired,
    lead_seconds: num(v.lead_seconds) ?? 0,
    phase: oneOf(v.phase, ['before', 'start', 'snooze', 'test', 'recovery'] as const, 'start'),
    sound: sound(v.sound),
    volume: num(v.volume) ?? 0.8,
    popup: bool(v.popup, true),
    status: oneOf(v.status, DELIVERY_STATUSES, 'delivered'),
  };
}

function observed(value: unknown): ObservedTimer | null {
  const v = bag(value);
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    name: str(v.name) ?? '',
    category: oneOf(v.category, ['event', 'field_boss', 'world_boss'] as const, 'field_boss'),
    npc_id: num(v.npc_id),
    event_id: num(v.event_id),
    due_ms: num(v.due_ms),
    observed_ms: num(v.observed_ms) ?? 0,
    server: str(v.server) ?? '',
    state: str(v.state) ?? '',
    basis: str(v.basis) ?? '',
    estimated: bool(v.estimated, false),
  };
}

function template(value: unknown): AlertTemplate | null {
  const v = bag(value);
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    name: str(v.name) ?? id,
    category: category(v.category),
    schedule: normalizeSchedule(v.schedule),
    duration_seconds: num(v.duration_seconds) ?? 0,
    regions: list(v.regions).flatMap((r) => (typeof r === 'string' ? [r] : [])),
    source: str(v.source) || null,
    notes: str(v.notes) ?? '',
    verified: bool(v.verified, false),
    npc_id: num(v.npc_id),
  };
}

function region(value: unknown): AlertRegion | null {
  const v = bag(value);
  const id = str(v.id);
  return id ? { id, name: str(v.name) || id, timezone: str(v.timezone) || 'UTC' } : null;
}

function server(value: unknown): AlertServer | null {
  const v = bag(value);
  const id = str(v.id);
  return id ? { id, name: str(v.name) || id, region: str(v.region) ?? '' } : null;
}

function boss(value: unknown): AlertBoss | null {
  const v = bag(value);
  const id = num(v.id);
  return id === null ? null : { id, name: str(v.name) || `NPC #${id}` };
}

function catalogueEntry(value: unknown, index: number): AlertCatalogueEntry | null {
  const v = bag(value);
  const id = str(v.id);
  if (!id) return null;
  const kind = oneOf(v.category, ['event', 'world_boss', 'field_boss'] as const, 'event');
  const base = rule(v.rule, index);
  return {
    id,
    name: str(v.name) || base.name || id,
    category: kind,
    map_id: num(v.map_id),
    map: str(v.map) || null,
    faction: oneOf(v.faction, ['elyos', 'asmodian', 'all'] as const, 'all'),
    members: present(list(v.members).map(boss)),
    // The default rule always belongs to its entry, whatever native omitted.
    rule: {
      ...base,
      id: str(bag(v.rule).id) || `preset-${id}`,
      name: base.name || str(v.name) || id,
      category: kind,
      enabled: false,
      preset_id: id,
    },
    source: str(v.source) ?? '',
    note: str(v.note) ?? '',
    recharge_minute: num(v.recharge_minute),
  };
}

function serverRow(value: unknown): ServerStatusRow | null {
  const v = bag(value);
  const id = str(v.id);
  if (!id) return null;
  const population = num(v.population);
  return {
    id,
    name: str(v.name) || id,
    region: str(v.region) ?? '',
    // Anything this app does not recognise is unknown, never read as up or down.
    status: oneOf(v.status, SERVER_STATES, 'unknown'),
    population: population !== null && population >= 0 ? population : null,
    character_creation_open:
      typeof v.character_creation_open === 'boolean' ? v.character_creation_open : null,
  };
}

/** Only a complete window with an https notice link; anything else is no known window. */
function maintenance(value: unknown): ServerMaintenance | null {
  const v = bag(value);
  const url = str(v.url);
  const starts = num(v.starts_ms);
  const ends = num(v.ends_ms);
  if (
    !url ||
    !url.toLowerCase().startsWith('https://') ||
    starts === null ||
    ends === null ||
    ends <= starts
  )
    return null;
  return {
    title: str(v.title) ?? '',
    url,
    starts_ms: starts,
    ends_ms: ends,
    // Only an explicit official completion counts; an elapsed end does not.
    completed: v.completed === true,
  };
}

/** A missing or malformed snapshot is "never checked": stale, with nothing listed. */
export function normalizeServerStatus(value: unknown): ServerStatusSnapshot {
  const v = bag(value);
  const checked = num(v.checked_ms);
  return {
    checked_ms: checked,
    last_attempt_ms: num(v.last_attempt_ms),
    stale: checked === null || bool(v.stale, true),
    error: str(v.error) || null,
    source: str(v.source) ?? '',
    maintenance: maintenance(v.maintenance),
    servers: present(list(v.servers).map(serverRow)),
  };
}

const present = <T>(items: (T | null)[]) => items.filter((item): item is T => item !== null);

export function normalizeDashboard(value: unknown): AlertDashboard {
  const v = bag(value);
  const config = normalizeConfig(v.config);
  if (!config) throw new Error('Native returned no alert settings');
  const clockReady = bool(v.clock_ready, config.region !== 'global');
  return {
    now_ms: num(v.now_ms) ?? Date.now(),
    config,
    upcoming: present(list(v.upcoming).map(occurrence)),
    catalogue_upcoming: present(list(v.catalogue_upcoming).map(countdown)),
    active: present(list(v.active).map(normalizeDelivery)),
    history: present(list(v.history).map(normalizeDelivery)),
    observed: present(list(v.observed).map(observed)),
    regions: present(list(v.regions).map(region)),
    servers: present(list(v.servers).map(server)),
    detected_server: server(v.detected_server),
    templates: present(list(v.templates).map(template)),
    bosses: present(list(v.bosses).map(boss)),
    catalogue: present(list(v.catalogue).map(catalogueEntry)),
    effective_region:
      str(v.effective_region) || (config.region === 'global' ? null : config.region),
    effective_timezone: str(v.effective_timezone) || config.timezone,
    effective_faction:
      v.effective_faction === 'elyos' || v.effective_faction === 'asmodian'
        ? v.effective_faction
        : null,
    clock_ready: clockReady,
    clock_estimated: bool(v.clock_estimated, !clockReady),
    clock_source: oneOf(
      v.clock_source,
      ['region', 'server', 'detected', 'fallback'] as const,
      !clockReady ? 'fallback' : config.region !== 'global' ? 'region' : 'detected',
    ),
    // Older engines do not say whether capture is observing; absent stays unknown.
    ...(typeof v.live_observations === 'boolean' ? { live_observations: v.live_observations } : {}),
    game_running: typeof v.game_running === 'boolean' ? v.game_running : null,
    delivery_paused:
      v.delivery_paused === 'game_closed' || v.delivery_paused === 'server_down'
        ? v.delivery_paused
        : null,
    server_status: normalizeServerStatus(v.server_status),
    error: str(v.error) || null,
  };
}
