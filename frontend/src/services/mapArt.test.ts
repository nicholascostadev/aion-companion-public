import { invoke } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureMapArt, readMapArtStatus } from './mapArt';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>(), isTauri: () => true }));
afterEach(() => vi.resetAllMocks());

const ID = 'Intersever/Abyss/Abyss_Reshanta_A';

describe('map art native contract', () => {
  it('names each command and its map id argument', async () => {
    const reply = { map_id: ID, phase: 'ready', downloaded_bytes: 3, total_bytes: 3, error: null };
    vi.mocked(invoke).mockResolvedValue(reply);
    expect(await readMapArtStatus(ID)).toEqual(reply);
    expect(invoke).toHaveBeenLastCalledWith('map_art_status', { mapId: ID });
    expect(await ensureMapArt(ID)).toEqual(reply);
    expect(invoke).toHaveBeenLastCalledWith('map_art_ensure', { mapId: ID });
  });
});
