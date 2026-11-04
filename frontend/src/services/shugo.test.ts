import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openShugoProfile } from './shugo';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe('Shugo.gg service', () => {
  it('asks native for one character by server and name, never with an address', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await openShugoProfile({ name: 'Aahz', serverId: 1304 });
    expect(invoke).toHaveBeenCalledWith('shugo_open_profile', { serverId: 1304, name: 'Aahz' });
  });

  it('passes a native failure on to the caller', async () => {
    vi.mocked(invoke).mockRejectedValue('Windows could not open your browser.');
    await expect(openShugoProfile({ name: 'Aahz', serverId: 1304 })).rejects.toBe(
      'Windows could not open your browser.',
    );
  });
});
