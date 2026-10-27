import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, timersStatus } from '../features/timers/fixtures';
import * as api from '../services/timers';
import { useTimers } from './useTimers';

vi.mock('../services/timers', () => ({ readTimersStatus: vi.fn<typeof api.readTimersStatus>() }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(api.readTimersStatus).mockResolvedValue(timersStatus());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('useTimers', () => {
  it('ticks locally from native time and reads only every 15 seconds', async () => {
    const { result } = renderHook(() => useTimers(true));
    await act(async () => {});
    expect(result.current.now).toBe(NOW);
    expect(result.current.stale).toBe(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(result.current.now).toBe(NOW + 10_000);
    expect(api.readTimersStatus).toHaveBeenCalledOnce();
    vi.mocked(api.readTimersStatus).mockResolvedValue(timersStatus({ now_ms: NOW + 15_000 }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(api.readTimersStatus).toHaveBeenCalledTimes(2);
    expect(result.current.now).toBe(NOW + 15_000);
  });
  it('stops polling while paused and replaces the old clock on resume', async () => {
    const { result, rerender } = renderHook(({ paused }) => useTimers(true, { paused }), {
      initialProps: { paused: false },
    });
    await act(async () => {});
    rerender({ paused: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.readTimersStatus).toHaveBeenCalledOnce();
    expect(result.current.stale).toBe(true);
    vi.mocked(api.readTimersStatus).mockResolvedValue(timersStatus({ now_ms: NOW + 60_000 }));
    rerender({ paused: false });
    await act(async () => {});
    expect(result.current.now).toBe(NOW + 60_000);
    expect(result.current.stale).toBe(false);
  });
  it('clears live certainty on failure and refreshes immediately after reconnect', async () => {
    const { result } = renderHook(() => useTimers(true));
    await act(async () => {});
    vi.mocked(api.readTimersStatus).mockRejectedValueOnce(new Error('Disconnected'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(result.current.stale).toBe(true);
    expect(result.current.error).toContain('Disconnected');
    vi.mocked(api.readTimersStatus).mockResolvedValue(timersStatus({ now_ms: NOW + 120_000 }));
    await act(async () => {
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.error).toBe('');
    expect(result.current.now).toBe(NOW + 120_000);
    expect(result.current.stale).toBe(false);
  });
  it('does not retain alive certainty if native stops responding', async () => {
    const { result } = renderHook(() => useTimers(true));
    await act(async () => {});
    vi.mocked(api.readTimersStatus).mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(46_000);
    });
    expect(result.current.stale).toBe(true);
    expect(api.readTimersStatus).toHaveBeenCalledTimes(2);
  });
  it('ignores an obsolete result after pause and skips native calls in a browser', async () => {
    let finish!: (value: ReturnType<typeof timersStatus>) => void;
    vi.mocked(api.readTimersStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ native, paused }) => useTimers(native, { paused }), {
      initialProps: { native: true, paused: false },
    });
    rerender({ native: true, paused: true });
    await act(async () => {
      finish(timersStatus());
    });
    expect(result.current.status).toBeNull();
    rerender({ native: false, paused: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(api.readTimersStatus).toHaveBeenCalledOnce();
  });
});
