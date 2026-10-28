import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../lib/offlineNormalize';
import * as api from '../services/offline';
import type { OfflineLiveStatus, OfflineStatus } from '../types/offline';
import { report, reportSummary } from '../features/offline/fixtures';
import { useOffline } from './useOffline';
import { createPreferenceSync, setActivePreferenceSync } from '../services/uiPreferences';

vi.mock('../services/offline', () => ({
  readOfflineStatus: vi.fn<typeof api.readOfflineStatus>(),
  readOfflineLiveStatus: vi.fn<typeof api.readOfflineLiveStatus>(),
  configureOffline: vi.fn<typeof api.configureOffline>(),
  runOfflineAction: vi.fn<typeof api.runOfflineAction>(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const envelope = {
  settings: SETTINGS_FALLBACK,
  library_count: 0,
  trackers: [],
  alerts: [],
  catalogue: null,
  capabilities: {},
  error: null,
};
const live = (patch: Partial<OfflineLiveStatus> = {}): OfflineLiveStatus => ({
  ...envelope,
  report: reportSummary(),
  ...patch,
});
const full = (patch: Partial<OfflineStatus> = {}): OfflineStatus => ({
  ...envelope,
  report: report(),
  ...patch,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('interface language on save', () => {
  it('shows the saved language at once, and keeps it when native refuses the save', async () => {
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValue(live());
    const apply = vi.fn<(stored: string) => void>();
    let stored = 'en';
    const sync = createPreferenceSync({
      read: async () => ({ locale: stored }),
      subscribe: async () => () => {},
      apply,
      report: vi.fn<(source: string, cause: unknown) => void>(),
    });
    await sync.start(10);
    setActivePreferenceSync(sync);
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).not.toBeNull());

    vi.mocked(api.configureOffline).mockRejectedValueOnce(new Error('hotkey taken'));
    await act(async () => {
      await result.current.configure({ ...SETTINGS_FALLBACK, locale: 'pt-BR' });
    });
    expect(apply.mock.calls).toEqual([['en']]);

    const saved = { ...SETTINGS_FALLBACK, locale: 'pt-BR' as const };
    vi.mocked(api.configureOffline).mockImplementationOnce(async () => {
      stored = 'pt-BR';
      return saved;
    });
    await act(async () => {
      await result.current.configure(saved);
    });
    expect(apply.mock.calls.at(-1)).toEqual(['pt-BR']);
    sync.dispose();
    setActivePreferenceSync(null);
  });
});

describe('offline settings that filter the report', () => {
  it('applies a new party filter only together with the report aggregated for it', async () => {
    const all = live();
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValueOnce(all);
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).toBe(all));

    const party = { ...SETTINGS_FALLBACK, party_only: true };
    vi.mocked(api.configureOffline).mockResolvedValue(party);
    const fresh = deferred<OfflineLiveStatus>();
    vi.mocked(api.readOfflineLiveStatus).mockReturnValueOnce(fresh.promise);
    let done: Promise<boolean> | undefined;
    act(() => {
      done = result.current.configure(party);
    });
    await waitFor(() => expect(api.readOfflineLiveStatus).toHaveBeenCalledTimes(2));
    // Saved but not yet re-read: the old filter and its report stay paired.
    expect(result.current.status?.settings?.party_only).toBe(false);
    expect(result.current.status?.report).toBe(all.report);

    // The fresh status already carries another window's later change: it wins as a whole.
    const later = { ...party, opacity: 0.5 };
    const filtered = live({ settings: later, report: reportSummary({ players: [] }) });
    await act(async () => {
      fresh.resolve(filtered);
      await done;
    });
    expect(result.current.status).toBe(filtered);
    expect(result.current.status?.settings?.opacity).toBe(0.5);
    expect(api.readOfflineStatus).not.toHaveBeenCalled();
  });

  it('does not re-read the report for settings that do not filter it', async () => {
    const all = live();
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValueOnce(all);
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).toBe(all));
    const faded = { ...SETTINGS_FALLBACK, opacity: 0.7 };
    vi.mocked(api.configureOffline).mockResolvedValue(faded);
    await act(async () => {
      await result.current.configure(faded);
    });
    expect(api.readOfflineLiveStatus).toHaveBeenCalledOnce();
    expect(result.current.status?.settings).toBe(faded);
    expect(result.current.status?.report).toBe(all.report);
  });

  it('re-reads the report aggregated in a newly chosen target scope', async () => {
    const all = live();
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValueOnce(all);
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).toBe(all));
    const bosses = { ...SETTINGS_FALLBACK, target_mode: 'boss' as const };
    vi.mocked(api.configureOffline).mockResolvedValue(bosses);
    const scoped = live({ settings: bosses, report: reportSummary({ players: [] }) });
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValueOnce(scoped);
    await act(async () => {
      await result.current.configure(bosses);
    });
    expect(api.readOfflineLiveStatus).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe(scoped);
  });

  it('re-reads a filtered report in full while a view needs its details', async () => {
    vi.mocked(api.readOfflineStatus).mockResolvedValueOnce(full());
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000, detail: true }));
    await waitFor(() => expect(result.current.status?.report?.detail_level).toBe('full'));
    const party = { ...SETTINGS_FALLBACK, party_only: true };
    vi.mocked(api.configureOffline).mockResolvedValue(party);
    const filtered = full({ settings: party });
    vi.mocked(api.readOfflineStatus).mockResolvedValueOnce(filtered);
    await act(async () => {
      await result.current.configure(party);
    });
    expect(result.current.status).toBe(filtered);
    expect(api.readOfflineLiveStatus).not.toHaveBeenCalled();
  });
});

