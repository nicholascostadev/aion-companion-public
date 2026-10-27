import { describe, expect, it } from 'vitest';
import bundled from '../../data/gathering-spawns.json';
import { gatheringArtSrc } from '../../components/ui/GameArt';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { SPOTS_FILE } from './fixtures';
import {
  GATHERING_CATEGORIES,
  gatheringMapIds,
  gatheringResources,
  gatheringSpots,
  parseGatheringSpots,
  shortName,
} from './spawns';

describe('gathering catalogue', () => {
  const { resources, maps } = parseGatheringSpots(SPOTS_FILE);

  it('merges native resources that yield the same item into one resource', () => {
    // Orichalcum, Cypri and Ruby each come from two native ids; the bad rows are skipped.
    expect([...resources.keys()].sort()).toEqual(
      ['item:100', 'item:200', 'item:300', 'item:400', 'item:500'].sort(),
    );
    expect(resources.get('item:200')).toMatchObject({
      category: 'food',
      name: { en: 'Cypri' },
      envIds: [11, 12],
    });
    expect(resources.get('item:300')?.iconKey).toBeNull();
  });

  it('keeps every native point of a merged resource and merges only close points', () => {
    const verteron = maps.get(VERTERON)!;
    const cypri = verteron.resources.find((r) => r.resource.key === 'item:200')!;
    expect(cypri.points).toBe(2);
    expect(cypri.places).toHaveLength(2);
    const ore = verteron.resources.find((r) => r.resource.key === 'item:100')!;
    // Two points 20 cm apart are one place standing for both.
    expect(ore.points).toBe(3);
    expect(ore.places.map((p) => p.count)).toEqual([2, 1]);
    expect(verteron.points).toBe(8);
  });

  it('skips groups of several or unknown resources, maps without art and bad points', () => {
    expect([...maps.keys()]).toEqual([VERTERON, ALTGARD]);
    const verteron = maps.get(VERTERON)!;
    const all = verteron.resources.flatMap((r) => r.places);
    expect(all.some((p) => p.x === 0 && p.y === 0)).toBe(false);
    expect(maps.get(ALTGARD)!.points).toBe(3);
  });

  it('orders resources by category, then name', () => {
    const order = maps.get(VERTERON)!.resources.map((r) => r.resource.name.en);
    expect(order).toEqual(['Orichalcum', 'Ruby', 'Aria', 'Cypri', 'Kukuru']);
  });

  it('is no catalogue for another version or shape', () => {
    expect(parseGatheringSpots({ ...SPOTS_FILE, version: 2 }).maps.size).toBe(0);
    expect(parseGatheringSpots(null).resources.size).toBe(0);
    expect(parseGatheringSpots({ version: 1, resources: 'x', maps: [] }).maps.size).toBe(0);
  });

  it('writes one or two letters for a resource without art', () => {
    expect(shortName('Kukuru')).toBe('Ku');
    expect(shortName('Fine Odyle')).toBe('FO');
    expect(shortName('  ')).toBe('?');
  });
});

describe('bundled gathering catalogue', () => {
  it('lists the possible locations of Verteron and Altgard from the game data', () => {
    expect(gatheringMapIds().sort()).toEqual([ALTGARD, VERTERON].sort());
    expect(gatheringSpots(VERTERON)?.points).toBe(2709);
    expect(gatheringSpots(ALTGARD)?.points).toBe(2692);
    const groups = (id: string) => bundled.maps.find((m) => m.map_id === id)?.groups.length;
    expect(groups(VERTERON)).toBe(130);
    expect(groups(ALTGARD)).toBe(39);
  });

  it('keeps every native resource and point, named once per gathered item', () => {
    const native = bundled.resources.length;
    expect(native).toBe(27);
    const envIds = gatheringResources().flatMap((r) => r.envIds);
    const byId = (a: number, b: number) => a - b;
    expect(envIds.sort(byId)).toEqual(bundled.resources.map((r) => r.id).sort(byId));
    // Each map lists every resource name once (Verteron's two Cypri ids are one Cypri).
    for (const id of [VERTERON, ALTGARD]) {
      const names = gatheringSpots(id)!.resources.map((r) => r.resource.name.en);
      expect(new Set(names).size).toBe(names.length);
    }
    expect(new Set(gatheringResources().map((r) => r.category))).toEqual(
      new Set(GATHERING_CATEGORIES),
    );
  });

  it('draws every icon key from verified bundled art, and none without one', () => {
    const keys = gatheringResources().flatMap((r) => r.iconKey ?? []);
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys)
      expect(gatheringArtSrc(key)).toMatch(/^\/resource-art\/[0-9a-f]{20}\.webp$/);
    // Resources whose exact native icon has no verified art keep their written label.
    expect(
      gatheringResources()
        .filter((r) => !r.iconKey)
        .map((r) => r.name.en)
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(['Conide', 'Inina', 'Kukuru', 'Ohkra']);
    expect(gatheringArtSrc('Icon_Item_Gather_Made_Up')).toBeNull();
    expect(gatheringArtSrc(null)).toBeNull();
    expect(gatheringArtSrc('constructor')).toBeNull();
  });
});
