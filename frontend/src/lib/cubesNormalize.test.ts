import { describe, expect, it } from 'vitest';
import { cube, cubesStatus, NOW } from '../features/cubes/fixtures';
import { MAX_CUBE_ROWS, normalizeCubesStatus, withoutGeometry } from './cubesNormalize';

const raw = (overrides: Record<string, unknown> = {}) =>
  JSON.parse(JSON.stringify({ ...cubesStatus(), ...overrides })) as Record<string, unknown>;

describe('cube status normalisation', () => {
  it('keeps a well-formed native status as it is', () => {
    expect(normalizeCubesStatus(raw())).toEqual(cubesStatus());
  });

  it('never measures from a missing own position, even if a payload claims distances', () => {
    const status = normalizeCubesStatus(raw({ position: null, position_age_ms: 30_000 }));
    expect(status.position).toBeNull();
    expect(status.position_age_ms).toBe(30_000);
    expect(status.cubes[0]).toMatchObject({ distance_m: null, height_m: null, bearing_deg: null });
  });

  it('never measures a cube that is opened, gone, out of view or unconfirmed', () => {
    const states = ['opened', 'removed', 'out_of_view', 'stale', 'mystery'];
    const status = normalizeCubesStatus(
      raw({ cubes: states.map((s, i) => ({ ...cube({ id: i }), status: s })) }),
    );
    expect(status.cubes.map((c) => c.status)).toEqual([
      'opened',
      'removed',
      'out_of_view',
      'stale',
      'stale',
    ]);
    for (const c of status.cubes)
      expect([c.distance_m, c.height_m, c.bearing_deg]).toEqual([null, null, null]);
  });

  it('lists nothing and has no position while capture is not running', () => {
    const status = normalizeCubesStatus(raw({ running: false, phase: 'stopped' }));
    expect(status.cubes).toEqual([]);
    expect(status.position).toBeNull();
  });

  it('drops malformed and duplicate rows and invalid measurements without guessing', () => {
    const status = normalizeCubesStatus(
      raw({
        cubes: [
          { ...cube({ id: 1 }), x: 'far' },
          { ...cube({ id: 2 }), distance_m: -5, bearing_deg: 450 },
          cube({ id: 2, distance_m: 9 }),
          { ...cube({ id: 3 }), height_m: undefined, bearing_deg: -90, opened_by_local: 'yes' },
          null,
        ],
      }),
    );
    expect(status.cubes.map((c) => c.id)).toEqual([2, 3]);
    // A negative distance is unknown, and so is the direction measured with it.
    expect(status.cubes[0]).toMatchObject({ distance_m: null, bearing_deg: null, height_m: null });
    expect(status.cubes[1]).toMatchObject({
      distance_m: 42,
      height_m: null,
      bearing_deg: 270,
      opened_by_local: null,
    });
  });

  it('reads at most the rows native may send, however large the payload', () => {
    const many = Array.from({ length: 20_000 }, (_, i) => cube({ id: i }));
    const status = normalizeCubesStatus(raw({ cubes: many }));
    expect(status.cubes).toHaveLength(MAX_CUBE_ROWS);
    expect(status.cubes.at(-1)?.id).toBe(MAX_CUBE_ROWS - 1);
  });

  it('survives a payload that is not an object', () => {
    for (const value of [null, undefined, 'x', 3, []]) {
      const status = normalizeCubesStatus(value);
      expect(status).toMatchObject({
        running: false,
        cubes: [],
        position: null,
        experimental: true,
      });
    }
  });

  it('can drop every measurement while keeping rows and position age', () => {
    const facing = { degrees: 30, observed_ms: NOW - 1000 };
    const status = withoutGeometry(cubesStatus({ facing }));
    expect(status.position).toBeNull();
    // A failed read or Clear lets the last position and facing go too.
    expect(status.last_position).toBeNull();
    expect(status.facing).toBeNull();
    expect(status.position_age_ms).toBe(200);
    expect(status.cubes).toHaveLength(1);
    expect(status.cubes[0]).toMatchObject({ distance_m: null, height_m: null, bearing_deg: null });
  });
});

