/* Native alerts wire types (docs/ALERTS_API.md), including official maintenance notices. */

export type AlertCategory = 'event' | 'world_boss' | 'field_boss' | 'custom';
export type AlertSound = 'none' | 'chime' | 'bell' | 'ping' | 'beep' | 'pulse' | 'alarm';

export type AlertSchedule =
  | { type: 'once'; at_ms: number }
  | { type: 'interval'; anchor_ms: number; every_seconds: number }
  /** HH:mm in the rule or global timezone; weekdays 0=Monday..6=Sunday, empty = every day. */
  | { type: 'calendar'; times: string[]; weekdays: number[] }
  | { type: 'observed' };

export type AlertScheduleType = AlertSchedule['type'];

export interface AlertRule {
  id: string;
  name: string;
  category: AlertCategory;
  enabled: boolean;
  favorite: boolean;
  schedule: AlertSchedule | null;
  /** IANA zone override for calendar times; null uses the global clock. */
  timezone: string | null;
  /** Distinct 0..86400 seconds before start; 0 = at start. */
  lead_seconds: number[];
  sound: AlertSound;
  /** 0..1 */
  volume: number;
  popup: boolean;
  /** 0 when the opening/entry duration is not known. */
  duration_seconds: number;
  npc_id: number | null;
  event_id: number | null;
  /** Observed rules: user respawn interval after an observed defeat, for an estimate. */
  respawn_seconds: number | null;
  notes: string;
  /** Ready-made catalogue entry this rule configures; null for a custom alert. */
  preset_id: string | null;
  /** Every NPC a grouped boss entry watches (e.g. all siege bosses). */
  npc_ids: number[];
  event_ids: number[];
  /** True keeps the user's own schedule instead of the built-in one for the region. */
  schedule_override: boolean;
}

/** Faction preference; 'auto' follows the detected character. */
export type AlertFactionSetting = 'auto' | 'all' | 'elyos' | 'asmodian';
export type AlertFaction = 'elyos' | 'asmodian' | 'all';

export interface QuietHours {
  start: string;
  end: string;
}

export interface AlertConfig {
  version: 1;
  revision: number;
  enabled: boolean;
  /** 'global' = custom clock. */
  region: string;
  /** '' = automatic (detected server). */
  server: string;
  timezone: string;
  background_sound: boolean;
  muted_until_ms: number | null;
  quiet_hours: QuietHours | null;
  /** Master volume 0..1, applied on top of each alert's own volume. */
  volume: number;
  faction: AlertFactionSetting;
  /**
   * False (the default) holds reminders while AION is not running; they are not replayed
   * later. Explicit previews always play.
   */
  alert_when_game_closed: boolean;
  /**
   * One notification when the official notice marks a watched maintenance complete (never
   * at its estimated end). Independent of `enabled` and of the game running; mute and
   * quiet hours still apply.
   */
  notify_server_back: boolean;
  rules: AlertRule[];
}

export interface AlertOccurrence {
  rule_id: string;
  name: string;
  category: AlertCategory;
  due_ms: number | null;
  remaining_ms: number | null;
  state: 'scheduled' | 'open' | 'unknown' | 'disabled';
  basis: string;
  estimated: boolean;
  source: string | null;
  server: string | null;
}

/** Where a countdown's time comes from. */
export type CountdownClock =
  /** Bundled calendar on the known server region's clock. */
  | 'server'
  /** Bundled calendar on the custom fallback clock; the server is not known yet. */
  | 'fallback'
  /** The user's own schedule for this entry. */
  | 'own'
  /** In-game sightings only; unknown until seen. */
  | 'observed'
  | 'none';

/**
 * Countdown for one catalogue entry, whether or not its notification is on. Native lists
 * every entry, using the saved rule where one exists.
 */
export interface CatalogueCountdown {
  entry_id: string;
  rule_id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss';
  due_ms: number | null;
  remaining_ms: number | null;
  state: 'scheduled' | 'open' | 'unknown';
  clock: CountdownClock;
  /** IANA zone the times use; null for sightings. */
  timezone: string | null;
  basis: string;
  estimated: boolean;
  /** Whether a reminder will sound or pop up: built-in calendars wait for a real clock. */
  notify: 'on' | 'off' | 'waiting_for_clock';
  server: string | null;
}

/** How the calendar clock was chosen. */
export type ClockSource = 'region' | 'server' | 'detected' | 'fallback';

/** `recovery`: the official notice marked a maintenance complete. */
export type DeliveryPhase = 'before' | 'start' | 'snooze' | 'test' | 'recovery';
export type DeliveryStatus =
  | 'delivered'
  | 'quiet'
  | 'muted'
  | 'dismissed'
  | 'snoozed'
  /** Held because the server was down (maintenance or offline). */
  | 'server_down'
  /** Held because AION was not running and alerting while closed is off. */
  | 'game_closed';

/** Why native is holding reminders right now. */
export type DeliveryPaused = 'game_closed' | 'server_down';

