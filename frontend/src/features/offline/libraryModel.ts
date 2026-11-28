import type {
  CombatReport,
  LogId,
  LogMeta,
  LogOutcome,
  LogQuery,
  LogSort,
} from '../../types/offline';

export interface LibraryFilters {
  search: string;
  boss: string;
  zone: string;
  run: string;
  /** yyyy-mm-dd, local time. */
  from: string;
  to: string;
  /** Result group; `all` filters nothing. */
  outcome: LogOutcome | 'all';
  sort: LogSort;
}

export const emptyFilters: LibraryFilters = {
  search: '',
  boss: '',
  zone: '',
  run: '',
  from: '',
  to: '',
  outcome: 'all',
  sort: 'newest',
};

export const PAGE_SIZE = 50;

function localDay(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [y, m, d] = value.split('-').map(Number) as [number, number, number];
  const date = endOfDay ? new Date(y, m - 1, d, 23, 59, 59, 999) : new Date(y, m - 1, d);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

/** Turns form filters into the native query, dropping anything unset or invalid. */
export function toQuery(filters: LibraryFilters, offset: number): LogQuery {
  const zone = Number(filters.zone);
  const query: LogQuery = { sort: filters.sort, limit: PAGE_SIZE + 1, offset };
  if (filters.search.trim()) query.search = filters.search.trim();
  if (filters.boss.trim()) query.boss = filters.boss.trim();
  if (filters.zone.trim() && Number.isInteger(zone) && zone >= 0) query.zone_id = zone;
  if (filters.run.trim()) query.run_id = filters.run.trim();
  const from = localDay(filters.from, false);
  const to = localDay(filters.to, true);
  if (from !== undefined) query.from_ms = from;
  if (to !== undefined) query.to_ms = to;
  if (filters.outcome !== 'all') query.outcome = filters.outcome;
  return query;
}

/** The status capability of an engine that filters saved fights by result before paging. */
export const OUTCOME_CAPABILITY = 'log_outcome_filter';

/**
 * The end reasons of each result group, as native groups them. Only these say how a fight
 * went: an idle timeout, a zone change or a manual end is neither a kill nor an attempt.
 */
export const OUTCOME_REASONS: Record<LogOutcome, readonly string[]> = {
  kill: ['kill', 'clear'],
  attempt: ['reset', 'wipe'],
  dummy: ['dummy_cap'],
};

/** The result group a recorded end reason belongs to, or null when it names none. */
export function logOutcome(reason: string | null): LogOutcome | null {
  for (const outcome of ['kill', 'attempt', 'dummy'] as const)
    if (reason !== null && OUTCOME_REASONS[outcome].includes(reason)) return outcome;
  return null;
}

/** The outcome of a library action, worded by the view (paths and labels verbatim). */
export type LibraryNotice =
  | { kind: 'renamed'; label: string }
  | { kind: 'deleted'; count: number }
  | { kind: 'exported'; paths: string[] }
  | { kind: 'exportedBeforeError'; paths: string[] };

/** What the library view needs from its state owner. */
export interface LogLibraryView {
  filters: LibraryFilters;
  setFilters: (filters: LibraryFilters) => void;
  offset: number;
  setOffset: (offset: number) => void;
  hasMore: boolean;
  logs: LogMeta[];
  loading: boolean;
  /** Raw native failure text, shown verbatim. */
  error: string;
  notice: LibraryNotice | null;
  clearNotice: () => void;
  selected: LogId[];
  setSelected: (ids: LogId[]) => void;
  /** Logs that appeared since the library was first listed (e.g. auto-saved). */
  fresh: LogId[];
  activeId: LogId | null;
  report: CombatReport | null;
  reportLoading: boolean;
  reportError: string;
  open: (id: LogId | null) => Promise<void>;
  rename: (id: LogId, label: string) => Promise<boolean>;
  remove: (ids: LogId[]) => Promise<void>;
  exportLogs: (ids: LogId[]) => Promise<void>;
  refresh: () => void;
}
