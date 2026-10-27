import { describe, expect, it } from 'vitest';
import { ALTGARD, RESHANTA, VERTERON } from '../maps/atlas';
import { clusterCell, clusterPlaces } from '../maps/spots';
import { SPOTS_FILE } from './fixtures';
import { cubeSpots, hasCubeSpots, parseCubeSpots } from './spawns';

describe('possible cube locations', () => {
  it('reads the file into places per map', () => {
    const catalogue = parseCubeSpots(SPOTS_FILE);
    const verteron = catalogue.get(VERTERON)!;
    expect(verteron.points).toBe(4);
    expect(verteron.groups).toBe(2);
    expect(verteron.places).toEqual([
      { x: -50_000, y: 126_000, count: 2, groups: [1] },
      { x: 60_000, y: -40_000, count: 1, groups: [1] },
      { x: -120_000, y: 30_000, count: 1, groups: [2] },
    ]);
    expect(catalogue.get(ALTGARD)?.points).toBe(1);
  });

  it('skips what it cannot place, and never throws', () => {
    expect(parseCubeSpots(null).size).toBe(0);
    expect(parseCubeSpots({ ...SPOTS_FILE, version: 2 }).size).toBe(0);
    const catalogue = parseCubeSpots({
      version: 1,
      maps: [
        { map_id: 'verteron', groups: [{ id: 'x', points: [[1, 2, 3]] }] },
        { map_id: RESHANTA, groups: 'none' },
        {
          map_id: VERTERON,
          groups: [
            { id: 'bad', points: [[Number.NaN, 0, 0], ['1', 2], [5]] },
            { points: [[1, 2, 3]] },
            {
              id: 'ok',
              points: [
                [100_000, 0, null],
                [200_000, 0],
              ],
            },
          ],
        },
        { map_id: VERTERON, groups: [{ id: 'again', points: [[0, 0, 0]] }] },
      ],
    });
    expect([...catalogue.keys()]).toEqual([VERTERON]);
    // Only usable groups are numbered.
    expect(catalogue.get(VERTERON)).toMatchObject({ points: 2, groups: 1 });
    expect(catalogue.get(VERTERON)?.places.map((p) => p.groups)).toEqual([[1], [1]]);
  });

  it('bundles the game data for Verteron and Altgard, every point accounted for', () => {
    expect(hasCubeSpots()).toBe(true);
    for (const [id, points, groups] of [
      [VERTERON, 1440, 95],
      [ALTGARD, 1371, 59],
    ] as const) {
      const spots = cubeSpots(id)!;
      expect(spots).toMatchObject({ points, groups });
      expect(spots.places.reduce((n, p) => n + p.count, 0)).toBe(points);
    }
    expect(cubeSpots(RESHANTA)).toBeNull();
  });

  it('draws a whole map as a few hundred groups at most, without losing a point', () => {
    for (const id of [VERTERON, ALTGARD]) {
      const spots = cubeSpots(id)!;
      // A 640 px view of a whole 16384 px sheet, the farthest common case.
      const cell = clusterCell(16_384 / 640);
      const drawn = spots.places.map((p) => [p.x * 0.02, p.y * 0.02] as const);
      const clusters = clusterPlaces(drawn, spots.places, cell);
      expect(clusters.length).toBeLessThan(300);
      expect(clusters.reduce((n, c) => n + c.count, 0)).toBe(spots.points);
    }
  });
});
