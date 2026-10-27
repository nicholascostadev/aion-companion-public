import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SetupLink } from '../types/setup';
import { normalizeSetupStatus, openSetupLink, readSetupStatus } from './setup';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));

afterEach(() => {
  vi.resetAllMocks();
});

describe('setup service', () => {
  it('reads the setup probe as native reports it', async () => {
    vi.mocked(invoke).mockResolvedValue({
      platform_supported: true,
      webview2_ready: true,
      npcap: { state: 'unavailable', detail: 'No supported adapter.' },
      installed: false,
      distribution: 'public',
    });
    await expect(readSetupStatus()).resolves.toEqual({
      platform_supported: true,
      webview2_ready: true,
      npcap: { state: 'unavailable', detail: 'No supported adapter.' },
      installed: false,
      distribution: 'public',
    });
    expect(invoke).toHaveBeenCalledWith('setup_status');
  });

  it('assumes nothing it was not told', () => {
    expect(normalizeSetupStatus({ npcap: { state: 'missing', detail: '  ' } })).toEqual({
      platform_supported: false,
      webview2_ready: true,
      npcap: { state: 'missing', detail: null },
      installed: false,
      distribution: 'private',
    });
    expect(() => normalizeSetupStatus(null)).toThrow('no setup status');
    expect(() => normalizeSetupStatus({ npcap: { state: 'maybe' } })).toThrow('no Npcap state');
  });

  it('opens only the fixed official links', async () => {
    vi.mocked(invoke).mockResolvedValue(null);
    await openSetupLink('npcap_help');
    expect(invoke).toHaveBeenCalledWith('setup_open_link', { link: 'npcap_help' });
    await expect(openSetupLink('https://example.com' as SetupLink)).rejects.toThrow('Unknown link');
    expect(invoke).toHaveBeenCalledOnce();
    // The GitHub access path opens the repository and invitations, through the same allowlist.
    await openSetupLink('repository');
    expect(invoke).toHaveBeenLastCalledWith('setup_open_link', { link: 'repository' });
    await openSetupLink('github_invitations');
    expect(invoke).toHaveBeenLastCalledWith('setup_open_link', { link: 'github_invitations' });
  });
});
