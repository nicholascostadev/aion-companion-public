import { Children, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

const statTones = {
  good: 'text-success',
  warn: 'text-warn',
  bad: 'text-danger',
  accent: 'text-accent',
} as const;

/** One figure in a <dl>: a small caps label over a large tabular value. */
export function Stat({
  label,
  value,
  sub,
  title,
  tone,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  title?: string | undefined;
  tone?: keyof typeof statTones | undefined;
  className?: string;
}) {
  return (
    <div
      data-ui="stat"
      className={cn('stat min-w-0 bg-surface-2 px-3.5 py-2.5', className)}
      title={title}
    >
      <dt className="text-2xs font-semibold tracking-caps text-ink-3 uppercase">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 truncate text-xl font-semibold tracking-tight tabular-nums',
          tone && statTones[tone],
        )}
      >
        {value}
      </dd>
      {sub !== undefined && <dd className="truncate text-2xs text-ink-3">{sub}</dd>}
    </div>
  );
}

/*
 * `columns="auto"`: as many columns as fit (about 7.5rem a figure, measured on the strip's
 * own width), but always in balanced rows. Five figures sit in one row or wrap 3 + 2, six
 * wrap 3 + 3, four wrap 2 + 2; a figure is never left alone on a row of its own.
 */
const autoGrids: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-2 @min-[22.5rem]:grid-cols-3',
  4: 'grid-cols-2 @min-[30rem]:grid-cols-4',
  5: 'grid-cols-2 @min-[22.5rem]:grid-cols-3 @min-[37.5rem]:grid-cols-5',
  6: 'grid-cols-2 @min-[22.5rem]:grid-cols-3 @min-[45rem]:grid-cols-6',
};

/**
 * Row of stats sharing hairline dividers. `boxed` (default) is one rounded strip; `open`
 * lets the figures stand on the surface they sit on, divided only by thin vertical rules,
 * for a hero row that should not read as yet another box.
 */
export function StatStrip({
  children,
  columns = 4,
  variant = 'boxed',
  className,
}: {
  children: ReactNode;
  columns?: 2 | 3 | 4 | 5 | 6 | 'auto';
  variant?: 'boxed' | 'open';
  className?: string;
}) {
  const grid = {
    2: 'grid-cols-2',
    3: 'grid-cols-3',
    4: 'grid-cols-2 sm:grid-cols-4',
    5: 'grid-cols-2 sm:grid-cols-5',
    6: 'grid-cols-3 sm:grid-cols-6',
    auto:
      autoGrids[Children.toArray(children).length] ??
      'grid-cols-[repeat(auto-fit,minmax(7.5rem,1fr))]',
  }[columns];
  // The auto grid measures the strip itself, so it wraps the same in a narrow window.
  const container = columns === 'auto' && '@container';
  if (variant === 'open')
    // Every figure carries a rule on its leading edge; the strip is pulled left and clipped
    // so the rule of whichever figure starts a row (on any width) is hidden.
    return (
      <div
        data-ui="stat-strip"
        data-variant="open"
        className={cn('mb-3.5 overflow-hidden', container, className)}
      >
        <dl
          className={cn(
            '-ml-4 grid w-[calc(100%+1rem)] gap-y-4',
            '[&>[data-ui=stat]]:border-l [&>[data-ui=stat]]:border-line-soft [&>[data-ui=stat]]:bg-transparent',
            '[&>[data-ui=stat]]:py-0.5 [&>[data-ui=stat]]:pr-3 [&>[data-ui=stat]]:pl-4 [&_dd:first-of-type]:text-2xl',
            grid,
          )}
        >
          {children}
        </dl>
      </div>
    );
  const strip = (
    <dl
      data-ui="stat-strip"
      data-variant={variant}
      className={cn(
        'mb-3.5 grid gap-px overflow-hidden rounded-lg border border-line bg-line',
        grid,
        !container && className,
      )}
    >
      {children}
    </dl>
  );
  return container ? <div className={cn('@container', className)}>{strip}</div> : strip;
}

