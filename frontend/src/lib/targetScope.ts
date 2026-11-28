import type { EntityId, OfflineSettings, ReportTotals, TargetMode } from '../types/offline';

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

/**
 * The targets a report's outgoing damage was counted against, as id text, or null when every
 * target counts: the All scope, a Bosses read of a fight that met no boss or dummy, or a
 * scope that is not known. Native's totals are already limited to these targets; a report's
 * events are not, so whatever is recomputed from them has to apply the same limit.
 */
export const scopedTargets = (
  report: Pick<ReportTotals, 'targets'> | null,
  mode: TargetMode | null | undefined,
): ReadonlySet<string> | null =>
  mode && reportScope(report, mode) === 'boss'
    ? new Set(bossTargets(report).map((x) => String(x.id)))
    : null;

/**
 * Whether an event aimed at `target` counts as outgoing damage in a scope (`scopedTargets`).
 * As native counts it: in the Bosses scope a damage hit or a cast counts only when it is
 * aimed at a boss or dummy, so one with no recorded target does not. Healing and damage
 * taken are never limited by the target scope; do not apply this to them.
 */
export const inTargetScope = (
  target: EntityId | null | undefined,
  targets: ReadonlySet<string> | null | undefined,
) => !targets || (target !== null && target !== undefined && targets.has(String(target)));
