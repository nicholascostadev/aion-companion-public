/**
 * Offline combat expansion DTOs, modelled on docs/OFFLINE_API.md.
 *
 * Optional or unknown facts are `null`, never invented. Every payload passes
 * through `lib/offlineNormalize.ts`, so components can rely on these shapes even
 * while the native side is still filling fields in.
 */

/** Native entity identifier: numeric today, tolerated as a string. */
export type EntityId = number | string;
/** Local log identifier (native `fight-<epoch>` string), passed back verbatim. */
export type LogId = string;

export type DpsMode = 'encounter' | 'active';
export type TargetMode = 'all' | 'boss';
export type Region = 'global' | 'twkr';
/**
 * A stored language preference. Only `en` and `pt-BR` are interface languages (`pt` is the
 * legacy value for `pt-BR`); the others stay valid so existing settings are never rewritten.
 */
export type Locale = 'en' | 'pt-BR' | 'pt' | 'de' | 'es' | 'fr' | 'ja' | 'ko' | 'zh' | 'ru';

export interface OfflineHotkeys {
  toggle_overlay: string;
  toggle_lock: string;
  reset: string;
  copy_summary: string;
  compact_strip: string;
}
export type HotkeyAction = keyof OfflineHotkeys;

export type TrackerMode = 'cooldowns' | 'buffs' | 'both';
export type TrackerAppearance = 'icons' | 'bars';

export interface TrackerBar {
  id: string;
  name: string;
  mode: TrackerMode;
  skills: number[];
  x: number;
  y: number;
  icon_size: number;
  appearance: TrackerAppearance;
  hidden: boolean;
}

export interface TrackerPreset {
  id: string;
  name: string;
  class: string | null;
  keybind: string | null;
  bars: TrackerBar[];
}

/** A user-defined local schedule. `at_ms` is the first due time (epoch ms). */
export interface AlertSchedule {
  id: string;
  name: string;
  enabled: boolean;
  at_ms: number | null;
  repeat_seconds: number | null;
  lead_seconds: number;
  /** 0..1 */
  volume: number;
  sound: string;
}

export interface OfflineSettings {
  dps_mode: DpsMode;
  target_mode: TargetMode;
  party_only: boolean;
  idle_timeout_seconds: number;
  /** 0 disables the dummy timer, otherwise 10..300. */
  dummy_length_seconds: number;
  dummy_cooldown_seconds: number;
  auto_save: boolean;
  refresh_ms: number;
  opacity: number;
  scale: number;
  /** 0 disables idle fading. */
  fade_after_seconds: number;
  fade_opacity: number;
  hide_names: boolean;
  compact_strip: boolean;
  region: Region;
  locale: Locale;
  hotkeys: OfflineHotkeys;
  presets: TrackerPreset[];
  active_preset: string | null;
  alerts: AlertSchedule[];
  /** Sound an alert when a catalogue boss spawn is actually observed. */
  boss_alerts: boolean;
  /** Sound an alert when an observed field-event state changes. */
  event_alerts: boolean;
}

export type TrackerKind = 'cooldown' | 'buff';
export interface TrackerStatus {
  bar_id: string;
  skill: number;
  name: string | null;
  /** null: an active buff with no recorded end. */
  remaining_ms: number | null;
  kind: TrackerKind;
  source: EntityId | null;
  target: EntityId | null;
  /** Remaining time is calibrated or derived rather than read exactly. */
  estimated: boolean;
  /** How native measured the timer, e.g. "observed wall-clock calibration". */
  basis: string | null;
}

export interface AlertStatus {
  id: string;
  name: string;
  due_ms: number;
  remaining_ms: number;
  sound: string;
  volume: number;
  lead_seconds: number;
}

export interface CatalogueSummary {
  skills: number;
  npcs: number;
}

/**
 * The status envelope. `offline_status` carries the live report with its bounded detail
 * ({@link OfflineStatus}); `offline_live_status` the same envelope with a compact
 * {@link ReportSummary} ({@link OfflineLiveStatus}).
 */
export interface OfflineStatusOf<Report> {
  settings: OfflineSettings | null;
  report: Report | null;
  library_count: number | null;
  trackers: TrackerStatus[];
  alerts: AlertStatus[];
  catalogue: CatalogueSummary | null;
  /** Feature flags and notes reported by native; an absent flag means unavailable. */
  capabilities: Record<string, boolean | string>;
  /** Last native library error (e.g. a failed auto-save), if any. */
  error: string | null;
}

