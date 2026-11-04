import manifest from '../data/stat-art.json';

/*
 * Original AION 2 stat emblems bundled under `public/stat-art`, keyed by the official
 * service's stat type (`STR`, `Justice` …). A type resolves only through its own manifest
 * entry; anything else has no emblem and keeps its written name.
 */

const stats: Record<string, { file?: unknown }> = manifest.stats;

/** Hashed bundle file name, never a path. */
const FILE = /^[a-f0-9]{20}\.webp$/;

/** Bundled emblem of a stat type, or null when none is bundled; never a network request. */
export function statArt(type: string, base = import.meta.env.BASE_URL): string | null {
  const file = Object.hasOwn(stats, type) ? stats[type]?.file : undefined;
  return typeof file === 'string' && FILE.test(file) ? `${base}stat-art/${file}` : null;
}
