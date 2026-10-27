import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OverlayStatus } from '../types/companion';

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.doUnmock('./mockScenario');
});

describe('mock automatic Group display', () => {
  it.each([
    { fresh: true, long: false, requested: false, visible: false },
    { fresh: false, long: false, requested: true, visible: true },
    { fresh: false, long: true, requested: true, visible: false },
  ])(
    'enables intent with eligible=$requested, visible=$visible',
    async ({ fresh, long, requested, visible }) => {
      vi.resetModules();
      vi.useFakeTimers();
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('__TAURI_INTERNALS__', undefined);
      vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', undefined);
      vi.stubGlobal('isTauri', undefined);
      vi.doMock('./mockScenario', () => ({
        FRESH: fresh,
        LONG: long,
        UPDATE: null,
        BACKUP: null,
        PORTABLE: false,
        NPCAP: null,
        ACCESS: null,
        NOTICES: null,
      }));
      const { install } = await import('./mockNative');
      install();
      const runtime = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (command: string) => Promise<OverlayStatus | null> };
      };
      const invoke = runtime.__TAURI_INTERNALS__.invoke;
      await invoke('group_hide');
      expect(await invoke('overlay_status')).toMatchObject({
        group_enabled: false,
        group_requested: false,
        group_visible: false,
      });
      expect(await invoke('group_show')).toMatchObject({
        group_enabled: true,
        group_requested: requested,
        group_visible: visible,
      });
      expect(await invoke('overlay_status')).toMatchObject({
        group_enabled: true,
        group_requested: requested,
        group_visible: visible,
      });
      await invoke('group_hide');
      expect(await invoke('overlay_status')).toMatchObject({
        group_enabled: false,
        group_requested: false,
        group_visible: false,
      });
    },
  );
});

describe('mock overlay locks', () => {
  const start = async (fresh: boolean) => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
    vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', undefined);
    vi.stubGlobal('isTauri', undefined);
    vi.doMock('./mockScenario', () => ({
      FRESH: fresh,
      LONG: false,
      UPDATE: null,
      BACKUP: null,
      PORTABLE: false,
      NPCAP: null,
      ACCESS: null,
      NOTICES: null,
    }));
    const { install } = await import('./mockNative');
    install();
    const runtime = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>;
      };
    };
    return runtime.__TAURI_INTERNALS__.invoke;
  };
  const locks = async (invoke: Awaited<ReturnType<typeof start>>) => {
    const overlay = (await invoke('overlay_status')) as OverlayStatus;
    const pets = (await invoke('pets_overlay_status')) as { locked: boolean };
    const timers = (await invoke('activity_window_status', { kind: 'timers' })) as {
      locked: boolean;
    };
    return {
      dps: overlay.locked,
      pets: pets.locked,
      timers: timers.locked,
    };
  };

  it('starts every lockable window unlocked and arranges the first tracker show', async () => {
    const invoke = await start(true);
    expect(await locks(invoke)).toEqual({
      dps: false,
      pets: false,
      timers: false,
    });
    expect(await invoke('trackers_show')).toMatchObject({
      trackers_requested: true,
      trackers_editing: true,
    });
  });

  it('keeps each lock choice across hide and show, without touching Group', async () => {
    const invoke = await start(true);
    const group = (await invoke('overlay_status')) as OverlayStatus;
    const groupBefore = {
      group_enabled: group.group_enabled,
      group_requested: group.group_requested,
      group_visible: group.group_visible,
    };
    await invoke('overlay_show');
    await invoke('overlay_lock', { locked: true });
    await invoke('pets_overlay_lock', { locked: true });
    await invoke('activity_window_lock', { kind: 'timers', locked: true });
    for (const [hide, show] of [
      ['overlay_hide', 'overlay_show'],
      ['pets_overlay_hide', 'pets_overlay_show'],
    ] as const)
      await invoke(hide).then(() => invoke(show));
    await invoke('activity_window_hide', { kind: 'timers' });
    await invoke('activity_window_show', { kind: 'timers' });
    expect(await locks(invoke)).toEqual({
      dps: true,
      pets: true,
      timers: true,
    });

    await invoke('trackers_show');
    await invoke('trackers_arrange', { editing: false });
    await invoke('trackers_hide');
    expect(await invoke('trackers_show')).toMatchObject({ trackers_editing: false });
    await invoke('trackers_arrange', { editing: true });
    await invoke('trackers_hide');
    expect(await invoke('overlay_status')).toMatchObject({ trackers_editing: false });
    expect(await invoke('trackers_show')).toMatchObject({ trackers_editing: true });

    expect(await invoke('overlay_status')).toMatchObject(groupBefore);
  });

  it('keeps the busy fixture tracker layer click-through on show', async () => {
    const invoke = await start(false);
    await invoke('trackers_hide');
    expect(await invoke('trackers_show')).toMatchObject({ trackers_editing: false });
  });
});

