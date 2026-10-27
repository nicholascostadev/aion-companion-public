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
}

export interface TimersStatus {
  now_ms: number;
  region: string | null;
  region_name: string;
  timezone: string;
  clock_ready: boolean;
  clock_estimated: boolean;
  rows: TimerRow[];
  resets: { daily_ms: number; weekly_ms: number; timezone: string; basis: string };
  error: string | null;
}
