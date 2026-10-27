import catalogueUrl from '../../../crates/companion-capture/data/pet-catalogue.json?url';
import { isFarmMap } from '../features/pets/maps';
import { rng } from './mockCombat';
import { FRESH, LONG, STILL } from './mockScenario';

/*
 * DEV ONLY (`?mock`). Pets use the app's own bundled catalogue (real names, maps and
 * spawns); the collection, position, sightings and session pickups are generated on
 * top of it for a fictional character.
 */

interface Spawn {
  map_id: string;
  npc_id: number;
  x: number;
  y: number;
  z: number;
}
interface Pet {
  id: number;
  name: string;
  family: string;
  npc_ids: number[];
  spawns: Spawn[];
}
interface Catalogue {
  pets: Pet[];
  maps: { id: string; name: string; zone_ids: number[]; art?: unknown }[];
  npcs: { id: number; name: string }[];
  thresholds: Record<string, number>;
}

let loading: Promise<Catalogue> | null = null;
export function catalogue(): Promise<Catalogue> {
  loading ??= fetch(catalogueUrl).then((res) => {
    if (!res.ok) throw new Error(`Pet catalogue: HTTP ${res.status}`);
    return res.json() as Promise<Catalogue>;
  });
  return loading;
}

interface World {
  progress: {
    pet_id: number;
    level: number;
    progress: number;
    observed_ms: number;
  }[];
  activePet: number;
  map: { id: string; zone: number | null };
  position: { x: number; y: number };
  nearby: Record<string, unknown>[];
  goal: { pet_id: number; map_id: string };
  pinned: number[];
  gains: { id: string; pet_id: number; gained: number; at_ms: number }[];
}

const config = {
  revision: 3,
  pinned_ids: [] as number[],
  show_maxed: false,
  nearby_radius: 250,
  opacity: 0.85,
  scale: 1,
  show_toasts: true,
  farming_goal: null as { pet_id: number; map_id: string } | null,
  last_map_id: null as string | null,
  routes: [] as MockRoute[],
  active_route_id: null as string | null,
};

interface MockRoute {
  id: string;
  name: string;
  map_id: string;
  pet_ids: number[];
  stops: { id: string; npc_id: number; x: number; y: number; pet_ids: number[]; done: boolean }[];
  current_stop_id: string | null;
}

/** Native stop radius in game centimetres (`STOP_RADIUS_CM`). */
const STOP_RADIUS = 8_000;

/**
 * Two legacy routes from the real catalogue, as an earlier version saved them: one followed
 * on the busiest farming map, one on Altgard with an orphaned stop. The app no longer shows
 * routes; the mock keeps them so every save can be seen to send them back unchanged.
 */
function mockRoutes(cat: Catalogue, mapId: string, targets: Pet[]): MockRoute[] {
  const stopsFor = (map: string, pets: Pet[], per: number) =>
    pets.flatMap((pet, p) =>
      pet.spawns
        .filter((s) => s.map_id === map)
        .filter((_, i, all) => i % Math.max(1, Math.floor(all.length / per)) === 0)
        .slice(0, per)
        .map((s, i) => ({
          id: `stop-${p}-${i}`,
          npc_id: s.npc_id,
          x: s.x,
          y: s.y,
          pet_ids: pets
            .filter((other) =>
              other.spawns.some(
                (o) => o.map_id === map && Math.hypot(o.x - s.x, o.y - s.y) <= STOP_RADIUS,
              ),
            )
            .map((other) => other.id),
          done: false,
        })),
    );
  const stops = stopsFor(mapId, targets, 2).slice(0, 5);
  if (stops[0]) stops[0].done = true;
  const altgard = 'World/World_D/World_D_A';
  const there = cat.pets.filter((p) => p.spawns.some((s) => s.map_id === altgard)).slice(0, 2);
  const kept = stopsFor(altgard, there, 1);
  return [
    {
      id: 'route-mock-1',
      name: 'Evening loop',
      map_id: mapId,
      pet_ids: targets.map((p) => p.id),
      stops,
      current_stop_id: stops[1]?.id ?? stops[0]?.id ?? null,
    },
    {
      id: 'route-mock-2',
      name: 'Old Altgard run',
      map_id: altgard,
      pet_ids: there.map((p) => p.id),
      stops: [
        ...kept,
        // A spawn record the bundled catalogue no longer has.
        { id: 'stop-gone', npc_id: 1, x: 12, y: 34, pet_ids: [there[0]?.id ?? 0], done: false },
      ],
      current_stop_id: null,
    },
  ];
}
const START = Date.now();
let world: World | null = null;

