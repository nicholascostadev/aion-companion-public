import type { PetCatalogue, PetsStatus } from '../../types/pets';

/*
 * Small, invented test catalogue: names and coordinates are placeholders, not game data.
 * Two maps use farming map ids (Elyos and Abyss); a third is a dungeon, never farmed.
 * Growth thresholds follow the game's rules (5 souls obtain a pet).
 */

export function catalogue(): PetCatalogue {
  return {
    version: 1,
    thresholds: { 0: 5, 1: 25, 2: 75, 3: 0 },
    npcs: [
      { id: 900, name: 'Test Wolf' },
      { id: 901, name: 'Test Owl' },
      { id: 902, name: 'Test Crab' },
      // A second monster with the same name, and sources with no known coordinates.
      { id: 903, name: 'Test Wolf' },
      { id: 904, name: 'Test Pup' },
      { id: 905, name: 'Test Pup' },
      { id: 906, name: 'Test Alpha' },
    ],
    maps: [
      {
        id: 'World/World_L/World_L_A',
        name: 'Test Plains',
        zone_ids: [7],
        bounds: [-1000, -1000, 1000, 1000],
        art: {
          width: 4096,
          height: 4096,
          scale: 0.5,
          offset_x: 2048,
          offset_y: 2048,
          approximate: false,
          overview: null,
          tiles: [
            {
              file: '/pet-map-art/0123456789abcdef0123.webp',
              x: 1024,
              y: 1024,
              width: 2048,
              height: 2048,
            },
          ],
        },
      },
      {
        id: 'Intersever/Abyss/Abyss_Reshanta_A',
        name: 'Test Cave',
        zone_ids: [],
        bounds: [0, 0, 500, 250],
        art: null,
      },
      {
        id: 'Dungeon/Test_C',
        name: 'Test Den',
        zone_ids: [],
        bounds: [0, 0, 300, 300],
        art: null,
      },
    ],
    pets: [
      {
        id: 1,
        name: 'Ashwolf',
        family: 'Fera',
        npc_ids: [900, 903, 904, 905, 906],
        soul_item_ids: [11],
        shop_item_ids: [],
        spawns: [
          { map_id: 'World/World_L/World_L_A', npc_id: 900, x: 100, y: -200, z: 0 },
          { map_id: 'World/World_L/World_L_A', npc_id: 900, x: 102, y: -201, z: 0 },
          { map_id: 'World/World_L/World_L_A', npc_id: 903, x: 140, y: -230, z: 0 },
          { map_id: 'Intersever/Abyss/Abyss_Reshanta_A', npc_id: 900, x: 50, y: 50, z: 0 },
          { map_id: 'Dungeon/Test_C', npc_id: 900, x: 20, y: 20, z: 0 },
        ],
        regions: [{ map_id: 'World/World_L/World_L_A', name: 'North Ridge' }],
      },
      {
        id: 2,
        name: 'Barn Owl',
        family: 'Natura',
        npc_ids: [901],
        soul_item_ids: [12],
        shop_item_ids: [],
        spawns: [{ map_id: 'World/World_L/World_L_A', npc_id: 901, x: -400, y: 300, z: 0 }],
        regions: [],
      },
      {
        id: 3,
        name: 'Copper Crab',
        family: 'Varia',
        npc_ids: [902],
        soul_item_ids: [],
        shop_item_ids: [],
        spawns: [
          { map_id: 'Intersever/Abyss/Abyss_Reshanta_A', npc_id: 902, x: 400, y: 200, z: 0 },
        ],
        regions: [],
      },
      {
        id: 4,
        name: 'Dawn Drake',
        family: 'Specia',
        npc_ids: [],
        soul_item_ids: [],
        shop_item_ids: [],
        spawns: [],
        regions: [],
      },
    ],
  };
}

export const NOW = 1_800_000_000_000;

/** A live status; the last-known position follows `position` unless given. */
export function status(overrides: Partial<PetsStatus> = {}): PetsStatus {
  const base = {
    revision: 1,
    now_ms: NOW,
    running: true,
    phase: 'capturing',
    message: '',
    profile_id: 'p1',
    active_profile_id: 'p1',
    profiles: [
      { id: 'p1', name: 'Tester', server_id: 1001, synced_ms: NOW - 60_000 },
      { id: 'p2', name: 'Alt', server_id: 1002, synced_ms: null },
    ],
    collection_synced: true,
    live_synced: true,
    active_pet_id: 2,
    progress: [
      { pet_id: 2, level: 1, progress: 10, observed_ms: NOW - 5000 },
      { pet_id: 3, level: 3, progress: 0, observed_ms: NOW - 5000 },
    ],
    nearby: [],
    position: {
      zone_id: 7,
      map_id: 'World/World_L/World_L_A',
      x: 0,
      y: 0,
      observed_ms: NOW - 1000,
    },
    gains: [],
    session: {
      profile_id: 'p1',
      started_ms: NOW - 15 * 60_000,
      souls_gained: 6,
      level_ups: 1,
      obtained: 0,
    },
    config: {
      revision: 4,
      pinned_ids: [],
      show_maxed: false,
      nearby_radius: 250,
      opacity: 0.8,
      scale: 1,
      show_toasts: true,
      farming_goal: null,
      last_map_id: null,
      routes: [],
      active_route_id: null,
    },
    error: null,
    bearing_reference: 'World compass: -Y north, +X east',
    ...overrides,
  };
  return {
    ...base,
    last_position: overrides.last_position !== undefined ? overrides.last_position : base.position,
  };
}
