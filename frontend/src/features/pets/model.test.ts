import { describe, expect, it } from 'vitest';
import { catalogue, NOW, status } from './fixtures';
import {
  artLayers,
  axisLabel,
  collectionBrief,
  collectionNotice,
  collectionSync,
  collectionStates,
  familySummaries,
  filterPets,
  fitPoints,
  groupNearby,
  indexCatalogue,
  keepOnMap,
  lastPositionAge,
  limitZoom,
  liveState,
  mapPets,
  mapsFor,
  markerCell,
  MIN_FIT_WORLD,
  MAX_MARKERS,
  MAX_TILE_PIXELS,
  TILE_PIXELS_PER_SCREEN_PIXEL,
  metres,
  nearbyRows,
  nextMark,
  onMap,
  pinnedRows,
  positionMap,
  projection,
  radarMap,
  radarPoint,
  sessionOf,
  soulsLeftLabel,
  spawnMarkers,
  stateFrom,
  stateOf,
  visibleArea,
  wholeBox,
  withPin,
} from './model';
import { formattersFor } from '../../i18n/formatters';
import { createTestI18n } from '../../i18n/testing';
import type { PetMapArt, PetSighting } from '../../types/pets';

/* English wording, as the app shows it by default. */
const tr = createTestI18n('en').getFixedT('en', 'pets');
const fmt = formattersFor('en');

const index = indexCatalogue(catalogue(), tr);
const sighting = (over: Partial<PetSighting> = {}): PetSighting => ({
  entity_id: 1,
  npc_id: 900,
  name: 'Test Wolf',
  pet_ids: [1],
  x: 100,
  y: -200,
  distance: 22,
  bearing: 30,
  observed_ms: NOW - 1000,
  ...over,
});

describe('collection state', () => {
  it('updates estimated remaining souls until a fresh collection replaces the cached baseline', () => {
    const rows = (progress: number, estimated: boolean) =>
      collectionStates(
        catalogue(),
        status({
          progress: [
            { pet_id: 2, level: 2, progress, observed_ms: NOW, progress_estimated: estimated },
          ],
        }),
      );
    expect(soulsLeftLabel(stateOf(rows(0, true), 2), tr)).toBe('~75 souls to Lv 3');
    expect(soulsLeftLabel(stateOf(rows(3, true), 2), tr)).toBe('~72 souls to Lv 3');
    expect(soulsLeftLabel(stateOf(rows(16, false), 2), tr)).toBe('59 souls to Lv 3');
  });
  it('counts souls left per level and to the maximum from the thresholds', () => {
    const t = catalogue().thresholds;
    expect(stateFrom(t, 0, 0, null)).toMatchObject({ stage: 'unowned', left: 5, toMax: 105 });
    expect(stateFrom(t, 0, 3, null)).toMatchObject({ progress: 3, left: 2 });
    expect(stateFrom(t, 1, 10, 5)).toMatchObject({
      stage: 'growing',
      needed: 25,
      left: 15,
      toMax: 90,
    });
    expect(stateFrom(t, 2, 74, 5)).toMatchObject({ left: 1, toMax: 1 });
    expect(stateFrom(t, 3, 0, 5)).toMatchObject({ stage: 'maxed', left: 0, toMax: 0 });
  });

  it('treats missing pets as unowned only after a full sync', () => {
    const synced = collectionStates(catalogue(), status());
    expect(stateOf(synced, 1).stage).toBe('unowned');
    expect(stateOf(synced, 2)).toMatchObject({ stage: 'growing', level: 1, progress: 10 });
    expect(stateOf(synced, 3).stage).toBe('maxed');

    const partial = collectionStates(catalogue(), status({ collection_synced: false }));
    // Observed rows stay authoritative; unseen pets are unknown, never "unowned".
    expect(stateOf(partial, 1)).toMatchObject({ stage: 'unknown', level: null, left: null });
    expect(stateOf(partial, 2).stage).toBe('growing');

    const none = collectionStates(catalogue(), status({ profile_id: null }));
    expect(stateOf(none, 2).stage).toBe('unknown');
    expect(stateOf(collectionStates(catalogue(), null), 1).stage).toBe('unknown');
  });

  it('summarises families without counting unknown pets as owned', () => {
    const [all, ...families] = familySummaries(
      catalogue(),
      collectionStates(catalogue(), status({ collection_synced: false })),
    );
    expect(all).toMatchObject({ total: 4, owned: 2, maxed: 1, unknown: 2 });
    expect(families.map((f) => f.family)).toEqual(['Cognia', 'Fera', 'Natura', 'Varia', 'Specia']);
    expect(families.find((f) => f.family === 'Fera')).toMatchObject({ total: 1, unknown: 1 });
  });
});

