import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  emptyFilters,
  PAGE_SIZE,
  toQuery,
  type LibraryFilters,
  type LibraryNotice,
  type LogLibraryView,
} from '../features/offline/libraryModel';
import { deleteLogs, exportLog, listLogs, readLog, renameLog } from '../services/offline';
import type { CombatReport, LogId, LogMeta } from '../types/offline';
import { HIDDEN_RELEASE_MS } from './useRecentlyShown';

interface Page {
  key: string;
  logs: LogMeta[];
  hasMore: boolean;
  error: string;
}

interface Options {
  /**
   * The library's tab is chosen. Its filters, page, selection and opened log are kept while
   * it is not; only the opened log's report is let go once it has stayed away for a while
   * (a long fight holds every event), and it is read again when the library shows.
   */
  shown?: boolean;
  /**
   * Saved fights are read in the Bosses target scope (bosses and dummies while the fight met
   * any) rather than every target. A change reads the opened log again in the new scope.
   */
  bossOnly?: boolean;
}

/** Local log library: filtered pages, multi-select, rename/delete/export and detail. */
export function useLogLibrary(
  native: boolean,
  libraryCount: number | null,
  { shown = true, bossOnly = false }: Options = {},
): LogLibraryView {
  const [filters, setFilters] = useState<LibraryFilters>(emptyFilters);
  const [debounced, setDebounced] = useState(filters);
  const [offset, setOffset] = useState(0);
  const [tick, setTick] = useState(0);
  const [page, setPage] = useState<Page>({ key: '', logs: [], hasMore: false, error: '' });
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState<LibraryNotice | null>(null);
  const [selected, setSelected] = useState<LogId[]>([]);
  const [activeId, setActiveId] = useState<LogId | null>(null);
  const [report, setReport] = useState<CombatReport | null>(null);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportError, setReportError] = useState('');
  const [fresh, setFresh] = useState<LogId[]>([]);
  const seen = useRef<Set<LogId> | null>(null);
  /** Opened log whose report was let go while hidden. */
  const released = useRef<LogId | null>(null);
  const reportRequest = useRef(0);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(filters), 250);
    return () => clearTimeout(timer);
  }, [filters]);

  const query = useMemo(() => toQuery(debounced, offset), [debounced, offset]);
  // Any change of query, library size or an explicit refresh refetches the page.
  const pageKey = `${JSON.stringify(query)}|${libraryCount ?? ''}|${tick}`;

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    listLogs(query).then(
      (rows) => {
        if (cancelled) return;
        const visible = rows.slice(0, PAGE_SIZE);
        if (seen.current) {
          const known = seen.current;
          const added = visible.map((l) => l.id).filter((id) => !known.has(id));
          if (added.length) setFresh((current) => [...new Set([...current, ...added])]);
          for (const l of visible) known.add(l.id);
        } else seen.current = new Set(visible.map((l) => l.id));
        setSelected((current) => current.filter((id) => visible.some((l) => l.id === id)));
        setPage({ key: pageKey, logs: visible, hasMore: rows.length > PAGE_SIZE, error: '' });
      },
      (cause: unknown) => {
        if (!cancelled) setPage((current) => ({ ...current, key: pageKey, error: String(cause) }));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native, query, pageKey]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  const open = useCallback(
    async (id: LogId | null) => {
      setActiveId(id);
      const ticket = ++reportRequest.current;
      if (id === null || !native) {
        setReport(null);
        return;
      }
      setFresh((current) => current.filter((k) => k !== id));
      setReportLoading(true);
      try {
        const next = await readLog(id, bossOnly);
        if (mounted.current && ticket === reportRequest.current) {
          setReport(next);
          setReportError('');
        }
      } catch (cause) {
        if (mounted.current && ticket === reportRequest.current) {
          setReport(null);
          setReportError(String(cause));
        }
      } finally {
        if (mounted.current && ticket === reportRequest.current) setReportLoading(false);
      }
    },
    [native, bossOnly],
  );

  // Hidden long enough, the report goes (with any read of it in flight); the log stays open.
  // A quick tab switch keeps it, like map art (`useRecentlyShown`).
  const holding = activeId !== null && (report !== null || reportLoading);
  useEffect(() => {
    if (shown || !holding) return;
    const timer = setTimeout(() => {
      reportRequest.current += 1;
      released.current = activeId;
      setReport(null);
      setReportLoading(false);
    }, HIDDEN_RELEASE_MS);
    return () => clearTimeout(timer);
  }, [shown, holding, activeId]);
  // A changed target scope drops the opened report (adjusted during render), so it is never
  // shown under the new scope, and releases the log: `open` follows the scope, so the effect
  // below reads it again at once, or once the library shows when hidden.
  const [scope, setScope] = useState(bossOnly);
  if (scope !== bossOnly) {
    setScope(bossOnly);
    setReport(null);
    setReportLoading(false);
  }
  const readScope = useRef(bossOnly);
  useEffect(() => {
    if (readScope.current === bossOnly) return;
    readScope.current = bossOnly;
    if (activeId === null) return;
    reportRequest.current += 1;
    released.current = activeId;
  }, [bossOnly, activeId]);
  // Shown again, the same log is read again; opening another log meanwhile replaces it.
  useEffect(() => {
    if (!shown || released.current === null) return;
    const id = released.current;
    released.current = null;
    if (id === activeId) void open(id);
  }, [shown, activeId, open]);

  const rename = useCallback(async (id: LogId, label: string) => {
    try {
      const meta = await renameLog(id, label.trim());
      if (!mounted.current) return false;
      setPage((current) => ({
        ...current,
        logs: current.logs.map((l) => (l.id === id ? meta : l)),
      }));
      setReport((current) =>
        current && current.id === id ? { ...current, label: meta.label } : current,
      );
      setNotice({ kind: 'renamed', label: meta.label ?? label });
      setActionError('');
      return true;
    } catch (cause) {
      if (mounted.current) setActionError(String(cause));
      return false;
    }
  }, []);

  const remove = useCallback(
    async (ids: LogId[]) => {
      if (!ids.length) return;
      try {
        const count = await deleteLogs(ids);
        if (!mounted.current) return;
        setNotice({ kind: 'deleted', count });
        setActionError('');
        setSelected([]);
        if (activeId !== null && ids.includes(activeId)) await open(null);
        refresh();
      } catch (cause) {
        if (mounted.current) setActionError(String(cause));
      }
    },
    [activeId, open, refresh],
  );

  const exportLogs = useCallback(async (ids: LogId[]) => {
    const paths: string[] = [];
    try {
      for (const id of ids) paths.push(await exportLog(id));
      if (mounted.current) {
        setActionError('');
        setNotice({ kind: 'exported', paths });
      }
    } catch (cause) {
      if (mounted.current) {
        setActionError(String(cause));
        if (paths.length) setNotice({ kind: 'exportedBeforeError', paths });
      }
    }
  }, []);

  return {
    filters,
    setFilters: (next) => {
      setFilters(next);
      setOffset(0);
    },
    offset,
    setOffset,
    hasMore: page.hasMore,
    logs: page.logs,
    loading: native && page.key !== pageKey,
    error: actionError || page.error,
    notice,
    clearNotice: () => setNotice(null),
    selected,
    setSelected,
    fresh,
    activeId,
    report,
    reportLoading,
    reportError,
    open,
    rename,
    remove,
    exportLogs,
    refresh,
  };
}
