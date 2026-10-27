import { useEffect, useState } from 'react';
import { listLogs } from '../services/offline';
import type { LogMeta } from '../types/offline';

/**
 * The newest saved fights, independent of the Logs tab's filters. Read once when shown and
 * again whenever the library grows or shrinks (`libraryCount` comes from the status poll the
 * workspace already runs), so it never polls on its own.
 */
export function useRecentLogs(native: boolean, libraryCount: number | null, limit = 40) {
  const [logs, setLogs] = useState<LogMeta[] | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    listLogs({ sort: 'newest', limit }).then(
      (rows) => {
        if (cancelled) return;
        setLogs(rows);
        setError('');
      },
      (cause: unknown) => {
        if (!cancelled) setError(String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native, libraryCount, limit]);
  return { logs, error };
}
