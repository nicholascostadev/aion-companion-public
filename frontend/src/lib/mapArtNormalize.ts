import { MAP_ART_PHASES, type MapArtPhase, type MapArtStatus } from '../types/mapArt';

/*
 * Native map art reports are untrusted shapes. A report for another map, an unknown phase or
 * a malformed body never reads as `ready`: art is drawn only on a well-formed ready report.
 */

type Bag = Record<string, unknown>;
const bag = (value: unknown): Bag =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Bag) : {};
const bytes = (value: unknown): number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
const isPhase = (value: unknown): value is MapArtPhase =>
  typeof value === 'string' && (MAP_ART_PHASES as readonly string[]).includes(value);

/** The report for `mapId`; anything else is an `error` with no message of its own. */
export function normalizeMapArtStatus(value: unknown, mapId: string): MapArtStatus {
  const v = bag(value);
  if (v.map_id !== mapId || !isPhase(v.phase))
    return { map_id: mapId, phase: 'error', downloaded_bytes: 0, total_bytes: 0, error: null };
  const total = bytes(v.total_bytes);
  const error = typeof v.error === 'string' && v.error.trim() ? v.error.trim() : null;
  return {
    map_id: mapId,
    phase: v.phase,
    // Never past the whole, so progress stays within the bar.
    downloaded_bytes: total
      ? Math.min(total, bytes(v.downloaded_bytes))
      : bytes(v.downloaded_bytes),
    total_bytes: total,
    error: v.phase === 'error' ? error : null,
  };
}
