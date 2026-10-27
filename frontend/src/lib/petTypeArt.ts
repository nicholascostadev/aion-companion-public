import manifest from '../data/pet-type-art.json';
import { PET_FAMILIES, type PetFamily } from '../types/pets';

/*
 * Original AION 2 pet type symbols bundled under `public/pet-type-art`. A family
 * resolves only through its own manifest entry; anything else has no symbol and keeps
 * its written name.
 */

interface TypeEntry {
  file?: unknown;
  width?: unknown;
  height?: unknown;
}

export interface PetTypeArt {
  /** Bundled asset URL; never a network request. */
  src: string;
  width: number;
  height: number;
}

/** Hashed bundle file name, never a path. */
const FILE = /^[A-Za-z0-9_-]+\.(?:png|webp)$/;

const size = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;

const isFamily = (value: unknown): value is PetFamily => PET_FAMILIES.includes(value as PetFamily);

/** Indexes a pet type manifest by family; unknown or malformed entries are skipped. */
export function indexPetTypeArt(
  families: Readonly<Record<string, TypeEntry>>,
  base = import.meta.env.BASE_URL,
) {
  const byFamily = new Map<PetFamily, PetTypeArt>();
  for (const family of PET_FAMILIES) {
    if (!Object.hasOwn(families, family)) continue;
    const { file, width, height } = families[family]!;
    const w = size(width);
    const h = size(height);
    if (typeof file !== 'string' || !FILE.test(file) || !w || !h) continue;
    byFamily.set(family, { src: `${base}pet-type-art/${file}`, width: w, height: h });
  }
  return byFamily;
}

const symbols = indexPetTypeArt(manifest.families);

/** Original symbol of a pet family, or null when none is bundled. */
export function petTypeArt(family: string | null | undefined): PetTypeArt | null {
  return isFamily(family) ? (symbols.get(family) ?? null) : null;
}
