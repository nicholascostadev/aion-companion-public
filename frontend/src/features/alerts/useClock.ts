import { useEffect, useState } from 'react';

/**
 * This PC's clock, refreshed every `ms` while `enabled` so countdowns move. It refreshes
 * right away when re-enabled, so a popup that just appeared never renders a stale time.
 */
export function useClock(ms = 1000, enabled = true) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, ms);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [ms, enabled]);
  return now;
}
