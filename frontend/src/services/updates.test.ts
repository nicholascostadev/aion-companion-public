import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeUpdateStatus, readUpdateStatus, runUpdateAction } from './updates';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => vi.resetAllMocks());

const raw = {
  channel: 'stable',
  current_version: '0.6.4',
  latest_version: '0.6.5',
  phase: 'available',
  error: null,
  checked_ms: 1_760_000_000_000,
  release_url: 'https://github.com/nicholascostadev/aion-companion-public/releases/tag/v0.6.5',
  notes: 'Fixes',
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
};

describe('updates native contract', () => {
  it('maps every command name without arguments', async () => {
    vi.mocked(invoke).mockResolvedValue(raw);
    expect((await readUpdateStatus()).phase).toBe('available');
    expect(invoke).toHaveBeenLastCalledWith('updates_status');
    await runUpdateAction('check');
    expect(invoke).toHaveBeenLastCalledWith('updates_check');
    await runUpdateAction('download');
    expect(invoke).toHaveBeenLastCalledWith('updates_download');
    await runUpdateAction('install');
    expect(invoke).toHaveBeenLastCalledWith('updates_install');
  });

  it('keeps well-formed status as is', () => {
    expect(normalizeUpdateStatus(raw)).toEqual(raw);
  });

  it('takes the distribution the updater found, only when it says one', () => {
    expect(normalizeUpdateStatus({ ...raw, distribution: 'public' }).distribution).toBe('public');
    expect(normalizeUpdateStatus({ ...raw, distribution: 'private' }).distribution).toBe('private');
    expect('distribution' in normalizeUpdateStatus({ ...raw, distribution: 'shared' })).toBe(false);
    expect('distribution' in normalizeUpdateStatus(raw)).toBe(false);
    expect(
      'distribution' in
        normalizeUpdateStatus({
          ...raw,
          channel: 'development',
          phase: 'development',
          distribution: 'public',
        }),
    ).toBe(false);
  });

  it('treats malformed fields as unknown instead of trusting them', () => {
    expect(
      normalizeUpdateStatus({
        current_version: '0.6.4',
        latest_version: '',
        phase: 'exploded',
        checked_ms: -1,
        restart_supported: 'yes',
        notes: 42,
      }),
    ).toEqual({
      channel: 'stable',
      current_version: '0.6.4',
      latest_version: null,
      phase: 'idle',
      error: null,
      checked_ms: null,
      release_url: null,
      notes: null,
      restart_supported: false,
      repository: 'nicholascostadev/aion-companion-public',
    });
  });

  it('rejects a status without the installed version', async () => {
    expect(() => normalizeUpdateStatus(null)).toThrow('no update status');
    vi.mocked(invoke).mockResolvedValue({ phase: 'idle' });
    await expect(readUpdateStatus()).rejects.toThrow('no update status');
  });

  it('keeps development isolated from stable release actions', () => {
    expect(normalizeUpdateStatus({ ...raw, channel: 'development' })).toMatchObject({
      channel: 'development',
      phase: 'development',
      latest_version: null,
      restart_supported: false,
    });
    expect(normalizeUpdateStatus({ ...raw, phase: 'development' }).channel).toBe('development');
  });
});
