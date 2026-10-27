import { describe, expect, it } from 'vitest';
import mapArt from '../../data/pet-map-art.json';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeCatalogue } from '../../lib/petsNormalize';
import { MAX_ART_UPSCALE, projection, wholeBox } from '../pets/model';
import { ALTGARD, ATLAS, atlasMap, RESHANTA, VERTERON, type AtlasMap } from './atlas';
import {
  atClosest,
  atFarthest,
  centreOn,
  FOLLOW_SPAN,
  followBox,
  panBox,
  unitOf,
  zoomBox,
} from './camera';

const HERE = dirname(fileURLToPath(import.meta.url));
const catalogue = normalizeCatalogue(
  JSON.parse(
    readFileSync(
      join(HERE, '..', '..', '..', '..', 'crates/companion-capture/data/pet-catalogue.json'),
      'utf8',
    ),
  ),
);

describe('world map atlas', () => {
  it('builds every bundled map exactly like the catalogue serves it', () => {
    expect([...ATLAS.keys()].sort()).toEqual(mapArt.maps.map((m) => m.id).sort());
    for (const map of ATLAS.values()) {
      const served = catalogue.maps.find((m) => m.id === map.id);
      expect(served?.art).toBeTruthy();
      expect(map.bounds).toEqual(served?.bounds);
      const key = (t: { file: string; x: number; y: number; width: number; height: number }) =>
        `${t.file}|${t.x}|${t.y}|${t.width}|${t.height}`;
      expect(map.art.tiles.map(key).sort()).toEqual(served!.art!.tiles.map(key).sort());
      expect(map.art.overview).toEqual(served!.art!.overview);
      expect([map.art.scale, map.art.offset_x, map.art.offset_y]).toEqual([
        served!.art!.scale,
        served!.art!.offset_x,
        served!.art!.offset_y,
      ]);
      expect(map.art.approximate).toBe(false);
    }
  });

  it('uses the verified calibration: canvas centre plus scale × world, −Y up', () => {
    const verteron = projection(atlasMap(VERTERON)!);
    expect(verteron.project(0, 0)).toEqual([8192, 8192]);
    expect(verteron.project(-50_000, 126_000)).toEqual([7192, 10712]);
    const altgard = projection(atlasMap(ALTGARD)!);
    expect(altgard.project(100_000, -100_000)).toEqual([5096, 3096]);
    expect(atlasMap(RESHANTA)?.name).toBe('Chaotic Lower Reshanta');
  });

  it('knows no map for an unknown or missing id', () => {
    expect(atlasMap(null)).toBeNull();
    expect(atlasMap('verteron')).toBeNull();
    expect(atlasMap('World/World_L/World_L_B')).toBeNull();
  });
});

describe('world map camera', () => {
  const map = atlasMap(VERTERON) as AtlasMap;
  const view = projection(map);
  const whole = wholeBox(map, view);
  const frame = { width: 640, height: 400 };
  const centre = (b: { x: number; y: number; width: number; height: number }) => [
    b.x + b.width / 2,
    b.y + b.height / 2,
  ];
  const span = Math.abs(view.project(FOLLOW_SPAN, 0)[0] - view.project(0, 0)[0]);

  it('follows you at the centre, with every current mark in view', () => {
    const player = { x: -50_000, y: 126_000 };
    const near = followBox({
      map,
      view,
      whole,
      frame,
      player,
      points: [],
      zoom: 1,
    });
    expect(centre(near)).toEqual(view.project(player.x, player.y));
    expect(near.width).toBeGreaterThanOrEqual(span);
    const far = { x: player.x + 60_000, y: player.y - 20_000 };
    const wide = followBox({
      map,
      view,
      whole,
      frame,
      player,
      points: [far],
      zoom: 1,
    });
    expect(centre(wide)).toEqual(view.project(player.x, player.y));
    const [fx, fy] = view.project(far.x, far.y);
    expect(fx).toBeLessThan(wide.x + wide.width);
    expect(fy).toBeGreaterThan(wide.y);
    // Closer by zoom, never past the art's sharpness.
    const close = followBox({
      map,
      view,
      whole,
      frame,
      player,
      points: [],
      zoom: 1e6,
    });
    expect(unitOf(close, frame) * MAX_ART_UPSCALE).toBeCloseTo(1);
    expect(atClosest(close, frame)).toBe(true);
  });

  it('frames the marks without a position, and the whole map without either', () => {
    const points = [
      { x: 10_000, y: 10_000 },
      { x: 20_000, y: 30_000 },
    ];
    const fitted = followBox({
      map,
      view,
      whole,
      frame,
      player: null,
      points,
      zoom: 1,
    });
    expect(centre(fitted)).toEqual(view.project(15_000, 20_000));
    const all = followBox({
      map,
      view,
      whole,
      frame,
      player: null,
      points: [],
      zoom: 1,
    });
    expect(centre(all)).toEqual(centre(whole));
    expect(all.width).toBeCloseTo(whole.width);
  });

  it('zooms about a point and stops at both ends', () => {
    const start = { x: 6000, y: 6000, width: 2000, height: 2000 };
    const at = { x: 6500, y: 6500 };
    const closer = zoomBox(start, 2, whole, frame, at);
    expect(closer.width).toBe(1000);
    // The point under the pointer stays put.
    expect((at.x - closer.x) / closer.width).toBeCloseTo((at.x - start.x) / start.width);
    const out = zoomBox(start, 1e-6, whole, frame);
    expect(atFarthest(out, whole)).toBe(true);
    expect(out.width).toBeCloseTo(whole.width * 1.25);
  });

  it('pans and centres without leaving the map', () => {
    const box = { x: 1000, y: 1000, width: 2000, height: 1000 };
    expect(panBox(box, 500, -200, whole)).toEqual({ ...box, x: 1500, y: 800 });
    const off = panBox(box, -1e6, -1e6, whole);
    expect(centre(off)).toEqual([whole.x, whole.y]);
    expect(centreOn(box, { x: 9000, y: 9000 }, whole)).toEqual({
      ...box,
      x: 8000,
      y: 8500,
    });
  });
});
