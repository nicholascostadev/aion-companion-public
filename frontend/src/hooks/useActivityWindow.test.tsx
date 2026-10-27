import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/activityWindows';
import { INITIAL_ACTIVITY_WINDOW, type ActivityWindowKind } from '../types/activityWindows';
import { useActivityWindow } from './useActivityWindow';

vi.mock('../services/companion', () => ({ isNative: () => true }));
vi.mock('../services/activityWindows', () => ({
  readActivityWindowStatus: vi.fn<typeof api.readActivityWindowStatus>(),
  markActivityWindowReady: vi.fn<typeof api.markActivityWindowReady>(),
  showActivityWindow: vi.fn<typeof api.showActivityWindow>(),
  hideActivityWindow: vi.fn<typeof api.hideActivityWindow>(),
  lockActivityWindow: vi.fn<typeof api.lockActivityWindow>(),
}));
beforeEach(() => {
  vi.mocked(api.readActivityWindowStatus).mockResolvedValue(INITIAL_ACTIVITY_WINDOW);
  vi.mocked(api.markActivityWindowReady).mockResolvedValue();
  vi.mocked(api.showActivityWindow).mockResolvedValue({
    ...INITIAL_ACTIVITY_WINDOW,
    requested: true,
    visible: true,
  });
  vi.mocked(api.hideActivityWindow).mockResolvedValue(INITIAL_ACTIVITY_WINDOW);
  vi.mocked(api.lockActivityWindow).mockImplementation((_, locked) =>
    Promise.resolve({ ...INITIAL_ACTIVITY_WINDOW, locked }),
  );
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('activity window controller', () => {
  it.each<ActivityWindowKind>(['timers', 'explore'])(
    'routes ready, visibility and lock commands for %s',
    async (kind) => {
      const { result, rerender } = renderHook(() => useActivityWindow(kind, { markReady: true }));
      await waitFor(() => expect(result.current.known).toBe(true));
      expect(result.current.status.locked).toBe(false);
      expect(api.markActivityWindowReady).toHaveBeenCalledWith(kind);
      await act(async () => {
        await result.current.toggle();
      });
      expect(api.showActivityWindow).toHaveBeenCalledWith(kind);
      expect(result.current.status.requested).toBe(true);
      await act(async () => {
        await result.current.toggle();
      });
      expect(api.hideActivityWindow).toHaveBeenCalledWith(kind);
      await act(async () => {
        await result.current.lock(true);
      });
      expect(api.lockActivityWindow).toHaveBeenCalledWith(kind, true);
      expect(result.current.status.locked).toBe(true);
      await act(async () => {
        await result.current.lock(false);
      });
      expect(api.lockActivityWindow).toHaveBeenLastCalledWith(kind, false);
      expect(result.current.status.locked).toBe(false);
      rerender();
      expect(api.markActivityWindowReady).toHaveBeenCalledOnce();
    },
  );
  it('rejects overlapping mutations and ignores an older poll', async () => {
    let finish!: (s: typeof INITIAL_ACTIVITY_WINDOW) => void;
    vi.mocked(api.readActivityWindowStatus).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useActivityWindow('timers'));
    await act(async () => {
      await result.current.show();
    });
    await act(async () => {
      finish(INITIAL_ACTIVITY_WINDOW);
    });
    expect(result.current.status.requested).toBe(true);
    let done!: (s: typeof INITIAL_ACTIVITY_WINDOW) => void;
    vi.mocked(api.hideActivityWindow).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    let pending!: Promise<boolean>;
    await act(async () => {
      pending = result.current.hide();
    });
    await act(async () => {
      expect(await result.current.show()).toBe(false);
      done(INITIAL_ACTIVITY_WINDOW);
      await pending;
    });
    expect(api.showActivityWindow).toHaveBeenCalledOnce();
  });
});
