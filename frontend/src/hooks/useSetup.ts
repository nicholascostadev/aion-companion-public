import { useCallback, useEffect, useRef, useState } from 'react';
import { openSetupLink, readSetupStatus } from '../services/setup';
import type { SetupLink, SetupState, SetupStatus } from '../types/setup';

/**
 * This PC's setup: read once when the workspace is first `active`, again when it shows after
 * being hidden while something still needs attention, and whenever Check again is pressed.
 * A probe can take seconds, so a request while one runs joins it rather than starting
 * another. Nothing is applied after unmount.
 */
export function useSetup(native: boolean, { active = true } = {}): SetupState {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const alive = useRef(false);
  const running = useRef<Promise<void> | null>(null);
  const healthy = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const recheck = useCallback(() => {
    if (!native) return Promise.resolve();
    if (running.current) return running.current;
    setChecking(true);
    const probe = (async () => {
      try {
        const next = await readSetupStatus();
        healthy.current = next.npcap.state === 'ready';
        if (!alive.current) return;
        setStatus(next);
        setError('');
      } catch (cause) {
        healthy.current = false;
        if (alive.current) setError(String(cause));
      } finally {
        running.current = null;
        if (alive.current) setChecking(false);
      }
    })();
    running.current = probe;
    return probe;
  }, [native]);

  const reading = native && active;
  const read = useRef(false);
  useEffect(() => {
    if (!reading) return;
    // Once the driver is known to work, showing the window again need not probe it.
    if (read.current && healthy.current) return;
    read.current = true;
    void recheck();
  }, [reading, recheck]);

  const open = useCallback(async (link: SetupLink) => {
    try {
      await openSetupLink(link);
      return '';
    } catch (cause) {
      return String(cause) || 'Error';
    }
  }, []);

  return { status, error, checking, recheck, open };
}
