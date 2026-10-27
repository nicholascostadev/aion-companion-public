import type {
  AlertSchedule,
  AlertStatus,
  BuffSpan,
  CatalogueSummary,
  CombatReport,
  EntityId,
  Highlight,
  HpSample,
  Locale,
  LogMeta,
  OfflineHotkeys,
  OfflineLiveStatus,
  OfflineSettings,
  OfflineStatus,
  OfflineStatusOf,
  ReportEvent,
  ReportPlayer,
  ReportPlayerTarget,
  ReportSkill,
  ReportSummary,
  ReportTarget,
  ReportTotals,
  SkillCharge,
  SkillSpecialty,
  TrackerBar,
  TrackerPreset,
  TrackerStatus,
} from '../types/offline';

/*
 * Native payloads are untrusted shapes: absent, null or malformed values become
 * `null` ("not observed"), never a guessed number. Collections default to empty.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

export const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const amount = (value: unknown) => num(value) ?? 0;
const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;
const bool = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
export const entity = (value: unknown): EntityId | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value !== ''
      ? value
      : null;
const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = num(value);
  return n === null ? fallback : Math.min(max, Math.max(min, n));
};

/** Native reports activity as 0..100; the UI works in 0..1. */
export function percentFraction(value: unknown): number | null {
  const n = num(value);
  return n === null || n < 0 ? null : Math.min(1, n / 100);
}

/** Native wire ids are u32 where 0 means "not observed". */
const wireId = (value: unknown): EntityId | null => {
  const id = entity(value);
  return id === 0 || id === '0' ? null : id;
};
const text = (value: unknown): string | null =>
  str(value) ?? (num(value) === null ? null : String(value));

/* ---------- Settings ---------- */

/** Native hotkeys today; also the fallback for hints when settings are unavailable. */
export const DEFAULT_HOTKEYS: OfflineHotkeys = {
  toggle_overlay: 'Ctrl+Shift+F9',
  toggle_lock: 'Ctrl+Shift+F8',
  reset: 'Ctrl+Shift+F6',
  copy_summary: 'Ctrl+Shift+F5',
  compact_strip: 'Ctrl+Shift+F4',
};

export const LOCALES: readonly Locale[] = [
  'en',
  'pt-BR',
  'pt',
  'de',
  'es',
  'fr',
  'ja',
  'ko',
  'zh',
  'ru',
];

/** Native defaults; only used to fill fields a partial settings object omits. */
export const SETTINGS_FALLBACK: OfflineSettings = {
  dps_mode: 'encounter',
  target_mode: 'all',
  party_only: false,
  idle_timeout_seconds: 10,
  dummy_length_seconds: 0,
  dummy_cooldown_seconds: 5,
  auto_save: true,
  refresh_ms: 250,
  opacity: 1,
  scale: 1,
  fade_after_seconds: 30,
  fade_opacity: 0.25,
  hide_names: false,
  compact_strip: false,
  region: 'global',
  locale: 'en',
  hotkeys: DEFAULT_HOTKEYS,
  presets: [],
  active_preset: null,
  alerts: [],
  boss_alerts: false,
  event_alerts: false,
};

function trackerBar(value: unknown, index: number): TrackerBar {
  const v = bag(value);
  return {
    id: str(v.id) ?? `bar-${index + 1}`,
    name: typeof v.name === 'string' ? v.name : '',
    mode: oneOf(v.mode, ['cooldowns', 'buffs', 'both'] as const, 'cooldowns'),
    skills: list(v.skills).flatMap((s) => {
      const n = num(s);
      return n === null ? [] : [n];
    }),
    x: amount(v.x),
    y: amount(v.y),
    icon_size: clamp(v.icon_size, 16, 128, 36),
    appearance: oneOf(v.appearance, ['icons', 'bars'] as const, 'icons'),
    hidden: v.hidden === true,
  };
}

function trackerPreset(value: unknown, index: number): TrackerPreset {
  const v = bag(value);
  return {
    id: str(v.id) ?? `preset-${index + 1}`,
    name: typeof v.name === 'string' ? v.name : '',
    class: str(v.class),
    keybind: str(v.keybind),
    bars: list(v.bars).map(trackerBar),
  };
}

