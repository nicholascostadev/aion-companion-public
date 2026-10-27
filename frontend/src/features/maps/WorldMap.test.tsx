import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cubeArtSrc } from '../../components/ui/GameArt';
import { atlasMap, VERTERON, type AtlasMap } from './atlas';
import type { Place } from './spots';
import { spotKey, WorldMap, type MapMark, type SpotLayer } from './WorldMap';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const map = atlasMap(VERTERON) as AtlasMap;
const mark = (key: string, x: number, y: number, tone: MapMark['tone'] = 'live'): MapMark => ({
  key,
  kind: 'cube',
  x,
  y,
  tone,
  label: `Mark ${key}`,
});
/** A synthetic layer: a 20 × 20 grid of places 50 m apart around (x, y), one point each. */
const grid = (x = 0, y = 0): SpotLayer => {
  const places: Place[] = [];
  for (let i = 0; i < 20; i++)
    for (let j = 0; j < 20; j++)
      places.push({ x: x + i * 5000, y: y + j * 5000, count: 1, groups: [1] });
  return {
    id: 'test',
    kind: 'cube',
    places,
    label: (_, i) => `Spot ${i}`,
    groupLabel: (count) => `${count} spots`,
  };
};
const spotNodes = (container: HTMLElement) => [
  ...container.querySelectorAll<SVGElement>('[data-spot-key]'),
];
const total = (container: HTMLElement) =>
  spotNodes(container).reduce((n, el) => n + Number(el.dataset.count), 0);
const viewBox = (container: HTMLElement) =>
  container.querySelector('svg')!.getAttribute('viewBox')!.split(' ').map(Number);

