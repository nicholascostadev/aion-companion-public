import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import mapArt from '../../data/pet-map-art.json';
import { normalizeCatalogue } from '../../lib/petsNormalize';
import type { PetMap } from '../../types/pets';
import { FARM_MAPS, isFarmMap, labelMaps, mapContext, spellId } from './maps';
import { projection } from './model';
import { createTestI18n } from '../../i18n/testing';

const tr = createTestI18n('en').getFixedT('en', 'pets');

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOGUE = join(
  HERE,
  '..',
  '..',
  '..',
  '..',
  'crates/companion-capture/data/pet-catalogue.json',
);

/* Invented map ids shaped like the catalogue's; names are placeholders. */
const map = (id: string, name = `Map ${id.slice(id.lastIndexOf('/') + 1)}`): PetMap => ({
  id,
  name,
  zone_ids: [],
  bounds: [0, 0, 1, 1],
  art: null,
});

const maps = [
  map('World/World_L/World_L_A', 'Sunfield'),
  map('World/World_D/World_D_A', 'Frostvale'),
  map('World/World_L/World_L_Starter'),
  map('World/World_L/World_L_A/InstanceLayer/World_L_A_Layer_HQ010'),
  map('World/World_L/World_L_A/InstanceLayer/World_L_A_Layer_District_EP2_1'),
  map('World/World_D/World_D_A/InstanceLayer/Dragon_Garrision_D1_1'),
  map('Dungeon/Party/Test_Den/Test_Den_Easy', 'Test Den'),
  map('Dungeon/Party/Test_Den/Test_Den_Normal', 'Test Den'),
  map('Dungeon/Party/Test_Den/Test_Den_Hard', 'Test Den'),
  map('Dungeon/Party/Test_Den/Test_Den_G_09', 'Test Den'),
  map('Dungeon/Crisis/Test_Pit/Test_Pit_Hell', 'Test Pit'),
  map('Dungeon/Crisis/Test_Pit/Test_Pit_Easy', 'Test Pit'),
  map('Dungeon/Seal/Light/Seal_Test_001', 'Quiet Cave'),
  map('ClusterofGrowth/Growth_TestBasin'),
  map('ClusterofGrowth/ClusterofGrowth_L/Growth_TestBasin_L'),
  map('ClusterofGrowth/ClusterofGrowth_D/Growth_TestBasin_D'),
  map('Intersever/Abyss/Abyss_Test', 'Upper Test Abyss'),
];
const labels = labelMaps(maps, tr);
const label = (id: string) => labels.get(id)!;

describe('map labels', () => {
  it('names factions only from faction folders in the id', () => {
    expect(label('World/World_L/World_L_A')).toMatchObject({
      label: 'Sunfield',
      faction: 'Elyos',
      group: 'Elyos regions',
      kind: 'field',
    });
    expect(label('World/World_D/World_D_A')).toMatchObject({
      faction: 'Asmodian',
      group: 'Asmodian regions',
    });
    expect(label('Dungeon/Seal/Light/Seal_Test_001').faction).toBe('Elyos');
    expect(label('Dungeon/Party/Test_Den/Test_Den_Easy').faction).toBeNull();
    expect(label('Intersever/Abyss/Abyss_Test').group).toBe('Abyss');
  });

  it('translates only known difficulties and keeps other variants neutral', () => {
    expect(label('Dungeon/Party/Test_Den/Test_Den_Easy')).toMatchObject({
      label: 'Test Den · Easy',
      variant: 'Easy',
    });
    expect(label('Dungeon/Party/Test_Den/Test_Den_Normal').label).toBe('Test Den · Normal');
    expect(label('Dungeon/Party/Test_Den/Test_Den_Hard').label).toBe('Test Den · Hard');
    // Unverified suffixes never become an invented difficulty.
    expect(label('Dungeon/Party/Test_Den/Test_Den_G_09').label).toBe('Test Den · Variant G09');
    expect(label('Dungeon/Crisis/Test_Pit/Test_Pit_Hell').label).toBe('Test Pit · Variant Hell');
  });

  it('folds instance layers into their parent with a readable, unique name', () => {
    expect(label('World/World_L/World_L_A/InstanceLayer/World_L_A_Layer_HQ010')).toMatchObject({
      label: 'Sunfield · HQ010',
      kind: 'layer',
      parent: 'World/World_L/World_L_A',
      group: 'Instance layers',
      derived: true,
    });
    expect(
      label('World/World_L/World_L_A/InstanceLayer/World_L_A_Layer_District_EP2_1').label,
    ).toBe('Sunfield · District EP2 1');
    expect(label('World/World_D/World_D_A/InstanceLayer/Dragon_Garrision_D1_1').label).toBe(
      'Frostvale · Dragon Garrision D1 1',
    );
    // Internal ids never lead a label.
    for (const l of labels.values()) expect(l.label).not.toMatch(/^Map |World_|Layer_/);
  });

  it('spells unnamed maps from their id and tells same-named maps apart by faction', () => {
    expect(label('World/World_L/World_L_Starter')).toMatchObject({
      label: 'Starter',
      derived: true,
    });
    expect(label('ClusterofGrowth/Growth_TestBasin').label).toBe('Test Basin');
    expect(label('ClusterofGrowth/ClusterofGrowth_L/Growth_TestBasin_L').label).toBe(
      'Test Basin (Elyos)',
    );
    expect(label('ClusterofGrowth/ClusterofGrowth_D/Growth_TestBasin_D').label).toBe(
      'Test Basin (Asmodian)',
    );
  });

  it('gives every map a unique label, the same every time', () => {
    const all = [...labels.values()].map((l) => l.label);
    expect(new Set(all).size).toBe(maps.length);
    expect([...labelMaps([...maps].reverse(), tr).values()].map((l) => l.label).sort()).toEqual(
      [...all].sort(),
    );
    // A last resort keeps true duplicates apart by their id segment.
    const twins = labelMaps([map('Dungeon/A/Twin_X', 'Twin'), map('Dungeon/B/Twin_Y', 'Twin')], tr);
    expect(new Set([...twins.values()].map((l) => l.label)).size).toBe(2);
  });

  it('spells ids and describes context in words', () => {
    expect(spellId('GarrisonTerritory_L2_D2')).toBe('Garrison Territory L2 D2');
    expect(spellId('OldPurifyingAltar')).toBe('Old Purifying Altar');
    expect(mapContext(label('World/World_L/World_L_A'), tr)).toBe('Elyos · Region');
    expect(mapContext(label('Dungeon/Party/Test_Den/Test_Den_Easy'), tr)).toBe('Dungeon');
  });
});

