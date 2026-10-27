import type { ReactNode } from 'react';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';

/**
 * One surface holding a run of settings sections. The sections are chapters divided by
 * hairlines rather than a stack of separate boxes.
 */
export function SettingsGroup({
  children,
  label,
  className,
  id,
  tabIndex,
}: {
  children: ReactNode;
  label?: string;
  className?: string;
  /** Lets another part of the workspace scroll to and focus this surface. */
  id?: string;
  tabIndex?: number;
}) {
  return (
    <Panel
      padding="none"
      id={id}
      tabIndex={tabIndex}
      aria-label={label}
      className={cn('px-6 max-[760px]:px-4', className)}
      {...(label ? { as: 'section' as const } : {})}
    >
      {children}
    </Panel>
  );
}

/**
 * A settings chapter: its title and purpose on the left, its controls on the right; on
 * narrow windows the title sits above.
 */
export function SettingsSection({
  title,
  label,
  description,
  children,
  className,
}: {
  title: ReactNode;
  /** Accessible name of the section when the title is not plain text. */
  label?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={label ?? (typeof title === 'string' ? title : undefined)}
      className={cn(
        'grid gap-x-10 gap-y-4 border-t border-line-soft py-6 first:border-t-0',
        'min-[900px]:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]',
        className,
      )}
    >
      <header className="min-w-0">
        <h2 className="m-0 flex items-center gap-2 text-lg">{title}</h2>
        {description && <p className="mt-1 mb-0 text-sm leading-snug text-ink-3">{description}</p>}
      </header>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

/** Responsive grid of fields inside a section. */
export function SettingsGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'grid grid-cols-[repeat(auto-fill,minmax(min(100%,15rem),1fr))] items-start gap-x-6 gap-y-5',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A labelled group that is not a single input (a row of buttons, a file picker). */
export function FieldGroup({
  label,
  hint,
  wide = false,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', wide && 'col-span-full')}>
      <span className="text-xs font-semibold text-ink-2">{label}</span>
      {children}
      {hint && <small className="text-2xs leading-snug text-ink-3">{hint}</small>}
    </div>
  );
}

/** A native range slider with its value printed beside it. */
export function RangeField({
  id,
  min,
  max,
  step,
  value,
  display,
  disabled,
  onChange,
}: {
  id: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: ReactNode;
  disabled?: boolean | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <span className={cn('flex items-center gap-3', disabled && 'opacity-50')}>
      <input
        id={id}
        type="range"
        data-ui="range"
        className="h-8 min-w-24 flex-1 cursor-pointer accent-accent"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <output htmlFor={id} className="min-w-11 text-right text-sm text-ink tabular-nums">
        {display}
      </output>
    </span>
  );
}
