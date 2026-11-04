import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../data/stat-art.json';
import { statArt } from './statArt';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

describe('stat emblems', () => {
  it('gives every official stat type its own bundled original emblem', () => {
    const sources = new Set<string>();
    for (const type of Object.keys(manifest.stats)) {
      const src = statArt(type, '/');
      expect(src).toMatch(/^\/stat-art\/[0-9a-f]{20}\.webp$/);
      expect(existsSync(join(PUBLIC, src!))).toBe(true);
      sources.add(src!);
    }
    expect(sources.size).toBe(16);
  });

  it('resolves exact stat types only', () => {
    for (const type of ['str', 'justice', 'ItemLevel', 'Might', 'toString', ''])
      expect(statArt(type)).toBeNull();
  });
});
