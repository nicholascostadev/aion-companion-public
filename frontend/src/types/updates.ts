import type { BuildChannel } from './buildInfo';
import type { SetupDistribution } from './setup';

/** Native update lifecycle, driven entirely by the desktop app. */
export type UpdatePhase =
  | 'development'
  | 'idle'
  | 'checking'
  | 'current'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'restarting'
  | 'error';

/** `updates_status`, `updates_check`, `updates_download` and `updates_install` all return this. */
export interface UpdateStatus {
  channel: BuildChannel;
  current_version: string;
  latest_version: string | null;
  phase: UpdatePhase;
  error: string | null;
  checked_ms: number | null;
  release_url: string | null;
  notes: string | null;
  restart_supported: boolean;
  repository: string;
  /**
   * Whether releases were found public or private, as the updater itself learned it; present
   * only when native says. It outranks the setup probe, which may have run before the first
   * update check.
   */
  distribution?: SetupDistribution;
}

export type UpdateAction = 'check' | 'download' | 'install';

/** What the Updates panel needs from `useUpdates`. */
export interface UpdatesState {
  status: UpdateStatus | null;
  /** The update service could not be reached or rejected a step. */
  error: string;
  pending: UpdateAction | null;
  /** A step is running here or natively; no other step may start. */
  busy: boolean;
  check: () => Promise<boolean>;
  download: () => Promise<boolean>;
  install: () => Promise<boolean>;
}
