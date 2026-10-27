import { useEffect, useState } from 'react';

/** How long hidden content stays drawn before it is released. */
export const HIDDEN_RELEASE_MS = 30_000;

/**
 * True while `shown`, and until it has stayed hidden for `graceMs`. Content that is costly to
 * hold but quick to draw again (decoded map art) is released only then, so a quick tab switch
 * or a game alt-tab never redraws it, while a window left hidden lets the engine free it.
 */
export function useRecentlyShown(shown: boolean, graceMs = HIDDEN_RELEASE_MS) {
  const [held, setHeld] = useState(shown);
  if (shown && !held) setHeld(true);
  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => setHeld(false), graceMs);
    return () => clearTimeout(timer);
  }, [shown, graceMs]);
  return shown || held;
}
