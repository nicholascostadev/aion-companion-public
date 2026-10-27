import { invoke } from '@tauri-apps/api/core';
import {
  normalizeCatalogue,
  normalizeMotion,
  normalizeStatus,
  normalizeWindowStatus,
} from '../lib/petsNormalize';
import type { PetCatalogue, PetsConfig, PetsStatus, PetWindowStatus } from '../types/pets';

/* Local-only native pet commands. The catalogue ships with the app; nothing is downloaded. */

/** Static pet, map and source-monster catalogue. */
export const readPetsCatalogue = (): Promise<PetCatalogue> =>
  invoke<unknown>('pets_catalogue').then(normalizeCatalogue);

/** Collection and radar state of one saved profile; `null` follows the live character. */
export const readPetsStatus = (profileId: string | null = null): Promise<PetsStatus> =>
  invoke<unknown>('pets_status', { profileId }).then(normalizeStatus);

/** Own observed position only, without cloning the collection or computing nearby rows. */
export const readPetMotion = (profileId: string | null = null) =>
  invoke<unknown>('pets_motion', { profileId }).then(normalizeMotion);

/** Full preference replacement; native rejects a stale `revision`. */
export const configurePets = (config: PetsConfig): Promise<PetsStatus> =>
  invoke<unknown>('pets_configure', { config }).then(normalizeStatus);

/* In-game pet radar window (`pet-radar`). */

export const readPetWindowStatus = (): Promise<PetWindowStatus> =>
  invoke<unknown>('pets_overlay_status').then(normalizeWindowStatus);
export const markPetWindowReady = () => invoke<void>('pets_overlay_ready');
export const showPetWindow = (): Promise<PetWindowStatus> =>
  invoke<unknown>('pets_overlay_show').then(normalizeWindowStatus);
export const hidePetWindow = (): Promise<PetWindowStatus> =>
  invoke<unknown>('pets_overlay_hide').then(normalizeWindowStatus);
export const lockPetWindow = (locked: boolean): Promise<PetWindowStatus> =>
  invoke<unknown>('pets_overlay_lock', { locked }).then(normalizeWindowStatus);
/**
 * Controls of the locked radar that take clicks: `[x, y, width, height]` in physical client
 * pixels at device pixel ratio `scale`. An empty list clears them.
 */
export const setPetHitRegions = (regions: [number, number, number, number][], scale: number) =>
  invoke<number>('pets_overlay_hit_regions', { regions, scale });