describe('own position, last position and facing', () => {
  const at = (age: number) => ({ x: 100, y: 200, z: 5, observed_ms: NOW - age });

  it('keeps a fresh position as the last one and its facing in coordinate degrees', () => {
    const status = normalizeCubesStatus(
      raw({ last_position: null, facing: { degrees: -90, observed_ms: NOW - 9_000 } }),
    );
    expect(status.now_ms).toBe(NOW);
    expect(status.last_position).toEqual(status.position);
    // 0 = +X, 90 = +Y: −90 is 270, never re-based to the cube bearing's map-up zero.
    expect(status.facing).toEqual({ degrees: 270, observed_ms: NOW - 9_000 });
    expect(
      normalizeCubesStatus(raw({ facing: { degrees: 450, observed_ms: NOW } })).facing,
    )?.toEqual({ degrees: 90, observed_ms: NOW });
  });

  it('measures nothing from a position older than 15 s, keeping only the last one native gave', () => {
    const status = normalizeCubesStatus(raw({ position: at(15_001), last_position: at(15_001) }));
    expect(status.position).toBeNull();
    expect(status.last_position).toEqual(at(15_001));
    expect(status.cubes[0]).toMatchObject({ distance_m: null, height_m: null, bearing_deg: null });
    // A stale position is never promoted to the last one.
    const alone = normalizeCubesStatus(raw({ position: at(20_000), last_position: null }));
    expect(alone.position).toBeNull();
    expect(alone.last_position).toBeNull();
    expect(normalizeCubesStatus(raw({ position: at(15_000) })).position).toEqual(at(15_000));
  });

  it('hides fixes and facings from the future, and implausible values', () => {
    const status = normalizeCubesStatus(
      raw({
        position: at(-1),
        last_position: at(-5),
        facing: { degrees: 10, observed_ms: NOW + 1 },
      }),
    );
    expect([status.position, status.last_position, status.facing]).toEqual([null, null, null]);
    expect(status.cubes[0]?.distance_m).toBeNull();
    for (const bad of [
      { ...at(0), x: 1e12 },
      { ...at(0), y: Number.NaN },
      { ...at(0), observed_ms: -1 },
      { x: 1, y: 2 },
    ])
      expect(normalizeCubesStatus(raw({ position: bad, last_position: null })).position).toBeNull();
    for (const facing of [
      { degrees: 721, observed_ms: NOW },
      { degrees: Number.POSITIVE_INFINITY, observed_ms: NOW },
      { degrees: '90', observed_ms: NOW },
      { degrees: 90 },
      { degrees: 90, observed_ms: NOW - 10_001 },
    ])
      expect(normalizeCubesStatus(JSON.parse(JSON.stringify({ ...raw(), facing }))).facing).toBe(
        null,
      );
  });

  it('never keeps a facing without a position of yours, or while capture is off', () => {
    const facing = { degrees: 45, observed_ms: NOW - 100 };
    expect(
      normalizeCubesStatus(raw({ position: null, last_position: null, facing })).facing,
    ).toBeNull();
    // With only a last position, a fresh facing still belongs to you.
    expect(
      normalizeCubesStatus(raw({ position: null, last_position: at(40_000), facing })).facing,
    ).toEqual(facing);
    const off = normalizeCubesStatus(raw({ running: false, phase: 'stopped', facing }));
    expect([off.position, off.last_position, off.facing]).toEqual([null, null, null]);
  });

  it('degrades safely for a native without the clock: no facing, and age from position_age_ms', () => {
    const legacy = normalizeCubesStatus(
      raw({ now_ms: undefined, last_position: undefined, facing: { degrees: 5, observed_ms: 0 } }),
    );
    expect(legacy.now_ms).toBeNull();
    expect(legacy.facing).toBeNull();
    expect(legacy.position).not.toBeNull();
    expect(legacy.last_position).toEqual(legacy.position);
    expect(
      normalizeCubesStatus(raw({ now_ms: undefined, position_age_ms: 16_000 })).position,
    ).toBeNull();
  });
});
