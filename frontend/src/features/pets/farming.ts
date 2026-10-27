import type { PetEntry, PetFamily, PetFarmingGoal, PetMap } from '../../types/pets';
import { isFarmMap, type MapLabel } from './maps';
import { npcName, stateOf, type PetIndex, type PetState } from './model';

/* Pure farming helpers: where a pet's souls drop, which map to focus and how to rank pets. */

/* ---------- Where to farm ---------- */

/** Source monsters sharing a name on one map, with their static spawn points. */
export interface FarmSource {
  name: string;
  npcIds: number[];
  points: number;
}

export interface FarmMapRow {
  map: PetMap;
  label: MapLabel | null;
  points: number;
  /** Most points first. */
  sources: FarmSource[];
  /** The character stands on this map now. */
  here: boolean;
}

/**
 * Source monsters with no spawn point on a farming map (unknown coordinates, or only on
 * other maps), grouped by name (`Minion Level 1 ×5`).
 */
export interface UnplacedSource {
  name: string;
  npcIds: number[];
}

export interface FarmPlan {
  /** Farming maps only: the current map first, then most points. */
  rows: FarmMapRow[];
  unplaced: UnplacedSource[];
  /** Spawn points over the farming maps. */
  points: number;
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Farming maps where `pet`'s source monsters have static spawns, each with its monsters
 * grouped by name on that map. Monsters with no point on a farming map are collected apart,
 * never dropped.
 */
export function farmPlan(index: PetIndex, pet: PetEntry, hereId: string | null): FarmPlan {
  const perMap = new Map<string, Map<string, FarmSource>>();
  const placed = new Set<number>();
  let points = 0;
  for (const s of pet.spawns) {
    if (!isFarmMap(s.map_id)) continue;
    points++;
    placed.add(s.npc_id);
    const sources = perMap.get(s.map_id) ?? new Map<string, FarmSource>();
    const name = npcName(index, s.npc_id);
    const source = sources.get(name) ?? { name, npcIds: [], points: 0 };
    source.points++;
    if (!source.npcIds.includes(s.npc_id)) source.npcIds.push(s.npc_id);
    sources.set(name, source);
    perMap.set(s.map_id, sources);
  }
  const rows: FarmMapRow[] = [];
  for (const [id, sources] of perMap) {
    const map = index.maps.get(id);
    if (!map) continue;
    const list = [...sources.values()].sort((a, b) => b.points - a.points || byName(a, b));
    rows.push({
      map,
      label: index.labels.get(id) ?? null,
      points: list.reduce((sum, s) => sum + s.points, 0),
      sources: list,
      here: id === hereId,
    });
  }
  rows.sort(
    (a, b) =>
      Number(b.here) - Number(a.here) ||
      b.points - a.points ||
      Number(!!b.map.art) - Number(!!a.map.art) ||
      (a.label?.label ?? a.map.id).localeCompare(b.label?.label ?? b.map.id),
  );
  const unplaced = new Map<string, UnplacedSource>();
  for (const id of pet.npc_ids) {
    if (placed.has(id)) continue;
    const name = npcName(index, id);
    const row = unplaced.get(name) ?? { name, npcIds: [] };
    if (!row.npcIds.includes(id)) row.npcIds.push(id);
    unplaced.set(name, row);
  }
  return {
    rows,
    unplaced: [...unplaced.values()].sort(
      (a, b) => b.npcIds.length - a.npcIds.length || byName(a, b),
    ),
    points,
  };
}

/**
 * The map to farm `pet` on: where the character stands when the pet spawns there, else the
 * map already chosen when the pet spawns there, else the map with the most points.
 */
export function bestFarmMap(plan: FarmPlan, chosenId: string | null): PetMap | null {
  const here = plan.rows.find((r) => r.here);
  if (here) return here.map;
  const chosen = chosenId ? plan.rows.find((r) => r.map.id === chosenId) : undefined;
  return (chosen ?? plan.rows[0])?.map ?? null;
}

/**
 * True when `goal` is still valid as saved: a known pet that spawns on its map. A goal saved
 * earlier on a map that is not a farming map stays valid, so it can still be seen and stopped.
 */
export function goalValid(index: PetIndex, goal: PetFarmingGoal | null) {
  if (!goal) return false;
  const pet = index.pets.get(goal.pet_id);
  return !!pet && index.maps.has(goal.map_id) && pet.spawns.some((s) => s.map_id === goal.map_id);
}

/* ---------- Search ---------- */

export const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase();

const haystacks = new WeakMap<PetIndex, Map<number, string>>();

/** Folded text a pet is found by: name, family, source monsters, regions and farming maps. */
export function petSearchText(index: PetIndex, pet: PetEntry) {
  let byPet = haystacks.get(index);
  if (!byPet) haystacks.set(index, (byPet = new Map()));
  let text = byPet.get(pet.id);
  if (text === undefined) {
    const maps = new Set(pet.spawns.flatMap((s) => (isFarmMap(s.map_id) ? [s.map_id] : [])));
    text = fold(
      [
        pet.name,
        pet.family,
        ...pet.npc_ids.map((id) => npcName(index, id)),
        ...pet.regions.map((r) => r.name),
        ...[...maps].map((id) => index.labels.get(id)?.label ?? id),
      ].join('\n'),
    );
    byPet.set(pet.id, text);
  }
  return text;
}

/** Farming maps with spawns whose name or realm matches `search`, in chooser order. */
export function searchMaps(index: PetIndex, search: string) {
  const needle = fold(search.trim());
  if (needle.length < 2) return [];
  const rows: { map: PetMap; label: MapLabel; points: number }[] = [];
  for (const { map, label, realm } of index.farmMaps) {
    const points = index.spawns.get(map.id)?.length ?? 0;
    if (points && fold(`${label.label}\n${realm}`).includes(needle))
      rows.push({ map, label, points });
  }
  return rows;
}

/* ---------- Ranked picker ---------- */

export type PickMode = 'farm' | 'pinned' | 'all';

export interface PickQuery {
  mode: PickMode;
  /** Only pets with spawns on this map; never hides pins in the pinned mode. */
  hereOnly: boolean;
  mapId: string | null;
  family: PetFamily | 'all';
  search: string;
  pinned: readonly number[];
  goal: number | null;
}

export interface PickRow {
  pet: PetEntry;
  state: PetState;
  /** Static spawn points on the shown map. */
  here: number;
  /** Static spawn points on every farming map. */
  points: number;
}

const farmPoints = (pet: PetEntry) => pet.spawns.filter((s) => isFarmMap(s.map_id)).length;

const needsSouls = (state: PetState) => state.stage === 'unowned' || state.stage === 'growing';

/**
 * Pets for the farming picker. Pins lead in pin order, then the goal; the rest are ranked
 * closest to their next level when the collection is known, else by spawn points on the
 * shown map, then on every farming map. Unknown pets never pretend to have progress. The
 * pinned mode lists every pin whatever the map: a pin is the user's own choice, so only the
 * type and the search narrow it.
 */
export function pickPets(
  index: PetIndex,
  states: Map<number, PetState>,
  query: PickQuery,
): PickRow[] {
  const needle = fold(query.search.trim());
  const pinned = new Set(query.pinned);
  const here = new Map<number, number>();
  for (const s of (query.mapId && index.spawns.get(query.mapId)) || [])
    here.set(s.pet, (here.get(s.pet) ?? 0) + 1);
  const rows: PickRow[] = [];
  for (const pet of index.catalogue.pets) {
    if (query.family !== 'all' && pet.family !== query.family) continue;
    const state = stateOf(states, pet.id);
    const on = here.get(pet.id) ?? 0;
    if (query.hereOnly && query.mode !== 'pinned' && !on) continue;
    if (query.mode === 'farm' && !needsSouls(state)) continue;
    if (query.mode === 'pinned' && !pinned.has(pet.id)) continue;
    if (needle && !petSearchText(index, pet).includes(needle)) continue;
    rows.push({ pet, state, here: on, points: farmPoints(pet) });
  }
  const pins = new Map(query.pinned.map((id, i) => [id, i]));
  const rank = (s: PetState) => (needsSouls(s) ? 0 : s.stage === 'unknown' ? 1 : 2);
  return rows.sort((a, b) => {
    const pa = pins.get(a.pet.id);
    const pb = pins.get(b.pet.id);
    if (pa !== undefined || pb !== undefined) return (pa ?? Infinity) - (pb ?? Infinity);
    const goal = Number(b.pet.id === query.goal) - Number(a.pet.id === query.goal);
    if (goal) return goal;
    return (
      rank(a.state) - rank(b.state) ||
      (a.state.left ?? Infinity) - (b.state.left ?? Infinity) ||
      b.here - a.here ||
      b.points - a.points ||
      a.pet.name.localeCompare(b.pet.name)
    );
  });
}