describe('mock offline status detail', () => {
  it('serves the compact live status, the full status and summary action replies', async () => {
    vi.resetModules();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
    vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', undefined);
    vi.stubGlobal('isTauri', undefined);
    vi.doMock('./mockScenario', () => ({
      FRESH: false,
      LONG: false,
      UPDATE: null,
      BACKUP: null,
      PORTABLE: false,
      NPCAP: null,
      ACCESS: null,
      NOTICES: null,
    }));
    const { install } = await import('./mockNative');
    install();
    const { normalizeLiveStatus, normalizeStatus } = await import('../lib/offlineNormalize');
    const runtime = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: object) => Promise<unknown> };
    };
    const invoke = runtime.__TAURI_INTERNALS__.invoke;

    const full = normalizeStatus(await invoke('offline_status')).report;
    expect(full?.detail_level).toBe('full');
    expect(full?.events.length).toBeGreaterThan(0);
    expect(full?.event_count).toBe(full?.events.length);

    const raw = (await invoke('offline_live_status')) as { report: Record<string, unknown> };
    expect(raw.report).toMatchObject({ detail_level: 'summary', events: [], buffs: [], hp: [] });
    const summary = normalizeLiveStatus(raw).report;
    expect(summary?.event_count).toBe(full?.event_count);
    expect(summary?.players.map((p) => p.damage)).toEqual(full?.players.map((p) => p.damage));

    const reply = (await invoke('offline_action', { action: 'save', summary: true })) as {
      report: Record<string, unknown>;
    };
    expect(reply.report.detail_level).toBe('summary');
    const detailed = (await invoke('offline_action', { action: 'save', summary: false })) as {
      report: Record<string, unknown>;
    };
    expect(detailed.report.detail_level).toBe('full');
  });
});

