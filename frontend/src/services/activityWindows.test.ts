import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_ACTIVITY_WINDOW, type ActivityWindowKind } from '../types/activityWindows';
import {
  hideActivityWindow,
  lockActivityWindow,
  markActivityWindowReady,
  readActivityWindowStatus,
  setActivityHitRegions,
  showActivityWindow,
} from './activityWindows';
import { readTimersStatus } from './timers';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => vi.resetAllMocks());
describe('activity native contract', () => {
  it.each<ActivityWindowKind>(['timers', 'explore'])(
    'uses kind=%s for every command and defaults to unlocked',
    async (kind) => {
      vi.mocked(invoke).mockResolvedValue({});
      expect(await readActivityWindowStatus(kind)).toEqual(INITIAL_ACTIVITY_WINDOW);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_status', { kind });
      await markActivityWindowReady(kind);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_ready', { kind });
      await showActivityWindow(kind);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_show', { kind });
      await hideActivityWindow(kind);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_hide', { kind });
      await lockActivityWindow(kind, false);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_lock', { kind, locked: false });
      await setActivityHitRegions(kind, [[1, 2, 3, 4]], 1.5);
      expect(invoke).toHaveBeenLastCalledWith('activity_window_hit_regions', {
        kind,
        regions: [[1, 2, 3, 4]],
        scale: 1.5,
      });
    },
  );
  it('uses the native Timers catalogue projection without a second frontend schedule', async () => {
    vi.mocked(invoke).mockResolvedValue({ now_ms: 123, rows: [] });
    expect(await readTimersStatus()).toEqual({ now_ms: 123, rows: [] });
    expect(invoke).toHaveBeenCalledWith('timers_status');
  });
});
