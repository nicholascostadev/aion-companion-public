import { describe, expect, it } from 'vitest';
import { resolveView, surfaceOf, VIEWS } from './views';

describe('window views', () => {
  it('opens the view named by the window URL and the workspace otherwise', () => {
    expect(resolveView('?view=overlay')).toBe('overlay');
    expect(resolveView('?mock&view=pet-radar')).toBe('pet-radar');
    expect(resolveView('?view=alert-popup')).toBe('alert-popup');
    expect(resolveView('')).toBe('workspace');
    expect(resolveView('?view=unknown')).toBe('workspace');
    // Inherited object keys are not views.
    expect(resolveView('?view=toString')).toBe('workspace');
  });

  it('opens the one Explore window by its earlier names, never a window of its own', () => {
    expect(resolveView('?view=explore')).toBe('explore');
    for (const name of ['cubes', 'gathering', 'maps', 'finder'])
      expect(resolveView(`?view=${name}&mock`)).toBe('explore');
  });

  it('keeps every native window route', () => {
    expect(Object.keys(VIEWS).sort()).toEqual(
      [
        'alert-popup',
        'details',
        'explore',
        'group',
        'menu',
        'overlay',
        'pet-radar',
        'timers',
        'trackers',
        'workspace',
      ].sort(),
    );
  });

  it('gives in-game windows glass and the workspace a solid ground', () => {
    const views = Object.keys(VIEWS) as (keyof typeof VIEWS)[];
    expect(views.filter((view) => surfaceOf(view) === 'solid')).toEqual(['workspace']);
  });
});
