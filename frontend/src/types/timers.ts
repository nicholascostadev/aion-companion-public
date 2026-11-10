export interface TimerRow {
  id: string;
  name: string;
  category: 'event' | 'world_boss' | 'field_boss';
  due_ms: number | null;
  ends_ms: number | null;
  state: 'scheduled' | 'open' | 'alive' | 'unknown';
  estimated: boolean;
  basis: string;
  timezone: string | null;
  /** The game map of a field boss; null for events and schedules. */
  map_id?: number | null;
}

/** A game map's field bosses, by the map's zone id. */
export interface TimerMap {
  id: number;
  name: string;
  rows: TimerRow[];
}

export interface TimersStatus {
  now_ms: number;
  region: string | null;
  region_name: string;
  timezone: string;
  clock_ready: boolean;
  clock_estimated: boolean;
  rows: TimerRow[];
  /**
   * The zone you are in while capturing; `name` is null for an area without bosses.
   * Optional, like `maps`, so a frontend reloaded over an older native build still renders.
   */
  current_map?: { id: number; name: string | null } | null;
  /** Every map with field bosses, the normal world first. */
  maps?: TimerMap[];
  resets: {
    daily_ms: number;
    weekly_ms: number;
    timezone: string;
    basis: string;
  };
  error: string | null;
}