describe('world map', () => {
  it('zooms, frames the whole map and follows again', () => {
    const { container } = render(
      <WorldMap map={map} marks={[]} player={{ x: 0, y: 0 }} title="Verteron" />,
    );
    const frame = container.querySelector<HTMLElement>('.world-map')!;
    const followed = viewBox(container);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(frame.dataset.camera).toBe('follow');
    expect(viewBox(container)[2]).toBeCloseTo(followed[2]! / 2);
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(frame.dataset.camera).toBe('free');
    expect(viewBox(container)[2]).toBeGreaterThanOrEqual(map.art.width);
    // A little farther out than the whole map, then no farther.
    fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect((screen.getByRole('button', { name: 'Zoom out' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Follow you' }));
    expect(viewBox(container)).toEqual(followed);
  });

  it('offers Fit to marks without a position', () => {
    render(<WorldMap map={map} marks={[mark('a', 1000, 1000)]} player={null} title="Verteron" />);
    expect(screen.getByRole('button', { name: 'Fit to marks' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Follow you' })).toBeNull();
  });

  it('selects marks by pointer and keyboard, and lets go on the map or Escape', () => {
    const onSelect = vi.fn<(key: string | null) => void>();
    const marks = [mark('a', 0, 0), mark('b', 2000, 0)];
    const { container, rerender } = render(
      <WorldMap map={map} marks={marks} player={null} title="Verteron" onSelect={onSelect} />,
    );
    const a = screen.getByRole('button', { name: 'Mark a' });
    expect(a.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('button', { name: 'Mark b' }).getAttribute('tabindex')).toBe('-1');
    fireEvent.click(a);
    expect(onSelect).toHaveBeenLastCalledWith('a');
    fireEvent.keyDown(a, { key: 'ArrowRight' });
    expect(document.activeElement?.getAttribute('data-mark-key')).toBe('b');
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('b');
    rerender(
      <WorldMap
        map={map}
        marks={marks}
        player={null}
        title="Verteron"
        selected="b"
        onSelect={onSelect}
      />,
    );
    fireEvent.keyDown(screen.getByRole('button', { name: 'Mark b' }), {
      key: 'Escape',
    });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(container.querySelector('svg')!);
    expect(onSelect).toHaveBeenCalledTimes(4);
  });

  it('brings a selected mark off screen into view', () => {
    const marks = [mark('a', 0, 0), mark('far', 300_000, 300_000, 'past')];
    const { container, rerender } = render(
      <WorldMap map={map} marks={marks} player={{ x: 0, y: 0 }} title="Verteron" />,
    );
    // Earlier marks never widen a followed view.
    const [x, y, w, h] = viewBox(container);
    const [fx, fy] = [8192 + 0.02 * 300_000, 8192 + 0.02 * 300_000];
    expect(fx > x! + w! || fy > y! + h!).toBe(true);
    rerender(
      <WorldMap map={map} marks={marks} player={{ x: 0, y: 0 }} title="Verteron" selected="far" />,
    );
    const [x2, y2, w2, h2] = viewBox(container);
    expect(x2! + w2! / 2).toBeCloseTo(fx);
    expect(y2! + h2! / 2).toBeCloseTo(fy);
  });

  it('lays its controls in a row in a short frame', () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback(
            [
              {
                contentRect: { width: 240, height: 82 },
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        disconnect() {}
      },
    );
    const { container } = render(
      <WorldMap map={map} marks={[]} player={null} title="Verteron" compact />,
    );
    expect(container.querySelector('[data-controls]')?.getAttribute('data-controls')).toBe('row');
  });

  it('groups spots as the view zooms out, never losing one, and opens a group', () => {
    const layer = [grid()];
    const { container } = render(
      <WorldMap map={map} marks={[]} spots={layer} player={null} title="Verteron" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    const groups = container.querySelectorAll('[data-spot-key][data-group]');
    expect(groups.length).toBeGreaterThan(0);
    expect(spotNodes(container).length).toBeLessThan(400);
    expect(total(container)).toBe(400);
    const before = viewBox(container)[2]!;
    fireEvent.click(groups[0]!);
    expect(viewBox(container)[2]).toBeLessThanOrEqual(before / 2);
    // Spots out of view are culled, not counted as gone: the whole map shows them again.
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(total(container)).toBe(400);
  });

  it('frames the spots without you or current marks, but never pulls a view that follows you', () => {
    const layer = [grid(-200_000, -200_000)];
    const { container, rerender } = render(
      <WorldMap map={map} marks={[]} player={{ x: 0, y: 0 }} title="Verteron" />,
    );
    const followed = viewBox(container);
    rerender(
      <WorldMap map={map} marks={[]} spots={layer} player={{ x: 0, y: 0 }} title="Verteron" />,
    );
    expect(viewBox(container)).toEqual(followed);
    rerender(<WorldMap map={map} marks={[]} spots={layer} player={null} title="Verteron" />);
    const [x, y, w, h] = viewBox(container);
    // The grid spans 950 m from (−2 km, −2 km): drawn from 4192 to 4382 on this sheet.
    expect(x).toBeLessThan(4192);
    expect(y).toBeLessThan(4192);
    expect(x! + w!).toBeGreaterThan(4382);
    expect(y! + h!).toBeGreaterThan(4382);
    expect(w).toBeLessThan(map.art.width / 4);
  });

  it('keeps a current mark first and above the spots, and selects a spot by its key', () => {
    const onSelect = vi.fn<(key: string | null) => void>();
    const layer = [grid(-50_000, -50_000)];
    const { container, rerender } = render(
      <WorldMap
        map={map}
        marks={[mark('a', 0, 0)]}
        spots={layer}
        player={null}
        title="Verteron"
        onSelect={onSelect}
      />,
    );
    // The mark is the tab stop and drawn after (over) every spot.
    expect(screen.getByRole('button', { name: 'Mark a' }).getAttribute('tabindex')).toBe('0');
    const drawn = [...container.querySelectorAll('[data-spot-key],[data-mark-key]')];
    expect(drawn.at(-1)?.getAttribute('data-mark-key')).toBe('a');
    expect(container.querySelectorAll('[data-spot-key][tabindex="0"]')).toHaveLength(0);
    // The mark frames the view, so the spots are drawn one by one around it.
    const spot = screen.getByRole('button', { name: 'Spot 190' });
    fireEvent.click(spot);
    expect(onSelect).toHaveBeenLastCalledWith(spotKey('test', 190));
    // Selected, it stands alone even where it would be grouped.
    rerender(
      <WorldMap
        map={map}
        marks={[mark('a', 0, 0)]}
        spots={layer}
        player={null}
        title="Verteron"
        selected={spotKey('test', 190)}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    const chosen = screen.getByRole('button', { name: 'Spot 190' });
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(chosen.querySelector('[data-ring="selected"]')).toBeTruthy();
    expect(total(container)).toBe(400);
    fireEvent.keyDown(chosen, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('draws each place with its own glyph, original art or a written label, and the cube by default', () => {
    // Half the grid is a resource with art, half one with only its label.
    const base = grid(-50_000, -50_000);
    const glyphOf = (i: number) => (i % 2 ? { text: 'Ku' } : { src: '/resource-art/ore.png' });
    const layer: SpotLayer = {
      ...base,
      kind: 'gathering',
      glyph: glyphOf,
      groupGlyphs: (members) => [glyphOf(members[0]!), glyphOf(members[0]! + 1), glyphOf(0)],
    };
    const { container, rerender } = render(
      <WorldMap
        map={map}
        marks={[]}
        spots={[layer]}
        player={{ x: -50_000, y: -50_000 }}
        title="Verteron"
      />,
    );
    // Following you, places 50 m apart are drawn one by one.
    const singles = spotNodes(container).filter((el) => !el.dataset.group);
    expect(singles.length).toBeGreaterThan(1);
    const odd = (el: SVGElement) => Number(el.dataset.spotKey!.split(':').at(-1)) % 2 === 1;
    const drawnAs = (el: SVGElement) => ({
      art: el.querySelector('image')?.getAttribute('href') ?? null,
      label: el.querySelector('[data-glyph="text"]')?.textContent ?? null,
    });
    expect(singles.map(drawnAs)).toEqual(
      singles.map((el) =>
        odd(el) ? { art: null, label: 'Ku' } : { art: '/resource-art/ore.png', label: null },
      ),
    );
    // Grouped, a tag shows at most two glyphs, every point still counted.
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    const tags = [...container.querySelectorAll('[data-spot-key][data-group]')];
    expect(tags.length).toBeGreaterThan(0);
    for (const tag of tags) {
      const glyphs = tag.querySelectorAll('image, [data-glyph="text"]').length;
      expect(glyphs).toBeGreaterThan(0);
      expect(glyphs).toBeLessThanOrEqual(2);
    }
    expect(total(container)).toBe(400);
    // A cube layer names no glyphs and keeps the original cube on every place and tag.
    rerender(<WorldMap map={map} marks={[]} spots={[grid()]} player={null} title="Verteron" />);
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    const hrefs = [...container.querySelectorAll('[data-spot-key] image')].map((i) =>
      i.getAttribute('href'),
    );
    expect(hrefs.length).toBeGreaterThan(0);
    expect(new Set(hrefs).size).toBe(1);
    expect(hrefs[0]).toBe(cubeArtSrc);
  });

  it('groups several layers together, each kind keeping its glyph, count and selection', () => {
    const onSelect = vi.fn<(key: string | null) => void>();
    // A cube grid and a gathering grid over the same ground, offset by 25 m.
    const cubes: SpotLayer = { ...grid(), id: 'cube', partLabel: (n) => `${n} cube places` };
    const gathering: SpotLayer = {
      ...grid(2500, 2500),
      id: 'gathering',
      kind: 'gathering',
      label: (_, i) => `Node ${i}`,
      groupLabel: (n) => `${n} nodes`,
      partLabel: (n) => `${n} nodes`,
      glyph: () => ({ text: 'Ku' }),
      groupGlyphs: () => [{ text: 'Ku' }, { text: 'Or' }],
      clusterPx: 26,
    };
    const spots = [cubes, gathering];
    const { container, rerender } = render(
      <WorldMap
        map={map}
        marks={[mark('live', 0, 0)]}
        spots={spots}
        player={null}
        title="Verteron"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    expect(total(container)).toBe(800);
    // Each layer's points add up on their own across every tag and place.
    const perLayer = { cube: 0, gathering: 0 };
    for (const el of spotNodes(container)) {
      if (el.dataset.group === undefined) {
        const layer = el.dataset.spotKey!.split(':')[1] as keyof typeof perLayer;
        perLayer[layer] += Number(el.dataset.count);
        continue;
      }
      for (const part of el.dataset.counts!.split(' ')) {
        const [layer, n] = part.split(':') as [keyof typeof perLayer, string];
        perLayer[layer] += Number(n);
      }
    }
    expect(perLayer).toEqual({ cube: 400, gathering: 400 });
    // A shared tag shows each kind: the original cube and the resource's own glyph.
    const mixed = [...container.querySelectorAll<SVGElement>('[data-spot-key][data-kind="mixed"]')];
    expect(mixed.length).toBeGreaterThan(0);
    for (const tag of mixed) {
      expect(tag.querySelector('image')?.getAttribute('href')).toBe(cubeArtSrc);
      expect(tag.querySelector('[data-glyph="text"]')?.textContent).toBe('Ku');
      expect(tag.getAttribute('aria-label')).toMatch(/^\d+ cube places · \d+ nodes, zoom in$/);
    }
    // The live mark stays the first stop and is drawn over every place.
    expect(screen.getByRole('button', { name: 'Mark live' }).getAttribute('tabindex')).toBe('0');
    const drawn = [...container.querySelectorAll('[data-spot-key],[data-mark-key]')];
    expect(drawn.at(-1)?.getAttribute('data-mark-key')).toBe('live');
    // A selected place of the second layer stands alone, and is its own layer's key.
    rerender(
      <WorldMap
        map={map}
        marks={[mark('live', 0, 0)]}
        spots={spots}
        player={null}
        title="Verteron"
        selected={spotKey('gathering', 190)}
        onSelect={onSelect}
      />,
    );
    const chosen = screen.getByRole('button', { name: 'Node 190' });
    expect(chosen.getAttribute('aria-pressed')).toBe('true');
    expect(chosen.dataset.kind).toBe('gathering');
    expect(total(container)).toBe(800);
    // Opening a shared tag zooms in on its places.
    const before = viewBox(container)[2]!;
    fireEvent.click(container.querySelector('[data-spot-key][data-kind="mixed"]')!);
    expect(viewBox(container)[2]).toBeLessThanOrEqual(before / 2);
    expect(onSelect).not.toHaveBeenCalled();
  });
  it('follows you at all times: no pan, and a group zooms in about you', () => {
    const layer = [grid(-40_000, -40_000)];
    const { container } = render(
      <WorldMap
        map={map}
        marks={[]}
        spots={layer}
        player={{ x: 0, y: 0 }}
        title="Verteron"
        follow
      />,
    );
    const frame = container.querySelector<HTMLElement>('.world-map')!;
    expect(screen.queryByRole('button', { name: 'Follow you' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Whole map' })).toBeNull();
    const out = screen.getByRole<HTMLButtonElement>('button', { name: 'Zoom out' });
    for (let i = 0; i < 4 && !out.disabled; i++) fireEvent.click(out);
    const group = container.querySelector('[data-spot-key][data-group]');
    expect(group).toBeTruthy();
    const [x, y, w, h] = viewBox(container) as [number, number, number, number];
    fireEvent.click(group!);
    const [ax, ay, aw, ah] = viewBox(container) as [number, number, number, number];
    expect(frame.dataset.camera).toBe('follow');
    expect(aw).toBeCloseTo(w / 2);
    // Still centred on you.
    expect(ax + aw / 2).toBeCloseTo(x + w / 2);
    expect(ay + ah / 2).toBeCloseTo(y + h / 2);
    // Keyboard opens a group the same way.
    fireEvent.click(out);
    const again = container.querySelector<SVGElement>('[data-spot-key][data-group]')!;
    const before = viewBox(container)[2]!;
    fireEvent.keyDown(again, { key: 'Enter' });
    expect(viewBox(container)[2]).toBeCloseTo(before / 2);
    expect(frame.dataset.camera).toBe('follow');
  });

  it('draws your facing through the projection, a last known mark hollow and an estimate ringed', () => {
    const { container, rerender } = render(
      <WorldMap map={map} marks={[]} player={{ x: 0, y: 0, facing: 90 }} title="Verteron" />,
    );
    const you = () => container.querySelector<SVGElement>('[data-mark="you"]')!;
    const arrow = () => container.querySelector<SVGElement>('[data-mark="you-facing"]');
    const turn = () =>
      Number(/rotate\(([^)]+)\)/.exec(arrow()?.getAttribute('transform') ?? '')?.[1]);
    // 90° is +Y, down on this north-up map.
    expect(you().dataset.state).toBe('fresh');
    expect(arrow()?.dataset.degrees).toBe('90');
    expect(turn()).toBeCloseTo(90);
    rerender(<WorldMap map={map} marks={[]} player={{ x: 0, y: 0, facing: 0 }} title="Verteron" />);
    expect(turn()).toBeCloseTo(0);
    rerender(
      <WorldMap map={map} marks={[]} player={{ x: 0, y: 0, facing: null }} title="Verteron" />,
    );
    expect(arrow()).toBeNull();
    expect(container.querySelector('[data-mark="you-estimate"]')).toBeNull();
    rerender(
      <WorldMap
        map={map}
        marks={[]}
        player={{ x: 0, y: 0, estimated: true, uncertainty_m: 3 }}
        title="Verteron"
      />,
    );
    expect(you().dataset.state).toBe('estimated');
    expect(container.querySelector('[data-mark="you-estimate"]')).toBeTruthy();
    rerender(
      <WorldMap
        map={map}
        marks={[]}
        player={{ x: 0, y: 0, last: true, estimated: true, facing: 180 }}
        title="Verteron"
      />,
    );
    expect(you().dataset.state).toBe('last');
    expect(you().querySelector('title')?.textContent).toBe('Your last known position');
    // Never an estimate around a last known position, and no ripple as if it were live.
    expect(container.querySelector('[data-mark="you-estimate"]')).toBeNull();
    expect(you().querySelector('.animate-ripple')).toBeNull();
    expect(arrow()?.dataset.degrees).toBe('180');
  });
});