const meterTones = {
  good: 'bg-success',
  warn: 'bg-warn',
  bad: 'bg-danger',
} as const;
const meterSizes = { xs: 'h-1', sm: 'h-1.5', md: 'h-2.5' } as const;

/**
 * Horizontal fill bar; `fraction` null renders an empty, hatched "unknown" track. The fill
 * grows out from its root the first time it appears, then eases between values.
 */
export function Meter({
  fraction,
  color,
  label,
  tone,
  size = 'sm',
  className,
}: {
  fraction: number | null;
  color?: string | undefined;
  label: string;
  tone?: keyof typeof meterTones | undefined;
  size?: keyof typeof meterSizes;
  className?: string;
}) {
  return (
    <span
      data-ui="meter"
      data-state={fraction === null ? 'unknown' : undefined}
      className={cn(
        'meter relative inline-block min-w-12 flex-1 overflow-hidden rounded-full bg-surface-3 align-middle',
        meterSizes[size],
        fraction === null &&
          'bg-[repeating-linear-gradient(135deg,var(--color-surface-3)_0_4px,transparent_4px_8px)]',
        className,
      )}
      // Decorative: the value is always printed beside the bar.
      aria-hidden="true"
      title={label}
    >
      {fraction !== null && (
        <span
          data-ui="meter-fill"
          className={cn(
            'absolute inset-y-0 left-0 origin-left animate-grow rounded-full bg-accent',
            'transition-[width] duration-300 ease-grow',
            tone && meterTones[tone],
          )}
          style={{
            width: `${Math.max(0, Math.min(1, fraction)) * 100}%`,
            background: color,
          }}
        />
      )}
    </span>
  );
}

/** Colour key for a data series or category; always next to its written name. */
export function Swatch({ color, className }: { color: string; className?: string }) {
  return (
    <i
      data-ui="swatch"
      className={cn('inline-block size-2 shrink-0 rounded-xs align-middle', className)}
      style={{ background: color }}
      aria-hidden="true"
    />
  );
}

export interface KeyValue {
  label: ReactNode;
  value: ReactNode;
  /** Tooltip on the label, e.g. how the value was measured. */
  title?: string | undefined;
}

/**
 * Two-column list of labelled facts (muted label, tabular value). Falsy entries are skipped
 * so optional facts can be written inline.
 */
export function KeyValueList({
  items,
  className,
}: {
  items: (KeyValue | false | null | undefined)[];
  className?: string;
}) {
  return (
    <dl
      data-ui="key-values"
      className={cn(
        'm-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm',
        className,
      )}
    >
      {items.map(
        (item, index) =>
          item && (
            <div key={index} className="contents">
              <dt className="text-ink-3" title={item.title}>
                {item.label}
              </dt>
              <dd className="m-0 min-w-0 text-ink tabular-nums">{item.value}</dd>
            </div>
          ),
      )}
    </dl>
  );
}
export interface BarRow {
  key: string;
  label: ReactNode;
  fraction: number | null;
  color?: string | undefined;
  meterLabel: string;
  value: ReactNode;
  sub?: ReactNode;
}

/** Ranked list of named values, each with a bar that grows out from its root. */
export function BarList({ rows, className }: { rows: BarRow[]; className?: string }) {
  return (
    <ul
      className={cn(
        'm-0 grid list-none grid-cols-[minmax(0,1.3fr)_minmax(4rem,1fr)_auto] gap-x-3 gap-y-2 p-0 text-sm',
        className,
      )}
    >
      {rows.map((row) => (
        <li key={row.key} className="col-span-3 grid grid-cols-subgrid items-center">
          <span
            className="min-w-0 truncate text-ink"
            title={typeof row.label === 'string' ? row.label : undefined}
          >
            {row.label}
          </span>
          <Meter fraction={row.fraction} color={row.color} label={row.meterLabel} />
          <span className="text-right text-ink tabular-nums">
            {row.value}
            {row.sub !== undefined && <small className="ml-1.5 text-ink-3">{row.sub}</small>}
          </span>
        </li>
      ))}
    </ul>
  );
}
