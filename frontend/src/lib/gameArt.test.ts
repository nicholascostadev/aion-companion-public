import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../data/game-art.json';
import { canonicalClass, classArt, skillArt } from './gameArt';

const PUBLIC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');
const bundled = (src: string) => existsSync(join(PUBLIC, src));
const skills: Record<string, { file?: string; base?: number; source?: string }> = manifest.skills;

describe('skill artwork', () => {
  it('resolves the reference Chanter skills by their exact ids', () => {
    const spinning = skillArt(18290000);
    expect(spinning).toMatchObject({ name: 'Spinning Strike', class: 'Chanter' });
    expect(spinning!.src).toMatch(/^\/game-art\/[0-9a-f]+\.webp$/);
    expect(bundled(spinning!.src)).toBe(true);
    expect(skillArt(18060000)?.name).toBe('Impactful Crush');
    expect(skillArt(18090000)?.name).toBe('Rushing Smash');
    expect(skillArt(18770000)?.name).toBe('Raging Spell');
  });

  it('gives a variant the artwork of its explicit base', () => {
    expect(skills['18290007']).toEqual({ base: 18290000 });
    expect(skillArt(18290007)).toEqual(skillArt(18290000));
    // Ids arrive as numbers or strings from different native payloads.
    expect(skillArt('18290007')).toEqual(skillArt(18290000));
  });

  it('never guesses from neighbouring or malformed ids', () => {
    // Ids next to a known skill are not part of its family unless the manifest says so.
    const neighbours = Array.from({ length: 50 }, (_, i) => 18290001 + i).filter(
      (id) => !Object.hasOwn(skills, String(id)),
    );
    expect(neighbours.length).toBeGreaterThan(0);
    for (const id of neighbours) expect(skillArt(id)).toBeNull();
    for (const id of [null, undefined, 0, -18290000, 18290000.5, '', ' ', '18290000x', '018290000'])
      expect(skillArt(id)).toBeNull();
    for (const id of ['constructor', '__proto__', 'toString']) expect(skillArt(id)).toBeNull();
  });

  it('resolves every manifest entry to a bundled image', () => {
    const missing = Object.keys(skills).filter((id) => {
      const art = skillArt(id);
      return !art || !bundled(art.src);
    });
    expect(missing).toEqual([]);
  });

  it('takes every skill icon from NCSOFT’s own game-data CDN', () => {
    const elsewhere = Object.entries(skills).filter(
      ([, entry]) =>
        entry.base === undefined &&
        !entry.source?.startsWith('https://assets.playnccdn.com/static-aion2-gamedata/resources/'),
    );
    expect(elsewhere).toEqual([]);
  });
});

describe('class artwork', () => {
  it('has an emblem for every native class name', () => {
    const names = [
      'Gladiator',
      'Templar',
      'Ranger',
      'Assassin',
      'Spiritmaster',
      'Sorcerer',
      'Cleric',
      'Chanter',
      'Brawler',
    ];
    const missing = names.filter((name) => {
      const art = classArt(name);
      return art?.name !== name || !bundled(art.src);
    });
    expect(missing).toEqual([]);
  });

  it('accepts only spelling variants and the game’s own internal class names', () => {
    expect(classArt('spirit master')).toEqual(classArt('Spiritmaster'));
    expect(classArt('CLERIC')).toEqual(classArt('Cleric'));
    expect(classArt('Elementalist')).toEqual(classArt('Spiritmaster'));
    expect(classArt('Fighter')).toEqual(classArt('Brawler'));
    for (const name of [null, undefined, '', 'Entity', 'Player', 'Warrior', 'Mage', 'constructor'])
      expect(classArt(name)).toBeNull();
  });

  it('names a class canonically, never through an inherited object property', () => {
    expect(canonicalClass('spirit master')).toBe('Spiritmaster');
    expect(canonicalClass('ELEMENTALIST')).toBe('Spiritmaster');
    expect(canonicalClass('fighter')).toBe('Brawler');
    const inherited = ['constructor', 'toString', 'hasOwnProperty', 'valueOf', '__proto__'];
    for (const name of [null, undefined, '', 'Warrior', ...inherited])
      expect(canonicalClass(name)).toBeNull();
  });
});
