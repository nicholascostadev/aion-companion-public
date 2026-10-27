import manifest from '../data/pet-art.json';

/*
 * Original AION 2 pet portraits bundled under `public/pet-art`. A pet resolves only
 * through its own manifest entry; anything else has no portrait and keeps its name.
 */

interface PortraitEntry {
  pet_id: number;
  file: string;
  width?: number;
  height?: number;
}

export interface PetPortraitArt {
  /** Bundled asset URL; never a network request. */
  src: string;
  width: number;
  height: number;
}

/** Hashed bundle file name, never a path. */
const FILE = /^[A-Za-z0-9_-]+\.(?:png|jpg|jpeg|webp)$/;

const size = (value: number | undefined) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 256;

/** Indexes a portrait manifest by pet id; malformed or repeated entries are skipped. */
export function indexPetArt(images: readonly PortraitEntry[], base = import.meta.env.BASE_URL) {
  const byPet = new Map<number, PetPortraitArt>();
  for (const entry of images) {
    if (!Number.isSafeInteger(entry.pet_id) || entry.pet_id <= 0 || byPet.has(entry.pet_id))
      continue;
    if (typeof entry.file !== 'string' || !FILE.test(entry.file)) continue;
    byPet.set(entry.pet_id, {
      src: `${base}pet-art/${entry.file}`,
      width: size(entry.width),
      height: size(entry.height),
    });
  }
  return byPet;
}

const portraits = indexPetArt(manifest.images);

/** Original portrait of a catalogue pet, or null when none is bundled. */
export function petArt(id: number | null | undefined): PetPortraitArt | null {
  return typeof id === 'number' ? (portraits.get(id) ?? null) : null;
}
