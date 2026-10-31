import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cubesStatus, NOW } from '../features/cubes/fixtures';
import { normalizeWorldMotion } from '../lib/worldMotion';
import * as api from '../services/worldMotion';
import type { WorldMotionStatus } from '../types/worldMotion';
import { useWorldMotion } from './useWorldMotion';

vi.mock('../services/worldMotion', () => ({
  readWorldMotion: vi.fn<typeof api.readWorldMotion>(),
  onWorldMotion: vi.fn<typeof api.onWorldMotion>(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const step = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

/** Native's motion at `x`, observed when read. */
const at = (x: number, revision: number, over: Partial<WorldMotionStatus> = {}) => {
  const now = NOW + revision * 10;
  const fix = { x, y: 150_000, z: 0, observed_ms: now };
  return normalizeWorldMotion({
    ...cubesStatus(),
    revision,
    now_ms: now,
    position: fix,
    last_position: fix,
    ...over,
  });
};

/** Native's motion at `x` in context `session` (native's id), all read at the same moment. */
const tied = (x: number, revision: number, session: string) => {
  const fix = { x, y: 150_000, z: 0, observed_ms: NOW };
  return normalizeWorldMotion({
    ...cubesStatus(),
    session_id: session,
    revision,
    now_ms: NOW,
    position: fix,
    last_position: fix,
  });
};

/** The listener, registered when the test says so; `emit` is native pushing an event. */
let emit: (motion: WorldMotionStatus) => void;
let register: () => void;
let refuse: (cause: unknown) => void;
const unsubscribe = vi.fn<() => void>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  emit = () => undefined;
  vi.mocked(api.onWorldMotion).mockImplementation((handler) => {
    const registration = deferred<() => void>();
    emit = handler;
    register = () => registration.resolve(unsubscribe);
    refuse = registration.reject;
    return registration.promise;
  });
  vi.mocked(api.readWorldMotion).mockResolvedValue(at(100, 1));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('useWorldMotion', () => {
  it('draws a pushed fix at once and reads again once the listener is registered', async () => {
    const { result } = renderHook(() => useWorldMotion(true));
    await step(0);
    expect(result.current?.position?.x).toBe(100);
    expect(api.readWorldMotion).toHaveBeenCalledTimes(1);
    vi.mocked(api.readWorldMotion).mockResolvedValue(at(110, 2));
    await act(async () => register());
    // Native does not replay events: what changed before registration is read.
    expect(api.readWorldMotion).toHaveBeenCalledTimes(2);
    expect(result.current?.position?.x).toBe(110);
    act(() => emit(at(120, 3)));
    expect(result.current?.position?.x).toBe(120);
  });

  it('never moves back for a bootstrap read that settles after a newer event', async () => {
    const slow = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(slow.promise);
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => register());
    act(() => emit(at(300, 7)));
    await act(async () => slow.resolve(at(100, 4)));
    expect(result.current?.position?.x).toBe(300);
    // An event of the same revision whose position has gone stale since does reach you.
    act(() => emit(at(300, 7, { now_ms: NOW + 90, position: null })));
    expect(result.current?.position).toBeNull();
    expect(result.current?.last_position?.x).toBe(300);
  });

  it('keeps a pushed fix when a read started before it fails late', async () => {
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => register());
    const late = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(late.promise);
    await step(1000);
    act(() => emit(at(300, 7)));
    await act(async () => late.reject(new Error('IPC down')));
    expect(result.current?.position?.x).toBe(300);
    // With no event since, a failed read still forgets the motion.
    vi.mocked(api.readWorldMotion).mockRejectedValue(new Error('IPC down'));
    await step(1000);
    expect(result.current).toBeNull();
  });

  it('never goes back to the context before, also read or pushed in the same millisecond', async () => {
    // Native's ids: a Clear in one capture counts the context up, its revision with it.
    const before = (x: number) => tied(x, 50, '1761148800000:3');
    const cleared = tied(-5, 51, '1761148800000:4');
    vi.mocked(api.readWorldMotion).mockResolvedValue(before(100));
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => register());
    expect(result.current?.position?.x).toBe(100);
    const late = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(late.promise);
    await step(1000);
    act(() => emit(cleared));
    await act(async () => late.resolve(before(300)));
    expect(result.current).toMatchObject({ session_id: '1761148800000:4', position: { x: -5 } });
    act(() => emit(before(310)));
    expect(result.current?.session_id).toBe('1761148800000:4');
    // A new capture starts its revisions again, yet is newer than the old capture's.
    act(() => emit(tied(7, 1, '1761148900000:0')));
    expect(result.current).toMatchObject({ session_id: '1761148900000:0', position: { x: 7 } });
    act(() => emit(tied(8, 60, '1761148800000:4')));
    expect(result.current?.position?.x).toBe(7);
  });

  it('takes a new session at once, e.g. after a zone change or Clear', async () => {
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => register());
    act(() => emit(at(300, 9)));
    act(() => emit(at(-5, 1, { session_id: 's2', now_ms: NOW + 200 })));
    expect(result.current).toMatchObject({ session_id: 's2', position: { x: -5 } });
    // A late event of the session before is not drawn on the new map.
    act(() => emit(at(310, 10, { now_ms: NOW + 150 })));
    expect(result.current?.session_id).toBe('s2');
  });

  it('reads again now and then while listening, in case an event was missed', async () => {
    renderHook(() => useWorldMotion(true));
    await act(async () => register());
    const reads = vi.mocked(api.readWorldMotion).mock.calls.length;
    await step(1000);
    expect(api.readWorldMotion).toHaveBeenCalledTimes(reads + 1);
  });

  it('reads every 250 ms instead when the event cannot be listened to', async () => {
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => refuse(new Error('no events')));
    vi.mocked(api.readWorldMotion).mockClear();
    vi.mocked(api.readWorldMotion).mockResolvedValue(at(150, 5));
    await step(1000);
    expect(vi.mocked(api.readWorldMotion).mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(result.current?.position?.x).toBe(150);
  });

  it('forgets the motion when a read fails, so the cube status draws you', async () => {
    const { result } = renderHook(() => useWorldMotion(true));
    await act(async () => register());
    expect(result.current).not.toBeNull();
    vi.mocked(api.readWorldMotion).mockRejectedValue(new Error('IPC down'));
    await step(1000);
    expect(result.current).toBeNull();
    act(() => emit(at(400, 20)));
    expect(result.current?.position?.x).toBe(400);
  });

  it('stops while paused, forgets what it had and drops a read that settles late', async () => {
    const { result, rerender } = renderHook(({ paused }) => useWorldMotion(true, { paused }), {
      initialProps: { paused: false },
    });
    await act(async () => register());
    expect(result.current).not.toBeNull();
    const late = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(late.promise);
    await step(1000);
    rerender({ paused: true });
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    await act(async () => late.resolve(at(999, 50)));
    act(() => emit(at(998, 51)));
    const reads = vi.mocked(api.readWorldMotion).mock.calls.length;
    await step(5000);
    expect(api.readWorldMotion).toHaveBeenCalledTimes(reads);
    // Shown again: nothing from before the pause, only what is read now.
    vi.mocked(api.readWorldMotion).mockResolvedValue(at(500, 60));
    rerender({ paused: false });
    expect(result.current).toBeNull();
    await step(0);
    expect(result.current?.position?.x).toBe(500);
  });

  it('drops the bootstrap read when hidden before it settles', async () => {
    const { result, rerender } = renderHook(({ paused }) => useWorldMotion(true, { paused }), {
      initialProps: { paused: false },
    });
    await step(0);
    const bootstrap = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(bootstrap.promise);
    await act(async () => register());
    rerender({ paused: true });
    await act(async () => bootstrap.resolve(at(999, 50)));
    const next = deferred<WorldMotionStatus>();
    vi.mocked(api.readWorldMotion).mockReturnValue(next.promise);
    rerender({ paused: false });
    await step(0);
    expect(result.current).toBeNull();
    await act(async () => next.resolve(at(500, 60)));
    expect(result.current?.position?.x).toBe(500);
  });

  it('unsubscribes on unmount, also before registration completes', async () => {
    const { unmount } = renderHook(() => useWorldMotion(true));
    unmount();
    await act(async () => register());
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('neither listens nor reads outside the desktop app', async () => {
    const { result } = renderHook(() => useWorldMotion(false));
    await step(2000);
    expect(api.onWorldMotion).not.toHaveBeenCalled();
    expect(api.readWorldMotion).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });
});
