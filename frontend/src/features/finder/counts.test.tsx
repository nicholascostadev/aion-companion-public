import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ALTGARD, VERTERON } from '../maps/atlas';
import { cubeSpots } from '../cubes/spawns';
import { gatheringSpots } from '../gathering/spawns';
import { ExploreView } from './ExploreView';
import { useTestPrefs } from './fixtures';

function View() {
  return (
    <ExploreView
      native={false}
      status={null}
      fresh={new Set()}
      error=""
      clearing={false}
      onClear={() => undefined}
      prefs={useTestPrefs()}
    />
  );
}

afterEach(cleanup);

/*
 * The bundled game data on one map: every possible cube and gathering location is drawn
 * and counted once, each finder's points apart, however places of both kinds are grouped.
 */
const EXPECTED = {
  [VERTERON]: { cube: 1440, gathering: 2709 },
  [ALTGARD]: { cube: 1371, gathering: 2692 },
};

describe('Explore with the bundled possible locations', () => {
  it.each([
    ['Verteron', VERTERON],
    ['Altgard', ALTGARD],
  ] as const)('draws and counts every possible location of %s by finder', (name, id) => {
    const expected = EXPECTED[id];
    expect(cubeSpots(id)?.points).toBe(expected.cube);
    expect(gatheringSpots(id)?.points).toBe(expected.gathering);
    const { container } = render(<View />);
    fireEvent.click(screen.getByRole('button', { name }));
    fireEvent.click(screen.getByRole('button', { name: 'Whole map' }));
    const drawn = [...container.querySelectorAll<SVGElement>('[data-spot-key]')];
    // Grouped as the whole map is: bounded by the screen, not the catalogue.
    expect(drawn.length).toBeLessThan(600);
    const counted = { cube: 0, gathering: 0 };
    for (const el of drawn) {
      if (el.dataset.group === undefined) {
        counted[el.dataset.spotKey!.split(':')[1] as 'cube' | 'gathering'] += Number(
          el.dataset.count,
        );
        continue;
      }
      for (const part of el.dataset.counts!.split(' ')) {
        const [layer, n] = part.split(':') as ['cube' | 'gathering', string];
        counted[layer] += Number(n);
      }
    }
    expect(counted).toEqual(expected);
    const all = drawn.reduce((n, el) => n + Number(el.dataset.count), 0);
    expect(all).toBe(expected.cube + expected.gathering);
    const count = (finder: string) =>
      container
        .querySelector(`[data-finder="${finder}"] [data-points]`)
        ?.getAttribute('data-points');
    expect(count('cubes')).toBe(String(expected.cube));
    expect(count('gathering')).toBe(String(expected.gathering));
  });
});
