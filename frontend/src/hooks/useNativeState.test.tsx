import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useNativeState } from './useNativeState';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('native state with one action at a time', () => {
  it('keeps a failed action’s message across good reads until an action succeeds', async () => {
    const read = vi.fn<() => Promise<number>>(() => Promise.resolve(1));
    const { result } = renderHook(() => useNativeState(true, read, { initial: 0, intervalMs: 20 }));
    await waitFor(() => expect(result.current.known).toBe(true));
    await act(async () => {
      await result.current.act(() => Promise.reject(new Error('lock failed')));
    });
    expect(result.current.error).toBe('Error: lock failed');
    const reads = read.mock.calls.length;
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(reads + 1));
    expect(result.current.error).toBe('Error: lock failed');
    await act(async () => {
      await result.current.act(() => Promise.resolve(2));
    });
    expect(result.current.error).toBe('');
  });

  it('clears a failed read at the next good read', async () => {
    vi.useFakeTimers();
    const read = vi
      .fn<() => Promise<number>>()
      .mockRejectedValueOnce(new Error('busy'))
      .mockResolvedValue(3);
    const { result } = renderHook(() =>
      useNativeState(true, read, { initial: 0, intervalMs: 1000 }),
    );
    await act(async () => {});
    expect(result.current.error).toBe('Error: busy');
    expect(result.current.known).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.state).toBe(3);
    expect(result.current.error).toBe('');
  });

  it('can let a good read clear a failed action, as settings saves always did', async () => {
    const read = vi.fn<() => Promise<number>>(() => Promise.resolve(1));
    const { result } = renderHook(() =>
      useNativeState(true, read, {
        initial: 0,
        intervalMs: 20,
        readClearsActionError: true,
      }),
    );
    await act(async () => {
      await result.current.act(() => Promise.reject(new Error('rejected')));
    });
    expect(result.current.error).toBe('Error: rejected');
    await waitFor(() => expect(result.current.error).toBe(''));
  });

  it('drops a read that started before an action and waits while it runs', async () => {
    const stale = deferred<string>();
    const read = vi.fn<() => Promise<string>>().mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() =>
      useNativeState(true, read, { initial: 'initial', intervalMs: 60_000 }),
    );
    const action = deferred<string>();
    let done!: Promise<boolean>;
    act(() => {
      done = result.current.act(() => action.promise);
    });
    // One at a time: a second action while the first runs is refused.
    let second!: Promise<boolean>;
    act(() => {
      second = result.current.act(() => Promise.resolve('second'));
    });
    await expect(second).resolves.toBe(false);
    await act(async () => {
      action.resolve('shown');
      await done;
    });
    await act(async () => {
      stale.resolve('stale');
    });
    expect(result.current.state).toBe('shown');
    expect(result.current.latest.current).toBe('shown');
    expect(result.current.busy).toBe(false);
  });

  it('re-reads after a failed action when asked, and forwards the failure', async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue('before');
    const onActionError = vi.fn<(message: string) => void>();
    const { result } = renderHook(() =>
      useNativeState(true, read, {
        initial: 'initial',
        intervalMs: 60_000,
        refreshAfterError: true,
        onActionError,
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('before'));
    read.mockResolvedValue('what native did');
    await act(async () => {
      await result.current.act(() => Promise.reject(new Error('half done')));
    });
    expect(onActionError).toHaveBeenCalledWith('Error: half done');
    expect(result.current.state).toBe('what native did');
  });

  it('reports ready once, keeps a failed report, and does nothing outside the app', async () => {
    const markReady = vi.fn<() => Promise<void>>(() => Promise.reject(new Error('not ready')));
    const read = vi.fn<() => Promise<number>>(() => Promise.resolve(1));
    const { result, rerender } = renderHook(
      ({ paused }) =>
        useNativeState(true, read, {
          initial: 0,
          intervalMs: 20,
          paused,
          markReady,
        }),
      { initialProps: { paused: false } },
    );
    await waitFor(() => expect(result.current.error).toBe('Error: not ready'));
    rerender({ paused: true });
    rerender({ paused: false });
    expect(markReady).toHaveBeenCalledOnce();
    await waitFor(() => expect(read.mock.calls.length).toBeGreaterThan(2));
    expect(result.current.error).toBe('Error: not ready');

    const browser = renderHook(() =>
      useNativeState(false, read, { initial: 0, intervalMs: 20, markReady }),
    );
    expect(await browser.result.current.act(() => Promise.resolve(9))).toBe(false);
    expect(markReady).toHaveBeenCalledOnce();
  });

  it('derives its interval from the state shown', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<number>>(() => Promise.resolve(1000));
    renderHook(() => useNativeState(true, read, { initial: 50, intervalMs: (ms) => ms }));
    expect(read).toHaveBeenCalledOnce();
    // The first answer slows the schedule to 1 s, restarting it with an immediate read.
    await act(async () => {});
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(900);
    });
    expect(read).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('holds a refresh asked for during an action and reads once it succeeded', async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue('before');
    const { result } = renderHook(() =>
      useNativeState(true, read, { initial: 'initial', intervalMs: 60_000 }),
    );
    await waitFor(() => expect(result.current.state).toBe('before'));
    const reads = read.mock.calls.length;
    const action = deferred<string>();
    let done!: Promise<boolean>;
    let refreshed!: Promise<void>;
    let again!: Promise<void>;
    act(() => {
      done = result.current.act(() => action.promise);
    });
    const after = deferred<string>();
    read.mockReturnValueOnce(after.promise);
    act(() => {
      refreshed = result.current.refresh();
      again = result.current.refresh();
    });
    expect(read).toHaveBeenCalledTimes(reads);
    await act(async () => {
      action.resolve('saved');
      await done;
    });
    expect(result.current.state).toBe('saved');
    // One held read for both requests, newer than the action's answer.
    expect(read).toHaveBeenCalledTimes(reads + 1);
    await act(async () => {
      after.resolve('after save');
      await Promise.all([refreshed, again]);
    });
    expect(result.current.state).toBe('after save');
  });

  it('applies the re-read after a failed action before a refresh held during it', async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue('before');
    const { result } = renderHook(() =>
      useNativeState(true, read, {
        initial: 'initial',
        intervalMs: 60_000,
        refreshAfterError: true,
      }),
    );
    await waitFor(() => expect(result.current.state).toBe('before'));
    const action = deferred<string>();
    let done!: Promise<boolean>;
    let refreshed!: Promise<void>;
    act(() => {
      done = result.current.act(() => action.promise.then(() => Promise.reject(new Error('no'))));
    });
    act(() => {
      refreshed = result.current.refresh();
    });
    const reread = deferred<string>();
    const held = deferred<string>();
    read.mockReturnValueOnce(reread.promise).mockReturnValueOnce(held.promise);
    const reads = read.mock.calls.length;
    await act(async () => {
      action.resolve('ignored');
    });
    // Only the re-read runs while the action settles; the held refresh waits for it.
    expect(read).toHaveBeenCalledTimes(reads + 1);
    await act(async () => {
      reread.resolve('what native did');
      await done;
    });
    expect(result.current.state).toBe('what native did');
    expect(result.current.error).toBe('Error: no');
    await act(async () => {
      held.resolve('latest');
      await refreshed;
    });
    expect(result.current.state).toBe('latest');
    // A read never clears an action's failure unless asked to.
    expect(result.current.error).toBe('Error: no');
  });

  it('drops a refresh that started before an action and settles after it', async () => {
    const read = vi.fn<() => Promise<string>>().mockResolvedValue('before');
    const { result } = renderHook(() =>
      useNativeState(true, read, { initial: 'initial', intervalMs: 60_000 }),
    );
    await waitFor(() => expect(result.current.state).toBe('before'));
    const slow = deferred<string>();
    read.mockReturnValueOnce(slow.promise);
    let refreshed!: Promise<void>;
    act(() => {
      refreshed = result.current.refresh();
    });
    await act(async () => {
      await result.current.act(() => Promise.resolve('saved'));
    });
    await act(async () => {
      slow.resolve('stale');
      await refreshed;
    });
    expect(result.current.state).toBe('saved');
  });
});
