import type {
  AlertDashboard,
  ServerMaintenance,
  ServerStatusRow,
  ServerStatusSnapshot,
} from '../../types/alerts';

/*
 * Server maintenance as the official notice board publishes it. Native reads the notices
 * once a minute whatever the windows show; these helpers only word what it found. A
 * published window is a schedule, never a live check: outside it a server's state stays
 * unknown, and an old or failed check is uncertain rather than a reason to pause.
 */

/** How often native reads the notices; shown as the update cadence. */
export const NOTICE_CHECK_EVERY_MS = 60_000;
/** A check older than this is uncertain (native marks it stale too). */
export const NOTICE_FRESH_MS = 180_000;

export type NoticeCheck =
  /** Never checked successfully and no failure yet: the first check is under way. */
  | 'waiting'
  /** Never checked successfully; the last attempt failed. */
  | 'unreachable'
  /** Checked within the last three minutes. */
  | 'fresh'
  /** Checked once, but too long ago or the newest attempt failed. */
  | 'stale';

export type MaintenancePhase =
  /** Inside the announced window and not yet officially completed. */
  | 'now'
  /** Announced for later. */
  | 'next'
  /** The estimated end has passed, but the notice has not marked it complete. */
  | 'overdue'
  /** The official notice has marked it complete. */
  | 'completed'
  /** No window known. */
  | 'none';

export interface MaintenanceView {
  check: NoticeCheck;
  checkedMs: number | null;
  error: string | null;
  window: ServerMaintenance | null;
  phase: MaintenancePhase;
  /** Roster servers the window is announced for. */
  affected: number;
  total: number;
  /** The chosen or detected server, when known. */
  server: { id: string; name: string } | null;
  /** Whether that server is among the announced ones; null when no server or no list. */
  yoursListed: boolean | null;
  /**
   * The region reminders follow when the notices do not cover it (they list Global servers
   * only), so nothing here applies to it; null when covered or not known.
   */
  uncovered: string | null;
}

export function noticeCheck(snapshot: ServerStatusSnapshot, nowMs: number): NoticeCheck {
  const checked = snapshot.checked_ms;
  if (checked === null) return snapshot.error ? 'unreachable' : 'waiting';
  const age = nowMs - checked;
  return snapshot.stale || snapshot.error || age > NOTICE_FRESH_MS || age < -NOTICE_FRESH_MS
    ? 'stale'
    : 'fresh';
}

export function maintenancePhase(window: ServerMaintenance | null, nowMs: number) {
  if (!window) return 'none';
  if (window.completed) return 'completed';
  if (nowMs < window.starts_ms) return 'next';
  // Past the announced end without an official completion: neither over nor confirmed.
  return nowMs < window.ends_ms ? 'now' : 'overdue';
}

/** The server reminders follow: the chosen one, else the one detected in game. */
export function yourServer(dashboard: AlertDashboard) {
  const id = dashboard.config.server || dashboard.detected_server?.id || '';
  if (!id) return null;
  const name =
    dashboard.servers.find((s) => s.id === id)?.name ??
    dashboard.server_status.servers.find((s) => s.id === id)?.name ??
    (dashboard.detected_server?.id === id ? dashboard.detected_server.name : id);
  return { id, name };
}

const announced = (row: ServerStatusRow) => row.status === 'maintenance';

export function maintenanceView(dashboard: AlertDashboard, nowMs: number): MaintenanceView {
  const snapshot = dashboard.server_status;
  const phase = maintenancePhase(snapshot.maintenance, nowMs);
  const server = yourServer(dashboard);
  const rows = snapshot.servers;
  const affected = phase === 'now' ? rows.filter(announced).length : 0;
  const yours = server ? rows.find((r) => r.id === server.id) : undefined;
  const region = dashboard.effective_region;
  const covered =
    !region || region === 'global' || !rows.length || rows.some((r) => r.region === region);
  return {
    check: noticeCheck(snapshot, nowMs),
    checkedMs: snapshot.checked_ms,
    error: snapshot.error,
    window: phase === 'none' ? null : snapshot.maintenance,
    phase,
    affected,
    total: rows.length,
    server,
    yoursListed: affected && yours ? announced(yours) : null,
    uncovered: covered ? null : (dashboard.regions.find((r) => r.id === region)?.name ?? region),
  };
}
