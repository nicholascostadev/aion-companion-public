import { useEffect, useState } from 'react';
import { FACING_TTL_MS } from '../../lib/cubesNormalize';
import type { CubeFacing, CubesStatus } from '../../types/cubes';
import type { AtlasMap } from '../maps/atlas';
import type { MapContext } from '../maps/context';
import type { MotionFix } from '../maps/motion';
import { useMapPosition } from '../maps/useMapPosition';
import type { MapPlayer } from '../maps/WorldMap';

/**
 * Your own fix on `map`: the fresh position, else the last one in the current context. Only
 * on the trusted current map (never after a failed read or in an unknown area). The capture
 * session is part of it, so movement is never bridged across a Clear or a new session.
 */
export function ownFix(
  status: CubesStatus | null,
  context: MapContext,
  map: AtlasMap,
): { fix: MotionFix; fresh: boolean } | null {
  if (!status || context.kind !== 'map' || context.map.id !== map.id) return null;
  const own = status.position ?? status.last_position;
  if (!own) return null;
  return {
    fix: {
      zone_id: status.zone_id,
      map_id: status.map_id,
      x: own.x,
      y: own.y,
      observed_ms: own.observed_ms,
      session: status.session_id,
    },
    fresh: status.position !== null,
  };
}

/**
 * Native's clock for this status: its own, else (from an older native) the fresh position's
 * time plus its reported age; null when neither is known, so nothing is predicted.
 */
export function nativeNow(status: CubesStatus | null): number | null {
  if (!status) return null;
  if (status.now_ms !== null) return status.now_ms;
  return status.position && status.position_age_ms !== null
    ? status.position.observed_ms + status.position_age_ms
    : null;
}

/**
 * The facing to draw, in coordinate degrees: native's while it is at most 10 s old by
 * native's clock, and gone once that much time has passed here too, even if no read
 * follows. A newer reading turns it without touching your position.
 */
export function useFreshFacing(facing: CubeFacing | null, now: number | null): number | null {
  const age = facing && now !== null ? now - facing.observed_ms : null;
  const valid = facing !== null && age !== null && age >= 0 && age <= FACING_TTL_MS;
  const key = facing ? `${facing.observed_ms}:${facing.degrees}` : '';
  const [expired, setExpired] = useState('');
  useEffect(() => {
    if (!valid || age === null) return;
    const timer = setTimeout(() => setExpired(key), FACING_TTL_MS - age + 1);
    return () => clearTimeout(timer);
  }, [key, valid, age]);
  return valid && expired !== key ? facing.degrees : null;
}

/**
 * You as drawn on `map`: a fresh position moves smoothly between native's fixes with a short,
 * bounded prediction (display only; every measurement uses the confirmed fix), a last known
 * one stays where it was observed, never predicted. A fresh facing turns the arrow on either.
 * Nothing moves while `enabled` is false (a hidden window or released art).
 */
export function usePlayerMark(
  status: CubesStatus | null,
  context: MapContext,
  map: AtlasMap,
  enabled: boolean,
): MapPlayer | null {
  const own = ownFix(status, context, map);
  const shown = useMapPosition(own?.fix ?? null, enabled && !!own?.fresh, nativeNow(status));
  const facing = useFreshFacing(own ? (status?.facing ?? null) : null, status?.now_ms ?? null);
  if (!own || !shown) return null;
  return own.fresh
    ? {
        x: shown.x,
        y: shown.y,
        estimated: shown.estimated,
        uncertainty_m: shown.uncertainty_m,
        facing,
      }
    : { x: own.fix.x, y: own.fix.y, last: true, facing };
}