describe('mock setup and portable updates', () => {
  const start = async (scenario: {
    NPCAP?: string | null;
    PORTABLE?: boolean;
    ACCESS?: string | null;
  }) => {
    vi.resetModules();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.stubGlobal('__TAURI_INTERNALS__', undefined);
    vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', undefined);
    vi.stubGlobal('isTauri', undefined);
    vi.doMock('./mockScenario', () => ({
      FRESH: false,
      LONG: false,
      UPDATE: null,
      BACKUP: null,
      FAILING: false,
      PORTABLE: false,
      NPCAP: null,
      ACCESS: null,
      NOTICES: null,
      ...scenario,
    }));
    const { install } = await import('./mockNative');
    install();
    const runtime = window as unknown as {
      __TAURI_INTERNALS__: { invoke: (command: string, args?: object) => Promise<unknown> };
    };
    return runtime.__TAURI_INTERNALS__.invoke;
  };

  it('reports a working driver by default', async () => {
    const invoke = await start({});
    const { normalizeSetupStatus } = await import('../services/setup');
    const setup = normalizeSetupStatus(await invoke('setup_status'));
    expect(setup.npcap).toEqual({ state: 'ready', detail: null });
    expect(setup.platform_supported).toBe(true);
  });

  it('fakes a missing driver that Get Npcap then installs', async () => {
    const invoke = await start({ NPCAP: 'missing' });
    const { normalizeSetupStatus } = await import('../services/setup');
    const before = normalizeSetupStatus(await invoke('setup_status'));
    expect(before.npcap.state).toBe('missing');
    expect(before.npcap.detail).toContain('Npcap');
    expect(await invoke('live_status')).toMatchObject({ phase: 'error', players: [] });
    await invoke('setup_open_link', { link: 'npcap_help' });
    expect(normalizeSetupStatus(await invoke('setup_status')).npcap.state).toBe('missing');
    await invoke('setup_open_link', { link: 'npcap' });
    expect(normalizeSetupStatus(await invoke('setup_status')).npcap.state).toBe('ready');
  });

  it.each(['unavailable', 'unsupported'])('fakes a driver that is %s', async (state) => {
    const invoke = await start({ NPCAP: state });
    const { normalizeSetupStatus } = await import('../services/setup');
    const setup = normalizeSetupStatus(await invoke('setup_status'));
    expect(setup.npcap.state).toBe(state);
    expect(setup.platform_supported).toBe(state !== 'unsupported');
    await invoke('setup_open_link', { link: 'npcap' });
    expect(normalizeSetupStatus(await invoke('setup_status')).npcap.state).toBe(state);
  });

  it('fakes a portable copy that checks releases but cannot download one', async () => {
    const invoke = await start({ PORTABLE: true });
    const { normalizeUpdateStatus } = await import('../services/updates');
    const status = normalizeUpdateStatus(await invoke('updates_status'));
    expect(status).toMatchObject({
      channel: 'stable',
      phase: 'available',
      restart_supported: false,
    });
    await expect(invoke('updates_download')).rejects.toThrow('cannot update itself');
  });

  it('never probes GitHub access on the default development build', async () => {
    const invoke = await start({});
    const { normalizeUpdateAccessStatus } = await import('../services/updateAccess');
    for (const command of ['updates_access_status', 'updates_access_check', 'updates_access_login'])
      expect(normalizeUpdateAccessStatus(await invoke(command))).toMatchObject({
        phase: 'development',
        login_supported: false,
      });
  });

  it('walks a friend with only the installer from no GitHub CLI to private updates', async () => {
    vi.useFakeTimers();
    const invoke = await start({ ACCESS: 'cli' });
    const { normalizeUpdateAccessStatus } = await import('../services/updateAccess');
    const { updateAccessStep } = await import('../lib/updateAccess');
    const { normalizeUpdateStatus } = await import('../services/updates');
    const step = async (command: string) => {
      const reply = invoke(command);
      await vi.advanceTimersByTimeAsync(5_000);
      return updateAccessStep(normalizeUpdateAccessStatus(await reply));
    };
    expect(normalizeUpdateStatus(await invoke('updates_status'))).toMatchObject({
      channel: 'stable',
      phase: 'error',
      distribution: 'private',
    });
    expect(
      updateAccessStep(normalizeUpdateAccessStatus(await invoke('updates_access_status'))),
    ).toBe('unknown');
    expect(await step('updates_access_check')).toBe('cli_missing');
    await expect(invoke('updates_access_login')).rejects.toThrow('Install GitHub CLI first');
    await invoke('setup_open_link', { link: 'github_cli' });
    expect(await step('updates_access_check')).toBe('signed_out');
    expect(await step('updates_access_login')).toBe('no_access');
    // Release checks fail until the invitation is accepted, then find the release.
    expect(normalizeUpdateStatus(await invoke('updates_check')).phase).toBe('error');
    await invoke('setup_open_link', { link: 'github_invitations' });
    expect(await step('updates_access_check')).toBe('ready');
    expect(normalizeUpdateStatus(await invoke('updates_check'))).toMatchObject({
      phase: 'available',
      latest_version: '0.7.0',
    });
  });

  it('fakes a cancelled sign-in and an unreachable GitHub as unfinished, not refused', async () => {
    vi.useFakeTimers();
    const { normalizeUpdateAccessStatus } = await import('../services/updateAccess');
    const { updateAccessStep } = await import('../lib/updateAccess');
    const settle = async (reply: Promise<unknown>) => {
      await vi.advanceTimersByTimeAsync(5_000);
      return normalizeUpdateAccessStatus(await reply);
    };
    let invoke = await start({ ACCESS: 'cancel' });
    const cancelled = await settle(invoke('updates_access_login'));
    expect(updateAccessStep(cancelled)).toBe('error');
    expect(cancelled).toMatchObject({ authenticated: null, repository_access: null });
    expect(cancelled.error).toContain('did not finish');
    expect(updateAccessStep(await settle(invoke('updates_access_login')))).toBe('no_access');

    invoke = await start({ ACCESS: 'error' });
    const unreachable = await settle(invoke('updates_access_check'));
    expect(updateAccessStep(unreachable)).toBe('error');
    expect(unreachable.error).toContain('Could not reach GitHub');
    expect(updateAccessStep(await settle(invoke('updates_access_check')))).toBe('ready');
  });
});
