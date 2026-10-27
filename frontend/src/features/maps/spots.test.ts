import { describe, expect, it } from 'vitest';
import { clusterCell, clusterPlaces, CLUSTER_PX, placesOf, spotDistance } from './spots';

describe('places', () => {
  it('merges points within two metres into the first, counting every point once', () => {
    const places = placesOf([
      { x: 0, y: 0, group: 2 },
      { x: 150, y: 100, group: 1 },
      { x: 0, y: 199, group: 2 },
      { x: 1000, y: 0, group: 3 },
    ]);
    expect(places).toEqual([
      { x: 0, y: 0, count: 3, groups: [1, 2] },
      { x: 1000, y: 0, count: 1, groups: [3] },
    ]);
  });

  it('merges across grid cells, never beyond the distance', () => {
    const places = placesOf([
      { x: 199, y: 0, group: 1 },
      { x: 201, y: 0, group: 1 },
      { x: 450, y: 0, group: 1 },
    ]);
    expect(places.map((p) => p.count)).toEqual([2, 1]);
  });

  it('measures straight-line metres on the map', () => {
    expect(spotDistance({ x: 300, y: 400, count: 1, groups: [1] }, { x: 0, y: 0 })).toBe(5);
  });
});

describe('spot clusters', () => {
  const places = [0, 10, 20, 500].map((x) => ({
    x,
    y: 0,
    count: x === 20 ? 3 : 1,
    groups: [1],
  }));
  const drawn = places.map((p) => [p.x, p.y] as const);

  it('groups in power-of-two cells of at least the cluster size on screen', () => {
    expect(clusterCell(1)).toBe(32);
    expect(clusterCell(0.25)).toBe(8);
    expect(clusterCell(10)).toBeGreaterThanOrEqual(CLUSTER_PX * 10);
  });

  it('keeps every point in exactly one cluster', () => {
    const clusters = clusterPlaces(drawn, places, 64);
    expect(clusters.reduce((n, c) => n + c.count, 0)).toBe(6);
    expect(clusters.flatMap((c) => c.members).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    const group = clusters.find((c) => c.members.length > 1)!;
    expect(group).toMatchObject({ x: 10, count: 5, members: [0, 1, 2] });
    // A single place keeps its own key at every zoom.
    expect(clusters.find((c) => c.members[0] === 3)?.key).toBe('p3');
  });

  it('groups more widely for a layer whose tags are wider', () => {
    expect(clusterCell(1, 40)).toBe(64);
    expect(clusterCell(1, 40)).toBeGreaterThan(clusterCell(1));
  });

  it('takes a group that would lie over its neighbour into it, keeping every count', () => {
    // Two groups in neighbouring wide cells whose tags (two cells wide) would overlap.
    const near = [0, 10, 130, 135, 900].map((x) => ({ x, y: 0, count: 2, groups: [1] }));
    const at = near.map((p) => [p.x, p.y] as const);
    const clusters = clusterPlaces(at, near, 64);
    expect(clusters.reduce((n, c) => n + c.count, 0)).toBe(10);
    expect(clusters.flatMap((c) => c.members).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    expect(clusters.find((c) => c.members.length > 1)?.members).toHaveLength(4);
    expect(clusters.find((c) => c.members[0] === 4)?.key).toBe('p4');
    // The selected place is never taken in.
    const kept = clusterPlaces(at, near, 64, 2);
    expect(kept.find((c) => c.key === 'p2')?.members).toEqual([2]);
    expect(kept.reduce((n, c) => n + c.count, 0)).toBe(10);
  });

  it('never groups the selected place, nor anything in the closest view', () => {
    const kept = clusterPlaces(drawn, places, 64, 1);
    expect(kept.find((c) => c.key === 'p1')?.members).toEqual([1]);
    expect(kept.reduce((n, c) => n + c.count, 0)).toBe(6);
    expect(clusterPlaces(drawn, places, 0).map((c) => c.key)).toEqual(['p0', 'p1', 'p2', 'p3']);
  });
});