export type ServerState = 'online' | 'maintenance' | 'offline' | 'unknown';

/**
 * A server of the bundled Global roster. `maintenance` only inside a verified, officially
 * announced window; `unknown` otherwise (there is no public live health to say online).
 */
export interface ServerStatusRow {
  id: string;
  name: string;
  region: string;
  status: ServerState;
  /** Null unless a source reports it; the official notices never do. */
  population: number | null;
  /** Null unless a source reports it; the official notices never do. */
  character_creation_open: boolean | null;
}

/** A maintenance window published on the official notice board. */
export interface ServerMaintenance {
  title: string;
  /** The official notice; always https. */
  url: string;
  starts_ms: number;
  /** The announced end: an estimate until the notice says it is complete. */
  ends_ms: number;
  /** The official notice has marked this maintenance complete. */
  completed: boolean;
}

/**
 * Native reads the official maintenance notices about once a minute, whatever the windows
 * show. A failed or old check is uncertain and never suppresses anything. A published
 * window is a schedule, not a live confirmation that a server is up or down.
 */
export interface ServerStatusSnapshot {
  /** Last successful check; null before the first one. */
  checked_ms: number | null;
  last_attempt_ms: number | null;
  /** Native: the last success is older than 3 minutes, or the last attempt failed. */
  stale: boolean;
  error: string | null;
  source: string;
  /** The announced window native follows (current or next); null when none is known. */
  maintenance: ServerMaintenance | null;
  servers: ServerStatusRow[];
}

export interface AlertDelivery {
  id: string;
  rule_id: string;
  name: string;
  category: AlertCategory;
  due_ms: number;
  fired_ms: number;
  lead_seconds: number;
  phase: DeliveryPhase;
  sound: AlertSound;
  volume: number;
  popup: boolean;
  status: DeliveryStatus;
}

export interface ObservedTimer {
  id: string;
  name: string;
  category: 'event' | 'field_boss' | 'world_boss';
  npc_id: number | null;
  event_id: number | null;
  due_ms: number | null;
  observed_ms: number;
  server: string;
  state: string;
  basis: string;
  estimated: boolean;
}

export interface AlertTemplate {
  id: string;
  name: string;
  category: AlertCategory;
  schedule: AlertSchedule | null;
  duration_seconds: number;
  regions: string[];
  source: string | null;
  notes: string;
  verified: boolean;
  npc_id: number | null;
}

export interface AlertRegion {
  id: string;
  name: string;
  timezone: string;
}

export interface AlertServer {
  id: string;
  name: string;
  region: string;
}

export interface AlertBoss {
  id: number;
  name: string;
}

/** A ready-made event or boss alert, listed whether or not the user configured it. */
export interface AlertCatalogueEntry {
  id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss';
  map_id: number | null;
  map: string | null;
  faction: AlertFaction;
  members: { id: number; name: string }[];
  /** Complete, valid, disabled default rule for the current region. */
  rule: AlertRule;
  source: string;
  note: string;
  /** Minute of the server day when daily entries recharge; null when not applicable. */
  recharge_minute: number | null;
}

export interface AlertDashboard {
  now_ms: number;
  config: AlertConfig;
  /** Next occurrence of each notification rule and snooze; follows notification settings. */
  upcoming: AlertOccurrence[];
  /** Countdown for every catalogue entry, independent of notification settings. */
  catalogue_upcoming: CatalogueCountdown[];
  active: AlertDelivery[];
  history: AlertDelivery[];
  observed: ObservedTimer[];
  regions: AlertRegion[];
  servers: AlertServer[];
  detected_server: AlertServer | null;
  templates: AlertTemplate[];
  /** Every boss in the bundled NPC catalogue, so unseen bosses can be watched too. */
  bosses: AlertBoss[];
  /** Every ready-made event and boss alert. */
  catalogue: AlertCatalogueEntry[];
  /** Region the schedules follow (chosen, or detected from the character); null if unknown. */
  effective_region: string | null;
  effective_timezone: string;
  /** Faction the list follows; null until a character is known. */
  effective_faction: 'elyos' | 'asmodian' | null;
  /** False until a server region is known; built-in reminders wait for it. */
  clock_ready: boolean;
  /** True while built-in countdowns run on the fallback clock instead of a server's. */
  clock_estimated: boolean;
  clock_source: ClockSource;
  /**
   * Whether capture is observing the game right now. When native reports false, no spawn
   * reads as up; absent means unknown and only the sighting's age decides.
   */
  live_observations?: boolean;
  /** Whether AION is running; null until native knows. */
  game_running: boolean | null;
  /** Why reminders are held right now; null while they are delivered. */
  delivery_paused: DeliveryPaused | null;
  server_status: ServerStatusSnapshot;
  error: string | null;
}

export type AlertActionName =
  | 'dismiss'
  | 'dismiss_all'
  | 'snooze'
  | 'skip'
  | 'clear_history'
  | 'mute'
  | 'unmute';