describe('report detail level', () => {
  it('polls the compact summary by default and never the full report', async () => {
    const summary = live();
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValue(summary);
    const { result } = renderHook(() => useOffline(true, { minIntervalMs: 60_000 }));
    await waitFor(() => expect(result.current.status).toBe(summary));
    expect(result.current.status?.report?.detail_level).toBe('summary');
    expect(api.readOfflineStatus).not.toHaveBeenCalled();
  });

  it('switches to the full report at once and back, dropping a read of the other level', async () => {
    const pending = deferred<OfflineLiveStatus>();
    vi.mocked(api.readOfflineLiveStatus).mockReturnValueOnce(pending.promise);
    const detailed = full();
    vi.mocked(api.readOfflineStatus).mockResolvedValue(detailed);
    const { result, rerender } = renderHook(
      ({ detail }: { detail: boolean }) => useOffline(true, { minIntervalMs: 60_000, detail }),
      { initialProps: { detail: false } },
    );
    // A view that draws details shows up before the summary read answers.
    rerender({ detail: true });
    await waitFor(() => expect(result.current.status).toBe(detailed));
    await act(async () => {
      pending.resolve(live());
      await pending.promise;
    });
    // The older summary never replaces the full report.
    expect(result.current.status).toBe(detailed);

    const summary = live();
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValue(summary);
    rerender({ detail: false });
    await waitFor(() => expect(result.current.status).toBe(summary));
    expect(api.readOfflineStatus).toHaveBeenCalledOnce();
  });

  it('asks actions for the detail level polled now', async () => {
    vi.mocked(api.readOfflineLiveStatus).mockResolvedValue(live());
    vi.mocked(api.readOfflineStatus).mockResolvedValue(full());
    vi.mocked(api.runOfflineAction).mockResolvedValue(live());
    const { result, rerender } = renderHook(
      ({ detail }: { detail: boolean }) => useOffline(true, { minIntervalMs: 60_000, detail }),
      { initialProps: { detail: false } },
    );
    await waitFor(() => expect(result.current.status).not.toBeNull());
    await act(async () => {
      await result.current.action('save');
    });
    expect(api.runOfflineAction).toHaveBeenLastCalledWith('save', 'summary');

    rerender({ detail: true });
    await waitFor(() => expect(result.current.status?.report?.detail_level).toBe('full'));
    vi.mocked(api.runOfflineAction).mockResolvedValue(full());
    await act(async () => {
      await result.current.action('reset');
    });
    expect(api.runOfflineAction).toHaveBeenLastCalledWith('reset', 'full');
    expect(result.current.status?.report?.detail_level).toBe('full');
  });
});
