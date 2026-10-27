import {
  hidePetWindow,
  lockPetWindow,
  markPetWindowReady,
  readPetWindowStatus,
  showPetWindow,
} from '../services/pets';
import type { PetWindowStatus } from '../types/pets';
import {
  useWindowController,
  type InGameWindowApi,
  type WindowControllerOptions,
} from './useWindowController';

const initial: PetWindowStatus = {
  requested: false,
  visible: false,
  ready: false,
  locked: false,
  game_active: false,
  errors: [],
};

const api: InGameWindowApi<PetWindowStatus> = {
  read: readPetWindowStatus,
  ready: markPetWindowReady,
  show: showPetWindow,
  hide: hidePetWindow,
  lock: lockPetWindow,
};

/**
 * Native state of the in-game pet radar window, with one-at-a-time show, hide and lock
 * actions. `status` always follows native, so changes from other windows are picked up.
 * The radar window itself passes `markReady` to report `pets_overlay_ready` once.
 */
export function usePetWindow(options: WindowControllerOptions = {}) {
  return useWindowController(api, initial, options);
}

export type PetWindowController = ReturnType<typeof usePetWindow>;
