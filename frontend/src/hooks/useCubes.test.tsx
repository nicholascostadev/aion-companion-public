import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cube, cubesStatus, NOW } from '../features/cubes/fixtures';
import * as api from '../services/cubes';
import type { CubesStatus } from '../types/cubes';
import { useCubes } from './useCubes';

vi.mock('../services/cubes', () => ({
  readCubesStatus: vi.fn<typeof api.readCubesStatus>(),
  clearCubes: vi.fn<typeof api.clearCubes>(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const step = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.mocked(api.readCubesStatus).mockResolvedValue(cubesStatus());
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('useCubes', () => {
  it('reads every 250 ms while shown and stops while paused', async () => {
    const { result, rerender } = renderHook(({ paused }) => useCubes(true, { paused }), {
      initialProps: { paused: false },
    });
    await step(0);
    expect(result.current.status?.cubes).toHaveLength(1);
    await step(1000);
    expect(api.readCubesStatus).toHaveBeenCalledTimes(5);
    rerender({ paused: true });
    await step(5000);
    expect(api.readCubesStatus).toHaveBeenCalledTimes(5);
  });

  it('never reads outside the desktop app', async () => {
    const { result } = renderHook(() => useCubes(false));
    await step(1000);
    expect(api.readCubesStatus).not.toHaveBeenCalled();
    expect(result.current.status).toBeNull();
  });

  it('drops every measurement from you when a read fails, keeping the rows', async () => {
    const { result } = renderHook(() => useCubes(true));
    await step(0);
    expect(result.current.status?.cubes[0]?.distance_m).toBe(42);
    vi.mocked(api.readCubesStatus).mockRejectedValue(new Error('IPC down'));
    await step(250);
    expect(result.current.error).toContain('IPC down');
    expect(result.current.status?.position).toBeNull();
    expect(result.current.status?.cubes[0]).toMatchObject({
      id: 65509,
      distance_m: null,
      height_m: null,
      bearing_deg: null,
    });
    vi.mocked(api.readCubesStatus).mockResolvedValue(cubesStatus({ revision: 2 }));
    await step(250);
    expect(result.current.error).toBe('');
    expect(result.current.status?.cubes[0]?.distance_m).toBe(42);
  });

  it('ignores an older revision of the same session', async () => {
    vi.mocked(api.readCubesStatus).mockResolvedValue(cubesStatus({ revision: 5 }));
    const { result } = renderHook(() => useCubes(true));
    await step(0);
    vi.mocked(api.readCubesStatus).mockResolvedValue(
      cubesStatus({ revision: 4, cubes: [cube({ id: 1 })] }),
    );
    await step(250);
    expect(result.current.status?.revision).toBe(5);
    expect(result.current.status?.cubes[0]?.id).toBe(65509);
  });

  it('marks only cubes arriving after the first snapshot as new', async () => {
    const { result } = renderHook(() => useCubes(true));
    await step(0);
    expect(result.current.fresh.size).toBe(0);
    vi.mocked(api.readCubesStatus).mockResolvedValue(
      cubesStatus({ revision: 2, cubes: [cube(), cube({ id: 7 })] }),
    );
    await step(250);
    expect([...result.current.fresh]).toEqual([7]);
    // A failing read lets the mark go rather than keeping it until reads recover.
    vi.mocked(api.readCubesStatus).mockRejectedValue(new Error('IPC down'));
    await step(250);
    expect(result.current.fresh.size).toBe(0);
    vi.mocked(api.readCubesStatus).mockResolvedValue(
      cubesStatus({ revision: 3, cubes: [cube(), cube({ id: 7 })] }),
    );
    await step(250);
    expect(result.current.fresh.size).toBe(0);
  });

  it('clears one at a time, and a read started before Clear never brings rows back', async () => {
    const { result } = renderHook(() => useCubes(true));
    await step(0);
    const late = deferred<CubesStatus>();
    vi.mocked(api.readCubesStatus).mockReturnValueOnce(late.promise);
    await step(250);
    const cleared = deferred<CubesStatus>();
    vi.mocked(api.clearCubes).mockReturnValue(cleared.promise);
    act(() => {
      void result.current.clear();
      void result.current.clear();
    });
    expect(api.clearCubes).toHaveBeenCalledOnce();
    expect(result.current.clearing).toBe(true);
    // Polls wait while Clear is in flight.
    const reads = vi.mocked(api.readCubesStatus).mock.calls.length;
    await step(1000);
    expect(vi.mocked(api.readCubesStatus).mock.calls.length).toBe(reads);
    await act(async () => {
      late.resolve(cubesStatus({ revision: 9 }));
      cleared.resolve(cubesStatus({ session_id: 's2', revision: 1, cubes: [] }));
    });
    expect(result.current.clearing).toBe(false);
    expect(result.current.status?.session_id).toBe('s2');
    expect(result.current.status?.cubes).toEqual([]);
  });
});
