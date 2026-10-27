import { useId, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type PanelVariant = 'raised' | 'flat' | 'inset' | 'glass';

const variants: Record<PanelVariant, string> = {
  /** A card on the ground: the default container for a block of content. */
  raised: 'rounded-xl border border-line bg-surface shadow-2',
  /** A quieter block nested inside a raised panel. */
  flat: 'rounded-lg border border-line-soft bg-surface-2',
  /** A shallow well for maps, charts and lists that scroll. */
  inset: 'rounded-lg border border-line-soft bg-sunken',
  /** In-game glass: see-through over the game, with legible shadowed text. */
  glass: 'rounded-lg border border-line bg-surface text-ink text-halo inset-shadow-light',
};
const paddings = { none: '', sm: 'p-3', md: 'p-4', lg: 'p-5' } as const;

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  variant?: PanelVariant;
  padding?: keyof typeof paddings;
  as?: 'div' | 'section' | 'article' | 'aside' | 'li';
}

/** A surface. */
export function Panel({
  variant = 'raised',
  padding = 'md',
  as: Tag = 'div',
  className,
  ...props
}: PanelProps) {
  return (
    <Tag
      data-ui="panel"
      className={cn(variants[variant], paddings[padding], className)}
      {...props}
    />
  );
}

/** Title row of a card or section: heading and subtitle on the left, actions on the right. */
export function PanelHeader({
  title,
  titleId,
  subtitle,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode;
  titleId?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={cn('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <Heading
          id={titleId}
          className={cn(level === 3 && 'm-0 text-lg font-semibold tracking-tight')}
        >
          {title}
        </Heading>
        {subtitle && <p className="mt-0.5 mb-0 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Raised panel with a titled header; the standard workspace card. Its title is an `h2`, or
 * an `h3` (`level={3}`, same look) when the card sits under a page `Section`.
 */
export function Card({
  title,
  children,
  id,
  subtitle,
  actions,
  level = 2,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  id?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  level?: 2 | 3;
  className?: string;
}) {
  // The section is a region named by its own title.
  const titleId = useId();
  return (
    <Panel
      as="section"
      padding="lg"
      id={id}
      aria-labelledby={titleId}
      className={cn('mb-4', className)}
    >
      <PanelHeader
        title={title}
        titleId={titleId}
        subtitle={subtitle}
        actions={actions}
        level={level}
      />
      {children}
    </Panel>
  );
}

/** A page-level group of cards under one heading, with no surface of its own. */
export function Section({
  title,
  id,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  id?: string;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  return (
    <section id={id} aria-labelledby={titleId} className={cn('mt-8 first:mt-2', className)}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h2 id={titleId} className="text-xl">
            {title}
          </h2>
          {description && <p className="mt-0.5 mb-0 text-sm text-ink-3">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
