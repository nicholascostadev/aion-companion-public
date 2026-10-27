import { useId, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';
import type { AlertCategory } from '../../types/alerts';
import { useTranslation } from '../../i18n/provider';
import { CATEGORY, categoryLabel } from './model';

/** One hue per category, from the shared data palette; always beside the category's word. */
export const CATEGORY_TONE: Record<AlertCategory, string> = {
  event: 'bg-alert-event/12 text-alert-event',
  world_boss: 'bg-alert-world/12 text-alert-world',
  field_boss: 'bg-alert-field/12 text-alert-field',
  custom: 'bg-alert-custom/12 text-alert-custom',
};
/** The category hue for an icon on its own (section headings). */
export const CATEGORY_INK: Record<AlertCategory, string> = {
  event: 'text-alert-event',
  world_boss: 'text-alert-world',
  field_boss: 'text-alert-field',
  custom: 'text-alert-custom',
};

/**
 * The category as a small round seed with its glyph, named by its title. The opaque
 * underlay lets it sit on a thread line.
 */
export function CategoryIcon({
  category,
  size = 'md',
  className,
}: {
  category: AlertCategory;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useTranslation('alerts');
  return (
    <span
      className={cn('shrink-0 rounded-full bg-surface', className)}
      title={categoryLabel(t, category)}
    >
      <span
        className={cn(
          'grid place-items-center rounded-full',
          size === 'sm' ? 'size-6' : 'size-7',
          CATEGORY_TONE[category],
        )}
      >
        <Icon name={CATEGORY[category].icon} size={size === 'sm' ? 13 : 15} />
      </span>
    </span>
  );
}

/** A countdown figure: tabular, right-aligned, lit when soon or open. */
export function Countdown({
  children,
  tone,
  size = 'md',
  className,
  ...props
}: {
  children: ReactNode;
  tone?: 'soon' | 'open' | 'muted' | undefined;
  size?: 'sm' | 'md';
  className?: string;
  'aria-label'?: string;
  title?: string | undefined;
}) {
  return (
    <span
      className={cn(
        'shrink-0 text-right font-semibold whitespace-nowrap text-ink tabular-nums',
        size === 'md' ? 'text-md' : 'text-sm',
        tone === 'soon' && 'text-warn',
        tone === 'open' && 'text-accent',
        tone === 'muted' && 'font-medium text-ink-3',
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

export type StateKind = 'open' | 'up' | 'good' | 'estimate' | 'unknown' | 'down' | 'neutral';

/** A short state word next to a countdown; dashed when the state is not known. */
export function StateTag({
  kind,
  children,
  title,
}: {
  kind: StateKind;
  children: ReactNode;
  title?: string | undefined;
}) {
  const props = { shape: 'tag' as const, title };
  switch (kind) {
    case 'open':
      return (
        <Badge {...props} tone="accent" dot="live">
          {children}
        </Badge>
      );
    case 'up':
      return (
        <Badge {...props} tone="success" dot="live">
          {children}
        </Badge>
      );
    case 'good':
      return (
        <Badge {...props} tone="accent" variant="outline">
          {children}
        </Badge>
      );
    case 'estimate':
      return (
        <Badge {...props} tone="warn" variant="outline">
          {children}
        </Badge>
      );
    case 'down':
      return (
        <Badge {...props} tone="danger" variant="outline">
          {children}
        </Badge>
      );
    case 'unknown':
      return (
        <Badge {...props} variant="outline" className="border-dashed font-medium text-ink-3">
          {children}
        </Badge>
      );
    case 'neutral':
      return <Badge {...props}>{children}</Badge>;
  }
}

/**
 * A raised block of the alerts tab, named by its own title. `tone="warn"` warms it for
 * something that needs attention now.
 */
export function AlertCard({
  title,
  icon,
  subtitle,
  actions,
  children,
  id,
  tone,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  tone?: 'warn';
  className?: string;
}) {
  const titleId = useId();
  return (
    <Panel
      as="section"
      padding="none"
      id={id}
      aria-labelledby={titleId}
      className={cn(
        'min-w-0 p-5 max-[760px]:p-4',
        tone === 'warn' && 'border-warn-line',
        className,
      )}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3
            id={titleId}
            className="m-0 flex items-center gap-2 text-lg font-semibold tracking-tight"
          >
            {icon}
            {title}
          </h3>
          {subtitle && <p className="mt-0.5 mb-0 text-sm leading-snug text-ink-3">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
    </Panel>
  );
}

/** A quiet list row divided from the previous one by a hairline. */
export const listRow = 'flex min-w-0 items-center gap-3 border-t border-line-soft first:border-t-0';

/** Two stacked lines (name and detail) that truncate rather than wrap. */
export function RowText({
  name,
  detail,
  nameTitle,
  detailTitle,
  className,
}: {
  name: ReactNode;
  detail?: ReactNode;
  nameTitle?: string | undefined;
  detailTitle?: string | undefined;
  className?: string;
}) {
  return (
    <span className={cn('flex min-w-0 flex-1 flex-col gap-px', className)}>
      <b className="truncate text-sm font-semibold text-ink" title={nameTitle}>
        {name}
      </b>
      {detail !== undefined && (
        <small className="truncate text-xs text-ink-3" title={detailTitle}>
          {detail}
        </small>
      )}
    </span>
  );
}

/** A chapter of a side panel: a small titled section, divided from the one above by a rule. */
export function Chapter({
  title,
  icon,
  id,
  actions,
  children,
}: {
  title: string;
  icon: IconName;
  id?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const titleId = useId();
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      className="flex min-w-0 flex-col gap-3 border-t border-line-soft py-5 first:border-t-0 first:pt-0 last:pb-0"
    >
      <header className="flex items-center justify-between gap-3">
        <h3
          id={titleId}
          className="m-0 flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <Icon name={icon} size={15} className="text-ink-3" />
          {title}
        </h3>
        {actions}
      </header>
      {children}
    </section>
  );
}
