import { invoke } from '@tauri-apps/api/core';

/**
 * Sizes the Group window to its content (logical px). Native clamps it to the monitor's
 * work area, keeps it inside, and never activates or shows the window.
 */
export const fitGroupWindow = (width: number, height: number) =>
  invoke<void>('group_fit', { width, height });
