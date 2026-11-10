import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../data/daevanion-art.json';
import { daevanionNodeArt, daevanionNodeKey } from './daevanionArt';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
const node = (kind: string, grade: string, open = false) => ({ kind, grade, open });

describe('Daevanion node art', () => {
  it('gives each grade its closed and open original and every playable class its start', () => {
    const sources = new Set<string>();
    const wanted = [
      ...['Common', 'Rare', 'Unique', 'Legend'].flatMap((grade) => [
        node('stat', grade),
        node('skill', grade, true),
        node('stat', grade, true),
      ]),
      ...[
        'Gladiator',
        'Templar',
        'Assassin',
        'Ranger',
        'Sorcerer',
        'Spiritmaster',
        'Elementalist',
        'Cleric',
        'Chanter',
        'Brawler',
      ].map((name) => [node('start', 'None'), name] as const),
    ];
    for (const entry of wanted) {
      const [n, playerClass] = Array.isArray(entry) ? entry : [entry, null];
      const src = daevanionNodeArt(n, playerClass, '/');
      expect(src).toMatch(/^\/daevanion-art\/[0-9a-f]{20}\.webp$/);
      expect(existsSync(join(PUBLIC, src!))).toBe(true);
      sources.add(src!);
    }
    expect(sources.size).toBe(Object.keys(manifest.nodes).length);
  });

  it('draws a node by its grade and state, whatever its kind, as the official page does', () => {
    expect(daevanionNodeKey(node('skill', 'Legend', true), 'Chanter')).toBe('legend_open');
    expect(daevanionNodeKey(node('stat', 'Legend', true), null)).toBe('legend_open');
    expect(daevanionNodeKey(node('stat', 'rare'), null)).toBe('rare');
    // The game's own name for the Spiritmaster.
    expect(daevanionNodeKey(node('start', 'None'), 'Spiritmaster')).toBe('start_elementalist');
    // And for the Brawler.
    expect(daevanionNodeKey(node('start', 'None'), 'Brawler')).toBe('start_fighter');
  });

  it('keeps the written mark when the site draws no node for it', () => {
    for (const [n, playerClass] of [
      [node('empty', 'None'), 'Chanter'],
      [node('stat', 'None', true), 'Chanter'],
      [node('stat', 'Epic', true), 'Chanter'],
      [node('stat', 'toString'), 'Chanter'],
      [node('start', 'None'), null],
      [node('start', 'None'), 'Painter'],
    ] as const)
      expect(daevanionNodeArt(n, playerClass)).toBeNull();
  });
});
