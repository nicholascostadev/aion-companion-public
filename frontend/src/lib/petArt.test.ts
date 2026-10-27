import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import manifest from '../data/pet-art.json';
import { indexPetArt, petArt } from './petArt';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, '..', '..', 'public');
const CATALOGUE = join(HERE, '..', '..', '..', 'crates/companion-capture/data/pet-catalogue.json');
const bundled = (src: string) => existsSync(join(PUBLIC, src));

describe('pet portraits', () => {
  it('gives every catalogue pet its own bundled portrait', () => {
    const catalogue = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as { pets: { id: number }[] };
    const sources = new Set<string>();
    for (const { id } of catalogue.pets) {
      const art = petArt(id);
      expect(art, `pet ${id}`).not.toBeNull();
      expect(art!.src).toMatch(/^\/pet-art\/[0-9a-f]{20}\.webp$/);
      expect(bundled(art!.src)).toBe(true);
      sources.add(art!.src);
    }
    expect(sources.size).toBe(catalogue.pets.length);
  });

  it('resolves exact ids only', () => {
    const first = manifest.images[0]!;
    expect(petArt(first.pet_id)).toEqual({
      src: `/pet-art/${first.file}`,
      width: 256,
      height: 256,
    });
    for (const id of [0, -1, 1, 1.5, Number.NaN, null, undefined]) expect(petArt(id)).toBeNull();
  });

  it('skips malformed, path-like and repeated entries', () => {
    const index = indexPetArt(
      [
        { pet_id: 7, file: 'aaaa.png' },
        { pet_id: 7, file: 'bbbb.png' },
        { pet_id: 8, file: '../escape.png' },
        { pet_id: 9, file: 'https://example.invalid/x.png' },
        { pet_id: 10, file: 'cccc.exe' },
        { pet_id: 0, file: 'dddd.png' },
        { pet_id: 11, file: 'eeee.webp', width: 128, height: 96 },
      ],
      '/',
    );
    expect([...index.keys()]).toEqual([7, 11]);
    expect(index.get(7)).toEqual({ src: '/pet-art/aaaa.png', width: 256, height: 256 });
    expect(index.get(11)).toEqual({ src: '/pet-art/eeee.webp', width: 128, height: 96 });
  });
});
