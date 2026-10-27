/*
 * Backups of this app's own saved state, made and restored by native. The frontend only
 * chooses what to include, shows native's estimate and preview, and asks for the restart.
 */

/** The parts a backup can hold, in the order they are offered. */
export const BACKUP_PARTS = ['settings', 'pets', 'logs'] as const;
export type BackupPart = (typeof BACKUP_PARTS)[number];

/** Which parts to include: `backups_plan` and `backups_export` take this as `options`. */
export type BackupOptions = Record<BackupPart, boolean>;

/** Settings and pet farming are small and included by default; logs are not. */
export const DEFAULT_BACKUP_OPTIONS: BackupOptions = {
  settings: true,
  pets: true,
  logs: false,
};

/** Native's hard limits for one backup. */
export interface BackupLimits {
  /** Largest backup file, as written. */
  archive_bytes: number;
  /** Largest sum of the files inside. */
  total_bytes: number;
  /** Largest single file inside. */
  file_bytes: number;
  /** Most files inside. */
  files: number;
}

/** What happened to a restore staged before this start. */
export interface BackupRecovery {
  /** `restored`, `rolled_back` or `failed`; anything else is shown as its message. */
  phase: string;
  /** Native detail, shown as it is. */
  message: string;
}

/** `backups_status`. */
export interface BackupStatus {
  /** This build's channel (`stable` or `development`); backups never cross channels. */
  channel: string;
  limits: BackupLimits;
  /** A restore is staged and applies on the next start. */
  pending_restore: boolean;
  last_recovery: BackupRecovery | null;
}

/** One saved file, by its path inside the app's data folder (`offline/pets.json`). */
export interface BackupFile {
  path: string;
  bytes: number;
}

/** `backups_plan`: the files a backup would hold now. An estimate; capture keeps running. */
export interface BackupPlan {
  files: BackupFile[];
  total_bytes: number;
}

/** `backups_export`, when a file was written. */
export interface BackupExport {
  path: string;
  files: number;
  total_bytes: number;
  archive_bytes: number;
}

export interface BackupPreviewFile extends BackupFile {
  /** A file of that name exists here now and would be replaced; otherwise it is added. */
  will_replace: boolean;
}

/** `backups_preview`: a chosen file, validated by native and held under `token`. */
export interface BackupPreview {
  token: string;
  created_ms: number;
  app_version: string;
  channel: string;
  files: BackupPreviewFile[];
  total_bytes: number;
}

/** The step running now; only one runs at a time. */
export type BackupAction = 'export' | 'preview' | 'restore' | 'cancel';

/** The latest backup attempt, worded at render. */
export type BackupExportOutcome =
  | { kind: 'saved'; result: BackupExport }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error: string };

/** The latest restore step, worded at render. */
export type BackupRestoreOutcome =
  | { kind: 'cancelled' }
  | { kind: 'failed'; step: 'preview' | 'restore'; error: string }
  | { kind: 'staged' };

/** What the backups surface needs from `useBackups`. */
export interface BackupsState {
  status: BackupStatus | null;
  /** The backup service could not be read. */
  statusError: string;
  options: BackupOptions;
  setOption: (part: BackupPart, on: boolean) => void;
  plan: BackupPlan | null;
  /** The plan is being read for the current options. */
  planning: boolean;
  planError: string;
  pending: BackupAction | null;
  exported: BackupExportOutcome | null;
  preview: BackupPreview | null;
  restore: BackupRestoreOutcome | null;
  /** Asks for a destination and writes a backup of the chosen parts. */
  exportBackup: () => Promise<void>;
  /** Asks for a backup file and previews it; never restores. */
  choosePreview: () => Promise<void>;
  /** Stages the shown preview and restarts; the token must be the one shown. */
  applyRestore: (token: string) => Promise<void>;
  /** Forgets the shown preview here and natively. */
  discardPreview: () => Promise<void>;
  dismissExport: () => void;
  dismissRestore: () => void;
}