function alertSchedule(value: unknown, index: number): AlertSchedule {
  const v = bag(value);
  return {
    id: str(v.id) ?? `alert-${index + 1}`,
    name: typeof v.name === 'string' ? v.name : '',
    enabled: v.enabled !== false,
    at_ms: num(v.at_ms),
    repeat_seconds: num(v.repeat_seconds),
    lead_seconds: clamp(v.lead_seconds, 0, 3600, 0),
    volume: clamp(v.volume, 0, 1, 0.8),
    sound: str(v.sound) ?? 'chime',
  };
}

export function normalizeSettings(value: unknown): OfflineSettings | null {
  if (!value || typeof value !== 'object') return null;
  const v = bag(value);
  const f = SETTINGS_FALLBACK;
  const keys = bag(v.hotkeys);
  const hotkeys = Object.fromEntries(
    (Object.keys(DEFAULT_HOTKEYS) as (keyof OfflineHotkeys)[]).map((key) => [
      key,
      typeof keys[key] === 'string' ? keys[key] : DEFAULT_HOTKEYS[key],
    ]),
  ) as unknown as OfflineHotkeys;
  return {
    dps_mode: oneOf(v.dps_mode, ['encounter', 'active'] as const, f.dps_mode),
    target_mode: oneOf(v.target_mode, ['all', 'boss'] as const, f.target_mode),
    party_only: bool(v.party_only) ?? f.party_only,
    idle_timeout_seconds: clamp(v.idle_timeout_seconds, 1, 600, f.idle_timeout_seconds),
    dummy_length_seconds: clamp(v.dummy_length_seconds, 0, 300, f.dummy_length_seconds),
    dummy_cooldown_seconds: clamp(v.dummy_cooldown_seconds, 0, 300, f.dummy_cooldown_seconds),
    auto_save: bool(v.auto_save) ?? f.auto_save,
    refresh_ms: clamp(v.refresh_ms, 50, 1000, f.refresh_ms),
    opacity: clamp(v.opacity, 0.15, 1, f.opacity),
    scale: clamp(v.scale, 0.75, 2, f.scale),
    fade_after_seconds: clamp(v.fade_after_seconds, 0, 600, f.fade_after_seconds),
    fade_opacity: clamp(v.fade_opacity, 0.05, 1, f.fade_opacity),
    hide_names: bool(v.hide_names) ?? f.hide_names,
    compact_strip: bool(v.compact_strip) ?? f.compact_strip,
    region: oneOf(v.region, ['global', 'twkr'] as const, f.region),
    locale: oneOf(v.locale, LOCALES, f.locale),
    hotkeys,
    presets: list(v.presets).map(trackerPreset),
    active_preset: str(v.active_preset),
    alerts: list(v.alerts).map(alertSchedule),
    boss_alerts: bool(v.boss_alerts) ?? f.boss_alerts,
    event_alerts: bool(v.event_alerts) ?? f.event_alerts,
  };
}

/* ---------- Report ---------- */

function specialties(value: unknown): SkillSpecialty[] {
  return list(value).flatMap((item): SkillSpecialty[] => {
    // A bare number is a decoded variant choice id; never guess a specialty name for it.
    const n = num(item);
    if (n !== null)
      return [{ slot: null, name: `Variant choice ${n}`, description: null, count: null }];
    if (typeof item === 'string' && item.trim())
      return [{ slot: null, name: item, description: null, count: null }];
    if (!item || typeof item !== 'object') return [];
    const v = bag(item);
    const choice = num(v.choice) ?? num(v.variant) ?? num(v.id);
    return [
      {
        slot: num(v.slot),
        name: str(v.name) ?? (choice === null ? null : `Variant choice ${choice}`),
        description: str(v.description),
        count: num(v.count) ?? num(v.uses),
      },
    ];
  });
}

function charge(value: unknown): SkillCharge | null {
  const n = num(value);
  if (n !== null) return n;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value as Bag).flatMap(([key, count]) => {
    const c = num(count);
    return c === null ? [] : [[key, c] as const];
  });
  return entries.length ? Object.fromEntries(entries) : null;
}

