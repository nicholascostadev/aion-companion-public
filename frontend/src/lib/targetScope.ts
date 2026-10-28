import type { OfflineSettings, ReportTotals, TargetMode } from '../types/offline';

/** The stored target scope; every target counts until settings say otherwise. */
export const targetMode = (settings: Pick<OfflineSettings, 'target_mode'> | null): TargetMode =>
  settings?.target_mode ?? 'all';

/** Bosses and training dummies a report met. */
export const bossTargets = (report: Pick<ReportTotals, 'targets'> | null) =>
  (report?.targets ?? []).filter((x) => x.boss === true || x.dummy === true);

/**
 * The scope a report was aggregated with: the Bosses scope counts only bosses and dummies
 * while the fight met any, and native falls back to every target otherwise.
 */
export const reportScope = (
  report: Pick<ReportTotals, 'targets'> | null,
  mode: TargetMode,
): TargetMode => (mode === 'boss' && bossTargets(report).length > 0 ? 'boss' : 'all');
