import { invoke } from '@tauri-apps/api/core';
import type {
  UpdateAccessAction,
  UpdateAccessPhase,
  UpdateAccessStatus,
} from '../types/updateAccess';

/*
 * GitHub access for private release updates. Native finds the official GitHub CLI, asks it
 * whether it is signed in and whether that account can read this app's repository, and can
 * open the CLI's own browser sign-in in a window of its own. GitHub CLI keeps the sign-in;
 * no token, password or device code ever reaches this side. Status is a cached snapshot, so
 * reading it never runs the CLI; only Check access and sign-in do.
 */

const PHASES: readonly UpdateAccessPhase[] = [
  'unchecked',
  'checking',
  'signing_in',
  'checked',
  'development',
];

/** Phases where native is working and the view should poll quickly. */
export const BUSY_ACCESS_PHASES: readonly UpdateAccessPhase[] = ['checking', 'signing_in'];

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : null);
const fact = (value: unknown) => (typeof value === 'boolean' ? value : null);
const time = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

export function normalizeUpdateAccessStatus(value: unknown): UpdateAccessStatus {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Native returned no GitHub access status');
  const raw = value as Record<string, unknown>;
  if (!PHASES.includes(raw.phase as UpdateAccessPhase))
    throw new Error('Native returned no GitHub access phase');
  const phase = raw.phase as UpdateAccessPhase;
  const development = phase === 'development';
  return {
    phase,
    cli_installed: development ? null : fact(raw.cli_installed),
    authenticated: development ? null : fact(raw.authenticated),
    repository_access: development ? null : fact(raw.repository_access),
    checked_ms: time(raw.checked_ms),
    error: text(raw.error),
    login_supported: !development && raw.login_supported === true,
    repository: text(raw.repository) ?? 'nicholascostadev/aion-companion-public',
  };
}

/** The cached result of the last probe; never runs the GitHub CLI. */
export const readUpdateAccessStatus = (): Promise<UpdateAccessStatus> =>
  invoke<unknown>('updates_access_status').then(normalizeUpdateAccessStatus);

const COMMANDS: Record<UpdateAccessAction, string> = {
  check: 'updates_access_check',
  login: 'updates_access_login',
};

/** Probe access now, or open GitHub CLI's sign-in window. Native rejects overlapping steps. */
export const runUpdateAccessAction = (action: UpdateAccessAction): Promise<UpdateAccessStatus> =>
  invoke<unknown>(COMMANDS[action]).then(normalizeUpdateAccessStatus);
