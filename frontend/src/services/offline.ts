import { invoke } from '@tauri-apps/api/core';
import {
  normalizeCatalogue,
  normalizeLogList,
  normalizeLiveStatus,
  normalizeLogMeta,
  normalizeReport,
  normalizeSettings,
  normalizeStatus,
} from '../lib/offlineNormalize';
import type {
  CatalogueSummary,
  CombatReport,
  LogId,
  LogMeta,
  LogQuery,
  OfflineActionName,
  OfflineLiveStatus,
  OfflineSettings,
  OfflineStatus,
  PolledOfflineStatus,
  ReportDetailLevel,
} from '../types/offline';

/* Local-only native commands from docs/OFFLINE_API.md. Nothing here touches the network. */

function required<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`Native returned no ${what}`);
  return value;
}

/**
 * Status with the live report's bounded events, buffs and HP samples. Only a visible view
 * that draws them (live analysis) reads this; everything else polls the summary below.
 */
export const readOfflineStatus = (): Promise<OfflineStatus> =>
  invoke<unknown>('offline_status').then(normalizeStatus);

/** The same status with a compact live report: aggregates and HP endpoints, no events or buffs. */
export const readOfflineLiveStatus = (): Promise<OfflineLiveStatus> =>
  invoke<unknown>('offline_live_status').then(normalizeLiveStatus);

export const configureOffline = (settings: OfflineSettings): Promise<OfflineSettings> =>
  invoke<unknown>('offline_configure', { settings }).then((value) =>
    required(normalizeSettings(value), 'settings'),
  );

/** Undefined filters are dropped so native sees only what the user set. */
export function listLogs(query: LogQuery): Promise<LogMeta[]> {
  const clean = Object.fromEntries(
    Object.entries(query).filter(([, value]) => value !== undefined && value !== ''),
  );
  return invoke<unknown>('offline_logs', { query: clean }).then(normalizeLogList);
}

/**
 * A saved fight. `bossOnly` has native re-aggregate it against its boss and dummy targets
 * (every target when it met none), matching the Bosses target scope; by default every
 * target counts. Pass the stored `target_mode === 'boss'`.
 */
export const readLog = (id: LogId, bossOnly = false): Promise<CombatReport> =>
  invoke<unknown>('offline_log', { id, bossOnly }).then((value) =>
    required(normalizeReport(value), 'log'),
  );

/**
 * Full report of exactly this fight: while it is the current fight every event is
 * included, afterwards the saved log. Native rejects an id it cannot find rather than
 * returning another fight. `bossOnly` scopes it like `readLog`.
 */
export const inspectReport = (id: LogId, bossOnly = false): Promise<CombatReport> =>
  invoke<unknown>('offline_inspect', { id, bossOnly }).then((value) =>
    required(normalizeReport(value), 'report'),
  );

export const renameLog = (id: LogId, label: string): Promise<LogMeta> =>
  invoke<unknown>('offline_log_rename', { id, label }).then((value) =>
    required(normalizeLogMeta(value), 'log metadata'),
  );

export const deleteLogs = (ids: LogId[]): Promise<number> =>
  invoke<number>('offline_log_delete', { ids });

export const exportLog = (id: LogId): Promise<string> => invoke<string>('offline_export', { id });

export const importCatalogue = (json: string): Promise<CatalogueSummary> =>
  invoke<unknown>('offline_catalogue_import', { json }).then((value) =>
    required(normalizeCatalogue(value), 'catalogue summary'),
  );

/**
 * Native Windows clipboard: no DOM selection or focus, so a locked, no-activate meter can
 * copy without taking focus from the game. Native rejects text over 1 MiB.
 */
export const copyTextNative = (text: string): Promise<void> =>
  invoke<void>('offline_copy_text', { text });

/** `id: null` summarizes the live report. */
export const readSummary = (id: LogId | null, multiline: boolean): Promise<string> =>
  invoke<string>('offline_summary', { id, multiline });

/**
 * Runs an action and answers with the status after it: a summary unless `'full'` is asked
 * for, so a mutation does not ship report details nothing will draw.
 */
export function runOfflineAction(
  action: OfflineActionName,
  detail: ReportDetailLevel = 'summary',
): Promise<PolledOfflineStatus> {
  const summary = detail === 'summary';
  return invoke<unknown>('offline_action', { action, summary }).then(
    (value): PolledOfflineStatus => (summary ? normalizeLiveStatus(value) : normalizeStatus(value)),
  );
}

/** Patch-only save of dragged bar positions into the current native settings. */
export const saveTrackerPositions = (
  presetId: string,
  positions: { bar_id: string; x: number; y: number }[],
): Promise<OfflineSettings> =>
  invoke<unknown>('offline_positions', { presetId, positions }).then((value) =>
    required(normalizeSettings(value), 'settings'),
  );
