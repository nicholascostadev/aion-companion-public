import type { CombatReport, LogId, LogMeta, LogQuery, LogSort } from '../../types/offline';

export interface LibraryFilters {
  search: string;
  boss: string;
  zone: string;
  run: string;
  /** yyyy-mm-dd, local time. */
  from: string;
  to: string;
  sort: LogSort;
}

export const emptyFilters: LibraryFilters = {
  search: '',
  boss: '',
  zone: '',
  run: '',
  from: '',
  to: '',
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
  return query;
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
