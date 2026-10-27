import { invoke } from '@tauri-apps/api/core';
import type {
  BackupExport,
  BackupFile,
  BackupLimits,
  BackupOptions,
  BackupPlan,
  BackupPreview,
  BackupPreviewFile,
  BackupRecovery,
  BackupStatus,
} from '../types/backups';

/*
 * Backups of this app's own saved state. Native opens the Windows file dialogs, validates
 * every file, writes atomically and applies a restore only after a restart, before capture
 * starts. A reply this side cannot read in full is an error, never a partial preview.
 */

type Raw = Record<string, unknown>;

const record = (value: unknown, what: string): Raw => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`Native returned no ${what}`);
  return value as Raw;
};

const text = (value: unknown, what: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Native returned no ${what}`);
  return value;
};

const size = (value: unknown, what: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`Native returned an invalid ${what}`);
  return value;
};

function files<T extends BackupFile>(
  value: unknown,
  extra: (raw: Raw) => Omit<T, keyof BackupFile>,
) {
  if (!Array.isArray(value)) throw new Error('Native returned no file list');
  return value.map((item) => {
    const raw = record(item, 'file');
    return {
      path: text(raw.path, 'file path'),
      bytes: size(raw.bytes, 'file size'),
      ...extra(raw),
    } as T;
  });
}

function limits(value: unknown): BackupLimits {
  const raw = record(value, 'backup limits');
  return {
    archive_bytes: size(raw.archive_bytes, 'backup size limit'),
    total_bytes: size(raw.total_bytes, 'total size limit'),
    file_bytes: size(raw.file_bytes, 'file size limit'),
    files: size(raw.files, 'file count limit'),
  };
}

function recovery(value: unknown): BackupRecovery | null {
  if (value === null || value === undefined) return null;
  const raw = record(value, 'recovery result');
  return {
    phase: typeof raw.phase === 'string' ? raw.phase : '',
    message: typeof raw.message === 'string' ? raw.message : '',
  };
}

export function normalizeBackupStatus(value: unknown): BackupStatus {
  const raw = record(value, 'backup status');
  return {
    channel: text(raw.channel, 'build channel'),
    limits: limits(raw.limits),
    pending_restore: raw.pending_restore === true,
    last_recovery: recovery(raw.last_recovery),
  };
}

export function normalizeBackupPlan(value: unknown): BackupPlan {
  const raw = record(value, 'backup estimate');
  return { files: files(raw.files, () => ({})), total_bytes: size(raw.total_bytes, 'total size') };
}

/** `null` is a cancelled Save dialog. */
export function normalizeBackupExport(value: unknown): BackupExport | null {
  if (value === null || value === undefined) return null;
  const raw = record(value, 'backup result');
  return {
    path: text(raw.path, 'backup path'),
    files: size(raw.files, 'file count'),
    total_bytes: size(raw.total_bytes, 'total size'),
    archive_bytes: size(raw.archive_bytes, 'backup size'),
  };
}

/** `null` is a cancelled Open dialog. */
export function normalizeBackupPreview(value: unknown): BackupPreview | null {
  if (value === null || value === undefined) return null;
  const raw = record(value, 'backup preview');
  const created = raw.created_ms;
  if (typeof created !== 'number' || !Number.isFinite(created) || created <= 0)
    throw new Error('Native returned an invalid backup date');
  return {
    token: text(raw.token, 'preview token'),
    created_ms: created,
    app_version: text(raw.app_version, 'backup version'),
    channel: text(raw.channel, 'backup channel'),
    files: files<BackupPreviewFile>(raw.files, (file) => ({
      will_replace: file.will_replace === true,
    })),
    total_bytes: size(raw.total_bytes, 'total size'),
  };
}

export const readBackupStatus = (): Promise<BackupStatus> =>
  invoke<unknown>('backups_status').then(normalizeBackupStatus);

export const planBackup = (options: BackupOptions): Promise<BackupPlan> =>
  invoke<unknown>('backups_plan', { options }).then(normalizeBackupPlan);

/** Opens the Save dialog and writes the backup; `null` when the dialog was cancelled. */
export const exportBackup = (options: BackupOptions): Promise<BackupExport | null> =>
  invoke<unknown>('backups_export', { options }).then(normalizeBackupExport);

/** Opens the Open dialog, validates the file and holds it; `null` when cancelled. */
export const previewBackup = (): Promise<BackupPreview | null> =>
  invoke<unknown>('backups_preview').then(normalizeBackupPreview);

/** Stages the held preview and closes the app; native restarts it and restores first. */
export const restoreBackup = async (token: string): Promise<void> => {
  const raw = record(await invoke<unknown>('backups_restore', { token }), 'restore result');
  if (raw.restart_required !== true) throw new Error('Native did not stage the restore');
};

/** Forgets the held preview. Never touches a restore already staged. */
export const cancelBackupPreview = (): Promise<void> =>
  invoke<unknown>('backups_cancel').then(() => undefined);
