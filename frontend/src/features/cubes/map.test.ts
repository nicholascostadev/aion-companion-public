import { describe, expect, it } from 'vitest';
import { ALTGARD, atlasMap, RESHANTA, VERTERON, type AtlasMap } from '../maps/atlas';
import {
  ALL_LAYERS,
  chooseMap,
  cubeContext,
  cubeMapChoices,
  cubeMarks,
  freshPlayer,
  shownContext,
  shownMap,
} from './map';
import { cube, cubesStatus } from './fixtures';

const verteron = atlasMap(VERTERON) as AtlasMap;
const altgard = atlasMap(ALTGARD) as AtlasMap;
const label = (c: { id: number }) => `#${c.id}`;
const none = new Set<number>();

describe('cube map context', () => {
  it('belongs to the map native names, never to a guessed one', () => {
    expect(cubeContext(cubesStatus(), '')).toEqual({ kind: 'map', map: verteron });
    expect(cubeContext(cubesStatus({ map_id: null }), '').kind).toBe('unknown');
    // An alias is not a map id.
    expect(cubeContext(cubesStatus({ map_id: 'verteron' }), '').kind).toBe('unknown');
    expect(cubeContext(cubesStatus({ running: false, phase: 'stopped' }), '').kind).toBe('none');
    expect(cubeContext(null, '').kind).toBe('none');
    // A failed read or Clear hides everything spatial.
    expect(cubeContext(cubesStatus(), 'Native unavailable').kind).toBe('hidden');
  });

  it('offers Altgard and Verteron, and the current map when it is another', () => {
    const ids = (context: ReturnType<typeof cubeContext>) =>
      cubeMapChoices(context).map((m) => m.id);
    expect(ids({ kind: 'none' })).toEqual([ALTGARD, VERTERON]);
    expect(ids(cubeContext(cubesStatus({ map_id: RESHANTA }), ''))).toEqual([
      ALTGARD,
      VERTERON,
      RESHANTA,
    ]);
  });

  it('follows the context until you pick another map; picking it again follows again', () => {
    const context = cubeContext(cubesStatus(), '');
    expect(shownMap(null, { kind: 'none' }).id).toBe(ALTGARD);
    expect(shownMap(null, context).id).toBe(VERTERON);
    expect(shownMap(chooseMap(ALTGARD, context), context).id).toBe(ALTGARD);
    expect(chooseMap(VERTERON, context)).toBeNull();
    expect(shownMap('nowhere', context).id).toBe(VERTERON);
  });
});

describe('shown context', () => {
  it('keeps the map last followed through a failed read only', () => {
    const hidden = cubeContext(cubesStatus(), 'Native gone');
    expect(shownContext(hidden, VERTERON)).toEqual({ kind: 'map', map: verteron });
    expect(shownContext(hidden, null)).toBe(hidden);
    const none = cubeContext(null, '');
    expect(shownContext(none, VERTERON)).toBe(none);
    const current = cubeContext(cubesStatus({ map_id: ALTGARD }), '');
    expect(shownContext(current, VERTERON)).toBe(current);
  });

  it('places you only on the current map, never after a failed read', () => {
    const status = cubesStatus();
    expect(freshPlayer(status, cubeContext(status, ''), verteron)).toEqual({
      x: -54405,
      y: 126283,
    });
    expect(freshPlayer(status, cubeContext(status, ''), altgard)).toBeNull();
    expect(freshPlayer(status, cubeContext(status, 'Native gone'), verteron)).toBeNull();
    expect(
      freshPlayer(cubesStatus({ position: null }), cubeContext(status, ''), verteron),
    ).toBeNull();
  });
});

describe('cube marks', () => {
  const marks = (overrides: Partial<Parameters<typeof cubeMarks>[0]>) => {
    const status = 'status' in overrides ? (overrides.status ?? null) : cubesStatus();
    return cubeMarks({
      status,
      context: overrides.context ?? cubeContext(status, ''),
      map: overrides.map ?? verteron,
      layers: overrides.layers ?? ALL_LAYERS,
      fresh: overrides.fresh ?? none,
      label,
    });
  };

  it('marks the received coordinates and you on the current map', () => {
    const { marks: m, player } = marks({});
    expect(m).toEqual([
      expect.objectContaining({ key: 'cube:65509', x: -50205, y: 126283, tone: 'live' }),
    ]);
    expect(player).toEqual({ x: -54405, y: 126283 });
  });

  it('marks nothing on another map, an unknown area or after a failure', () => {
    expect(marks({ map: altgard })).toEqual({ marks: [], player: null });
    const unknown = cubesStatus({ map_id: null });
    expect(marks({ status: unknown })).toEqual({ marks: [], player: null });
    expect(marks({ context: { kind: 'hidden' } })).toEqual({ marks: [], player: null });
    expect(marks({ status: null })).toEqual({ marks: [], player: null });
  });

  it('keeps cubes but drops you without a fresh position', () => {
    const { marks: m, player } = marks({ status: cubesStatus({ position: null }) });
    expect(m).toHaveLength(1);
    expect(player).toBeNull();
  });

  it('tones by lifecycle, filters by layer and marks only current arrivals as new', () => {
    const status = cubesStatus({
      cubes: [
        cube({ id: 1 }),
        cube({ id: 2, status: 'opening' }),
        cube({ id: 3, status: 'opened' }),
        cube({ id: 4, status: 'out_of_view' }),
      ],
    });
    const fresh = new Set([1, 3]);
    const all = marks({ status, fresh }).marks;
    expect(all.map((m) => [m.key, m.tone, m.isNew])).toEqual([
      ['cube:1', 'live', true],
      ['cube:2', 'busy', false],
      ['cube:3', 'past', false],
      ['cube:4', 'past', false],
    ]);
    const nearby = marks({ status, layers: { ...ALL_LAYERS, earlier: false } }).marks;
    expect(nearby.map((m) => m.key)).toEqual(['cube:1', 'cube:2']);
    const earlier = marks({ status, layers: { ...ALL_LAYERS, nearby: false } }).marks;
    expect(earlier.map((m) => m.key)).toEqual(['cube:3', 'cube:4']);
  });
});
