import { createContext, useContext, type ReactNode } from 'react';
import { Panel } from '../../components/ui/Panel';
import { cn } from '../../lib/cn';

/** Whether the settings below sit straight on a Settings page rather than in a surface. */
const OnPage = createContext(false);

/**
 * One Settings category as a page: its name as the page heading, then its sections laid
 * straight on the ground, each opened by a hairline, with no surface around them. Every
 * `SettingsGroup` and `SettingsSection` inside follows the page layout.
 */
export function SettingsPage({
  title,
  children,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <OnPage.Provider value>
      <div className={cn('flex max-w-4xl min-w-0 flex-col', className)}>
        <h2 className="m-0 pb-5 text-xl">{title}</h2>
        {children}
      </div>
    </OnPage.Provider>
  );
}

/**
 * A run of settings sections. On its own (Trackers) it is one raised surface whose
 * sections are chapters divided by hairlines rather than a stack of separate boxes; inside a
 * `SettingsPage` it draws nothing and only holds the run's id and name.
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
  /** Lets another part of the workspace scroll to and focus this run. */
  id?: string;
  tabIndex?: number;
}) {
  const onPage = useContext(OnPage);
  if (onPage) {
    const Element = label ? 'section' : 'div';
    return (
      <Element
        id={id}
        tabIndex={tabIndex}
        aria-label={label}
        className={cn('flex min-w-0 flex-col', className)}
      >
        {children}
      </Element>
    );
  }
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
 * A settings chapter. In a surface its title and purpose sit on the left and its controls on
 * the right (the title above on narrow windows); on a Settings page the title, purpose and
 * controls stack under a hairline, at a readable width. `id` lets Settings search and deep
 * links scroll to and focus it.
 */
export function SettingsSection({
  id,
  title,
  label,
  description,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  /** Accessible name of the section when the title is not plain text. */
  label?: string;
  description?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const onPage = useContext(OnPage);
  const name = label ?? (typeof title === 'string' ? title : undefined);
  if (onPage)
    return (
      <section
        id={id}
        tabIndex={id ? -1 : undefined}
        aria-label={name}
        className={cn('scroll-mt-28 border-t border-line-soft pt-6 pb-9', className)}
      >
        <header className="mb-5 min-w-0">
          <h3 className="m-0 flex items-center gap-2 text-md font-semibold tracking-tight">
            {title}
          </h3>
          {description && (
            <p className="mt-1 mb-0 max-w-2xl text-sm leading-snug text-ink-3">{description}</p>
          )}
        </header>
        <div className="min-w-0">{children}</div>
      </section>
    );
  return (
    <section
      id={id}
      tabIndex={id ? -1 : undefined}
      aria-label={name}
      className={cn(
        'grid scroll-mt-28 gap-x-10 gap-y-4 border-t border-line-soft py-6 first:border-t-0',
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
      <output htmlFor={id} className="min-w-11 text-right text-sm text-ink figures">
        {display}
      </output>
    </span>
  );
}