/** Shared hit-quality counters for players and skills. */
function counters(v: Bag) {
  return {
    casts: num(v.casts),
    hits: num(v.hits),
    crits: num(v.crits),
    back: num(v.back),
    front: num(v.front),
    perfect: num(v.perfect),
    double: num(v.double),
    parry: num(v.parry),
    multi: num(v.multi),
    direct_hits: num(v.direct_hits),
    critical_hits_observed: num(v.critical_hits_observed),
    flags_observed: num(v.flags_observed),
    inferred_casts: num(v.inferred_casts),
    damage_hits: num(v.damage_hits),
    damage_crits: num(v.damage_crits),
    damage_critical_hits_observed: num(v.damage_critical_hits_observed),
  };
}

function skill(value: unknown, index: number): ReportSkill {
  const v = bag(value);
  return {
    id: entity(v.id) ?? `skill-${index}`,
    name: str(v.name),
    damage: amount(v.damage),
    healing: amount(v.healing),
    received: amount(v.received),
    ...counters(v),
    min: num(v.min),
    max: num(v.max),
    avg: num(v.avg),
    cast_gap_ms: num(v.cast_gap_ms),
    charge: charge(v.charge),
    specialties: specialties(v.specialties),
  };
}

function playerTarget(value: unknown, index: number): ReportPlayerTarget {
  const v = bag(value);
  return {
    id: entity(v.id) ?? `target-${index}`,
    name: str(v.name),
    damage: amount(v.damage),
    healing: amount(v.healing),
    received: amount(v.received),
  };
}

function player(value: unknown, index: number): ReportPlayer {
  const v = bag(value);
  return {
    id: entity(v.id) ?? `player-${index}`,
    name: str(v.name),
    class: str(v.class),
    local: bool(v.local),
    party: bool(v.party),
    server_id: num(v.server_id),
    level: num(v.level),
    gear_score: num(v.gear_score),
    combat_power: num(v.combat_power),
    damage: amount(v.damage),
    healing: amount(v.healing),
    received: amount(v.received),
    healing_received: num(v.healing_received),
    deaths: num(v.deaths),
    ...counters(v),
    edps: num(v.edps),
    adps: num(v.adps),
    current_dps: num(v.current_dps),
    active_pct: percentFraction(v.active_pct),
    activity_method: str(v.activity_method),
    skills: list(v.skills).map(skill),
    targets: list(v.targets).map(playerTarget),
  };
}

function target(value: unknown, index: number): ReportTarget {
  const v = bag(value);
  return {
    id: entity(v.id) ?? `npc-${index}`,
    npc_id: num(v.npc_id),
    name: str(v.name),
    boss: bool(v.boss),
    dummy: bool(v.dummy),
    current_hp: num(v.current_hp),
    max_hp: num(v.max_hp),
    dead: bool(v.dead),
    damage: amount(v.damage),
    berserk_seconds: num(v.berserk_seconds),
  };
}

const EVENT_NUMBERS = [
  'amount',
  'hit_count',
  'duration_ms',
  'current_hp',
  'max_hp',
  'zone_id',
  'charge',
  'x',
  'y',
] as const;
const EVENT_FLAGS = ['critical', 'back', 'front', 'perfect', 'double', 'parry', 'tick'] as const;
const EVENT_IDS = ['source', 'target', 'skill', 'instance'] as const;

function event(value: unknown): ReportEvent | null {
  const v = bag(value);
  const at = num(v.at_ms);
  const kind = str(v.kind);
  if (at === null || kind === null) return null;
  const out: ReportEvent = { at_ms: at, kind };
  for (const key of EVENT_IDS) if (key in v) out[key] = wireId(v[key]);
  for (const key of EVENT_NUMBERS) if (key in v) out[key] = num(v[key]);
  for (const key of EVENT_FLAGS) if (key in v) out[key] = bool(v[key]);
  return out;
}

function buff(value: unknown): BuffSpan | null {
  const v = bag(value);
  const start = num(v.start_ms);
  const skillId = entity(v.skill);
  if (start === null || skillId === null) return null;
  return {
    source: wireId(v.source),
    target: wireId(v.target),
    skill: skillId,
    instance: wireId(v.instance),
    start_ms: start,
    end_ms: num(v.end_ms),
  };
}

