import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  cancelBackupPreview,
  exportBackup,
  normalizeBackupPlan,
  normalizeBackupPreview,
  normalizeBackupStatus,
  planBackup,
  previewBackup,
  restoreBackup,
} from './backups';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<(command: string, args?: unknown) => Promise<unknown>>(),
}));

afterEach(() => vi.resetAllMocks());

const MIB = 1024 * 1024;
const limits = {
  archive_bytes: 128 * MIB,
  total_bytes: 64 * MIB,
  file_bytes: 32 * MIB,
  files: 1000,
};
const options = { settings: true, pets: true, logs: false };
const preview = {
  token: 'abc',
  created_ms: 1_760_000_000_000,
  app_version: '0.7.9',
  channel: 'stable',
  files: [
    { path: 'offline/settings.json', bytes: 10, will_replace: true },
    { path: 'offline/logs/1.json', bytes: 20, will_replace: false },
  ],
  total_bytes: 30,
};

describe('backup status', () => {
  it('reads the channel, limits, a waiting restore and the last recovery', () => {
    expect(
      normalizeBackupStatus({
        channel: 'stable',
        limits,
        pending_restore: true,
        last_recovery: { phase: 'rolled_back', message: 'detail' },
      }),
    ).toEqual({
      channel: 'stable',
      limits,
      pending_restore: true,
      last_recovery: { phase: 'rolled_back', message: 'detail' },
    });
  });

  it('treats anything but true as no waiting restore', () => {
    const status = normalizeBackupStatus({ channel: 'development', limits, pending_restore: 1 });
    expect(status.pending_restore).toBe(false);
    expect(status.last_recovery).toBeNull();
  });

  it('refuses a status without limits or channel', () => {
    expect(() => normalizeBackupStatus({ channel: 'stable' })).toThrow(/limits/);
    expect(() => normalizeBackupStatus({ limits })).toThrow(/channel/);
    expect(() => normalizeBackupStatus(null)).toThrow(/backup status/);
  });
});

describe('backup estimate', () => {
  it('sends the chosen parts and reads the files', async () => {
    vi.mocked(invoke).mockResolvedValue({
      files: [{ path: 'offline/settings.json', bytes: 12 }],
      total_bytes: 12,
    });
    await expect(planBackup(options)).resolves.toEqual({
      files: [{ path: 'offline/settings.json', bytes: 12 }],
      total_bytes: 12,
    });
    expect(invoke).toHaveBeenCalledWith('backups_plan', { options });
  });

  it.each([
    { files: [{ path: '', bytes: 1 }], total_bytes: 1 },
    { files: [{ path: 'a', bytes: -1 }], total_bytes: 1 },
    { files: [{ path: 'a', bytes: 1.5 }], total_bytes: 1 },
    { files: 'nope', total_bytes: 1 },
    { files: [], total_bytes: Number.NaN },
  ])('refuses a malformed estimate %#', (raw) => {
    expect(() => normalizeBackupPlan(raw)).toThrow(/Native returned/);
  });
});

describe('backup export', () => {
  it('is null when the Save dialog was cancelled', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(exportBackup(options)).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('backups_export', { options });
  });

  it('reads where the backup was written', async () => {
    const written = {
      path: 'D:/b.aion-backup.json',
      files: 2,
      total_bytes: 30,
      archive_bytes: 900,
    };
    vi.mocked(invoke).mockResolvedValue(written);
    await expect(exportBackup(options)).resolves.toEqual(written);
  });

  it('passes native errors through as they are', async () => {
    vi.mocked(invoke).mockRejectedValue('Not enough free space');
    await expect(exportBackup(options)).rejects.toBe('Not enough free space');
  });
});

describe('backup preview', () => {
  it('is null when the Open dialog was cancelled', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(previewBackup()).resolves.toBeNull();
    expect(invoke).toHaveBeenCalledWith('backups_preview');
  });

  it('reads every file and whether it replaces one here', () => {
    expect(normalizeBackupPreview(preview)).toEqual(preview);
    const loose = normalizeBackupPreview({
      ...preview,
      files: [{ path: 'offline/pets.json', bytes: 3, will_replace: 'yes' }],
    });
    expect(loose?.files[0]?.will_replace).toBe(false);
  });

  it('never shows part of a preview it cannot read', () => {
    expect(() => normalizeBackupPreview({ ...preview, token: '' })).toThrow(/token/);
    expect(() => normalizeBackupPreview({ ...preview, created_ms: 0 })).toThrow(/date/);
    expect(() =>
      normalizeBackupPreview({ ...preview, files: [...preview.files, { bytes: 1 }] }),
    ).toThrow(/path/);
  });
});

describe('restore', () => {
  it('stages by token and expects a restart', async () => {
    vi.mocked(invoke).mockResolvedValue({ restart_required: true });
    await expect(restoreBackup('abc')).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('backups_restore', { token: 'abc' });
  });

  it('refuses a reply that did not stage a restart', async () => {
    vi.mocked(invoke).mockResolvedValue({ restart_required: false });
    await expect(restoreBackup('abc')).rejects.toThrow(/did not stage/);
  });

  it('cancels only the held preview', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await expect(cancelBackupPreview()).resolves.toBeUndefined();
    expect(invoke).toHaveBeenCalledWith('backups_cancel');
  });
});
