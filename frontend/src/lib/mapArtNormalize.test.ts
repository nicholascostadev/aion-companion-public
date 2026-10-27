import { describe, expect, it } from 'vitest';
import { normalizeMapArtStatus } from './mapArtNormalize';

const ID = 'World/World_L/World_L_A';

describe('normalizeMapArtStatus', () => {
  it('keeps a well-formed report', () => {
    expect(
      normalizeMapArtStatus(
        { map_id: ID, phase: 'downloading', downloaded_bytes: 5, total_bytes: 10, error: null },
        ID,
      ),
    ).toEqual({
      map_id: ID,
      phase: 'downloading',
      downloaded_bytes: 5,
      total_bytes: 10,
      error: null,
    });
  });

  it('never reads another map, an unknown phase or a malformed body as ready', () => {
    for (const value of [
      { map_id: 'World/World_D/World_D_A', phase: 'ready' },
      { map_id: ID, phase: 'done' },
      null,
      'ready',
      [],
    ])
      expect(normalizeMapArtStatus(value, ID)).toEqual({
        map_id: ID,
        phase: 'error',
        downloaded_bytes: 0,
        total_bytes: 0,
        error: null,
      });
  });

  it('keeps progress within the whole and an error only on a failure', () => {
    expect(
      normalizeMapArtStatus(
        { map_id: ID, phase: 'downloading', downloaded_bytes: 12, total_bytes: 10, error: 'x' },
        ID,
      ),
    ).toMatchObject({ downloaded_bytes: 10, error: null });
    expect(
      normalizeMapArtStatus(
        { map_id: ID, phase: 'error', downloaded_bytes: -1, total_bytes: 1.5, error: ' offline ' },
        ID,
      ),
    ).toMatchObject({ downloaded_bytes: 0, total_bytes: 0, error: 'offline' });
  });
});