const present = <T>(items: (T | null)[]): T[] => items.filter((item): item is T => item !== null);

interface HpUpdate {
  entity: EntityId;
  at_ms: number;
  current: number | null;
  max: number | null;
}

function hpUpdate(value: unknown): HpUpdate | null {
  const v = bag(value);
  const id = wireId(v.entity);
  const at = num(v.at_ms);
  const current = num(v.current);
  const max = num(v.max);
  if (id === null || at === null) return null;
  return {
    entity: id,
    at_ms: at,
    current: current !== null && current >= 0 ? current : null,
    max: max !== null && max > 0 ? max : null,
  };
}

/**
 * HP samples from native updates, which often carry only the new current HP (or only a
 * new max). A current-only update uses the latest max observed for that entity, else the
 * target's reported max (e.g. when a live tail starts after the spawn sample); a max-only
 * update changes the known max without adding a sample. Without any known max a current
 * value has no fraction and is left out. HP is never derived from damage.
 */
function hpSamples(raw: unknown[], targets: ReportTarget[]): HpSample[] {
  const targetMax = new Map(
    targets.flatMap((t) => (t.max_hp !== null && t.max_hp > 0 ? [[String(t.id), t.max_hp]] : [])),
  );
  const knownMax = new Map<string, number>();
  const samples: HpSample[] = [];
  const updates = present(raw.map(hpUpdate)).sort((a, b) => a.at_ms - b.at_ms);
  for (const update of updates) {
    const id = String(update.entity);
    if (update.max !== null) knownMax.set(id, update.max);
    if (update.current === null) continue;
    const max = knownMax.get(id) ?? targetMax.get(id);
    if (max !== undefined)
      samples.push({ entity: update.entity, at_ms: update.at_ms, current: update.current, max });
  }
  return samples;
}

function highlight(input: unknown): Highlight | null {
  const v = bag(input);
  const kind = str(v.kind);
  if (!kind) return null;
  // first_hit carries value 0 meaning "no amount", not a zero-damage hit.
  const value = kind === 'first_hit' ? null : num(v.value);
  return { kind, player: wireId(v.player), value, at_ms: num(v.at_ms) };
}

