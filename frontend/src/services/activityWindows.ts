import { invoke } from '@tauri-apps/api/core';
import { normalizeWindowStatus } from '../lib/petsNormalize';
import type { ActivityWindowKind, ActivityWindowStatus } from '../types/activityWindows';

export const readActivityWindowStatus = (kind: ActivityWindowKind): Promise<ActivityWindowStatus> =>
  invoke<unknown>('activity_window_status', { kind }).then(normalizeWindowStatus);
export const markActivityWindowReady = (kind: ActivityWindowKind) =>
  invoke<void>('activity_window_ready', { kind });
export const showActivityWindow = (kind: ActivityWindowKind): Promise<ActivityWindowStatus> =>
  invoke<unknown>('activity_window_show', { kind }).then(normalizeWindowStatus);
export const hideActivityWindow = (kind: ActivityWindowKind): Promise<ActivityWindowStatus> =>
  invoke<unknown>('activity_window_hide', { kind }).then(normalizeWindowStatus);
export const lockActivityWindow = (
  kind: ActivityWindowKind,
  locked: boolean,
): Promise<ActivityWindowStatus> =>
  invoke<unknown>('activity_window_lock', { kind, locked }).then(normalizeWindowStatus);
/** Physical client-pixel controls, refreshed while the locked window is click-through. */
export const setActivityHitRegions = (
  kind: ActivityWindowKind,
  regions: [number, number, number, number][],
  scale: number,
) => invoke<number>('activity_window_hit_regions', { kind, regions, scale });