function build(cat: Catalogue): World {
  const r = rng(2026);
  const thresholds = cat.thresholds;
  const progress = cat.pets.flatMap((p) => {
    const roll = r();
    if (roll < 0.35) return [];
    const level = roll < 0.5 ? 0 : roll < 0.72 ? 1 : roll < 0.9 ? 2 : 3;
    const need = thresholds[String(level)] ?? 0;
    return [
      {
        pet_id: p.id,
        level,
        progress: need ? Math.floor(r() * need) : 0,
        observed_ms: START - Math.floor(r() * 3_600_000),
      },
    ];
  });
  // The farming map where the most pets spawn: Verteron in the bundled data.
  const farmMaps = cat.maps.filter((m) => isFarmMap(m.id));
  const count = (id: string) =>
    cat.pets.filter((p) => p.spawns.some((s) => s.map_id === id)).length;
  // `?mock=long`: the farming map of the longest pet name, its longest pet names first.
  const longest = [...cat.pets]
    .filter((p) => p.spawns.some((s) => isFarmMap(s.map_id)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  const longestMap = longest?.spawns.find((s) => isFarmMap(s.map_id))?.map_id;
  const map = LONG
    ? (cat.maps.find((m) => m.id === longestMap) ?? cat.maps[0]!)
    : (farmMaps.sort((a, b) => count(b.id) - count(a.id))[0] ?? cat.maps[0]!);
  const local = cat.pets.filter((p) => p.spawns.some((s) => s.map_id === map.id));
  if (LONG) local.sort((a, b) => b.name.length - a.name.length);
  const goalPet = LONG
    ? local[0]!
    : (local.find((p) => progress.some((g) => g.pet_id === p.id && g.level === 1)) ?? local[0]!);
  const anchor = goalPet.spawns.find((s) => s.map_id === map.id)!;
  const position = { x: anchor.x + 4_000, y: anchor.y - 3_000 };
  const npcName = new Map(cat.npcs.map((n) => [n.id, n.name]));
  const nearby = local
    .flatMap((p) => p.spawns.filter((s) => s.map_id === map.id).map((s) => ({ p, s })))
    .map(({ s }) => ({
      s,
      d: Math.hypot(s.x - position.x, s.y - position.y) / 100,
    }))
    .filter(({ d }) => d < 240)
    .sort((a, b) => a.d - b.d)
    .slice(0, 7)
    .map(({ s, d }, i) => ({
      entity_id: 70_000 + i,
      npc_id: s.npc_id,
      name: npcName.get(s.npc_id) ?? `Monster #${s.npc_id}`,
      pet_ids: cat.pets.filter((p) => p.npc_ids.includes(s.npc_id)).map((p) => p.id),
      x: s.x,
      y: s.y,
      distance: Math.round(d * 10) / 10,
      // World compass: -Y north, +X east.
      bearing: (Math.atan2(s.x - position.x, -(s.y - position.y)) * 180) / Math.PI,
      observed_ms: START - i * 700,
    }));
  const owned = progress.filter((g) => g.level > 0);
  return {
    progress,
    activePet: owned[0]?.pet_id ?? cat.pets[0]!.id,
    map: { id: map.id, zone: map.zone_ids[0] ?? null },
    position,
    nearby,
    goal: { pet_id: goalPet.id, map_id: map.id },
    pinned: [goalPet.id, ...local.slice(1, 3).map((p) => p.id)],
    gains: [
      { id: 'gain-1', pet_id: goalPet.id, gained: 1, at_ms: START - 40_000 },
      {
        id: 'gain-2',
        pet_id: local[1]?.id ?? goalPet.id,
        gained: 2,
        at_ms: START - 95_000,
      },
    ],
  };
}

async function ready() {
  const cat = await catalogue();
  if (!world) {
    world = build(cat);
    // A first run has chosen nothing yet.
    if (!FRESH) {
      config.farming_goal = world.goal;
      config.pinned_ids = world.pinned;
      config.last_map_id = world.map.id;
      const local = cat.pets.filter(
        (p) => p.id !== world!.goal.pet_id && p.spawns.some((s) => s.map_id === world!.map.id),
      );
      const goalPet = cat.pets.find((p) => p.id === world!.goal.pet_id)!;
      config.routes = isFarmMap(world.map.id)
        ? mockRoutes(cat, world.map.id, [goalPet, ...local.slice(3, 5)])
        : [];
      config.active_route_id = config.routes[0]?.id ?? null;
    }
  }
  return world;
}

const PROFILES = [
  {
    id: 'p1',
    name: 'Lyrienne',
    server_id: 2101,
    synced_ms: START - 12 * 60_000,
  },
  {
    id: 'p2',
    name: 'Lyrielle',
    server_id: 2101,
    synced_ms: START - 3 * 86_400_000,
  },
  { id: 'p3', name: 'Dorrin', server_id: 2102, synced_ms: null },
];

export async function status(profileId: unknown) {
  const w = await ready();
  const now = Date.now();
  if (FRESH)
    return {
      revision: config.revision,
      now_ms: now,
      running: true,
      phase: 'waiting_for_game',
      message: 'Waiting for AION 2.',
      profile_id: null,
      active_profile_id: null,
      profiles: [],
      collection_synced: false,
      live_synced: false,
      active_pet_id: null,
      progress: [],
      nearby: [],
      position: null,
      last_position: null,
      gains: [],
      session: {
        profile_id: null,
        started_ms: null,
        souls_gained: 0,
        level_ups: 0,
        obtained: 0,
      },
      config,
      error: null,
      bearing_reference: 'World compass: -Y north, +X east',
    };
  const profile = typeof profileId === 'string' ? profileId : 'p1';
  const current = profile === 'p1';
  // `?mock=still`: standing still, so only the last observed position remains.
  const here = current
    ? {
        zone_id: w.map.zone,
        map_id: w.map.id,
        ...w.position,
        observed_ms: STILL ? START - 65_000 : now - 400,
      }
    : null;
  return {
    revision: config.revision,
    now_ms: now,
    running: true,
    phase: 'capturing',
    message: '',
    profile_id: profile,
    active_profile_id: 'p1',
    profiles: PROFILES,
    collection_synced: profile !== 'p3',
    live_synced: current,
    active_pet_id: current ? w.activePet : null,
    progress: profile === 'p3' ? [] : w.progress,
    nearby: current ? w.nearby : [],
    position: STILL ? null : here,
    last_position: here,
    facing: here && !STILL ? { degrees: 315, observed_ms: now } : null,
    gains: current ? w.gains : [],
    session: current
      ? {
          profile_id: 'p1',
          started_ms: START - 47 * 60_000,
          souls_gained: 14,
          level_ups: 2,
          obtained: 1,
        }
      : {
          profile_id: null,
          started_ms: null,
          souls_gained: 0,
          level_ups: 0,
          obtained: 0,
        },
    config,
    error: null,
    bearing_reference: 'World compass: -Y north, +X east',
  };
}

export async function configure(next: unknown) {
  await ready();
  const value = (next ?? {}) as Partial<typeof config>;
  if (value.revision !== undefined && value.revision !== config.revision)
    throw new Error('Pet settings changed in another window (revision)');
  Object.assign(config, value, { revision: config.revision + 1 });
  return status('p1');
}

// Long strings: asked for, but held back while AION is not focused, except in the radar's
// own preview (`?view=pet-radar&mock=long`), which shows its rows with the long names.
const RADAR_VIEW = new URLSearchParams(window.location.search).get('view') === 'pet-radar';
const radar = {
  requested: !FRESH,
  visible: !FRESH && (!LONG || RADAR_VIEW),
  ready: true,
  locked: false,
  game_active: !FRESH && (!LONG || RADAR_VIEW),
};
export const windowStatus = () => ({ ...radar, errors: [] });
export function setWindow(patch: Partial<typeof radar>) {
  Object.assign(radar, patch);
  return windowStatus();
}
