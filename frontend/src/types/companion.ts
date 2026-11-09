export type RecordingEvent =
  | {
      kind: 'damage';
      at_ms: number;
      source: string;
      target: string;
      skill: string;
      amount: number;
    }
  | {
      kind: 'heal';
      at_ms: number;
      source: string;
      target: string;
      skill: string;
      amount: number;
    }
  | { kind: 'position'; at_ms: number; actor: string; x: number; y: number }
  | {
      kind: 'counter';
      at_ms: number;
      character: string;
      key: string;
      value: number;
      limit: number;
    }
  | {
      kind: 'pet_souls';
      at_ms: number;
      character: string;
      pet: string;
      owned: number;
      required: number;
    }
  | { kind: 'gap'; at_ms: number; reason: string };

export interface Recording {
  schema_version: number;
  source: string;
  duration_ms: number;
  events: RecordingEvent[];
}

export interface ReplayPlayer {
  damage: number;
  healing: number;
  dps: number;
  skills: Record<string, number>;
}

export interface ActivityCounter {
  character: string;
  key: string;
  value: number;
  limit: number;
}

export interface PetSouls {
  character: string;
  pet: string;
  owned: number;
  required: number;
}

export interface Snapshot {
  at_ms: number;
  players: Record<string, ReplayPlayer>;
  positions: Record<string, [number, number]>;
  counters: ActivityCounter[];
  pets: PetSouls[];
  gaps: string[];
}

export type RecordingSource =
  | { kind: 'demo' }
  | { kind: 'import'; json: string }
  | { kind: 'live'; id?: number };

/*
 * `live_status` and `group_status` are typed to their native contracts
 * (`crates/companion-capture/src/live_status.rs` and `group_status.rs`, with one golden
 * payload each in `fixtures/contracts`). Every field is always present; `null` means not
 * observed, never zero. `lib/liveStatusNormalize` and `lib/groupStatusNormalize` guarantee
 * these shapes whatever native sends.
 */

/** One row of the fallback meter: an entity's totals beside its player identity. */
export interface LivePlayer {
  entity: number;
  /** `"<name> #<entity>"` once the name is observed, `"<class> #<entity>"` before. */
  label: string;
  /** From the first skill the player used; `"Entity"` when that skill names no class. */
  class: string;
  damage: number;
  /** Damage per second over the whole fight. */
  dps: number;
  /** Damage per second over the last five seconds. */
  current_dps: number;
  /** This row's part of the damage of the rows shown, from 0 to 1. */
  share: number;
  direct_hits: number;
  critical_hits: number;
  ticks: number;
  /** Damage by skill label. */
  skills: Record<string, number>;
  name: string | null;
  /** Whether `name` is set. */
  name_known: boolean;
  is_local: boolean;
  /** Observed with the name, or taken from the verified roster member; null when unknown. */
  server_id: number | null;
  /** Counts as part of the local player's group. */
  party_member: boolean;
  gear_score: number | null;
  combat_power: number | null;
}

/**
 * The local character's Odyle energy as the game last reported it: the balance and its
 * separate bonus, observed at `observed_ms` (epoch milliseconds).
 */
export interface OdyleBalance {
  base: number;
  bonus: number;
  observed_ms: number;
}

/** The capture worker's counters, all ten together once it has published. */
export interface CaptureCounters {
  adapters: number;
  packets: number;
  frames: number;
  bundles: number;
  rejected: number;
  gaps: number;
  retransmissions: number;
  desyncs: number;
  dropped: number;
  metadata_dropped: number;
}

/** `{}` until the capture worker publishes for the first time; then every counter. */
export type CaptureStats = CaptureCounters | { [Counter in keyof CaptureCounters]?: never };

/** An earlier fight still held in memory. */
export interface PastEncounter {
  id: number;
  duration_ms: number;
  events: number;
}

export interface LiveStatus {
  /** Captured Odyle energy; null while it is unknown. */
  odyle: OdyleBalance | null;
  running: boolean;
  /** `idle`, `starting`, `waiting_for_game`, `capturing`, `stopped` or `error`. */
  phase: string;
  message: string;
  /** The current fight's length; zero before its first hit. */
  duration_ms: number;
  /** Damage events in the current fight. */
  events: number;
  stats: CaptureStats;
  /** Highest damage first. */
  players: LivePlayer[];
  /** Entities whose name has been observed. */
  named_entities: number;
  roster_seen: boolean;
  /** Members in the current party roster. */
  party_members: number;
  local_known: boolean;
  /** The saved "party only" preference, not whether `players` is filtered right now. */
  party_only: boolean;
  auto_end: boolean;
  /** The current fight's number, starting at one. */
  encounter: number;
  encounter_ended: boolean;
  /** Skill names loaded from the catalogue. */
  skill_labels: number;
  /** Earlier fights still held in memory, oldest first. */
  history: PastEncounter[];
}

