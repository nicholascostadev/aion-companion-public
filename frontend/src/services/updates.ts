import { invoke } from '@tauri-apps/api/core';
import type { UpdateAction, UpdatePhase, UpdateStatus } from '../types/updates';

/*
 * App updates from this app's own GitHub releases. Native reads public releases over HTTPS
 * and reuses GitHub CLI sign-in for private releases, verifies downloads and keeps going
 * if this view goes away; the
 * frontend only reads status and asks for the next step. No gameplay data is sent.
 */

const PHASES: readonly UpdatePhase[] = [
  'development',
  'idle',
  'checking',
  'current',
  'available',
  'downloading',
  'ready',
  'restarting',
  'error',
];

/** Phases where native is working and the view should poll quickly. */
export const BUSY_PHASES: readonly UpdatePhase[] = ['checking', 'downloading', 'restarting'];

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const time = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export function normalizeUpdateStatus(value: unknown): UpdateStatus {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const current = text(raw.current_version);
  if (!current) throw new Error('Native returned no update status');
  const development = raw.channel === 'development' || raw.phase === 'development';
  const phase = development
    ? 'development'
    : PHASES.includes(raw.phase as UpdatePhase)
      ? (raw.phase as UpdatePhase)
      : 'idle';
  return {
    channel: development ? 'development' : 'stable',
    current_version: current,
    latest_version: development ? null : text(raw.latest_version),
    phase,
    error: text(raw.error),
    checked_ms: time(raw.checked_ms),
    release_url: text(raw.release_url),
    notes: text(raw.notes),
    restart_supported: !development && raw.restart_supported === true,
    repository: text(raw.repository) ?? 'nicholascostadev/aion-companion-public',
    ...(!development && (raw.distribution === 'public' || raw.distribution === 'private')
      ? { distribution: raw.distribution }
      : {}),
  };
}

export const readUpdateStatus = (): Promise<UpdateStatus> =>
  invoke<unknown>('updates_status').then(normalizeUpdateStatus);

const COMMANDS: Record<UpdateAction, string> = {
  check: 'updates_check',
  download: 'updates_download',
  install: 'updates_install',
};

/** Check, download or restart into the staged version. Native rejects a step out of order. */
export const runUpdateAction = (action: UpdateAction): Promise<UpdateStatus> =>
  invoke<unknown>(COMMANDS[action]).then(normalizeUpdateStatus);
