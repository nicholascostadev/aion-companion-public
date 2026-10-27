import { BACKUP_PARTS, type BackupOptions } from '../types/backups';
import { BACKUP, FAILING, FRESH } from './mockScenario';

/*
 * DEV ONLY. Backup and restore commands for the mock runtime. No dialog opens and nothing
 * is read or written: a backup "saves" to a fixed path, a restore file is a fixed example,
 * and restoring only marks a restore as waiting (the preview never quits).
 */

type Args = Record<string, unknown>;

const MIB = 1024 * 1024;
const LIMITS = {
  archive_bytes: 128 * MIB,
  total_bytes: 64 * MIB,
  file_bytes: 32 * MIB,
  files: 1000,
};
const CANCEL = BACKUP === 'cancel';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

const LOGS = Array.from({ length: BACKUP === 'large' ? 1200 : FRESH ? 0 : 38 }, (_, index) => ({
  path: `offline/logs/${1_760_900_000_000 + index * 3_600_000}.json`,
  bytes: 48_000 + ((index * 7919) % 160_000),
}));

const FILES: Record<(typeof BACKUP_PARTS)[number], { path: string; bytes: number }[]> = {
  settings: [{ path: 'offline/settings.json', bytes: 6_420 }],
  pets: FRESH ? [] : [{ path: 'offline/pets.json', bytes: 41_890 }],
  logs: LOGS,
};

let pendingRestore = false;
let held: string | null = null;

const parts = (value: unknown): BackupOptions => {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(
    BACKUP_PARTS.map((part) => [part, raw[part] === true]),
  ) as BackupOptions;
};

function plan({ options }: Args) {
  const chosen = parts(options);
  const files = BACKUP_PARTS.flatMap((part) => (chosen[part] ? FILES[part] : []));
  return { files, total_bytes: files.reduce((sum, file) => sum + file.bytes, 0) };
}

export const backupCommands: Record<string, (args: Args) => unknown> = {
  backups_status: () => ({
    channel: 'development',
    limits: LIMITS,
    pending_restore: pendingRestore,
    last_recovery:
      BACKUP === 'restored'
        ? {
            phase: 'restored',
            message:
              'The selected native files were restored. A rollback copy is retained in the recovery folder.',
          }
        : BACKUP === 'rolled-back'
          ? {
              phase: 'rolled_back',
              message:
                'Restore failed and original files were restored: offline/pets.json could not be replaced (mock).',
            }
          : null,
  }),
  backups_plan: async (args) => {
    await wait(250);
    return plan(args);
  },
  backups_export: async (args) => {
    await wait(900);
    if (CANCEL) return null;
    const { files, total_bytes } = plan(args);
    return {
      path: 'C:/Users/Player/Documents/aion-companion-2026-10-20.aion-backup.json',
      files: files.length,
      total_bytes,
      archive_bytes: Math.round(total_bytes * 1.08) + 2_048,
    };
  },
  backups_preview: async () => {
    held = null;
    await wait(900);
    if (CANCEL) return null;
    if (FAILING) throw new Error('Checksum mismatch for offline/pets.json (mock)');
    held = `mock-${Date.now()}`;
    const logs = LOGS.slice(0, 12).map((file, index) => ({ ...file, will_replace: index < 9 }));
    const files = [
      { path: 'offline/settings.json', bytes: 6_102, will_replace: true },
      { path: 'offline/pets.json', bytes: 39_744, will_replace: !FRESH },
      ...logs,
    ];
    return {
      token: held,
      created_ms: Date.now() - 3 * 86_400_000 - 2 * 3_600_000,
      app_version: '0.7.9',
      channel: 'development',
      files,
      total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
    };
  },
  backups_restore: async ({ token }) => {
    await wait(700);
    if (!held || token !== held)
      throw new Error('The backup preview expired; choose the file again');
    held = null;
    pendingRestore = true;
    return { restart_required: true };
  },
  backups_cancel: () => {
    held = null;
    return null;
  },
};