describe('filters and pins', () => {
  const states = collectionStates(catalogue(), status());
  const names = (filter: Parameters<typeof filterPets>[2]) =>
    filterPets(index, states, filter).map((p) => p.name);
  const query = { family: 'all' as const, filter: 'all' as const, search: '', pinned: [] };

  it('lists pinned pets first in pin order, then by name', () => {
    expect(names({ ...query, pinned: [3, 1] })).toEqual([
      'Copper Crab',
      'Ashwolf',
      'Barn Owl',
      'Dawn Drake',
    ]);
  });

  it('filters by family, stage and pins, and searches monster and region names', () => {
    expect(names({ ...query, family: 'Natura' })).toEqual(['Barn Owl']);
    expect(names({ ...query, filter: 'unowned' })).toEqual(['Ashwolf', 'Dawn Drake']);
    expect(names({ ...query, filter: 'incomplete' })).toEqual(['Barn Owl']);
    expect(names({ ...query, filter: 'maxed' })).toEqual(['Copper Crab']);
    expect(names({ ...query, filter: 'pinned', pinned: [2] })).toEqual(['Barn Owl']);
    expect(names({ ...query, search: 'test owl' })).toEqual(['Barn Owl']);
    expect(names({ ...query, search: 'north ridge' })).toEqual(['Ashwolf']);
  });

  it('adds new pins first and removes without duplicates', () => {
    expect(withPin([2, 3], 1, true)).toEqual([1, 2, 3]);
    expect(withPin([2, 3], 2, true)).toEqual([2, 3]);
    expect(withPin([2, 3], 3, false)).toEqual([2]);
  });
});

describe('live radar', () => {
  it('shows sightings only for the live character during capture', () => {
    const states = collectionStates(catalogue(), status());
    const s = status({ nearby: [sighting()] });
    expect(nearbyRows(index, states, s, true)).toHaveLength(1);
    expect(nearbyRows(index, states, s, false)).toEqual([]);
    expect(nearbyRows(index, states, { ...s, running: false }, true)).toEqual([]);
    expect(nearbyRows(index, states, { ...s, profile_id: 'p2' }, true)).toEqual([]);
    expect(liveState({ ...s, active_profile_id: null }, true).kind).toBe('identifying');
    expect(liveState({ ...s, profile_id: 'p2' }, true).kind).toBe('saved');
  });

  it('drops stale sightings and hides direction without a fresh own position', () => {
    const states = collectionStates(catalogue(), status());
    const stale = status({
      nearby: [sighting(), sighting({ entity_id: 2, observed_ms: NOW - 91_000 })],
    });
    expect(nearbyRows(index, states, stale, true).map((r) => r.sighting.entity_id)).toEqual([1]);
    const old = status({
      nearby: [sighting()],
      position: {
        zone_id: 7,
        map_id: 'World/World_L/World_L_A',
        x: 0,
        y: 0,
        observed_ms: NOW - 16_000,
      },
    });
    const [row] = nearbyRows(index, states, old, true);
    expect(row).toMatchObject({ distance: null, bearing: null });
  });

  it('puts pinned pets first, then the nearest, and skips complete monsters unless asked', () => {
    const states = collectionStates(catalogue(), status());
    const base = status({
      nearby: [
        sighting({ entity_id: 1, distance: 80 }),
        sighting({ entity_id: 2, npc_id: 901, name: 'Test Owl', pet_ids: [2], distance: 120 }),
        sighting({ entity_id: 3, npc_id: 902, name: 'Test Crab', pet_ids: [3], distance: 5 }),
      ],
    });
    const pinned = { ...base, config: { ...base.config, pinned_ids: [2] } };
    expect(nearbyRows(index, states, pinned, true).map((r) => r.sighting.entity_id)).toEqual([
      2, 1,
    ]);
    const all = { ...pinned, config: { ...pinned.config, show_maxed: true } };
    expect(nearbyRows(index, states, all, true).map((r) => r.sighting.entity_id)).toEqual([
      2, 3, 1,
    ]);
    expect(nearbyRows(index, states, base, true)[0]?.needed).toBe(5);
    // A pin, like the goal, overrides the max-level filter.
    const pinnedMaxed = { ...base, config: { ...base.config, pinned_ids: [3] } };
    expect(nearbyRows(index, states, pinnedMaxed, true).map((r) => r.sighting.entity_id)).toEqual([
      3, 1, 2,
    ]);
  });

  it('lists every pin for the radar: nearest sighting first, the rest in pin order', () => {
    const states = collectionStates(catalogue(), status());
    const s = status({
      nearby: [
        sighting({ entity_id: 1, distance: 80, bearing: 10 }),
        sighting({ entity_id: 2, distance: 30, bearing: 200 }),
        sighting({ entity_id: 3, npc_id: 901, name: 'Test Owl', pet_ids: [2], distance: 120 }),
      ],
      config: { ...status().config, pinned_ids: [4, 3, 2, 1], show_maxed: false },
    });
    const rows = pinnedRows(index, states, s, true, 'World/World_L/World_L_A');
    expect(rows.map((r) => r.pet.name)).toEqual([
      'Ashwolf',
      'Barn Owl',
      'Dawn Drake',
      'Copper Crab',
    ]);
    expect(rows[0]).toMatchObject({ near: { distance: 30, bearing: 200, count: 2 }, here: 3 });
    // A complete pin without a sighting is simply not near: native tracks pins at max level.
    expect(rows[2]).toMatchObject({ near: null, here: 0 });
    expect(rows[3]).toMatchObject({ near: null, here: 0, state: { stage: 'maxed' } });
    // Without a fresh position a pin is still near, with no distance; off live nothing is near.
    const old = { ...s, position: { ...s.position!, observed_ms: NOW - 16_000 } };
    const stale = pinnedRows(index, states, old, true, null);
    // Near pins without a distance keep pin order.
    expect(stale.map((r) => r.pet.name).slice(0, 2)).toEqual(['Barn Owl', 'Ashwolf']);
    expect(stale[1]).toMatchObject({
      near: { distance: null, bearing: null, count: 2 },
      here: null,
    });
    const saved = pinnedRows(index, states, { ...s, profile_id: 'p2' }, true, null);
    expect(saved.map((r) => [r.pet.id, r.near])).toEqual([
      [4, null],
      [3, null],
      [2, null],
      [1, null],
    ]);
  });

  it('labels directions by coordinate axes and plots −Y up, +X right', () => {
    expect(axisLabel(0)).toBe('−Y');
    expect(axisLabel(90)).toBe('+X');
    expect(axisLabel(135)).toBe('+X +Y');
    expect(axisLabel(-90)).toBe('−X');
    expect(axisLabel(359)).toBe('−Y');
    const east = radarPoint(90, 50, 100);
    expect(east.x).toBeCloseTo(0.5);
    expect(east.y).toBeCloseTo(0);
    const south = radarPoint(180, 500, 100);
    expect(south.y).toBeCloseTo(1);
    expect(metres(42.4, fmt)).toBe('42 m');
    expect(metres(1500, fmt)).toBe('1.5 km');
  });
});

