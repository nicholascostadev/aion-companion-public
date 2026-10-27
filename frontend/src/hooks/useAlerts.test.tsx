import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboard } from '../features/alerts/fixtures';
import { patchRule } from '../features/alerts/model';
import * as sound from '../lib/sound';
import * as api from '../services/alerts';
import type { AlertConfig, AlertDashboard } from '../types/alerts';
import { useAlerts } from './useAlerts';

vi.mock('../services/alerts', () => ({
  readAlertsStatus: vi.fn<typeof api.readAlertsStatus>(),
  configureAlerts: vi.fn<typeof api.configureAlerts>(),
  runAlertAction: vi.fn<typeof api.runAlertAction>(),
  testAlert: vi.fn<typeof api.testAlert>(),
}));
vi.mock('../lib/sound', () => ({ playSound: vi.fn<typeof sound.playSound>() }));

let backend: AlertDashboard;
const STALE = 'Alert settings changed in another window. Refresh and try again.';

/** A native engine double: rejects stale revisions like the real one. */
function configure(config: AlertConfig) {
  if (config.revision !== backend.config.revision) return Promise.reject(new Error(STALE));
  backend = { ...backend, config: { ...config, revision: config.revision + 1 } };
  return Promise.resolve(backend);
}

beforeEach(() => {
  backend = dashboard();
  vi.mocked(api.readAlertsStatus).mockImplementation(() => Promise.resolve(backend));
  vi.mocked(api.configureAlerts).mockImplementation(configure);
  vi.mocked(api.runAlertAction).mockImplementation(() => Promise.resolve(backend));
  vi.mocked(api.testAlert).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('useAlerts', () => {
  it('re-applies only the user change after another window saved first', async () => {
    const { result } = renderHook(() => useAlerts(true, { intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.dashboard?.config.revision).toBe(3));
    // Another window renames r2 and bumps the revision behind our back.
    backend = {
      ...backend,
      config: {
        ...patchRule(backend.config, 'r2', { name: 'Renamed elsewhere' }),
        revision: 4,
      },
    };
    let ok = false;
    await act(async () => {
      ok = await result.current.configure((c) => patchRule(c, 'r1', { favorite: true }));
    });
    expect(ok).toBe(true);
    expect(api.configureAlerts).toHaveBeenCalledTimes(2);
    const saved = result.current.dashboard?.config;
    expect(saved?.revision).toBe(5);
    expect(saved?.rules.find((r) => r.id === 'r1')?.favorite).toBe(true);
    expect(saved?.rules.find((r) => r.id === 'r2')?.name).toBe('Renamed elsewhere');
    expect(result.current.error).toBe('');
  });

  it('runs quick successive edits in order on the newest config', async () => {
    const { result } = renderHook(() => useAlerts(true, { intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    await act(async () => {
      await Promise.all([
        result.current.configure((c) => patchRule(c, 'r1', { enabled: false })),
        result.current.configure((c) => patchRule(c, 'r2', { enabled: true })),
      ]);
    });
    const rules = result.current.dashboard?.config.rules ?? [];
    expect(rules.map((r) => r.enabled)).toEqual([false, true]);
    expect(result.current.dashboard?.config.revision).toBe(5);
  });

  it('surfaces other native errors without retrying', async () => {
    vi.mocked(api.configureAlerts).mockRejectedValue(new Error('Unknown timezone'));
    const { result } = renderHook(() => useAlerts(true, { intervalMs: 60_000 }));
    await waitFor(() => expect(result.current.dashboard).not.toBeNull());
    await act(async () => {
      await result.current.configure((c) => ({ ...c, timezone: 'Nope/Zone' }));
    });
    expect(api.configureAlerts).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/Unknown timezone/);
  });

  it('previews through native in the app and never plays web audio there', async () => {
    const { result } = renderHook(() => useAlerts(true, { intervalMs: 60_000 }));
    await act(async () => {
      await result.current.test('bell', 0.5, true);
    });
    expect(api.testAlert).toHaveBeenCalledWith('bell', 0.5, true);
    expect(sound.playSound).not.toHaveBeenCalled();
  });

  it('words its own preview failure in the current language, without storing the text', async () => {
    vi.mocked(sound.playSound).mockResolvedValue(false);
    const { result } = renderHook(() => useAlerts(false));
    await act(async () => {
      await result.current.test('bell', 0.5, false);
    });
    expect(result.current.error).toBe('Sound could not start in this browser preview.');
    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    expect(result.current.error).toBe('Não foi possível tocar o som nesta prévia no navegador.');
  });

  it('sends actions with their arguments', async () => {
    const { result } = renderHook(() => useAlerts(true, { intervalMs: 60_000 }));
    await act(async () => {
      await result.current.action('snooze', 'r1:1', 300);
    });
    expect(api.runAlertAction).toHaveBeenCalledWith('snooze', 'r1:1', 300);
  });
});
