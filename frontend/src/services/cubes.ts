import { invoke } from '@tauri-apps/api/core';
import { normalizeCubesStatus } from '../lib/cubesNormalize';
import type { CubesStatus } from '../types/cubes';

/** Native owns capture and every cube observation; this only reads them. */
export const readCubesStatus = (): Promise<CubesStatus> =>
  invoke<unknown>('cubes_status').then(normalizeCubesStatus);

/** Forgets the tracked observations (own position and zone are kept); answers the new status. */
export const clearCubes = (): Promise<CubesStatus> =>
  invoke<unknown>('cubes_clear').then(normalizeCubesStatus);