describe('grouped radar rows', () => {
  const states = collectionStates(catalogue(), status());

  it('groups one monster type, keeping the nearest known distance with its own bearing', () => {
    const s = status({
      nearby: [
        sighting({ entity_id: 1, distance: null, bearing: null }),
        sighting({ entity_id: 2, distance: 60, bearing: 200 }),
        sighting({ entity_id: 3, distance: 25, bearing: 45 }),
        sighting({ entity_id: 4, distance: 90, bearing: 10 }),
        sighting({ entity_id: 5, npc_id: 901, name: 'Test Owl', pet_ids: [2], distance: 5 }),
      ],
    });
    const groups = groupNearby(nearbyRows(index, states, s, true));
    expect(groups.map((g) => [g.name, g.rows.length])).toEqual([
      ['Test Owl', 1],
      ['Test Wolf', 4],
    ]);
    const wolf = groups[1]!;
    expect(wolf.nearest?.sighting.entity_id).toBe(3);
    expect(wolf.nearest).toMatchObject({ distance: 25, bearing: 45 });
  });

  it('has no distance when none of its entities has one, never a borrowed bearing', () => {
    const s = status({
      nearby: [sighting({ entity_id: 1, distance: null, bearing: 120 })],
    });
    const [group] = groupNearby(nearbyRows(index, states, s, true));
    expect(group?.nearest).toBeNull();
  });

  it('leads with the farming goal, even when complete', () => {
    const base = status({
      nearby: [
        sighting({ entity_id: 1, distance: 5 }),
        sighting({ entity_id: 2, npc_id: 902, name: 'Test Crab', pet_ids: [3], distance: 80 }),
      ],
    });
    const goal = {
      ...base,
      config: {
        ...base.config,
        farming_goal: { pet_id: 3, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' },
      },
    };
    const rows = nearbyRows(index, states, goal, true);
    // Copper Crab is at max level but it is the goal, so it stays and leads.
    expect(rows.map((r) => [r.sighting.entity_id, r.goal])).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(groupNearby(rows)[0]?.goal).toBe(true);
  });

  it('puts every pin above the goal and nearer monsters, newest pin first', () => {
    const base = status({
      nearby: [
        sighting({ entity_id: 1, distance: 5 }),
        sighting({ entity_id: 2, npc_id: 902, name: 'Test Crab', pet_ids: [3], distance: 80 }),
        sighting({ entity_id: 3, npc_id: 901, name: 'Test Owl', pet_ids: [2], distance: 140 }),
      ],
    });
    const config = (pinned_ids: number[]) => ({
      ...base,
      config: {
        ...base.config,
        pinned_ids,
        farming_goal: { pet_id: 3, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' },
      },
    });
    const order = (pins: number[]) =>
      groupNearby(nearbyRows(index, states, config(pins), true)).map((g) => [g.name, g.pin]);
    // The far owl pin leads the nearer goal crab and the nearest, unpinned wolf.
    expect(order([2])).toEqual([
      ['Test Owl', 0],
      ['Test Crab', null],
      ['Test Wolf', null],
    ]);
    // A newer pin (`withPin` puts it first) moves above older ones at once.
    expect(order(withPin([2], 1, true))).toEqual([
      ['Test Wolf', 0],
      ['Test Owl', 1],
      ['Test Crab', null],
    ]);
  });
});

describe('labels and session', () => {
  it('says how many souls obtain a pet, from the thresholds', () => {
    const t = catalogue().thresholds;
    expect(soulsLeftLabel(stateFrom(t, 0, 2, null), tr)).toBe('3 souls to obtain');
    expect(soulsLeftLabel(stateFrom(t, 1, 24, null), tr)).toBe('1 soul to Lv 2');
  });

  it('shows a session only for the profile it counts', () => {
    expect(sessionOf(status())).toMatchObject({ souls_gained: 6, level_ups: 1 });
    expect(sessionOf(status({ profile_id: 'p2' }))).toBeNull();
    const none = status();
    expect(
      sessionOf({ ...none, session: { ...none.session, profile_id: null, started_ms: null } }),
    ).toBeNull();
    expect(sessionOf(null)).toBeNull();
  });
});

describe('spawn map', () => {
  const art = index.maps.get('World/World_L/World_L_A')!;
  const chart = index.maps.get('Intersever/Abyss/Abyss_Reshanta_A')!;

  it('places points with the art calibration, with no flip', () => {
    const view = projection(art);
    expect(view.art).toBe(true);
    expect(view.project(100, -200)).toEqual([2098, 1948]);
    expect(view.unproject(2098, 1948)).toEqual([100, -200]);
  });

  it('draws maps without art as a chart over their bounds, −Y at the top', () => {
    const view = projection(chart);
    expect(view.art).toBe(false);
    expect(view.width).toBe(1000);
    expect(view.height).toBe(500);
    expect(view.project(0, 0)).toEqual([0, 0]);
    expect(view.project(500, 250)).toEqual([1000, 500]);
  });

  it('draws only the chosen pets, grouping nearby points', () => {
    const view = projection(art);
    const { markers, total } = spawnMarkers(index, art.id, new Set([1]), view);
    expect(total).toBe(3);
    expect(markers).toHaveLength(2);
    expect(markers[0]).toMatchObject({ pet: 1, count: 2, npcs: [900] });
    expect(markers[1]).toMatchObject({ pet: 1, count: 1, npcs: [903] });
    expect(spawnMarkers(index, art.id, new Set(), view).markers).toEqual([]);
  });

  it('caps the number of markers on dense maps', () => {
    const big = catalogue();
    big.pets[0]!.spawns = Array.from({ length: 3000 }, (_, i) => ({
      map_id: 'World/World_L/World_L_A',
      npc_id: 900,
      x: -1000 + (i % 60) * 33,
      y: -1000 + Math.floor(i / 60) * 40,
      z: 0,
    }));
    const dense = indexCatalogue(big, tr);
    const result = spawnMarkers(dense, art.id, new Set([1]), projection(art));
    expect(result.total).toBe(3000);
    expect(result.markers.length).toBe(MAX_MARKERS);
    expect(result.truncated).toBe(true);
  });

  it('lists maps by spawn count and matches the player only on their own map', () => {
    expect(mapsFor(index, new Set([1, 3])).map((m) => [m.map.id, m.count])).toEqual([
      ['World/World_L/World_L_A', 3],
      ['Intersever/Abyss/Abyss_Reshanta_A', 2],
      ['Dungeon/Test_C', 1],
    ]);
    const here = { zone_id: 7, map_id: null, x: 0, y: 0, observed_ms: NOW };
    expect(onMap(here, art)).toBe(true);
    expect(onMap(here, chart)).toBe(false);
    expect(onMap({ ...here, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' }, art)).toBe(false);
    expect(onMap(null, art)).toBe(false);
  });

  it('fits only the given markers, never smaller than a useful extent', () => {
    // A field-sized map: 16 km wide at 0.02 px per centimetre, in 2048 px tiles.
    const field = {
      ...art,
      bounds: [-410_000, -410_000, 410_000, 410_000] as [number, number, number, number],
      art: {
        width: 16384,
        height: 16384,
        scale: 0.02,
        offset_x: 8192,
        offset_y: 8192,
        approximate: false,
        overview: null,
        tiles: Array.from({ length: 64 }, (_, i) => ({
          file: '/pet-map-art/0123456789abcdef0123.webp',
          x: (i % 8) * 2048,
          y: Math.floor(i / 8) * 2048,
          width: 2048,
          height: 2048,
        })),
      },
    };
    const view = projection(field);
    // A camp 2000 px wide: the box hugs it (padded), far smaller than the 16384 px map.
    const box = fitPoints(field, view, [
      { x: 5000, y: 6000 },
      { x: 7000, y: 6500 },
    ]);
    expect(box.width).toBeCloseTo(2000 * 1.24);
    expect(box.x + box.width / 2).toBeCloseTo(6000);
    expect(box.y + box.height / 2).toBeCloseTo(6250);
    // One point: the minimum extent, in world units through the calibration.
    const one = fitPoints(field, view, [{ x: 9000, y: 9000 }]);
    expect(one.width).toBeCloseTo(MIN_FIT_WORLD * 0.02);
    expect(one.x + one.width / 2).toBeCloseTo(9000);
    // No points: the whole map.
    expect(fitPoints(field, view, [])).toEqual({ x: 0, y: 0, width: 16384, height: 16384 });
    // A map smaller than the minimum extent is shown whole at most.
    expect(fitPoints(art, projection(art), [{ x: 2098, y: 1948 }]).width).toBe(2048);
  });

  it('never draws map art closer than a given upscale, growing the box about its centre', () => {
    const frame = { width: 600, height: 400 };
    // 60 × 40 units in 600 × 400 px: 10 px per unit, capped at 3.
    const box = limitZoom({ x: 100, y: 200, width: 60, height: 40 }, frame, 3);
    expect(box.width).toBeCloseTo(200);
    expect(box.height).toBeCloseTo(400 / 3);
    expect(box.x + box.width / 2).toBeCloseTo(130);
    expect(box.y + box.height / 2).toBeCloseTo(220);
    // Already wide enough (2 px per unit): unchanged.
    const wide = { x: 0, y: 0, width: 300, height: 100 };
    expect(limitZoom(wide, frame, 3)).toBe(wide);
  });

  it('keeps the centre of the view on the map', () => {
    const whole = { x: 0, y: 0, width: 1125, height: 1125 };
    expect(keepOnMap({ x: -900, y: 2000, width: 200, height: 100 }, whole)).toEqual({
      x: -100,
      y: 1075,
      width: 200,
      height: 100,
    });
    const inside = { x: 10, y: 20, width: 200, height: 100 };
    expect(keepOnMap(inside, whole)).toEqual(inside);
  });

  it('frames the whole map by its tiles, or the whole chart', () => {
    expect(wholeBox(art, projection(art))).toEqual({ x: 1024, y: 1024, width: 2048, height: 2048 });
    expect(wholeBox(chart, projection(chart))).toEqual({ x: 0, y: 0, width: 1000, height: 500 });
    // A chart smaller than the minimum extent is shown whole, not zoomed out past it.
    const small = fitPoints(chart, projection(chart), [{ x: 100, y: 100 }]);
    expect(small.width).toBe(1000);
  });

  it('groups points finer as the view zooms in, a cell never wider than three pixels', () => {
    const view = projection(art);
    // Whole-map cell: 1/220 of the 4096-unit canvas.
    const base = 4096 / 220;
    expect(markerCell(view)).toBeCloseTo(base);
    // Zoomed out far enough, the whole-map cell stays.
    expect(markerCell(view, base / 3)).toBeCloseTo(base);
    expect(markerCell(view, 100)).toBeCloseTo(base);
    // Just past the boundary the cell halves, so it never spans more than 3 px.
    expect(markerCell(view, (base / 3) * 0.999)).toBeCloseTo(base / 2);
    for (const unit of [9, 6.2, 3.1, 1.7, 1, 0.5, 0.33, 0.1])
      expect(markerCell(view, unit) / unit).toBeLessThanOrEqual(3 + 1e-9);
    // At most ten halvings, however close.
    expect(markerCell(view, 1e-6)).toBeCloseTo(base / 1024);
  });

  it('keeps only markers in an area, so the cap applies to what is on screen', () => {
    const view = projection(art);
    const all = spawnMarkers(index, art.id, new Set([1]), view, 1);
    expect(all.markers).toHaveLength(3);
    const [first] = all.markers;
    const near = spawnMarkers(index, art.id, new Set([1]), view, 1, {
      x: first!.x - 0.25,
      y: first!.y - 0.25,
      width: 0.5,
      height: 0.5,
    });
    expect(near.markers.map((m) => m.key)).toEqual([first!.key]);
    expect(near.total).toBe(3);
  });

  it('reports the area a box shows in a frame of other proportions', () => {
    // 100 × 100 units in a 400 × 200 frame: 0.5 units per pixel, widened to 200 × 100.
    expect(
      visibleArea({ x: 0, y: 0, width: 100, height: 100 }, { width: 400, height: 200 }),
    ).toEqual({
      x: -50,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  describe('map art layers', () => {
    // A 16384 px canvas in 64 tiles of 2048 px with a 2048 px overview, like the largest map.
    const tiles = Array.from({ length: 64 }, (_, i) => ({
      file: `/pet-map-art/tile${i}.webp`,
      x: (i % 8) * 2048,
      y: Math.floor(i / 8) * 2048,
      width: 2048,
      height: 2048,
    }));
    const big: PetMapArt = {
      width: 16384,
      height: 16384,
      scale: 0.02,
      offset_x: 8192,
      offset_y: 8192,
      approximate: false,
      tiles,
      overview: { file: '/pet-map-art/overview.webp', width: 2048, height: 2048 },
    };
    const whole = { x: 0, y: 0, width: 16384, height: 16384 };

    it('draws only the overview while it is not upscaled on screen', () => {
      // 1024 px frame on the whole canvas: 16 units per pixel, overview 1/8 px per unit.
      expect(artLayers(big, whole, 16)).toEqual({ overview: big.overview, tiles: [] });
      // Exactly at the overview's own resolution, still the overview.
      expect(artLayers(big, { x: 0, y: 0, width: 8192, height: 8192 }, 8).tiles).toEqual([]);
      // A denser screen needs the detail sooner.
      expect(
        artLayers(big, { x: 0, y: 0, width: 8192, height: 8192 }, 8, 2).tiles.length,
      ).toBeGreaterThan(0);
    });

    it('draws only the native tiles meeting the view, with a margin', () => {
      // A 600 px view inside one tile, at 1 unit per pixel.
      const inside = artLayers(big, { x: 2500, y: 2500, width: 600, height: 600 }, 1);
      expect(inside.overview).toBe(big.overview);
      expect(inside.tiles.map((t) => [t.x, t.y])).toEqual([[2048, 2048]]);
      // On a tile corner the four tiles around it.
      const corner = artLayers(big, { x: 3800, y: 3800, width: 600, height: 600 }, 1);
      expect(corner.tiles.map((t) => [t.x, t.y])).toEqual([
        [2048, 2048],
        [4096, 2048],
        [2048, 4096],
        [4096, 4096],
      ]);
      // Within 10 % of the view of a tile edge, that tile loads ahead of a pan.
      const edge = artLayers(big, { x: 2100, y: 2500, width: 1000, height: 1000 }, 1);
      expect(edge.tiles.map((t) => [t.x, t.y])).toEqual([
        [0, 2048],
        [2048, 2048],
      ]);
    });

    it('never decodes more than the budget, falling back to the overview', () => {
      const pixels = (t: { width: number; height: number }[]) =>
        t.reduce((n, x) => n + x.width * x.height, 0);
      // A whole-map view on a large, dense screen would need all 64 tiles (256 Mpx).
      const all = artLayers(big, whole, 2, 2);
      expect(all).toEqual({ overview: big.overview, tiles: [] });
      // A view the budget covers only without its margin drops the margin.
      const tight = artLayers(big, { x: 0, y: 0, width: 8192, height: 8192 }, 4, 2);
      expect(tight.tiles).toHaveLength(16);
      expect(pixels(tight.tiles)).toBeLessThanOrEqual(MAX_TILE_PIXELS);
      // Full native detail on a 4K screen fits the budget.
      const native = artLayers(big, { x: 5000, y: 5000, width: 3840, height: 2160 }, 1);
      expect(native.tiles.length).toBeGreaterThan(0);
      expect(pixels(native.tiles)).toBeLessThanOrEqual(MAX_TILE_PIXELS);
    });

    describe('in proportion to the screen', () => {
      const pixels = (t: { width: number; height: number }[]) =>
        t.reduce((n, x) => n + x.width * x.height, 0);
      const TILE = 2048 * 2048;
      const frames = [
        { name: 'radar', width: 340, height: 220, dpr: 1.25 },
        { name: 'workspace', width: 900, height: 560, dpr: 1.25 },
        { name: 'wide workspace', width: 1600, height: 900, dpr: 1 },
        { name: '4K', width: 3840, height: 2160, dpr: 1 },
      ];
      /** Tiles drawn for `frame` at `scale` native pixels per device pixel, centred at (cx, cy). */
      const draw = (frame: (typeof frames)[number], scale: number, cx: number, cy: number) => {
        const unit = scale * frame.dpr;
        const box = {
          x: cx - (frame.width * unit) / 2,
          y: cy - (frame.height * unit) / 2,
          width: frame.width * unit,
          height: frame.height * unit,
        };
        return artLayers(big, visibleArea(box, frame), unit, frame.dpr).tiles;
      };
      // Centres on tile corners, edges and middles, from close to the overview's own scale.
      const centres = [4096, 5000, 6144, 7100, 9000];
      const scales = [0.34, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 7, 7.9];

      it('decodes at most four tiles, or a bounded multiple of what the screen shows', () => {
        for (const frame of frames) {
          const screenPixels = frame.width * frame.height * frame.dpr ** 2;
          const most = Math.min(
            MAX_TILE_PIXELS,
            Math.max(4 * TILE, screenPixels * TILE_PIXELS_PER_SCREEN_PIXEL),
          );
          for (const scale of scales)
            for (const c of centres)
              expect(pixels(draw(frame, scale, c, c))).toBeLessThanOrEqual(most);
        }
        // A small radar never holds more than the four tiles around a corner (64 MiB), where
        // a fixed budget let it decode up to 256 MiB of a large map.
        for (const scale of scales)
          for (const c of centres)
            expect(pixels(draw(frames[0]!, scale, c, c))).toBeLessThanOrEqual(4 * TILE);
      });

      it('keeps native detail on every screen, down to two native pixels per device pixel', () => {
        for (const frame of frames)
          for (const scale of [0.34, 0.5, 1, 1.5, 2])
            for (const c of centres) expect(draw(frame, scale, c, c).length).toBeGreaterThan(0);
      });

      it('gives a larger screen the tiles a smaller one leaves to the overview', () => {
        // Four native pixels per device pixel on a tile corner: eight tiles without the margin.
        // Past the workspace frame's share, so its overview stands in, upscaled only 2×...
        expect(draw(frames[1]!, 4, 6144, 6144)).toEqual([]);
        // ...while the wider frame, showing more of the map at that detail, keeps them.
        expect(draw(frames[2]!, 4, 6144, 6144)).toHaveLength(8);
      });
    });

    it('draws the tiles at every zoom without an overview, assuming no grid', () => {
      const scattered: PetMapArt = {
        ...big,
        overview: null,
        tiles: [tiles[0]!, { ...tiles[9]!, width: 1000 }, tiles[63]!],
      };
      expect(artLayers(scattered, whole, 16).tiles).toEqual(scattered.tiles);
      expect(artLayers(scattered, { x: 2100, y: 2100, width: 500, height: 500 }, 1).tiles).toEqual([
        scattered.tiles[1],
      ]);
    });
  });

  it('places a position on a map only when exactly one map matches', () => {
    const at = { zone_id: 7, map_id: null, x: 0, y: 0, observed_ms: NOW };
    expect(positionMap(index, at)?.id).toBe('World/World_L/World_L_A');
    expect(positionMap(index, { ...at, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' })?.id).toBe(
      'Intersever/Abyss/Abyss_Reshanta_A',
    );
    expect(positionMap(index, { ...at, zone_id: 99 })).toBeNull();
    const twins = catalogue();
    twins.maps[1]!.zone_ids = [7];
    expect(positionMap(indexCatalogue(twins, tr), at)).toBeNull();
    expect(positionMap(index, null)).toBeNull();
  });

  it('draws the radar where you are, else last known, else the goal or chosen map', () => {
    const fresh = status();
    expect(radarMap(index, fresh, true)).toMatchObject({ source: 'here', player: fresh.position });
    // Standing still: only the last observed position remains, never presented as fresh.
    const last = { zone_id: 7, map_id: null, x: 5, y: 6, observed_ms: NOW - 65_000 };
    const still = status({ position: null, last_position: last });
    expect(radarMap(index, still, true)).toMatchObject({ source: 'last', player: last });
    expect(liveState(still, true)).toEqual({ kind: 'live', positionFresh: false });
    expect(lastPositionAge(still)).toBe(65_000);
    // No position at all: the farming map without a player, then the chosen map.
    const goal = { pet_id: 3, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' };
    const none = status({ position: null, config: { ...status().config, farming_goal: goal } });
    expect(radarMap(index, none, true)).toMatchObject({ source: 'goal', player: null });
    expect(radarMap(index, none, true)?.map.id).toBe('Intersever/Abyss/Abyss_Reshanta_A');
    const chosen = status({
      position: null,
      config: { ...status().config, last_map_id: 'World/World_L/World_L_A' },
    });
    expect(radarMap(index, chosen, true)).toMatchObject({ source: 'chosen', player: null });
    // A goal or choice saved on a map that is not a farming map is never drawn by itself.
    const off = status({
      position: null,
      config: {
        ...status().config,
        farming_goal: { pet_id: 1, map_id: 'Dungeon/Test_C' },
        last_map_id: 'Dungeon/Test_C',
      },
    });
    expect(radarMap(index, off, true)).toBeNull();
    expect(radarMap(index, status({ position: null }), true)).toBeNull();
    // A saved profile or stopped capture never borrows a position.
    const saved = status({ profile_id: 'p2', last_position: last });
    expect(radarMap(index, saved, true)).toBeNull();
    expect(radarMap(index, { ...fresh, running: false }, true)).toBeNull();
  });

  it('draws recorded points of needed, pinned and goal pets only', () => {
    const states = collectionStates(index.catalogue, status());
    // Copper Crab (3) is complete: left out unless pinned, a goal or max-level pets are shown.
    expect([...mapPets(index, states, status())].sort((a, b) => a - b)).toEqual([1, 2, 4]);
    const pinned = status({ config: { ...status().config, pinned_ids: [3] } });
    expect(mapPets(index, states, pinned).has(3)).toBe(true);
    const all = status({ config: { ...status().config, show_maxed: true } });
    expect(mapPets(index, states, all).has(3)).toBe(true);
  });
});

describe('map mark navigation', () => {
  const a = { x: 0, y: 0 };
  const right = { x: 10, y: 1 };
  const farRight = { x: 30, y: 0 };
  const diagonal = { x: 8, y: 8 };
  const below = { x: 0, y: 12 };
  const marks = [a, right, farRight, diagonal, below];

  it('moves to the nearest mark ahead, preferring straight ahead over off to the side', () => {
    expect(nextMark(marks, a, 1, 0)).toBe(right);
    expect(nextMark(marks, right, 1, 0)).toBe(farRight);
    expect(nextMark(marks, a, 0, 1)).toBe(below);
    expect(nextMark(marks, below, 0, -1)).toBe(a);
  });

  it('returns null when nothing lies that way', () => {
    expect(nextMark(marks, a, -1, 0)).toBeNull();
    expect(nextMark(marks, a, 0, -1)).toBeNull();
  });

  it('steps through marks drawn on the very same spot in drawing order', () => {
    const under = { x: 5, y: 5 };
    const over = { x: 5, y: 5 };
    const stack = [under, over, { x: 20, y: 5 }];
    expect(nextMark(stack, under, 1, 0)).toBe(over);
    expect(nextMark(stack, over, -1, 0)).toBe(under);
    expect(nextMark(stack, over, 1, 0)).toBe(stack[2]);
  });
});

describe('collection sync', () => {
  const HOUR = 3_600_000;
  // The reported case: the app started after login, so the last played profile comes
  // from disk with its old full sync, and the character playing now is not identified.
  const cached = status({
    active_profile_id: null,
    collection_synced: true,
    live_synced: false,
    profiles: [{ id: 'p1', name: 'Tester', server_id: 1001, synced_ms: NOW - 4 * HOUR }],
  });

  it('never treats an old saved baseline as current without this connection syncing it', () => {
    const sync = collectionSync(cached, true);
    expect(sync).toEqual({
      kind: 'cached',
      name: 'Tester',
      syncedMs: NOW - 4 * HOUR,
      reason: 'identifying',
    });
    const notice = collectionNotice(sync, NOW, tr)!;
    expect(notice.tone).toBe('warn');
    expect(notice.text).toContain('last full sync was 4h ago, so it may be out of date');
    expect(notice.text).toContain('return to character selection and log back in');
    expect(collectionBrief(sync, NOW, tr)?.text).toBe('Saved collection, may be outdated');
    // Capture stopped or still connecting: the same profile, but a different reason.
    const offline = collectionSync({ ...cached, running: false, active_profile_id: 'p1' }, true);
    expect(offline).toMatchObject({ kind: 'cached', reason: 'offline' });
    expect(collectionNotice(offline, NOW, tr)!.text).toContain('capture is not connected');
  });

  it('separates a live character without a full collection this session from a current one', () => {
    const waiting = collectionSync(status({ live_synced: false }), true);
    expect(waiting).toMatchObject({ kind: 'waiting', syncedMs: NOW - 60_000 });
    expect(collectionNotice(waiting, NOW, tr)!.text).toContain('from the last full sync, 1m ago');
    expect(collectionBrief(waiting, NOW, tr)?.text).toBe('Collection not synced this session');
    const never = collectionSync(status({ live_synced: false, collection_synced: false }), true);
    expect(never).toMatchObject({ kind: 'waiting', syncedMs: null });
    expect(collectionNotice(never, NOW, tr, 2)!.text).toMatch(
      /^Collection not synced \(2 pets observed\): levels of unseen pets are unknown/,
    );
    // The game resent the collection: nothing to warn about, whatever its age.
    const current = collectionSync(status({ now_ms: NOW + 30 * 86_400_000 }), true);
    expect(current.kind).toBe('current');
    expect(collectionNotice(current, NOW + 30 * 86_400_000, tr)).toBeNull();
    expect(collectionBrief(current, NOW, tr)).toBeNull();
  });

  it('labels a chosen saved profile without asking to log in to another character', () => {
    const synced = collectionSync(
      status({
        profile_id: 'p2',
        profiles: [{ id: 'p2', name: 'Alt', server_id: 1002, synced_ms: NOW - 3 * HOUR }],
      }),
      true,
      'p2',
    );
    expect(synced).toEqual({ kind: 'saved', name: 'Alt', syncedMs: NOW - 3 * HOUR });
    expect(collectionNotice(synced, NOW, tr)).toBeNull();
    const never = collectionSync(
      status({ profile_id: 'p2', collection_synced: false, live_synced: false }),
      true,
      'p2',
    );
    const notice = collectionNotice(never, NOW, tr)!;
    expect(notice.tone).toBe('info');
    expect(notice.text).not.toContain('character selection');
    // Choosing the character playing now is the live view, not a saved one.
    expect(collectionSync(status(), true, 'p1').kind).toBe('current');
  });

  it('stays quiet in the preview and before any profile is known', () => {
    expect(collectionSync(cached, false)).toEqual({ kind: 'none' });
    expect(collectionSync(null, true)).toEqual({ kind: 'none' });
    const empty = collectionSync(status({ profile_id: null, active_profile_id: null }), true);
    expect(empty).toEqual({ kind: 'empty' });
    expect(collectionNotice(empty, NOW, tr)?.tone).toBe('info');
    expect(collectionBrief(empty, NOW, tr)).toBeNull();
  });
});
