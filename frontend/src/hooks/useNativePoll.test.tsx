import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNativePoll, type PollOptions } from './useNativePoll';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** Lets settled reads run their handlers. */
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

type Props = { read: () => Promise<number> } & Partial<PollOptions<number>>;
function setup(initial: Props) {
  const onData = vi.fn<(value: number) => void>();
  const onError = vi.fn<(message: string) => void>();
  const hook = renderHook(
    ({ read, ...options }: Props) =>
      useNativePoll(read, {
        enabled: true,
        intervalMs: 100,
        onData,
        onError,
        ...options,
      }),
    { initialProps: initial },
  );
  return { ...hook, onData, onError };
}

describe('native poll', () => {
  it('reads at once and on schedule, but never starts a read while one is in flight', async () => {
    const pending = deferred<number>();
    const read = vi.fn<() => Promise<number>>().mockReturnValueOnce(pending.promise);
    const { onData } = setup({ read });
    expect(read).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    expect(read).toHaveBeenCalledOnce();
    read.mockResolvedValue(2);
    pending.resolve(1);
    await settle();
    expect(onData).toHaveBeenCalledWith(1);
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenLastCalledWith(2);
  });

  it('drops a read that settles after invalidate, after it was disabled or after unmount', async () => {
    let pending = deferred<number>();
    const read = vi.fn<() => Promise<number>>(() => pending.promise);
    const { result, rerender, unmount, onData, onError } = setup({ read });
    result.current.invalidate();
    pending.resolve(1);
    await settle();
    expect(onData).not.toHaveBeenCalled();

    pending = deferred<number>();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    rerender({ read, enabled: false });
    pending.reject(new Error('gone'));
    await settle();
    expect(onError).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(read).toHaveBeenCalledTimes(2);

    pending = deferred<number>();
    rerender({ read, enabled: true });
    expect(read).toHaveBeenCalledTimes(3);
    unmount();
    pending.resolve(3);
    await settle();
    expect(onData).not.toHaveBeenCalled();
  });

  it('restarts at once for a new read and ignores the previous one', async () => {
    const first = deferred<number>();
    const readA = vi.fn<() => Promise<number>>(() => first.promise);
    const readB = vi.fn<() => Promise<number>>(() => Promise.resolve(2));
    const { rerender, onData } = setup({ read: readA });
    rerender({ read: readB });
    expect(readB).toHaveBeenCalledOnce();
    first.resolve(1);
    await settle();
    expect(onData).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('skips scheduled reads while asked to and reports failures as text', async () => {
    let busy = true;
    const read = vi.fn<() => Promise<number>>(() => Promise.reject(new Error('no status')));
    const { onError } = setup({ read, skip: () => busy });
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(read).not.toHaveBeenCalled();
    busy = false;
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(read).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('Error: no status');
  });

  it('refreshes once outside the schedule, dropped like any other read', async () => {
    const read = vi.fn<() => Promise<number>>(() => Promise.resolve(5));
    const { result, onData } = setup({ read, enabled: false });
    await act(async () => {
      await result.current.refresh();
    });
    expect(onData).toHaveBeenCalledExactlyOnceWith(5);
    const pending = deferred<number>();
    read.mockReturnValueOnce(pending.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.refresh();
    });
    result.current.invalidate();
    pending.resolve(6);
    await act(async () => {
      await done;
    });
    expect(onData).toHaveBeenCalledOnce();
  });

  it('applies only the newest read to settle, whether scheduled or refreshed', async () => {
    const scheduled = deferred<number>();
    const read = vi.fn<() => Promise<number>>().mockReturnValueOnce(scheduled.promise);
    const { result, onData, onError } = setup({ read });
    const manual = deferred<number>();
    read.mockReturnValueOnce(manual.promise);
    let done!: Promise<void>;
    act(() => {
      done = result.current.refresh();
    });
    manual.resolve(2);
    await act(async () => {
      await done;
    });
    expect(onData).toHaveBeenCalledExactlyOnceWith(2);
    // The slow scheduled read started first: neither its answer nor its failure is shown.
    scheduled.reject(new Error('late'));
    await settle();
    expect(onData).toHaveBeenCalledOnce();
    expect(onError).not.toHaveBeenCalled();

    // Two refreshes at once: the older one settling last is dropped, also after a failure.
    const older = deferred<number>();
    const newer = deferred<number>();
    read.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = result.current.refresh();
      second = result.current.refresh();
    });
    newer.reject(new Error('busy'));
    await act(async () => {
      await second;
    });
    expect(onError).toHaveBeenCalledExactlyOnceWith('Error: busy');
    older.resolve(3);
    await act(async () => {
      await first;
    });
    expect(onData).toHaveBeenCalledOnce();
  });

  it('refreshes the current read, also from an old callback, and drops the replaced one', async () => {
    const first = deferred<number>();
    const readA = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(1)
      .mockReturnValueOnce(first.promise);
    const readB = vi.fn<() => Promise<number>>(() => Promise.resolve(2));
    const { result, rerender, onData } = setup({ read: readA, enabled: false });
    const refresh = result.current.refresh;
    await act(async () => {
      await refresh();
    });
    expect(onData).toHaveBeenCalledExactlyOnceWith(1);
    let done!: Promise<void>;
    act(() => {
      done = refresh();
    });
    rerender({ read: readB, enabled: false });
    expect(result.current.refresh).toBe(refresh);
    first.resolve(10);
    await act(async () => {
      await done;
    });
    expect(onData).toHaveBeenCalledOnce();
    await act(async () => {
      await refresh();
    });
    expect(readA).toHaveBeenCalledTimes(2);
    expect(onData).toHaveBeenLastCalledWith(2);
  });
});
