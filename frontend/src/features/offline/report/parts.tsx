import type { ReactNode } from 'react';
import { Meter } from '../../../components/ui/Data';
import { Select, type SelectProps } from '../../../components/ui/Field';
import { cn } from '../../../lib/cn';

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
