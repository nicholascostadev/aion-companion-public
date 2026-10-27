import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupStatus } from '../features/setup/fixtures';
import * as api from '../services/setup';
import type { SetupStatus } from '../types/setup';
import { useSetup } from './useSetup';

vi.mock('../services/setup', () => ({
  readSetupStatus: vi.fn<typeof api.readSetupStatus>(),
  openSetupLink: vi.fn<typeof api.openSetupLink>(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.mocked(api.readSetupStatus).mockResolvedValue(setupStatus('missing'));
  vi.mocked(api.openSetupLink).mockResolvedValue();
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('useSetup', () => {
  it('probes once when shown and again only on request', async () => {
    const { result } = renderHook(() => useSetup(true));
    expect(result.current.checking).toBe(true);
    await waitFor(() => expect(result.current.status?.npcap.state).toBe('missing'));
    expect(result.current.checking).toBe(false);
    expect(api.readSetupStatus).toHaveBeenCalledOnce();

    vi.mocked(api.readSetupStatus).mockResolvedValue(setupStatus('ready'));
    await act(() => result.current.recheck());
    expect(result.current.status?.npcap.state).toBe('ready');
    expect(api.readSetupStatus).toHaveBeenCalledTimes(2);
  });

  it('joins a probe already running instead of starting another', async () => {
    const probe = deferred<SetupStatus>();
    vi.mocked(api.readSetupStatus).mockReturnValue(probe.promise);
    const { result } = renderHook(() => useSetup(true));
    void result.current.recheck();
    void result.current.recheck();
    expect(api.readSetupStatus).toHaveBeenCalledOnce();
    await act(async () => probe.resolve(setupStatus('unavailable')));
    expect(result.current.status?.npcap.state).toBe('unavailable');
  });

  it('probes again on showing while a problem remains, but not once the driver works', async () => {
    const { result, rerender } = renderHook(({ active }) => useSetup(true, { active }), {
      initialProps: { active: true },
    });
    await waitFor(() => expect(result.current.status).not.toBeNull());
    rerender({ active: false });
    rerender({ active: true });
    await waitFor(() => expect(api.readSetupStatus).toHaveBeenCalledTimes(2));

    vi.mocked(api.readSetupStatus).mockResolvedValue(setupStatus('ready'));
    await act(() => result.current.recheck());
    rerender({ active: false });
    rerender({ active: true });
    expect(api.readSetupStatus).toHaveBeenCalledTimes(3);
  });

  it('keeps a failed probe as an error and reads nothing in a preview', async () => {
    vi.mocked(api.readSetupStatus).mockRejectedValue(new Error('probe failed'));
    const { result } = renderHook(() => useSetup(true));
    await waitFor(() => expect(result.current.error).toContain('probe failed'));
    expect(result.current.status).toBeNull();

    vi.mocked(api.readSetupStatus).mockClear();
    const preview = renderHook(() => useSetup(false));
    await act(() => preview.result.current.recheck());
    expect(api.readSetupStatus).not.toHaveBeenCalled();
    expect(preview.result.current.checking).toBe(false);
  });

  it('opens official pages and returns why one could not open', async () => {
    const { result } = renderHook(() => useSetup(true));
    await expect(result.current.open('npcap')).resolves.toBe('');
    expect(api.openSetupLink).toHaveBeenCalledWith('npcap');
    vi.mocked(api.openSetupLink).mockRejectedValue(new Error('no browser'));
    await expect(result.current.open('releases')).resolves.toContain('no browser');
  });
});