/** `offline_status`: the live report with its events, buffs and HP samples. */
export type OfflineStatus = OfflineStatusOf<CombatReport>;
/** `offline_live_status` and summary action replies: aggregates only, no report details. */
export type OfflineLiveStatus = OfflineStatusOf<ReportSummary>;
/** The live report a shared poll holds: a summary unless a visible view asked for detail. */
export type LiveReport = CombatReport | ReportSummary;
/** A polled status (see `useOffline`); narrow its report by `detail_level` before using details. */
export type PolledOfflineStatus = OfflineStatusOf<LiveReport>;

/* ---------- Combat report ---------- */

export interface SkillSpecialty {
  slot: number | null;
  name: string | null;
  description: string | null;
  /** Observed uses of this specialty, when native counts them. */
  count: number | null;
}

/** Charge levels: a single observed figure or a per-level count. */
export type SkillCharge = number | Record<string, number>;

/**
 * Accuracy denominators. Crit rates divide by `critical_hits_observed` (direct hits
 * whose crit flag was decoded) and positional rates by `flags_observed`; a null
 * count means native observed none, so the rate is unavailable rather than 0%.
 */
export interface HitAccuracy {
  /** Hits that were not periodic ticks. */
  direct_hits: number | null;
  critical_hits_observed: number | null;
  flags_observed: number | null;
  /** Casts counted from hits because no cast packet was observed. */
  inferred_casts: number | null;
}

/**
 * Outgoing-damage counters, separate from `hits`/`crits`, which also count healing.
 * `damage_hits` counts damage events (a multi-hit is one event); crit rates divide
 * `damage_crits` by `damage_critical_hits_observed` (direct damage with a decoded crit
 * flag). Null means native did not report the counter or observed no crit flags.
 */
export interface DamageAccuracy {
  damage_hits: number | null;
  damage_crits: number | null;
  damage_critical_hits_observed: number | null;
}

export interface ReportSkill extends HitAccuracy, DamageAccuracy {
  id: EntityId;
  name: string | null;
  damage: number;
  healing: number;
  received: number;
  casts: number | null;
  hits: number | null;
  crits: number | null;
  back: number | null;
  front: number | null;
  perfect: number | null;
  double: number | null;
  parry: number | null;
  multi: number | null;
  min: number | null;
  max: number | null;
  avg: number | null;
  cast_gap_ms: number | null;
  charge: SkillCharge | null;
  specialties: SkillSpecialty[];
}

export interface ReportPlayerTarget {
  id: EntityId;
  name: string | null;
  damage: number;
  healing: number;
  received: number;
}

export interface ReportPlayer extends HitAccuracy, DamageAccuracy {
  id: EntityId;
  name: string | null;
  class: string | null;
  local: boolean | null;
  party: boolean | null;
  server_id: number | null;
  level: number | null;
  gear_score: number | null;
  combat_power: number | null;
  damage: number;
  healing: number;
  received: number;
  healing_received: number | null;
  deaths: number | null;
  casts: number | null;
  hits: number | null;
  crits: number | null;
  back: number | null;
  front: number | null;
  perfect: number | null;
  double: number | null;
  parry: number | null;
  multi: number | null;
  edps: number | null;
  adps: number | null;
  current_dps: number | null;
  /** Share of the fight with activity, normalized from native 0..100 to 0..1. */
  active_pct: number | null;
  /** How native approximates activity, shown with the figure. */
  activity_method: string | null;
  skills: ReportSkill[];
  targets: ReportPlayerTarget[];
}

export interface ReportTarget {
  id: EntityId;
  npc_id: number | null;
  name: string | null;
  boss: boolean | null;
  dummy: boolean | null;
  current_hp: number | null;
  max_hp: number | null;
  dead: boolean | null;
  damage: number;
  berserk_seconds: number | null;
}

export type ReportEventKind =
  | 'damage'
  | 'heal'
  | 'cast'
  | 'buff'
  | 'buff_end'
  | 'hp'
  | 'death'
  | 'revive'
  | 'zone'
  | 'reset'
  | 'spawn'
  | 'position';

