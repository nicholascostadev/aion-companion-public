import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../data/pet-type-art.json';
import { PET_FAMILIES } from '../types/pets';
import { indexPetTypeArt, petTypeArt } from './petTypeArt';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');

describe('pet type symbols', () => {
  it('gives every family its own bundled original symbol', () => {
    const sources = new Set<string>();
    for (const family of PET_FAMILIES) {
      const art = petTypeArt(family);
      expect(art).toEqual({
        src: `/pet-type-art/${manifest.families[family].file}`,
        width: 94,
        height: 106,
      });
      expect(art!.src).toMatch(/^\/pet-type-art\/[0-9a-f]{20}\.webp$/);
      expect(existsSync(join(PUBLIC, art!.src))).toBe(true);
      sources.add(art!.src);
    }
    expect(sources.size).toBe(PET_FAMILIES.length);
  });

  it('resolves exact family names only', () => {
    for (const family of ['all', 'cognia', 'Cognia ', 'Intellect', '', null, undefined])
      expect(petTypeArt(family)).toBeNull();
  });

  it('skips unknown, malformed and path-like entries', () => {
    const index = indexPetTypeArt(
      {
        Cognia: { file: 'aaaa.webp', width: 94, height: 106 },
        Fera: { file: '../escape.webp', width: 94, height: 106 },
        Natura: { file: 'https://example.invalid/x.webp', width: 94, height: 106 },
        Varia: { file: 'cccc.exe', width: 94, height: 106 },
        Specia: { file: 'dddd.webp', width: 0, height: 106 },
        all: { file: 'eeee.webp', width: 94, height: 106 },
        toString: { file: 'ffff.webp', width: 94, height: 106 },
      },
      '/',
    );
    expect([...index.keys()]).toEqual(['Cognia']);
    expect(index.get('Cognia')).toEqual({ src: '/pet-type-art/aaaa.webp', width: 94, height: 106 });
  });
});
