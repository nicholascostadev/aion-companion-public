export type RecordingEvent =
  | { kind: 'damage'; at_ms: number; source: string; target: string; skill: string; amount: number }
  | { kind: 'heal'; at_ms: number; source: string; target: string; skill: string; amount: number }
  | { kind: 'position'; at_ms: number; actor: string; x: number; y: number }
  | { kind: 'counter'; at_ms: number; character: string; key: string; value: number; limit: number }
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

export interface LivePlayer {
  entity: number;
  label: string;
  name?: string | null;
  class?: string | null;
  name_known?: boolean;
  is_local?: boolean;
  damage: number;
  dps: number;
  current_dps: number;
  share: number;
  direct_hits: number;
  critical_hits: number;
  ticks: number;
  skills: Record<string, number>;
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

export interface LiveStatus {
  /** Captured Odyle energy; null (or absent from older builds) while it is unknown. */
  odyle?: OdyleBalance | null;
  named_entities?: number;
  roster_seen?: boolean;
  party_members?: number;
  local_known?: boolean;
  party_only?: boolean;
  auto_end?: boolean;
  encounter?: number;
  encounter_ended?: boolean;
  skill_labels?: number;
  history?: { id: number; duration_ms: number; events: number }[];
  running: boolean;
  phase: string;
  message: string;
  duration_ms: number;
  events: number;
  players: LivePlayer[];
  stats: Partial<
    Record<
      | 'adapters'
      | 'packets'
      | 'frames'
      | 'bundles'
      | 'rejected'
      | 'gaps'
      | 'retransmissions'
      | 'desyncs'
      | 'dropped',
      number
    >
  >;
}

export interface OverlayStatus {
  /** User's visibility choices, retained while focus temporarily hides the windows. */
  requested_visible?: boolean;
  /** User enabled automatic Group display in raid rooms, retained outside rooms. */
  group_enabled?: boolean;
  /** Enabled Group panel is currently eligible for display in a raid room. */
  group_requested?: boolean;
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
  group_ready?: boolean;
  group_visible?: boolean;
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

export interface GroupInspection {
  id: number;
  name: string;
  class: string;
  level: number;
  gear_score: number;
  observed_ms: number;
  combat_power?: number | null;
  ready?: boolean | null;
  leader?: boolean | null;
}
export interface GroupStatus {
  capture_id: number;
  running: boolean;
  phase: string;
  message: string;
  roster_seen: boolean;
  roster_age_ms: number | null;
  lobby_name?: string | null;
  capacity?: number | null;
  party_id?: number | null;
  members: {
    name: string;
    server_id: number | null;
    class: string | null;
    level: number;
    gear_score?: number | null;
    combat_power?: number | null;
    ready?: boolean | null;
    leader?: boolean | null;
  }[];
  inspections: GroupInspection[];
}
