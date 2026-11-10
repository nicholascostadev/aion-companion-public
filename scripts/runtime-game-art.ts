import type { Plugin } from 'vite';

interface Entry {
  file?: string;
  name?: string | null;
  class?: string | null;
  base?: number;
  original_key?: string;
}

export interface ArtManifest {
  classes: Record<string, Entry>;
  skills: Record<string, Entry>;
}

/** Keep lookup data in the executable; provenance stays in the verified source manifest. */
export function runtimeManifest(manifest: ArtManifest): ArtManifest {
  const entries = (table: Record<string, Entry>, keys: readonly (keyof Entry)[]) =>
    Object.fromEntries(
      Object.entries(table).map(([id, entry]) => [
        id,
        Object.fromEntries(keys.filter((key) => key in entry).map((key) => [key, entry[key]])),
      ]),
    );
  return {
    classes: entries(manifest.classes, ['file', 'original_key']),
    skills: entries(manifest.skills, ['file', 'name', 'class', 'base']),
  };
}

/** Source and test imports retain every checksum and source URL for artwork verification. */
export function runtimeGameArt(): Plugin {
  return {
    name: 'aion-runtime-game-art',
    apply: 'build',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/frontend/src/data/game-art.json')) return null;
      return { code: JSON.stringify(runtimeManifest(JSON.parse(code))), map: null };
    },
  };
}
