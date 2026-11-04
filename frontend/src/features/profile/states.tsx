import { useEffect, useState, type ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import type { ProfileError } from '../../types/profile';

/**
 * Seconds left before a rate-limited request may be retried, counted from when the error
 * reached this window; 0 when the service gave no wait.
 */
export function useRetryWait(error: ProfileError | null) {
  const [now, setNow] = useState(() => Date.now());
  const wait = error?.kind === 'rate_limited' ? error.retryAfterS : null;
  const since = error ? Math.max(0, now - error.receivedMs) : 0;
  const left = wait === null ? 0 : Math.max(0, Math.ceil(wait - since / 1000));
  useEffect(() => {
    if (left <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), 1000);
    return () => clearTimeout(timer);
  }, [left, now]);
  return left;
}

const ICONS: Record<ProfileError['kind'], IconName> = {
  invalid: 'warning',
  not_found: 'search',
  private: 'lock',
  rate_limited: 'hourglass',
  unavailable: 'warning',
  network: 'network',
};

/** What went wrong, in the profile's words: the service's own message is only a detail. */
export function useErrorText() {
  const { t } = useTranslation('profile');
  return (error: ProfileError) => ({
    title: t(($) => $.errors[error.kind].title),
    hint: t(($) => $.errors[error.kind].hint),
  });
}

/** The whole profile could not be read: why, and how to try again. */
export function SheetError({
  error,
  onRetry,
  extra,
}: {
  error: ProfileError;
  onRetry: () => void;
  extra?: ReactNode;
}) {
  const { t } = useTranslation('profile');
  const words = useErrorText()(error);
  const wait = useRetryWait(error);
  return (
    <EmptyState
      icon={<Icon name={ICONS[error.kind]} size={18} />}
      title={words.title}
      className="my-8 px-4"
    >
      <p className="m-0">{words.hint}</p>
      {error.message && <p className="m-0 mt-1 text-2xs text-ink-4">{error.message}</p>}
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {error.kind !== 'invalid' && (
          <Button
            size="sm"
            variant="primary"
            icon={<Icon name="refresh" size={14} />}
            disabled={wait > 0}
            onClick={onRetry}
          >
            {wait > 0 ? t(($) => $.actions.retryIn, { seconds: wait }) : t(($) => $.actions.retry)}
          </Button>
        )}
        {extra}
      </div>
    </EmptyState>
  );
}

/** One part (an item, a board, half the sheet) failed; the rest stays usable. */
export function ErrorLine({
  error,
  onRetry,
  what,
}: {
  error: ProfileError;
  onRetry?: () => void;
  what: string;
}) {
  const { t } = useTranslation('profile');
  const words = useErrorText()(error);
  const wait = useRetryWait(error);
  return (
    <Notice tone={error.kind === 'private' || error.kind === 'not_found' ? 'warn' : 'error'}>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span>
          {t(($) => $.errors.part, { what })} {words.title}. {words.hint}
        </span>
        {onRetry && error.kind !== 'invalid' && (
          <Button size="xs" disabled={wait > 0} onClick={onRetry}>
            {wait > 0 ? t(($) => $.actions.retryIn, { seconds: wait }) : t(($) => $.actions.retry)}
          </Button>
        )}
      </span>
    </Notice>
  );
}
