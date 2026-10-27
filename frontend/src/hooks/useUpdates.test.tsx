import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/updates';
import type { UpdateStatus } from '../types/updates';
import { useUpdates } from './useUpdates';

vi.mock('../services/updates', async (load) => ({
  ...(await load<typeof api>()),
  readUpdateStatus: vi.fn<typeof api.readUpdateStatus>(),
  runUpdateAction: vi.fn<typeof api.runUpdateAction>(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

const updateStatus = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  channel: 'stable',
  current_version: '0.6.4',
  latest_version: null,
  phase: 'idle',
  error: null,
  checked_ms: null,
  release_url: null,
  notes: null,
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const slow = { busyMs: 60_000, idleMs: 60_000 };

describe('update status', () => {
  it('refuses every release action on development builds', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValue(
      updateStatus({ channel: 'development', phase: 'development', restart_supported: false }),
    );
    const { result } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('development'));
    expect(await result.current.check()).toBe(false);
    expect(await result.current.download()).toBe(false);
    expect(await result.current.install()).toBe(false);
    expect(api.runUpdateAction).not.toHaveBeenCalled();
  });

  it('does nothing outside the desktop app', async () => {
    const { result } = renderHook(() => useUpdates(false));
    expect(await result.current.check()).toBe(false);
    expect(api.readUpdateStatus).not.toHaveBeenCalled();
    expect(api.runUpdateAction).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('polls only while visible and keeps a step finishing while hidden', async () => {
    vi.useFakeTimers();
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'available' }));
    const { result, rerender } = renderHook(
      ({ active }) => useUpdates(true, { active, busyMs: 1000, idleMs: 5000 }),
      { initialProps: { active: true } },
    );
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(1);

    const download = deferred<UpdateStatus>();
    vi.mocked(api.runUpdateAction).mockReturnValueOnce(download.promise);
    let done: Promise<boolean> | undefined;
    act(() => {
      done = result.current.download();
    });
    rerender({ active: false });
    const calls = vi.mocked(api.readUpdateStatus).mock.calls.length;
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(calls);

    const ready = updateStatus({ phase: 'ready', latest_version: '0.6.5' });
    await act(async () => {
      download.resolve(ready);
      expect(await done).toBe(true);
    });
    expect(result.current.status).toBe(ready);

    rerender({ active: true });
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(calls + 1);
  });

  it('polls quickly while native is busy and slowly otherwise', async () => {
    vi.useFakeTimers();
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'downloading' }));
    renderHook(() => useUpdates(true, { busyMs: 1000, idleMs: 5000 }));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(2);

    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'ready' }));
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(4000));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(3);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(api.readUpdateStatus).toHaveBeenCalledTimes(4);
  });

  it('runs a check once even when asked twice, and shows its result', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus());
    const { result } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('idle'));

    const check = deferred<UpdateStatus>();
    vi.mocked(api.runUpdateAction).mockReturnValueOnce(check.promise);
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'checking' }));
    let first: Promise<boolean> | undefined;
    let second: Promise<boolean> | undefined;
    act(() => {
      first = result.current.check();
      second = result.current.check();
    });
    expect(await second).toBe(false);
    expect(api.runUpdateAction).toHaveBeenCalledTimes(1);
    expect(api.runUpdateAction).toHaveBeenCalledWith('check');
    expect(result.current.pending).toBe('check');
    expect(result.current.busy).toBe(true);
    await waitFor(() => expect(result.current.status?.phase).toBe('checking'));

    const found = updateStatus({ phase: 'available', latest_version: '0.6.5' });
    await act(async () => {
      check.resolve(found);
      expect(await first).toBe(true);
    });
    expect(result.current.status).toBe(found);
    expect(result.current.pending).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it('refuses a step while native reports one running', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'downloading' }));
    const { result } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('downloading'));
    expect(result.current.busy).toBe(true);
    expect(await result.current.download()).toBe(false);
    expect(api.runUpdateAction).not.toHaveBeenCalled();
  });

  it('does not let a slower, older status overwrite a newer result', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValueOnce(
      updateStatus({ phase: 'available', latest_version: '0.6.5' }),
    );
    const { result } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('available'));

    const stale = deferred<UpdateStatus>();
    vi.mocked(api.readUpdateStatus).mockReturnValueOnce(stale.promise);
    const ready = updateStatus({ phase: 'ready', latest_version: '0.6.5' });
    vi.mocked(api.runUpdateAction).mockResolvedValueOnce(ready);
    await act(async () => {
      await result.current.download();
    });
    expect(result.current.status).toBe(ready);
    await act(async () => stale.resolve(updateStatus({ phase: 'downloading' })));
    expect(result.current.status).toBe(ready);
  });

  it('reports a failed step and an unreachable service', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus({ phase: 'ready' }));
    const { result } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('ready'));

    const failed = updateStatus({ phase: 'error', error: 'Could not save capture' });
    vi.mocked(api.runUpdateAction).mockResolvedValueOnce(failed);
    await act(async () => {
      expect(await result.current.install()).toBe(false);
    });
    expect(result.current.status).toBe(failed);

    vi.mocked(api.runUpdateAction).mockRejectedValueOnce(new Error('gh missing'));
    await act(async () => {
      expect(await result.current.check()).toBe(false);
    });
    expect(result.current.error).toBe('Error: gh missing');
    expect(result.current.pending).toBeNull();
  });

  it('drops results that arrive after unmount', async () => {
    vi.mocked(api.readUpdateStatus).mockResolvedValue(updateStatus());
    const { result, unmount } = renderHook(() => useUpdates(true, slow));
    await waitFor(() => expect(result.current.status?.phase).toBe('idle'));

    const check = deferred<UpdateStatus>();
    vi.mocked(api.runUpdateAction).mockReturnValueOnce(check.promise);
    let done: Promise<boolean> | undefined;
    act(() => {
      done = result.current.check();
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    unmount();
    check.reject(new Error('late'));
    expect(await done).toBe(false);
    expect(result.current.status?.phase).toBe('idle');
    expect(result.current.error).toBe('');
    expect(errors).not.toHaveBeenCalled();
  });
});