describe('farming maps', () => {
  const real = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as {
    maps: (PetMap & { art?: unknown })[];
    pets: { spawns: { map_id: string }[] }[];
  };
  const labels = labelMaps(real.maps, tr);

  it('are exactly the Elyos and Asmodian main worlds and the Abyss', () => {
    expect(FARM_MAPS.map((m) => [labels.get(m.id)?.label, m.realm])).toEqual([
      ['Verteron', 'Elyos'],
      ['Altgard', 'Asmodian'],
      ['Chaotic Lower Reshanta', 'Abyss'],
    ]);
    expect(FARM_MAPS.map((m) => labels.get(m.id)?.kind)).toEqual(['field', 'field', 'abyss']);
    for (const { id } of FARM_MAPS)
      expect(real.pets.some((p) => p.spawns.some((s) => s.map_id === id))).toBe(true);
  });

  it('are the only maps with bundled original art', () => {
    expect(mapArt.maps.map((m) => m.id).sort()).toEqual(FARM_MAPS.map((m) => m.id).sort());
    expect([...new Set(mapArt.images.flatMap((i) => i.map_ids))].sort()).toEqual(
      FARM_MAPS.map((m) => m.id).sort(),
    );
    expect(
      real.maps
        .filter((m) => m.art)
        .map((m) => m.id)
        .sort(),
    ).toEqual(FARM_MAPS.map((m) => m.id).sort());
  });

  it('draw on their whole original canvas, tiled without gaps and with an overview', () => {
    const maps = normalizeCatalogue(real).maps;
    // Per map: the tiles cover the canvas exactly once (the same total area, every tile inside
    // it) and an overview is drawn over the whole canvas.
    const coverage = FARM_MAPS.map(({ id }) => {
      const art = maps.find((m) => m.id === id)?.art;
      return {
        id,
        covered: art?.tiles.reduce((n, t) => n + t.width * t.height, 0),
        canvas: art && art.width * art.height,
        inside: art?.tiles.every(
          (t) => t.x >= 0 && t.y >= 0 && t.x + t.width <= art.width && t.y + t.height <= art.height,
        ),
        overview: !!art?.overview,
      };
    });
    for (const row of coverage)
      expect(row).toEqual({ ...row, covered: row.canvas, inside: true, overview: true });
    expect(coverage.every((row) => row.canvas && row.canvas > 0)).toBe(true);
  });

  it('place known spawns where the original art shows their land', () => {
    // Sylphen on Verteron's western island: the canvas spans ±409,600 around the world origin
    // at 0.02 px per unit, so a spawn lands at 8192 + 0.02 × world on the 16384 px canvas.
    const maps = normalizeCatalogue(real).maps;
    const verteron = maps.find((m) => m.id === 'World/World_L/World_L_A')!;
    const view = projection(verteron);
    expect(view.width).toBe(16384);
    const [x, y] = view.project(-154_604, -60_974);
    expect(x).toBeCloseTo(5099.92, 6);
    expect(y).toBeCloseTo(6972.52, 6);
    // The same spawn is in the catalogue, unchanged.
    expect(
      real.pets.some((p) =>
        p.spawns.some(
          (s) =>
            s.map_id === verteron.id &&
            (s as { x?: number }).x === -154_604 &&
            (s as { y?: number }).y === -60_974,
        ),
      ),
    ).toBe(true);
    // Every farming map's canvas is centred on the world origin.
    const centres = FARM_MAPS.map(({ id }) => {
      const map = maps.find((m) => m.id === id)!;
      return {
        id,
        origin: projection(map).project(0, 0),
        centre: [map.art!.width / 2, map.art!.height / 2],
      };
    });
    for (const row of centres) expect(row.origin).toEqual(row.centre);
  });

  it('never include dungeons, difficulties or instance layers', () => {
    expect(isFarmMap('World/World_L/World_L_A/InstanceLayer/World_L_A_Layer_HQ010')).toBe(false);
    expect(isFarmMap('Dungeon/Party/Fire_Temple/Fire_Temple_Hard')).toBe(false);
    expect(isFarmMap('Intersever/Abyss/Abyss_Reshanta_C')).toBe(false);
    expect(isFarmMap(null)).toBe(false);
    expect(isFarmMap('Intersever/Abyss/Abyss_Reshanta_A')).toBe(true);
  });
});
