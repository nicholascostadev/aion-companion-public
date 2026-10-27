import { useCallback, useSyncExternalStore, type ReactNode } from 'react';

/*
 * One shared clock per period. Every `Ticking` with the same period reads the same tick, so
 * a page of countdowns runs on a single timer, and only the figures that print the time
 * re-render, never the page around them. The timer stops when nothing reads it.
 */
interface Clock {
  now: number;
  timer: ReturnType<typeof setInterval> | undefined;
  listeners: Set<() => void>;
}
const clocks = new Map<number, Clock>();

function clock(every: number): Clock {
  let value = clocks.get(every);
  if (!value)
    clocks.set(every, (value = { now: Date.now(), timer: undefined, listeners: new Set() }));
  return value;
}

function subscribe(every: number, listener: () => void) {
  const c = clock(every);
  c.listeners.add(listener);
  if (!c.timer) {
    // A clock that sat idle is stale: catch up before the first tick (React re-reads the
    // snapshot right after subscribing).
    c.now = Date.now();
    c.timer = setInterval(() => {
      c.now = Date.now();
      for (const l of c.listeners) l();
    }, every);
  }
  return () => {
    c.listeners.delete(listener);
    if (!c.listeners.size && c.timer) {
      clearInterval(c.timer);
      c.timer = undefined;
    }
  };
}

/** This PC's time, refreshed every `every` ms while the component is mounted. */
export function useTick(every = 1000) {
  const listen = useCallback((listener: () => void) => subscribe(every, listener), [every]);
  const read = useCallback(() => clock(every).now, [every]);
  return useSyncExternalStore(listen, read);
}

/**
 * Renders `children(now)` and re-renders only itself on every tick: live countdowns and
 * clocks inside an otherwise still page. `offset` shifts the time onto another clock (the
 * native clock of `useAlerts`, for example).
 */
export function Ticking({
  every = 1000,
  offset = 0,
  children,
}: {
  every?: number;
  offset?: number;
  children: (now: number) => ReactNode;
}) {
  const now = useTick(every);
  return <>{children(now + offset)}</>;
}