/** Aggregates shared by full and summary reports. */
function reportTotals(v: Record<string, unknown>, targets: ReportTarget[]) {
  const coverage = Object.fromEntries(
    Object.entries(bag(v.coverage)).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
  const count = num(v.event_count);
  return {
    id: text(v.id),
    label: str(v.label),
    // Native writes 0 before the first hit.
    started_ms: num(v.started_ms) || null,
    duration_ms: Math.max(0, amount(v.duration_ms)),
    end_reason: str(v.end_reason),
    zone_id: num(v.zone_id),
    run_id: str(v.run_id),
    party_id: entity(v.party_id),
    players: list(v.players).map(player),
    targets,
    highlights: present(list(v.highlights).map(highlight)),
    warnings: list(v.warnings).flatMap((w) => (typeof w === 'string' && w ? [w] : [])),
    coverage,
    event_count: count === null ? null : Math.max(0, Math.trunc(count)),
  } satisfies Omit<ReportTotals, 'detail_level'>;
}

/**
 * A report with its details (`offline_status`, `offline_log`, `offline_inspect`). A
 * summary is never taken for one: its empty events would read as a fight with none.
 */
export function normalizeReport(value: unknown): CombatReport | null {
  if (!value || typeof value !== 'object') return null;
  const v = bag(value);
  if (v.detail_level === 'summary') return null;
  const targets = list(v.targets).map(target);
  return {
    detail_level: 'full',
    ...reportTotals(v, targets),
    events: present(list(v.events).map(event)).sort((a, b) => a.at_ms - b.at_ms),
    buffs: present(list(v.buffs).map(buff)),
    hp: hpSamples(list(v.hp), targets),
    events_truncated: v.events_truncated === true,
    event_window_start_ms: num(v.event_window_start_ms),
  };
}

/**
 * The compact live report (`offline_live_status`). Whatever native sends, events and buffs
 * are dropped, so the result is a summary even if a reply carried details.
 */
export function normalizeReportSummary(value: unknown): ReportSummary | null {
  if (!value || typeof value !== 'object') return null;
  const v = bag(value);
  const targets = list(v.targets).map(target);
  return {
    detail_level: 'summary',
    ...reportTotals(v, targets),
    hp: hpSamples(list(v.hp), targets),
  };
}

/* ---------- Status ---------- */

function trackerStatus(value: unknown): TrackerStatus | null {
  const v = bag(value);
  const barId = str(v.bar_id);
  const skillId = num(v.skill);
  const remaining = num(v.remaining_ms);
  if (barId === null || skillId === null) return null;
  return {
    bar_id: barId,
    skill: skillId,
    name: str(v.name),
    remaining_ms: remaining === null ? null : Math.max(0, remaining),
    kind: oneOf(v.kind, ['cooldown', 'buff'] as const, 'cooldown'),
    source: wireId(v.source),
    target: wireId(v.target),
    estimated: v.estimated === true,
    basis: str(v.basis),
  };
}

function alertStatus(value: unknown): AlertStatus | null {
  const v = bag(value);
  const id = str(v.id);
  const due = num(v.due_ms);
  const remaining = num(v.remaining_ms);
  if (id === null || due === null || remaining === null) return null;
  return {
    id,
    name: typeof v.name === 'string' ? v.name : '',
    due_ms: due,
    remaining_ms: remaining,
    sound: str(v.sound) ?? 'chime',
    volume: clamp(v.volume, 0, 1, 0.8),
    lead_seconds: clamp(v.lead_seconds, 0, 3600, 0),
  };
}

export function normalizeCatalogue(value: unknown): CatalogueSummary | null {
  if (!value || typeof value !== 'object') return null;
  const v = bag(value);
  const skills = num(v.skills);
  const npcs = num(v.npcs);
  return skills === null && npcs === null ? null : { skills: skills ?? 0, npcs: npcs ?? 0 };
}

function statusWith<Report>(
  value: unknown,
  report: (value: unknown) => Report | null,
): OfflineStatusOf<Report> {
  const v = bag(value);
  return {
    settings: normalizeSettings(v.settings),
    report: report(v.report),
    library_count: num(v.library_count),
    trackers: present(list(v.trackers).map(trackerStatus)),
    alerts: present(list(v.alerts).map(alertStatus)),
    catalogue: normalizeCatalogue(v.catalogue),
    capabilities: Object.fromEntries(
      Object.entries(bag(v.capabilities)).filter(
        (entry): entry is [string, boolean | string] =>
          typeof entry[1] === 'boolean' || typeof entry[1] === 'string',
      ),
    ),
    error: str(v.error),
  };
}

/** `offline_status`: the live report with its details. */
export const normalizeStatus = (value: unknown): OfflineStatus =>
  statusWith(value, normalizeReport);

/** `offline_live_status` and summary action replies: the live report as a summary. */
export const normalizeLiveStatus = (value: unknown): OfflineLiveStatus =>
  statusWith(value, normalizeReportSummary);

/* ---------- Library ---------- */

export function normalizeLogMeta(value: unknown): LogMeta | null {
  const v = bag(value);
  const id = text(v.id);
  if (id === null) return null;
  const names = list(v.players).flatMap((p) =>
    typeof p === 'string' ? [p] : str(bag(p).name) ? [String(bag(p).name)] : [],
  );
  return {
    id,
    label: str(v.label),
    started_ms: num(v.started_ms),
    duration_ms: Math.max(0, amount(v.duration_ms)),
    damage: num(v.damage),
    dps: num(v.dps),
    players: num(v.players) ?? (Array.isArray(v.players) ? v.players.length : null),
    player_names: names,
    boss: str(v.boss),
    zone_id: num(v.zone_id),
    run_id: str(v.run_id),
    end_reason: str(v.end_reason),
  };
}

export function normalizeLogList(value: unknown): LogMeta[] {
  const items = Array.isArray(value) ? value : list(bag(value).logs);
  return present(items.map(normalizeLogMeta));
}