export interface ReportEvent {
  at_ms: number;
  /** A {@link ReportEventKind}; unknown future kinds pass through as strings. */
  kind: string;
  source?: EntityId | null;
  target?: EntityId | null;
  skill?: EntityId | null;
  amount?: number | null;
  hit_count?: number | null;
  critical?: boolean | null;
  back?: boolean | null;
  front?: boolean | null;
  perfect?: boolean | null;
  double?: boolean | null;
  parry?: boolean | null;
  instance?: EntityId | null;
  duration_ms?: number | null;
  current_hp?: number | null;
  max_hp?: number | null;
  zone_id?: number | null;
  charge?: number | null;
  /** Periodic (damage/heal over time) tick rather than a direct hit. */
  tick?: boolean | null;
  x?: number | null;
  y?: number | null;
}

export interface BuffSpan {
  source: EntityId | null;
  target: EntityId | null;
  skill: EntityId;
  instance: EntityId | null;
  start_ms: number;
  /** null while still active. */
  end_ms: number | null;
}

export interface HpSample {
  entity: EntityId;
  at_ms: number;
  current: number;
  max: number;
}

/** Known kinds: biggest_hit, first_hit, healing, healing_received, damage_taken. */
export type HighlightKind = string;
export interface Highlight {
  kind: HighlightKind;
  player: EntityId | null;
  value: number | null;
  at_ms: number | null;
}

/** `full`: events, buffs and HP samples are included; `summary`: aggregates and HP endpoints. */
export type ReportDetailLevel = 'full' | 'summary';

/** Whole-fight aggregates every report carries, full or summary. */
export interface ReportTotals {
  detail_level: ReportDetailLevel;
  id: LogId | null;
  label: string | null;
  started_ms: number | null;
  duration_ms: number;
  end_reason: string | null;
  zone_id: number | null;
  run_id: string | null;
  party_id: EntityId | null;
  players: ReportPlayer[];
  targets: ReportTarget[];
  highlights: Highlight[];
  warnings: string[];
  /** Observed packet families. A missing key means "not observed". */
  coverage: Record<string, boolean>;
  /** Observations in the whole fight, when native counts them; detailed events may be fewer. */
  event_count: number | null;
}

export interface CombatReport extends ReportTotals {
  detail_level: 'full';
  events: ReportEvent[];
  buffs: BuffSpan[];
  hp: HpSample[];
  /** Live reports carry only the latest detailed events; totals still cover the whole fight. */
  events_truncated: boolean;
  /** Fight time of the first detailed event when truncated. */
  event_window_start_ms: number | null;
}

/**
 * Compact live report (`offline_live_status`): the same aggregates without events or
 * buffs, so it can never feed a timeline, rotation or buff view. `hp` holds at most two
 * samples per target, the first and last of the 20 s ending at its latest HP update:
 * enough for the boss projection's HP-drop kill time, never an HP timeline.
 */
export interface ReportSummary extends ReportTotals {
  detail_level: 'summary';
  hp: HpSample[];
}

/** One fight loaded for the damage-details panel (see `useInspectedReport`). */
export interface InspectedReport {
  /** Fight this panel is pinned to; never changes until another row is opened. */
  reportId: string | null;
  report: CombatReport | null;
  /** Target scope `report` was read in; a scope change drops it until read again. */
  scope: TargetMode | null;
  settings: OfflineSettings | null;
  loading: boolean;
  /** Load failure before any report arrived. */
  error: string;
  /** Live refresh failed after a report was shown: the last snapshot stays. */
  stale: string;
  /** The user wants live refreshes while the pinned fight is still recording. */
  following: boolean;
  /** Refreshes are running right now (following, still recording and panel visible). */
  updating: boolean;
  setFollowing: (following: boolean) => void;
}

/* ---------- Local log library ---------- */

export type LogSort = 'newest' | 'damage' | 'dps';

export interface LogQuery {
  search?: string;
  boss?: string;
  zone_id?: number;
  run_id?: string;
  from_ms?: number;
  to_ms?: number;
  sort?: LogSort;
  limit?: number;
  offset?: number;
}

export interface LogMeta {
  id: LogId;
  label: string | null;
  started_ms: number | null;
  duration_ms: number;
  damage: number | null;
  dps: number | null;
  /** Player count. */
  players: number | null;
  /** Player names, when native lists them instead of a count. */
  player_names: string[];
  boss: string | null;
  zone_id: number | null;
  run_id: string | null;
  end_reason: string | null;
}

export type OfflineActionName = 'save' | 'reset' | 'clear' | 'open_data_folder';
