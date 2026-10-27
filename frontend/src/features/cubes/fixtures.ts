import type { CubeObservation, CubesStatus } from '../../types/cubes';

export const NOW = Date.UTC(2026, 9, 22, 18, 0);

export const cube = (overrides: Partial<CubeObservation> = {}): CubeObservation => ({
  id: 65509,
  template_id: 1200039,
  x: -50205,
  y: 126283,
  z: 15449,
  first_seen_ms: NOW - 20_000,
  last_seen_ms: NOW - 1_000,
  status: 'observed',
  opened_by_local: null,
  distance_m: 42,
  height_m: 6,
  bearing_deg: 90,
  ...overrides,
});

const HERE = { x: -54405, y: 126283, z: 14849, observed_ms: NOW - 200 };

/** A capturing status with a fresh position and one cube nearby; no facing is known. */
export const cubesStatus = (overrides: Partial<CubesStatus> = {}): CubesStatus => ({
  running: true,
  phase: 'capturing',
  message: '',
  experimental: true,
  session_id: 's1',
  revision: 1,
  zone_id: 1010,
  map_id: 'World/World_L/World_L_A',
  now_ms: NOW,
  position: HERE,
  position_age_ms: 200,
  last_position: HERE,
  facing: null,
  cubes: [cube()],
  observed_total: 3,
  opened_total: 1,
  ...overrides,
});

/**
 * Synthetic possible locations in the bundled file's shape, for tests only (not game data):
 * on Verteron two points 70 cm apart (one place) and two far apart, one on Altgard.
 */
export const SPOTS_FILE = {
  version: 1,
  maps: [
    {
      map_id: 'World/World_L/World_L_A',
      groups: [
        {
          id: 'a',
          points: [
            [-50_000, 126_000, 15_000],
            [-50_050, 126_050, 15_000],
            [60_000, -40_000, 9_000],
          ],
        },
        { id: 'b', points: [[-120_000, 30_000, 7_000]] },
      ],
    },
    {
      map_id: 'World/World_D/World_D_A',
      groups: [{ id: 'c', points: [[10_000, 10_000, 0]] }],
    },
  ],
};
