import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/backups';
import type { BackupPlan, BackupPreview, BackupStatus } from '../types/backups';
import { useBackups } from './useBackups';

vi.mock('../services/backups', async (load) => ({
  ...(await load<typeof api>()),
  readBackupStatus: vi.fn<typeof api.readBackupStatus>(),
  planBackup: vi.fn<typeof api.planBackup>(),
  exportBackup: vi.fn<typeof api.exportBackup>(),
  previewBackup: vi.fn<typeof api.previewBackup>(),
  restoreBackup: vi.fn<typeof api.restoreBackup>(),
  cancelBackupPreview: vi.fn<typeof api.cancelBackupPreview>(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const MIB = 1024 * 1024;
const status: BackupStatus = {
  channel: 'stable',
  limits: { archive_bytes: 128 * MIB, total_bytes: 64 * MIB, file_bytes: 32 * MIB, files: 1000 },
  pending_restore: false,
  last_recovery: null,
};
const plan = (bytes: number): BackupPlan => ({
  files: [{ path: 'offline/settings.json', bytes }],
  total_bytes: bytes,
});
const preview = (token: string): BackupPreview => ({
  token,
  created_ms: 1_760_000_000_000,
  app_version: '0.7.9',
  channel: 'stable',
  files: [{ path: 'offline/settings.json', bytes: 10, will_replace: true }],
  total_bytes: 10,
});

beforeEach(() => {
  vi.mocked(api.readBackupStatus).mockResolvedValue(status);
  vi.mocked(api.planBackup).mockResolvedValue(plan(10));
  vi.mocked(api.cancelBackupPreview).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const mount = async (native = true) => {
  const hook = renderHook(() => useBackups(native));
  if (native) await waitFor(() => expect(hook.result.current.status).not.toBeNull());
  return hook;
};

describe('backups', () => {
  it('does nothing outside the desktop app', async () => {
    const { result } = await mount(false);
    await act(() => result.current.exportBackup());
    await act(() => result.current.choosePreview());
    expect(api.readBackupStatus).not.toHaveBeenCalled();
    expect(api.exportBackup).not.toHaveBeenCalled();
    expect(api.previewBackup).not.toHaveBeenCalled();
  });

  it('includes settings and pet farming by default, logs only when asked', async () => {
    const { result } = await mount();
    expect(result.current.options).toEqual({
      settings: true,
      pets: true,
      logs: false,
    });
    await waitFor(() => expect(result.current.plan).toEqual(plan(10)));
    expect(api.planBackup).toHaveBeenLastCalledWith(result.current.options);
  });

  it('drops an estimate for options that have since changed', async () => {
    const first = deferred<BackupPlan>();
    const second = deferred<BackupPlan>();
    vi.mocked(api.planBackup)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = await mount();
    act(() => result.current.setOption('logs', true));
    await waitFor(() => expect(api.planBackup).toHaveBeenCalledTimes(2));
    await act(async () => second.resolve(plan(900)));
    await act(async () => first.resolve(plan(1)));
    expect(result.current.plan).toEqual(plan(900));
    expect(result.current.planning).toBe(false);
  });

  it('asks nothing when no part is chosen', async () => {
    const { result } = await mount();
    await waitFor(() => expect(result.current.planning).toBe(false));
    vi.mocked(api.planBackup).mockClear();
    act(() => {
      for (const part of ['settings', 'pets'] as const) result.current.setOption(part, false);
    });
    expect(result.current.plan).toEqual({ files: [], total_bytes: 0 });
    await act(() => result.current.exportBackup());
    expect(api.planBackup).not.toHaveBeenCalled();
    expect(api.exportBackup).not.toHaveBeenCalled();
  });

  it('opens one Save dialog at a time and reports where the backup went', async () => {
    const written = deferred<Awaited<ReturnType<typeof api.exportBackup>>>();
    vi.mocked(api.exportBackup).mockReturnValue(written.promise);
    const { result } = await mount();
    let running!: Promise<void>;
    act(() => {
      running = result.current.exportBackup();
      void result.current.exportBackup();
      void result.current.choosePreview();
    });
    expect(result.current.pending).toBe('export');
    expect(api.exportBackup).toHaveBeenCalledTimes(1);
    expect(api.previewBackup).not.toHaveBeenCalled();
    const saved = { path: 'D:/a.aion-backup.json', files: 3, total_bytes: 30, archive_bytes: 99 };
    await act(async () => {
      written.resolve(saved);
      await running;
    });
    expect(result.current.exported).toEqual({ kind: 'saved', result: saved });
    expect(result.current.pending).toBeNull();
  });

  it('says a cancelled or failed backup wrote nothing', async () => {
    vi.mocked(api.exportBackup).mockResolvedValueOnce(null).mockRejectedValueOnce('disk full');
    const { result } = await mount();
    await act(() => result.current.exportBackup());
    expect(result.current.exported).toEqual({ kind: 'cancelled' });
    await act(() => result.current.exportBackup());
    expect(result.current.exported).toEqual({ kind: 'failed', error: 'disk full' });
  });

  it('clears the shown preview before another file is chosen, and keeps it cleared on cancel', async () => {
    vi.mocked(api.previewBackup).mockResolvedValueOnce(preview('one'));
    const { result } = await mount();
    await act(() => result.current.choosePreview());
    expect(result.current.preview?.token).toBe('one');

    const next = deferred<BackupPreview | null>();
    vi.mocked(api.previewBackup).mockReturnValueOnce(next.promise);
    let choosing!: Promise<void>;
    act(() => {
      choosing = result.current.choosePreview();
    });
    expect(result.current.preview).toBeNull();
    // The old file can no longer be applied while the dialog is open.
    await act(() => result.current.applyRestore('one'));
    expect(api.restoreBackup).not.toHaveBeenCalled();
    await act(async () => {
      next.resolve(null);
      await choosing;
    });
    expect(result.current.preview).toBeNull();
    expect(result.current.restore).toEqual({ kind: 'cancelled' });
  });

  it('shows why a file was refused, without a preview', async () => {
    vi.mocked(api.previewBackup).mockRejectedValue('Checksum mismatch');
    const { result } = await mount();
    await act(() => result.current.choosePreview());
    expect(result.current.preview).toBeNull();
    expect(result.current.restore).toEqual({
      kind: 'failed',
      step: 'preview',
      error: 'Checksum mismatch',
    });
  });

  it('applies only the preview on screen, then locks every step', async () => {
    vi.mocked(api.previewBackup).mockResolvedValue(preview('shown'));
    vi.mocked(api.restoreBackup).mockResolvedValue();
    const { result } = await mount();
    await act(() => result.current.choosePreview());
    await act(() => result.current.applyRestore('stale'));
    expect(api.restoreBackup).not.toHaveBeenCalled();
    await act(() => result.current.applyRestore('shown'));
    expect(api.restoreBackup).toHaveBeenCalledWith('shown');
    expect(result.current.restore).toEqual({ kind: 'staged' });
    expect(result.current.status?.pending_restore).toBe(true);
    await act(() => result.current.exportBackup());
    await act(() => result.current.choosePreview());
    expect(api.exportBackup).not.toHaveBeenCalled();
    expect(api.previewBackup).toHaveBeenCalledTimes(1);
  });

  it('forgets the preview when staging fails, so the file is checked again', async () => {
    vi.mocked(api.previewBackup).mockResolvedValue(preview('shown'));
    vi.mocked(api.restoreBackup).mockRejectedValue('Preview expired');
    const { result } = await mount();
    await act(() => result.current.choosePreview());
    await act(() => result.current.applyRestore('shown'));
    expect(result.current.preview).toBeNull();
    expect(result.current.restore).toEqual({
      kind: 'failed',
      step: 'restore',
      error: 'Preview expired',
    });
  });

  it('discards the preview here and natively', async () => {
    vi.mocked(api.previewBackup).mockResolvedValue(preview('shown'));
    const { result } = await mount();
    await act(() => result.current.choosePreview());
    await act(() => result.current.discardPreview());
    expect(result.current.preview).toBeNull();
    expect(api.cancelBackupPreview).toHaveBeenCalledTimes(1);
  });

  it('reports a backup service it cannot read', async () => {
    vi.mocked(api.readBackupStatus).mockRejectedValue('no backups command');
    const { result } = renderHook(() => useBackups(true));
    await waitFor(() => expect(result.current.statusError).toBe('no backups command'));
  });
});
