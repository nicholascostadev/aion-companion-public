import type { MapArtStatus } from '../types/mapArt';
import { MAPS } from './mockScenario';

/*
 * DEV ONLY. Native's per-map art downloads (`map_art_status`, `map_art_ensure`), faked in
 * memory: every map is cached unless `?mock=maps-download` or `?mock=maps-error` (see
 * `mockScenario.ts`). The files themselves are served by the development server from
 * `artwork/delivery/pet-map-art` (see `vite.config.ts`), standing in for the `map-art`
 * protocol.
 */

/** Rough sizes of each map's pack, for the progress bar only. */
const PACK_BYTES: Record<string, number> = {
  'World/World_L/World_L_A': 26_400_000,
  'World/World_D/World_D_A': 9_300_000,
  'Intersever/Abyss/Abyss_Reshanta_A': 8_900_000,
};
const DOWNLOAD_MS = 6000;

interface Run {
  started: number;
  fails: boolean;
}
const runs = new Map<string, Run>();
const settled = new Map<string, 'ready' | 'error'>();

function report(id: string): MapArtStatus {
  const total = PACK_BYTES[id];
  const base = { map_id: id, downloaded_bytes: 0, total_bytes: total ?? 0, error: null };
  if (!total) return { ...base, phase: 'error', error: `Unknown map ${id} (mock)` };
  if (!MAPS) return { ...base, phase: 'ready', downloaded_bytes: total };
  const run = runs.get(id);
  if (run) {
    const done = Math.min(1, (Date.now() - run.started) / DOWNLOAD_MS);
    if (run.fails && done >= 0.4) {
      runs.delete(id);
      settled.set(id, 'error');
    } else if (done >= 1) {
      runs.delete(id);
      settled.set(id, 'ready');
    } else return { ...base, phase: 'downloading', downloaded_bytes: Math.round(done * total) };
  }
  const end = settled.get(id);
  if (end === 'ready') return { ...base, phase: 'ready', downloaded_bytes: total };
  if (end === 'error')
    return {
      ...base,
      phase: 'error',
      error: 'The download stopped: the connection was reset (mock)',
    };
  return { ...base, phase: 'missing' };
}

export const mapArtCommands = {
  map_art_status: ({ mapId }: Record<string, unknown>) => report(String(mapId)),
  map_art_ensure: ({ mapId }: Record<string, unknown>) => {
    const id = String(mapId);
    const now = report(id);
    if (now.phase === 'missing' || now.phase === 'error') {
      // In `maps-error` only a map's first download fails.
      runs.set(id, { started: Date.now(), fails: MAPS === 'error' && !settled.has(id) });
      settled.delete(id);
      return report(id);
    }
    return now;
  },
};

/** Where the development server answers a cached file, in place of the native protocol. */
export const mockMapArtSrc = (file: string) => `/pet-map-art/${encodeURIComponent(file)}`;
