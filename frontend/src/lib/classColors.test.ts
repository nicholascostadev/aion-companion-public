import { describe, expect, it } from 'vitest';
import { CLASS_COLORS, classColor, UNKNOWN_CLASS_COLOR } from './classColors';
import manifest from '../data/game-art.json';

describe('class colours', () => {
  it('gives each of the nine classes the colour of its own class', () => {
    expect(Object.keys(CLASS_COLORS).sort()).toEqual(Object.keys(manifest.classes).sort());
    for (const [name, color] of Object.entries(CLASS_COLORS)) {
      expect(color).toBe(`var(--color-class-${name.toLowerCase()})`);
      expect(classColor(name)).toBe(color);
    }
  });

  it('reads native spellings and the game aliases of a class', () => {
    expect(classColor('ranger')).toBe(classColor('Ranger'));
    expect(classColor('RANGER')).toBe(classColor('Ranger'));
    expect(classColor('Elementalist')).toBe(classColor('Spiritmaster'));
    expect(classColor('Fighter')).toBe(classColor('Brawler'));
  });

  it('keeps an unknown or hidden class neutral', () => {
    for (const name of [null, undefined, '', 'Daevanion', 'constructor', '__proto__']) {
      expect(classColor(name)).toBe(UNKNOWN_CLASS_COLOR);
    }
    expect(Object.values(CLASS_COLORS)).not.toContain(UNKNOWN_CLASS_COLOR);
  });
});
