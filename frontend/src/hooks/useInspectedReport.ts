import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from '../i18n/provider';
import { targetMode } from '../lib/targetScope';
import { inspectReport, readOfflineLiveStatus } from '../services/offline';
import { onUiPreferencesChanged } from '../services/uiPreferences';
import type { DetailsSelection } from '../types/companion';
import type { CombatReport, InspectedReport, OfflineSettings, TargetMode } from '../types/offline';

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
 *
 * The fight is read in the stored target scope. A changed scope drops the report, so it is
 * never shown under the wrong scope, and reads the same fight again in the new one; the
 * pinned fight and pause state stay as they are.
 */
export function useInspectedReport(
  selection: DetailsSelection | null,
  native: boolean,
  visible: boolean,
): InspectedReport {
  const { t } = useTranslation('live');
  const [reportId, setReportId] = useState<string | null>(null);
  const [report, setReport] = useState<CombatReport | null>(null);
  const [scope, setScope] = useState<TargetMode | null>(null);
  const [settings, setSettings] = useState<OfflineSettings | null>(null);
  const [error, setError] = useState<Problem>(null);
  const [stale, setStale] = useState<Problem>(null);
  const [following, setFollowing] = useState(true);
  const revision = selection?.revision ?? null;
  const selectedId = selection?.report_id ?? null;
  /**
   * Generation whose results may still be applied. Every selection or scope gets a new one,
   * so going back to an earlier selection and scope never accepts its old replies.
   */
  const current = useRef<number | null>(null);
  const generations = useRef(0);
  /** Generation with a request in flight; a newer selection or scope is never blocked by it. */
  const inflight = useRef<number | null>(null);
  const shown = useRef(false);
  /** Settings reads in the order they were made: an older reply never replaces a newer one. */
  const reads = useRef<{ made: number; applied: number; settings: OfflineSettings | null }>({
    made: 0,
    applied: 0,
    settings: null,
  });
  const applySettings = useCallback((at: number, next: OfflineSettings | null) => {
    if (at <= reads.current.applied) return;
    reads.current = { ...reads.current, applied: at, settings: next };
    setSettings(next);
  }, []);

  // A new selection starts over, adjusted during render.
  const [seen, setSeen] = useState(revision);
  if (seen !== revision) {
    setSeen(revision);
    setReportId(null);
    setReport(null);
    setScope(null);
    setError(null);
    setStale(null);
    setFollowing(true);
  }
  // A changed target scope drops the report read in the old one.
  const mode = targetMode(settings);
  if (scope !== null && scope !== mode) {
    setScope(mode);
    setReport(null);
    setError(null);
    setStale(null);
  }

  const load = useCallback(async (id: string, generation: number, bossOnly: boolean) => {
    if (inflight.current === generation) return;
    inflight.current = generation;
    try {
      const next = await inspectReport(id, bossOnly);
      if (current.current !== generation) return;
      if (next.id !== null && next.id !== id) throw new OtherFight();
      shown.current = true;
      setReport(next);
      setStale(null);
      setError(null);
    } catch (cause) {
      if (current.current !== generation) return;
      const problem: Problem =
        cause instanceof OtherFight
          ? { code: 'mismatch' }
          : { code: 'native', detail: String(cause) };
      // Keep whatever was already shown; never fall back to another fight.
      if (shown.current) setStale(problem);
      else setError(problem);
      setFollowing(false);
    } finally {
      if (inflight.current === generation) inflight.current = null;
    }
  }, []);

  useEffect(() => {
    current.current = null;
    if (!native || revision === null) return;
    let cancelled = false;
    void (async () => {
      // Settings (privacy, target scope) and, if the row had none, the fight current now:
      // the compact status is enough, the fight itself comes in full from `offline_inspect`.
      // A newer settings read may answer first; its settings and scope then stay.
      const at = ++reads.current.made;
      const status = await readOfflineLiveStatus().catch(() => null);
      if (cancelled) return;
      applySettings(at, status?.settings ?? null);
      const id = selectedId ?? status?.report?.id ?? null;
      if (!id) {
        setError({ code: 'noReport' });
        return;
      }
      setScope(targetMode(reads.current.settings));
      setReportId(id);
    })();
    return () => {
      cancelled = true;
    };
  }, [native, revision, selectedId, applySettings]);

  // The pinned fight, read once per selection and scope.
  const request = revision !== null && scope !== null ? `${revision}|${scope}` : null;
  const bossOnly = scope === 'boss';
  useEffect(() => {
    if (!native || !reportId || !request) return;
    const generation = ++generations.current;
    current.current = generation;
    shown.current = false;
    void (async () => {
      await load(reportId, generation, bossOnly);
    })();
  }, [native, reportId, request, bossOnly, load]);

  // Settings may change while the panel is hidden (privacy or target scope in the
  // workspace): showing it again re-reads them, and while visible every saved settings
  // change does. The pinned fight and pause state stay as they are.
  useEffect(() => {
    if (!native || !visible) return;
    let cancelled = false;
    const refresh = () => {
      const at = ++reads.current.made;
      void readOfflineLiveStatus().then(
        (status) => {
          if (!cancelled && status.settings) applySettings(at, status.settings);
        },
        () => {
          // Keep the last settings; the next change or show retries.
        },
      );
    };
    refresh();
    const listening = onUiPreferencesChanged(refresh).catch(() => null);
    return () => {
      cancelled = true;
      void listening.then((stop) => stop?.());
    };
  }, [native, visible, applySettings]);

  const ended = report !== null && report.end_reason !== null;
  const updating = following && visible && !ended && reportId !== null && report !== null;
  useEffect(() => {
    if (!updating || !reportId || !request) return;
    const timer = setInterval(() => {
      const generation = current.current;
      if (generation !== null) void load(reportId, generation, bossOnly);
    }, FOLLOW_MS);
    return () => clearInterval(timer);
  }, [updating, reportId, request, bossOnly, load]);

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
    scope: report ? scope : null,
    settings,
    loading: native && revision !== null && report === null && error === null,
    error: word(error),
    stale: word(stale),
    following: following && !ended,
    updating,
    setFollowing,
  };
}
