import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

/**
 * The current time, ticking every `ms`. Returns null during the server render and the first
 * client paint so prerendered HTML never disagrees with the visitor's clock.
 */
export function useNow(ms = 1000) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const first = window.setTimeout(() => setNow(new Date()), 0);
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(id);
    };
  }, [ms]);
  return now;
}

/** Seconds until the next time the clock's minute hand reads `minute` (on the hour = 0). */
export function secondsUntilMinute(now: Date, minute: number) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  if (next.getTime() <= now.getTime()) next.setHours(next.getHours() + 1);
  return Math.round((next.getTime() - now.getTime()) / 1000);
}

export function countdown(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Count up from 0 to `to` once `active` turns true. */
export function useCountUp(to: number, active: boolean, duration = 1400) {
  const [value, setValue] = useState(to);
  useEffect(() => {
    if (!active) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setValue(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, active, duration]);
  return value;
}

/** True once the element has scrolled into view. */
export function useSeen<T extends Element>(ref: RefObject<T | null>, margin = '0px 0px -15% 0px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: margin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, seen, margin]);
  return seen;
}
