import { useCallback, useEffect, useRef, useState } from 'react';
import { Notice } from '../../components/ui/Feedback';
import { useTranslation } from '../../i18n/provider';
import type { SetupLink, SetupState } from '../../types/setup';

/**
 * Opens official pages for one surface: which link is opening, and why the last one could
 * not open. Each surface keeps its own failure, so it is shown beside the button pressed.
 */
export function useLinkOpener(open: SetupState['open'] | undefined) {
  const [opening, setOpening] = useState<SetupLink | null>(null);
  const [error, setError] = useState('');
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const go = useCallback(
    async (link: SetupLink) => {
      if (!open) return;
      setOpening(link);
      setError('');
      const failure = await open(link);
      if (!alive.current) return;
      setOpening(null);
      setError(failure);
    },
    [open],
  );
  return { open: go, opening, error, available: !!open };
}

/** A page that could not be opened, with why. */
export function LinkFailure({ error, className }: { error: string; className?: string }) {
  const { t } = useTranslation('setup');
  if (!error) return null;
  return (
    <Notice tone="error" className={className ?? 'mt-3 mb-0'}>
      {t(($) => $.linkFailed, { error })}
    </Notice>
  );
}
