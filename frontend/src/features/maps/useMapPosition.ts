import { useEffect, useLayoutEffect, useState } from 'react';
import {
  canAnimatePosition,
  confirmedPosition,
  MapMotion,
  usableFix,
  type MapPosition,
  type MotionFix,
} from './motion';

/** True while the system asks for reduced motion, following changes. */
export function useReducedMotion() {
  const [reduced, setReduced] = useState(
    () =>
      typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches,
  );
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return;
    const query = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/**
 * Bounded prediction and correction are visual only; native positions remain measured.
 * `now` is native's clock when `position` was read (null when unknown: eased, not predicted).
 * Disabled or with reduced motion, the measured fix is drawn as it is.
 */
export function useMapPosition<T extends MotionFix>(
  input: T | null,
  enabled: boolean,
  now: number | null,
): MapPosition<T> | null {
  const position = usableFix(input);
  const reduced = useReducedMotion();
  const [motion] = useState(() => new MapMotion<T>());
  const [display, setDisplay] = useState(() => confirmedPosition(position));
  const x = position?.x;
  const y = position?.y;
  const observed = position?.observed_ms;
  const map = position?.map_id;
  const zone = position?.zone_id;
  const session = position?.session;
  useLayoutEffect(() => {
    let frame = 0;
    const time = performance.now();
    if (!enabled || reduced) motion.reset(position, time);
    else motion.accept(position, now, time);
    const step = (at: number) => {
      const next = motion.sample(at);
      setDisplay(next.position);
      if (enabled && !reduced && next.active) frame = requestAnimationFrame(step);
    };
    step(time);
    return () => cancelAnimationFrame(frame);
    // Repeated polls of the same fix must not extend the prediction horizon.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y, observed, map, zone, session, enabled, reduced, motion]);
  return enabled && !reduced && canAnimatePosition(display, position)
    ? display
    : confirmedPosition(position);
}
