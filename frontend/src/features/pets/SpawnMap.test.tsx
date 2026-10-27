import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { PetMapArt, PetPosition } from '../../types/pets';
import { catalogue, NOW } from './fixtures';
import { createTestI18n } from '../../i18n/testing';
import { indexCatalogue } from './model';
import { SpawnMap } from './SpawnMap';

afterEach(cleanup);

/** A canvas like the largest original map: 16384 px in 64 tiles of 2048, with an overview. */
const art: PetMapArt = {
  width: 16384,
  height: 16384,
  scale: 0.02,
  offset_x: 8192,
  offset_y: 8192,
  approximate: false,
  tiles: Array.from({ length: 64 }, (_, i) => ({
    file: `/pet-map-art/tile${i}.webp`,
    x: (i % 8) * 2048,
    y: Math.floor(i / 8) * 2048,
    width: 2048,
    height: 2048,
  })),
  overview: { file: '/pet-map-art/overview.webp', width: 2048, height: 2048 },
};

function draw(position: PetPosition | null = null) {
  const data = catalogue();
  data.maps[0]!.art = art;
  const index = indexCatalogue(data, createTestI18n('en').getFixedT('en', 'pets'));
  const map = index.maps.get('World/World_L/World_L_A')!;
  const element = (at: PetPosition | null) => (
    <SpawnMap
      index={index}
      map={map}
      pets={new Set([1, 2])}
      selected={null}
      goal={null}
      pinned={new Set()}
      position={at}
      sightings={[]}
      states={new Map()}
      now={NOW}
      onSelect={() => undefined}
    />
  );
  const rendered = render(element(position));
  return (at: PetPosition | null) => rendered.rerender(element(at));
}

const layer = () => document.querySelector('.pet-map-tiles')!;
const images = () => [...layer().querySelectorAll('image')].map((i) => i.getAttribute('href'));
/** Native canvas pixels per screen pixel in the default 640 × 400 frame. */
const unit = () => {
  const [, , width, height] = document
    .querySelector('.pet-map-svg')!
    .getAttribute('viewBox')!
    .split(' ')
    .map(Number);
  return Math.max(width! / 640, height! / 400);
};

describe('spawn map art', () => {
  it('follows observed player positions until the user chooses the whole map', () => {
    const position: PetPosition = {
      zone_id: 7,
      map_id: 'World/World_L/World_L_A',
      x: 50_000,
      y: -50_000,
      observed_ms: NOW,
    };
    const move = draw(position);
    const centreX = () => {
      const [x, , width] = document
        .querySelector('.pet-map-svg')!
        .getAttribute('viewBox')!
        .split(' ')
        .map(Number);
      return x! + width! / 2;
    };
    const follow = screen.getByRole('button', { name: 'Follow your position' });
    fireEvent.click(follow);
    expect(follow.getAttribute('aria-pressed')).toBe('true');
    const before = centreX();
    move({ ...position, x: 60_000, observed_ms: NOW + 1000 });
    expect(centreX() - before).toBeCloseTo(200);
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(follow.getAttribute('aria-pressed')).toBe('false');
    const whole = centreX();
    move({ ...position, x: 70_000, observed_ms: NOW + 2000 });
    expect(centreX()).toBeCloseTo(whole);
  });
  it('draws the whole map from its overview, feathered on the whole canvas', () => {
    draw();
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(images()).toEqual(['/pet-map-art/overview.webp']);
    // The feather is anchored to the canvas, so culled tiles never move it.
    const masks = [...document.querySelectorAll('mask')];
    expect(masks).toHaveLength(2);
    for (const mask of masks) {
      expect(mask.getAttribute('maskUnits')).toBe('userSpaceOnUse');
      expect(['x', 'y', 'width', 'height'].map((a) => mask.getAttribute(a))).toEqual([
        '0',
        '0',
        '16384',
        '16384',
      ]);
    }
  });

  it('zooms past 64× to the native sharpness limit, drawing only the tiles in view', () => {
    draw();
    const zoomIn = screen.getByRole('button', { name: 'Zoom in' }) as HTMLButtonElement;
    for (let i = 0; i < 20 && !zoomIn.disabled; i++) fireEvent.click(zoomIn);
    expect(zoomIn.disabled).toBe(true);
    // Four screen pixels per native pixel still use the original texture detail.
    expect(unit()).toBeCloseTo(1 / 4);
    expect(16384 / (640 * unit())).toBeGreaterThan(64);
    // The overview stays under the native tiles; only those meeting the view load.
    const shown = images();
    expect(shown[0]).toBe('/pet-map-art/overview.webp');
    expect(shown.length - 1).toBeGreaterThan(0);
    expect(shown.length - 1).toBeLessThanOrEqual(4);
    expect(Number(layer().getAttribute('data-tiles'))).toBe(shown.length - 1);
  });
});
