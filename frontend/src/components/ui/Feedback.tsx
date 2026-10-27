import { Button as ButtonPrimitive } from '@base-ui/react/button';
import type { ReactNode } from 'react';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { Icon, type IconName } from './Icon';

const noticeTones = {
  info: { box: 'border-info-line bg-info-soft text-info-strong', icon: 'info' },
  warn: { box: 'border-warn-line bg-warn-soft text-warn-strong', icon: 'warning' },
  error: { box: 'border-danger-line bg-danger-soft text-danger-strong', icon: 'warning' },
  good: { box: 'border-success-line bg-success-soft text-success-strong', icon: 'check' },
} as const satisfies Record<string, { box: string; icon: IconName }>;

/** Inline message bar. Errors are announced as alerts, everything else as status. */
export function Notice({
  tone = 'info',
  children,
  onDismiss,
  className,
}: {
  tone?: keyof typeof noticeTones;
  children: ReactNode;
  onDismiss?: () => void;
  className?: string;
}) {
  const { box, icon } = noticeTones[tone];
  const { t } = useTranslation('common');
  const dismissLabel = t(($) => $.actions.dismiss);
  return (
    <div
      data-ui="notice"
      data-tone={tone}
      className={cn(
        'my-2.5 flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm leading-snug',
        box,
        className,
      )}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={icon} size={15} className="mt-px shrink-0 opacity-90" />
      <span className="min-w-0 flex-1">{children}</span>
      {onDismiss && (
        <ButtonPrimitive
          type="button"
          data-ui="dismiss"
          aria-label={dismissLabel}
          onClick={onDismiss}
          className="-my-0.5 -mr-1 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full text-current opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Icon name="close" size={13} />
        </ButtonPrimitive>
      )}
    </div>
  );
}

/**
 * Honest empty or unavailable state: what is missing, and what would fill it. Not a box:
 * a soft pool of light with an optional emblem; `live` lets the emblem breathe while the
 * state is waiting on something that will arrive by itself (a fight, a connection).
 */
export function EmptyState({
  title,
  children,
  icon,
  live = false,
  compact = false,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  live?: boolean;
  /** Less vertical room, for states inside a table or a small panel. */
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      data-ui="empty"
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg px-4 text-center text-ink-2',
        compact ? 'py-5' : 'py-9',
        className,
      )}
    >
      {icon && (
        <span
          className={cn(
            'mb-2 grid size-11 place-items-center rounded-full border border-accent-line bg-accent-soft text-accent',
            live && 'animate-breathe',
          )}
        >
          {icon}
        </span>
      )}
      <b className={cn('font-semibold tracking-tight text-ink', compact ? 'text-md' : 'text-lg')}>
        {title}
      </b>
      {children && <span className="max-w-[520px] text-sm text-ink-3">{children}</span>}
    </div>
  );
}
