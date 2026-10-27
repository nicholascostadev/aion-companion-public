import { describe, expect, it } from 'vitest';
import {
  normalizeCatalogue,
  normalizeMotion,
  normalizeStatus,
  normalizeWindowStatus,
} from './petsNormalize';

describe('pet payload normalization', () => {
  it('preserves zero facing and rejects malformed facing on both spatial payloads', () => {
    for (const normalize of [normalizeMotion, normalizeStatus]) {
      expect(normalize({ facing: { degrees: 0, observed_ms: 100 } }).facing).toEqual({
        degrees: 0,
        observed_ms: 100,
      });
      expect(normalize({ facing: { degrees: -90, observed_ms: 100 } }).facing?.degrees).toBe(270);
      for (const facing of [
        undefined,
        {},
        { degrees: NaN, observed_ms: 100 },
        { degrees: 721, observed_ms: 100 },
        { degrees: 90, observed_ms: -1 },
      ]) {
        expect(normalize({ facing }).facing).toBeNull();
      }
    }
  });
  it('keeps valid pets, maps and spawns and drops malformed rows', () => {
    const catalogue = normalizeCatalogue({
      version: 1,
      thresholds: { 0: 1, 1: 25, 2: 75, 3: 0 },
      pets: [
        {
          id: 1,
          name: ' Ashwolf ',
          family: 'Fera',
          npc_ids: [900, 'x'],
          spawns: [
            { map_id: 'M', npc_id: 900, x: 1, y: 2, z: 3 },
            { map_id: 'M', npc_id: 900, x: 'nope', y: 2 },
          ],
          regions: [{ map_id: 'M', name: 'Ridge' }, { map_id: 'M' }],
        },
        { id: 2, name: 'Unknown family', family: 'Other' },
        { id: 'three', name: 'Bad id', family: 'Fera' },
      ],
      maps: [
        { id: 'M', name: 'Plains', bounds: [0, 0, 10, 10], zone_ids: [7] },
        { id: 'Flat', name: 'Flat', bounds: [0, 0, 0, 10] },
      ],
      npcs: [{ id: 900, name: 'Wolf' }, { id: 'x' }],
    });
    expect(catalogue.pets).toHaveLength(1);
    expect(catalogue.pets[0]).toMatchObject({ name: 'Ashwolf', npc_ids: [900] });
    expect(catalogue.pets[0]!.spawns).toEqual([{ map_id: 'M', npc_id: 900, x: 1, y: 2, z: 3 }]);
    expect(catalogue.pets[0]!.regions).toEqual([{ map_id: 'M', name: 'Ridge' }]);
    expect(catalogue.maps.map((m) => m.id)).toEqual(['M']);
    expect(catalogue.maps[0]!.art).toBeNull();
    expect(catalogue.npcs).toEqual([{ id: 900, name: 'Wolf' }]);
  });

  it('accepts only bundled local map tiles with a sane calibration', () => {
    const map = (art: unknown) =>
      normalizeCatalogue({ maps: [{ id: 'M', name: 'M', bounds: [0, 0, 1, 1], art }] }).maps[0]!
        .art;
    const tile = { file: '/pet-map-art/abc123.jpg', x: 0, y: 0, width: 2048, height: 2048 };
    const good = { width: 4096, height: 4096, scale: 0.02, offset_x: 10, offset_y: 20 };
    expect(map({ ...good, tiles: [tile] })?.tiles).toEqual([tile]);
    expect(map({ ...good, tiles: [{ ...tile, file: 'https://example.com/a.jpg' }] })).toBeNull();
    expect(map({ ...good, tiles: [{ ...tile, file: '/pet-map-art/../x.jpg' }] })).toBeNull();
    expect(map({ ...good, scale: 0, tiles: [tile] })).toBeNull();
    expect(map({ ...good, scale: -1, tiles: [tile] })).toBeNull();
    expect(map({ ...good, width: 1e6, tiles: [tile] })).toBeNull();
    expect(map({ ...good, tiles: [] })).toBeNull();
    // An optional local overview of the whole canvas, by its intrinsic size.
    const overview = { file: '/pet-map-art/def456.webp', width: 2048, height: 2048 };
    expect(map({ ...good, tiles: [tile] })?.overview).toBeNull();
    expect(map({ ...good, tiles: [tile], overview })?.overview).toEqual(overview);
    for (const bad of [
      { ...overview, file: 'https://example.com/o.webp' },
      { ...overview, width: 0 },
      { ...overview, height: 1e6 },
      'overview.webp',
    ])
      expect(map({ ...good, tiles: [tile], overview: bad })?.overview).toBeNull();
    // Only an explicit true marks a provisional calibration.
    expect(map({ ...good, tiles: [tile] })?.approximate).toBe(false);
    expect(map({ ...good, tiles: [tile], approximate: true })?.approximate).toBe(true);
    expect(map({ ...good, tiles: [tile], approximate: 'yes' })?.approximate).toBe(false);
  });

  it("draws an instance layer on its parent's map, never borrowing across maps", () => {
    const tile = { file: '/pet-map-art/abc123.webp', x: 0, y: 0, width: 1125, height: 1125 };
    const art = { width: 1125, height: 1125, scale: 0.01, offset_x: 5, offset_y: 6, tiles: [tile] };
    const maps = normalizeCatalogue({
      maps: [
        { id: 'World/A', name: 'A', bounds: [0, 0, 1, 1], art },
        { id: 'World/A/InstanceLayer/A_Layer_1', name: 'L', bounds: [0, 0, 1, 1] },
        { id: 'World/B/InstanceLayer/B_Layer_1', name: 'M', bounds: [0, 0, 1, 1] },
        { id: 'World/AB', name: 'AB', bounds: [0, 0, 1, 1] },
      ],
    }).maps;
    expect(maps[1]!.art).toEqual(maps[0]!.art);
    expect(maps[2]!.art).toBeNull();
    expect(maps[3]!.art).toBeNull();
  });

  it('keeps unknown status values null and never invents a collection', () => {
    const status = normalizeStatus({
      now_ms: 5,
      profile_id: 'p1',
      progress: [
        { pet_id: 1, level: 2, progress: 30, observed_ms: 4, progress_estimated: true },
        { pet_id: 2, level: 9, progress: 1 },
      ],
      nearby: [{ entity_id: 1, npc_id: 900, pet_ids: [1], distance: -3, bearing: 450 }],
      gains: [
        { id: 'g1', pet_id: 1, gained: 2, at_ms: 4 },
        { id: 'g2', pet_id: 1, gained: 0, at_ms: 4 },
      ],
      config: { revision: 3, pinned_ids: [1, 1, 2], nearby_radius: 100 },
    });
    expect(status.collection_synced).toBe(false);
    expect(status.live_synced).toBe(false);
    expect(status.progress).toEqual([
      { pet_id: 1, level: 2, progress: 30, observed_ms: 4, progress_estimated: true },
    ]);
    expect(status.nearby[0]).toMatchObject({
      // Unnamed: the radar words the fallback in the interface language.
      name: '',
      distance: null,
      bearing: 90,
      x: null,
    });
    expect(status.gains.map((g) => g.id)).toEqual(['g1']);
    expect(status.config).toMatchObject({ revision: 3, pinned_ids: [1, 2], nearby_radius: 100 });
    expect(status.position).toBeNull();
    // Older native builds send no last-known position.
    expect(status.last_position).toBeNull();
    expect(status.error).toBeNull();
  });

  it('reads the last-known position separately from the fresh one', () => {
    const at = { zone_id: 1010, map_id: null, x: 10, y: -20, observed_ms: 3 };
    const status = normalizeStatus({ position: null, last_position: at });
    expect(status.position).toBeNull();
    expect(status.last_position).toEqual(at);
    expect(normalizeStatus({ last_position: { x: 'a', y: 1 } }).last_position).toBeNull();
  });

  it('defaults the radar window to unlocked and hidden', () => {
    expect(normalizeWindowStatus(null)).toEqual({
      requested: false,
      visible: false,
      ready: false,
      locked: false,
      game_active: false,
      errors: [],
    });
  });

  it('keeps a farming goal and last map only when well formed', () => {
    const config = (value: unknown) => normalizeStatus({ config: value }).config;
    expect(config({ farming_goal: { pet_id: 3, map_id: 'M' }, last_map_id: 'M' })).toMatchObject({
      farming_goal: { pet_id: 3, map_id: 'M' },
      last_map_id: 'M',
    });
    expect(config({ farming_goal: { pet_id: 'x', map_id: 'M' } }).farming_goal).toBeNull();
    expect(config({ farming_goal: { pet_id: 3 } }).farming_goal).toBeNull();
    expect(config({ last_map_id: '' }).last_map_id).toBeNull();
    // Older native configs without the fields read as not farming.
    expect(config({ revision: 2 })).toMatchObject({ farming_goal: null, last_map_id: null });
  });

  it('reads a missing or malformed session as no session, never as pickups', () => {
    expect(normalizeStatus({}).session).toEqual({
      profile_id: null,
      started_ms: null,
      souls_gained: 0,
      level_ups: 0,
      obtained: 0,
    });
    expect(
      normalizeStatus({
        session: { profile_id: 'p1', started_ms: 5, souls_gained: 6, level_ups: -2, obtained: 1.5 },
      }).session,
    ).toEqual({ profile_id: 'p1', started_ms: 5, souls_gained: 6, level_ups: 0, obtained: 0 });
  });

  it('falls back to the game growth rules only where the catalogue omits a level', () => {
    expect(normalizeCatalogue({}).thresholds).toEqual({ 0: 5, 1: 25, 2: 75, 3: 0 });
    expect(normalizeCatalogue({ thresholds: { 0: 7 } }).thresholds[0]).toBe(7);
  });
});
