import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PETS_CONFIG_FALLBACK } from '../lib/petsNormalize';
import {
  configurePets,
  hidePetWindow,
  lockPetWindow,
  markPetWindowReady,
  readPetsCatalogue,
  readPetsStatus,
  readPetWindowStatus,
  setPetHitRegions,
  showPetWindow,
} from './pets';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => vi.resetAllMocks());

describe('pet native contract', () => {
  it('maps every command and argument name', async () => {
    vi.mocked(invoke).mockResolvedValue({});
    await readPetsCatalogue();
    expect(invoke).toHaveBeenLastCalledWith('pets_catalogue');
    await readPetsStatus();
    expect(invoke).toHaveBeenLastCalledWith('pets_status', { profileId: null });
    await readPetsStatus('p2');
    expect(invoke).toHaveBeenLastCalledWith('pets_status', { profileId: 'p2' });
    await configurePets(PETS_CONFIG_FALLBACK);
    expect(invoke).toHaveBeenLastCalledWith('pets_configure', { config: PETS_CONFIG_FALLBACK });
    await readPetWindowStatus();
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_status');
    await markPetWindowReady();
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_ready');
    await showPetWindow();
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_show');
    await hidePetWindow();
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_hide');
    await lockPetWindow(false);
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_lock', { locked: false });
    await setPetHitRegions([[1, 2, 3, 4]], 1.5);
    expect(invoke).toHaveBeenLastCalledWith('pets_overlay_hit_regions', {
      regions: [[1, 2, 3, 4]],
      scale: 1.5,
    });
  });
});
