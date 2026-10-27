import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/provider';
import { inspectReport, readOfflineLiveStatus } from '../services/offline';
import type { DetailsSelection } from '../types/companion';
import type { CombatReport, InspectedReport, OfflineSettings } from '../types/offline';

/** Full reports are rebuilt natively on every refresh, so live updates stay modest. */
export const FOLLOW_MS = 2000;

/**
 * Why the fight could not be shown, kept as a fact and worded on render so it follows a
 * language change. Native failures keep their own text.
 */
type Problem = { code: 'mismatch' | 'noReport' } | { code: 'native'; detail: string } | null;

/** Native answered with a fight other than the one asked for. */
class OtherFight extends Error {}

/**
 * Loads the full native report of the selected fight and keeps it. While that same fight
 * is still recording and the panel is visible it can refresh; once it ends or cannot be
 * read the last snapshot stays on screen. A newer fight never replaces it: only a new
 * selection does. Hiding the panel (closed or focus-hidden) pauses refreshes and keeps
 * the snapshot for when it shows again.
 */
export function useInspectedReport(
  selection: DetailsSelection | null,
  native: boolean,
  visible: boolean,
): InspectedReport {
  const { t } = useTranslation('live');
  const [reportId, setReportId] = useState<string | null>(null);
  const [report, setReport] = useState<CombatReport | null>(null);
  const [settings, setSettings] = useState<OfflineSettings | null>(null);
  const [error, setError] = useState<Problem>(null);
  const [stale, setStale] = useState<Problem>(null);
  const [following, setFollowing] = useState(true);
  const revision = selection?.revision ?? null;
  const selectedId = selection?.report_id ?? null;
  /** Selection whose results may still be applied. */
  const current = useRef(revision);
  /** Selection with a request in flight; a newer selection is never blocked by it. */
  const inflight = useRef<number | null | undefined>(undefined);
  const shown = useRef(false);

  // A new selection starts over, adjusted during render.
  const [seen, setSeen] = useState(revision);
  if (seen !== revision) {
    setSeen(revision);
    setReportId(null);
    setReport(null);
    setError(null);
    setStale(null);
    setFollowing(true);
  }

  const load = useCallback(async (id: string, request: number | null) => {
    if (inflight.current === request) return;
    inflight.current = request;
    try {
      const next = await inspectReport(id);
      if (current.current !== request) return;
      if (next.id !== null && next.id !== id) throw new OtherFight();
      shown.current = true;
      setReport(next);
      setStale(null);
      setError(null);
    } catch (cause) {
      if (current.current !== request) return;
      const problem: Problem =
        cause instanceof OtherFight
          ? { code: 'mismatch' }
          : { code: 'native', detail: String(cause) };
      // Keep whatever was already shown; never fall back to another fight.
      if (shown.current) setStale(problem);
      else setError(problem);
      setFollowing(false);
    } finally {
      if (inflight.current === request) inflight.current = undefined;
    }
  }, []);

  useEffect(() => {
    current.current = revision;
    shown.current = false;
    if (!native || revision === null) return;
    let cancelled = false;
    void (async () => {
      // Settings (privacy, DPS mode) and, if the row had none, the fight current now: the
      // compact status is enough, the fight itself comes in full from `offline_inspect`.
      const status = await readOfflineLiveStatus().catch(() => null);
      if (cancelled) return;
      setSettings(status?.settings ?? null);
      const id = selectedId ?? status?.report?.id ?? null;
      if (!id) {
        setError({ code: 'noReport' });
        return;
      }
      setReportId(id);
      await load(id, revision);
    })();
    return () => {
      cancelled = true;
    };
  }, [native, revision, selectedId, load]);

  // Settings may change while the panel is hidden (e.g. privacy in the workspace). Showing
  // it again re-reads them; the pinned fight, snapshot and pause state stay as they are.
  useEffect(() => {
    if (!native || !visible) return;
    let cancelled = false;
    void readOfflineLiveStatus().then(
      (status) => {
        if (!cancelled && status.settings) setSettings(status.settings);
      },
      () => {
        // Keep the last settings; the next show retries.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [native, visible]);

  const ended = report !== null && report.end_reason !== null;
  const updating = following && visible && !ended && reportId !== null && report !== null;
  useEffect(() => {
    if (!updating || !reportId) return;
    const timer = setInterval(() => void load(reportId, revision), FOLLOW_MS);
    return () => clearInterval(timer);
  }, [updating, reportId, revision, load]);

  const word = (problem: Problem) =>
    !problem
      ? ''
      : problem.code === 'native'
        ? problem.detail
        : problem.code === 'mismatch'
          ? t(($) => $.history.nativeMismatch)
          : t(($) => $.details.noReport);

  return {
    reportId,
    report,
    settings,
    loading: native && revision !== null && report === null && error === null,
    error: word(error),
    stale: word(stale),
    following: following && !ended,
    updating,
    setFollowing,
  };
}