export interface OverlayStatus {
  /** User's visibility choices, retained while focus temporarily hides the windows. */
  requested_visible?: boolean;
  menu_requested?: boolean;
  game_focused?: boolean;
  focus_suppressed?: boolean;
  /** DPS panel is click-through. */
  locked: boolean;
  /** DPS panel webview reported ready. */
  ready: boolean;
  /** DPS panel window is shown. */
  visible: boolean;
  can_lock: boolean;
  /** Last report saved by native; not shown by the meter. */
  saved_path?: string;
  errors: string[];
  menu_ready?: boolean;
  menu_visible?: boolean;
  tray_ready?: boolean;
  tray_registered?: boolean;
  /** In-game tracker surface (click-through unless being arranged). */
  trackers_requested?: boolean;
  trackers_editing?: boolean;
  trackers_ready?: boolean;
  trackers_visible?: boolean;
  /** Damage-details panel opened from a meter row. */
  details_requested?: boolean;
  details_ready?: boolean;
  details_visible?: boolean;
  details_selection?: DetailsSelection | null;
  /** Locked-meter controls and rows currently registered as clickable. */
  row_regions?: number;
}

/** One meter row opened in the damage-details panel; `revision` grows with every open. */
export interface DetailsSelection {
  revision: number;
  report_id: string | null;
  player: string;
}

/** A character inspected in the lobby: an observation, not an identity (no server, no id). */
export interface GroupInspection {
  /** Unique among the inspections of one capture; not a character id. */
  id: number;
  name: string;
  class: string;
  level: number;
  gear_score: number;
  /** Epoch milliseconds. */
  observed_ms: number;
}

/**
 * One roster member. Absent observations are null: the room shows a dash, never a guess.
 * Gear score and combat power follow the meters' precedence; the rest is the roster.
 */
export interface GroupMember {
  /** A 64-bit id as decimal text, because it exceeds a JavaScript safe integer. */
  character_id: string | null;
  /** 1-based party slot. */
  slot: number | null;
  /** Never observed today; always null. */
  group_index: number | null;
  /** When `ready` was last observed (epoch milliseconds). */
  ready_observed_ms: number | null;
  name: string;
  server_id: number | null;
  class: string | null;
  level: number;
  gear_score: number | null;
  combat_power: number | null;
  leader: boolean | null;
  /** Set only by an explicit readiness update, never by the roster itself. */
  ready: boolean | null;
}

/**
 * Readiness metadata. Today native only proves each member's ready bit: `observed_ms` is
 * when readiness was last seen. `active`, `started_ms` and `expires_ms` describe a timed
 * ready-check round and stay null unless the game reports one explicitly.
 */
export interface GroupReadyCheck {
  active: boolean | null;
  started_ms: number | null;
  expires_ms: number | null;
  /** Newest member readiness observation. */
  observed_ms: number | null;
  /** Oldest member readiness observation still shown. */
  oldest_observed_ms: number | null;
  source: string;
  supported: boolean;
}

export interface GroupStatus {
  /** When this capture began (epoch milliseconds); it changes with every restart. */
  capture_id: number;
  running: boolean;
  phase: string;
  message: string;
  /** A roster record was observed, including one that emptied the party. */
  roster_seen: boolean;
  roster_age_ms: number | null;
  lobby_name: string | null;
  capacity: number | null;
  party_id: number | null;
  /** In slot order for a complete roster. */
  members: GroupMember[];
  /** Newest first. */
  inspections: GroupInspection[];
  /** A complete live party room roster (title, capacity, members). */
  room: boolean;
  /** The dungeon the room's party was formed for, from its roster; null for other parties. */
  dungeon_id: number | null;
  /** The observed dungeon run; see `docs/GROUP_PROTOCOL.md`. */
  run: GroupRun;
  /**
   * A dungeon group (room with `dungeon_id`) whose run has not been observed to start: the
   * meter shows only the room. Native decides; an unknown run phase still prepares.
   */
  preparing: boolean;
  ready_check: GroupReadyCheck;
}

/**
 * Whether a dungeon run is under way, from the decoded dungeon state: `unknown` until a zone
 * or dungeon state is observed after connecting, `outside` with none, `running`, then
 * `cleared` until the player leaves the dungeon.
 */
export interface GroupRun {
  phase: 'unknown' | 'outside' | 'running' | 'cleared';
  dungeon_id: number | null;
  run_id: string | null;
  zone_id: number | null;
}
