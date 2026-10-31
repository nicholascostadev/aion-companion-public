import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { normalizeWorldMotion } from '../lib/worldMotion';
import type { WorldMotionStatus } from '../types/worldMotion';

/** Native's latest motion status after each own fix, context change or expiry; not replayed. */
export const WORLD_MOTION_UPDATED = 'world-motion-updated';

/** Your position as capture owns it right now (no cubes); the event's starting point. */
export const readWorldMotion = (): Promise<WorldMotionStatus> =>
  invoke<unknown>('world_motion_status').then(normalizeWorldMotion);

export const onWorldMotion = (handler: (motion: WorldMotionStatus) => void): Promise<() => void> =>
  listen<unknown>(WORLD_MOTION_UPDATED, (event) => handler(normalizeWorldMotion(event.payload)));
