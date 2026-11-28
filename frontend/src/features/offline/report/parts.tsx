import type { ReactNode } from 'react';
import { Meter } from '../../../components/ui/Data';
import { Select, type SelectProps } from '../../../components/ui/Field';
import { SkillIcon } from '../../../components/ui/GameArt';
import { cn } from '../../../lib/cn';
import type { EntityId } from '../../../types/offline';

/** A view's row of pickers and filters, above its content. */
export function ViewTools({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-2.5', className)}>{children}</div>
  );
}

/** Vertical rhythm of a report view: blocks breathe apart, nothing boxes them. */
export function ViewStack({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-w-0 flex-col gap-5', className)}>{children}</div>;
}

/** Small caps heading of a block inside a view. */
export function SubHeading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <h4
      className={cn('mb-2.5 text-2xs font-semibold tracking-caps text-ink-3 uppercase', className)}
    >
      {children}
    </h4>
  );
}

/** A quiet explanatory line. */
export function Note({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('m-0 text-xs leading-snug text-ink-3', className)}>{children}</p>;
}

/** A labelled, compact native select that sits inline in a tool row. */
export function InlineSelect({
  label,
  children,
  wrapperClassName,
  ...props
}: SelectProps & { label: ReactNode }) {
  return (
    <label className="inline-flex min-w-0 items-center gap-2 text-xs font-medium text-ink-3">
      {label}
      <Select size="sm" wrapperClassName={cn('max-w-64', wrapperClassName)} {...props}>
        {children}
      </Select>
    </label>
  );
}

/** A value with its share bar, for a table cell. */
export function ShareCell({
  fraction,
  color,
  label,
  children,
}: {
  fraction: number | null;
  color?: string | undefined;
  label: string;
  children: ReactNode;
}) {
  return (
    <span className="inline-flex min-w-30 items-center justify-end gap-2">
      <Meter fraction={fraction} color={color} label={label} className="max-w-18" />
      <span className="min-w-12 text-right">{children}</span>
    </span>
  );
}

/** The first letters of a skill's written name, for a slot that has no artwork. */
const initials = (name: string) =>
  name
    .replace(/#\d+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '·';

const artSizes = { sm: { px: 28, box: 'size-7' }, md: { px: 36, box: 'size-9' } } as const;

/**
 * A skill's original icon in a square slot. Without verified artwork the slot holds the
 * initials of the written name in a dashed frame: a label, never a substitute picture. The
 * name itself is always written beside it.
 */
export function SkillArt({
  id,
  name,
  size = 'md',
  className,
}: {
  id: EntityId | null | undefined;
  name: string;
  size?: keyof typeof artSizes;
  className?: string;
}) {
  const { px, box } = artSizes[size];
  return (
    <SkillIcon
      id={id}
      size={px}
      className={cn(box, 'rounded-sm', className)}
      fallback={
        <span
          aria-hidden="true"
          data-art="label"
          className={cn(
            box,
            'inline-grid shrink-0 place-items-center rounded-sm border border-dashed border-line-strong',
            'text-2xs font-semibold text-ink-3',
            className,
          )}
        >
          {initials(name)}
        </span>
      }
    />
  );
}

/**
 * One labelled figure in a wrapping row of figures: a muted label, then its value. Inside a
 * `<dl>`; `wide` takes two tracks of a figure grid for a value that needs the room.
 */
export function Figure({
  label,
  title,
  wide = false,
  className,
  children,
}: {
  label: ReactNode;
  title?: string | undefined;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      data-ui="figure"
      title={title}
      className={cn('flex min-w-0 items-baseline gap-1.5', wide && 'col-span-2', className)}
    >
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0 text-ink figures">{children}</dd>
    </div>
  );
}
