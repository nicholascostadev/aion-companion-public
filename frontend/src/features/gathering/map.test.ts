import { describe, expect, it } from 'vitest';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { HERE, SPOTS_FILE } from './fixtures';
import {
  categoryKeys,
  categoryShown,
  filterChoice,
  hiddenFor,
  layerIndex,
  nearestSpots,
  NONE_HIDDEN,
  onlyShown,
  resourcesAt,
  setShown,
  spotAt,
  visibleSpots,
} from './map';
import { parseGatheringSpots } from './spawns';

const catalogue = parseGatheringSpots(SPOTS_FILE);
const all = [...catalogue.resources.values()];
const verteron = catalogue.maps.get(VERTERON)!;
const altgard = catalogue.maps.get(ALTGARD)!;
const keysOf = (v: ReturnType<typeof visibleSpots>) => v.resources.map((r) => r.resource.key);

describe('gathering map layer', () => {
  it('draws every resource by default, as one layer counting every point', () => {
    const v = visibleSpots(verteron, NONE_HIDDEN);
    expect(v.resources).toHaveLength(5);
    expect(v.places).toHaveLength(7);
    expect(v.points).toBe(8);
    expect(v.owner).toHaveLength(v.places.length);
  });

  it('keeps a selected place by resource while other resources are hidden and shown', () => {
    const shown = visibleSpots(verteron, NONE_HIDDEN);
    const cypri = shown.offsets.get('item:200')!;
    const ref = spotAt(shown, cypri + 1)!.ref;
    expect(ref).toEqual({ key: 'item:200', index: 1 });
    const fewer = visibleSpots(verteron, new Set(['item:100']));
    const at = layerIndex(fewer, ref)!;
    expect(at).not.toBe(cypri + 1);
    expect(spotAt(fewer, at)?.place).toBe(spotAt(shown, cypri + 1)?.place);
    // Hidden with its resource.
    expect(layerIndex(visibleSpots(verteron, new Set(['item:200'])), ref)).toBeNull();
  });

  it('names a group by its resources, most points first', () => {
    const v = visibleSpots(verteron, NONE_HIDDEN);
    const members = v.places.map((_, i) => i);
    const names = resourcesAt(v, members).map((r) => r.resource.name.en);
    expect(names[0]).toBe('Orichalcum');
    expect(names[1]).toBe('Cypri');
    expect(new Set(names).size).toBe(5);
  });

  it('measures straight-line distances only from a fresh position', () => {
    const v = visibleSpots(verteron, NONE_HIDDEN);
    const near = nearestSpots(v, HERE, 3);
    expect(near.map((n) => n.resource.name.en)).toEqual(['Orichalcum', 'Kukuru', 'Cypri']);
    expect(near[0]!.distance).toBeCloseTo(5);
    expect(near.every((n, i) => i === 0 || n.distance >= near[i - 1]!.distance)).toBe(true);
    expect(nearestSpots(v, null, 3)).toEqual([]);
    // Only what is shown is measured.
    const ruby = nearestSpots(visibleSpots(verteron, onlyShown(all, ['item:400'])), HERE, 3);
    expect(ruby.map((n) => n.resource.key)).toEqual(['item:400']);
  });
});

describe('gathering filters', () => {
  it('keeps a category choice on every map', () => {
    const ore = hiddenFor(all, 'category:ore', NONE_HIDDEN);
    expect(keysOf(visibleSpots(altgard, ore))).toEqual(['item:100']);
    // Browsing to Verteron keeps Ore only: no food, gem or herb of that map appears.
    expect(keysOf(visibleSpots(verteron, ore))).toEqual(['item:100']);
    expect(filterChoice(all, ore)).toBe('category:ore');
  });

  it('keeps a one-resource choice on every map, and none where it is not listed', () => {
    const ruby = hiddenFor(all, 'resource:item:400', NONE_HIDDEN);
    expect(keysOf(visibleSpots(verteron, ruby))).toEqual(['item:400']);
    expect(keysOf(visibleSpots(altgard, ruby))).toEqual(['item:400']);
    // Ruby is the only gemstone, so choosing it reads as its whole category.
    expect(filterChoice(all, ruby)).toBe('category:gemstone');
    const kukuru = hiddenFor(all, 'resource:item:300', NONE_HIDDEN);
    expect(keysOf(visibleSpots(verteron, kukuru))).toEqual(['item:300']);
    expect(filterChoice(all, kukuru)).toBe('resource:item:300');
    expect(visibleSpots(altgard, kukuru).places).toHaveLength(0);
  });

  it('reads a mix from the checklist as custom and every resource as all', () => {
    expect(filterChoice(all, NONE_HIDDEN)).toBe('all');
    const mix = setShown(NONE_HIDDEN, ['item:100', 'item:500'], false);
    expect(filterChoice(all, mix)).toBe('custom');
    expect(hiddenFor(all, 'custom', mix)).toBe(mix);
    expect(hiddenFor(all, 'all', mix)).toBe(NONE_HIDDEN);
  });

  it('tells whether a category is shown, partly shown or hidden on a map', () => {
    expect(categoryShown(verteron, NONE_HIDDEN, 'food')).toBe('all');
    const some = setShown(NONE_HIDDEN, ['item:300'], false);
    expect(categoryShown(verteron, some, 'food')).toBe('some');
    const none = setShown(NONE_HIDDEN, categoryKeys(all, 'food'), false);
    expect(categoryShown(verteron, none, 'food')).toBe('none');
    expect(setShown(none, categoryKeys(all, 'food'), true).size).toBe(0);
  });
});
