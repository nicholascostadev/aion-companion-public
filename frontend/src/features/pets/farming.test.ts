import { describe, expect, it } from 'vitest';
import { bestFarmMap, farmPlan, goalValid, pickPets, searchMaps, type PickQuery } from './farming';
import { catalogue, status } from './fixtures';
import { createTestI18n } from '../../i18n/testing';
import { collectionStates, indexCatalogue } from './model';

const index = indexCatalogue(catalogue(), createTestI18n('en').getFixedT('en', 'pets'));
const ashwolf = index.pets.get(1)!;

describe('where to farm', () => {
  it('lists maps by points, grouping same-named sources on each map', () => {
    const plan = farmPlan(index, ashwolf, null);
    expect(plan.rows.map((r) => [r.map.id, r.points])).toEqual([
      ['World/World_L/World_L_A', 3],
      ['Intersever/Abyss/Abyss_Reshanta_A', 1],
    ]);
    // Two monsters named "Test Wolf" on one map are one source with both ids.
    expect(plan.rows[0]!.sources).toEqual([{ name: 'Test Wolf', npcIds: [900, 903], points: 3 }]);
    expect(plan.points).toBe(4);
  });

  it('offers only the farming maps, never a dungeon the pet also spawns in', () => {
    const plan = farmPlan(index, ashwolf, 'Dungeon/Test_C');
    expect(plan.rows.map((r) => r.map.id)).not.toContain('Dungeon/Test_C');
    expect(plan.rows.some((r) => r.here)).toBe(false);
    expect(bestFarmMap(plan, 'Dungeon/Test_C')?.id).toBe('World/World_L/World_L_A');
  });

  it('keeps sources off the farming maps apart, grouped by name, never dropped', () => {
    const plan = farmPlan(index, ashwolf, null);
    expect(plan.unplaced).toEqual([
      { name: 'Test Pup', npcIds: [904, 905] },
      { name: 'Test Alpha', npcIds: [906] },
    ]);
  });

  it('puts the map you stand on first', () => {
    const plan = farmPlan(index, ashwolf, 'Intersever/Abyss/Abyss_Reshanta_A');
    expect(plan.rows[0]).toMatchObject({ here: true });
    expect(plan.rows[0]!.map.id).toBe('Intersever/Abyss/Abyss_Reshanta_A');
  });

  it('farms where you are, else the chosen map, else the map with most points', () => {
    expect(
      bestFarmMap(
        farmPlan(index, ashwolf, 'Intersever/Abyss/Abyss_Reshanta_A'),
        'World/World_L/World_L_A',
      )?.id,
    ).toBe('Intersever/Abyss/Abyss_Reshanta_A');
    expect(
      bestFarmMap(farmPlan(index, ashwolf, null), 'Intersever/Abyss/Abyss_Reshanta_A')?.id,
    ).toBe('Intersever/Abyss/Abyss_Reshanta_A');
    expect(bestFarmMap(farmPlan(index, ashwolf, null), null)?.id).toBe('World/World_L/World_L_A');
    // A chosen map the pet never spawns on is ignored.
    const owl = index.pets.get(2)!;
    expect(bestFarmMap(farmPlan(index, owl, null), 'Intersever/Abyss/Abyss_Reshanta_A')?.id).toBe(
      'World/World_L/World_L_A',
    );
    expect(bestFarmMap(farmPlan(index, index.pets.get(4)!, null), null)).toBeNull();
  });

  it('accepts a goal only for a known pet that spawns on a known map', () => {
    expect(goalValid(index, { pet_id: 1, map_id: 'World/World_L/World_L_A' })).toBe(true);
    expect(goalValid(index, { pet_id: 2, map_id: 'Intersever/Abyss/Abyss_Reshanta_A' })).toBe(
      false,
    );
    expect(goalValid(index, { pet_id: 99, map_id: 'World/World_L/World_L_A' })).toBe(false);
    expect(goalValid(index, null)).toBe(false);
  });
});

describe('farming picker', () => {
  const query: PickQuery = {
    mode: 'all',
    hereOnly: false,
    mapId: 'World/World_L/World_L_A',
    family: 'all',
    search: '',
    pinned: [],
    goal: null,
  };
  const names = (q: Partial<PickQuery>, s = status()) =>
    pickPets(index, collectionStates(index.catalogue, s), { ...query, ...q }).map(
      (r) => r.pet.name,
    );

  it('ranks known pets closest to their next level first', () => {
    // Ashwolf needs 5 to obtain, Barn Owl 15 to level 2; Copper Crab is complete.
    expect(names({})).toEqual(['Ashwolf', 'Dawn Drake', 'Barn Owl', 'Copper Crab']);
    expect(names({ mode: 'farm' })).toEqual(['Ashwolf', 'Dawn Drake', 'Barn Owl']);
  });

  it('leads with pins in pin order, then the goal', () => {
    expect(names({ goal: 3, pinned: [2] })).toEqual([
      'Barn Owl',
      'Copper Crab',
      'Ashwolf',
      'Dawn Drake',
    ]);
    // A pinned goal keeps its pin place; the newest pin comes first.
    expect(names({ goal: 3, pinned: [4, 3] }).slice(0, 2)).toEqual(['Dawn Drake', 'Copper Crab']);
  });

  it('falls back to spawn points when the collection is unknown, with no fake progress', () => {
    const unknown = status({ collection_synced: false, progress: [] });
    const rows = pickPets(index, collectionStates(index.catalogue, unknown), query);
    expect(rows.every((r) => r.state.stage === 'unknown' && r.state.left === null)).toBe(true);
    // Most points on the shown map first: Ashwolf 3, Barn Owl 1, then everywhere.
    expect(rows.map((r) => [r.pet.name, r.here])).toEqual([
      ['Ashwolf', 3],
      ['Barn Owl', 1],
      ['Copper Crab', 0],
      ['Dawn Drake', 0],
    ]);
    // "To farm" needs a known collection: nothing pretends to need souls.
    expect(names({ mode: 'farm' }, unknown)).toEqual([]);
  });

  it('lists only pets farmable on the shown map when asked', () => {
    expect(names({ hereOnly: true })).toEqual(['Ashwolf', 'Barn Owl']);
    expect(names({ hereOnly: true, mapId: 'Intersever/Abyss/Abyss_Reshanta_A' })).toEqual([
      'Ashwolf',
      'Copper Crab',
    ]);
  });

  it('finds pets by monster, region and map name', () => {
    expect(names({ search: 'test pup' })).toEqual(['Ashwolf']);
    expect(names({ search: 'north ridge' })).toEqual(['Ashwolf']);
    expect(names({ search: 'test cave' })).toEqual(['Ashwolf', 'Copper Crab']);
    expect(names({ search: 'natura' })).toEqual(['Barn Owl']);
    expect(names({ search: 'test den' })).toEqual([]);
  });

  it('finds maps with spawns by their label', () => {
    expect(searchMaps(index, 'cave').map((m) => [m.map.id, m.points])).toEqual([
      ['Intersever/Abyss/Abyss_Reshanta_A', 2],
    ]);
    expect(searchMaps(index, 'abyss').map((m) => m.map.id)).toEqual([
      'Intersever/Abyss/Abyss_Reshanta_A',
    ]);
    // Maps other than the farming maps are never found.
    expect(searchMaps(index, 'test den')).toEqual([]);
    expect(searchMaps(index, 'p')).toEqual([]);
    expect(searchMaps(index, 'nowhere')).toEqual([]);
  });
});
