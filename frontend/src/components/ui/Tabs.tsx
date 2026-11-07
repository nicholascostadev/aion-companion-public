import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
  /** Rail only: a glyph before the label. */
  icon?: ReactNode;
  /** Rail only: a state mark after the label, drawn as given (it carries its own words). */
  marker?: ReactNode;
  /** Rail only: the first tab of a new group, set apart by a hairline. */
  startsGroup?: boolean;
}

/**
 * The state of a set of tabs: Base UI's `Tabs.Root`, holding the chosen tab for the
 * `TabList` and every `TabPanel` inside it, which it links to each other (ids,
 * aria-controls, aria-labelledby). It lays out nothing itself (`display: contents`), so
 * the list and the panels can sit anywhere in the page, such as a sticky nav above `main`.
 * `orientation` picks the arrow keys: left and right, or up and down for a vertical rail.
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  orientation = 'horizontal',
  className,
  children,
}: {
  value: T;
  onValueChange: (value: T) => void;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root
      data-ui="tabs-root"
      value={value}
      orientation={orientation}
      onValueChange={(next: T) => onValueChange(next)}
      className={cn('contents', className)}
    >
      {children}
    </TabsPrimitive.Root>
  );
}

/**
 * A rail tab: a quiet, square-cornered row with its glyph in muted ink. The chosen one sits
 * on a faint gold wash, flat (no shade, no highlight), with its words and glyph in gold;
 * hovering any other brightens its ink over a barely-there neutral wash. Below 960px the
 * rail runs across as a strip of the same tabs.
 */
const railTab = cn(
  'group relative flex h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-sm px-3.5 text-sm',
  'font-medium whitespace-nowrap text-ink-3',
  'transition-colors duration-150 ease-grow',
  'not-data-disabled:not-aria-selected:hover:bg-row-hover not-data-disabled:not-aria-selected:hover:text-ink',
  'aria-selected:bg-accent-soft aria-selected:text-accent',
  'data-disabled:cursor-default data-disabled:opacity-45',
);

/**
 * Tab list with roving focus: the arrow keys, Home and End move between tabs and choose
 * them as they go. The selected tab is marked by a small accent stem that grows out from
 * its centre. `rail` is a vertical list of places beside the content (Settings), with a
 * glyph and an optional state mark on every tab and the chosen one on a faint gold wash;
 * under 960px it runs across instead.
 */
export function TabList<T extends string>({
  items,
  label,
  variant = 'primary',
  className,
}: {
  items: TabItem<T>[];
  label: string;
  variant?: 'primary' | 'sub' | 'rail';
  className?: string;
}) {
  if (variant === 'rail')
    return (
      <TabsPrimitive.List
        aria-label={label}
        data-ui="tabs"
        data-variant="rail"
        activateOnFocus
        className={cn(
          'flex gap-1 overflow-x-auto py-1 [scrollbar-width:none]',
          'min-[960px]:flex-col min-[960px]:gap-0.5 min-[960px]:overflow-visible min-[960px]:py-0',
          className,
        )}
      >
        {items.map((item) => (
          <TabsPrimitive.Tab
            key={item.id}
            value={item.id}
            data-ui="tab"
            disabled={item.disabled}
            className={cn(
              railTab,
              // A new group is set apart by a hairline: above it in the rail, before it in the strip.
              item.startsGroup &&
                cn(
                  'after:absolute after:bg-line-soft',
                  'max-[959px]:ml-3 max-[959px]:after:inset-y-2 max-[959px]:after:-left-2 max-[959px]:after:w-px',
                  'min-[960px]:mt-4 min-[960px]:after:inset-x-3.5 min-[960px]:after:-top-2.5 min-[960px]:after:h-px',
                ),
              focusRing,
              // Inside the tab, so the sideways-scrolling strip never clips the ring.
              'focus-visible:outline-offset-[-2px]',
            )}
          >
            {item.icon && (
              <span className="flex text-ink-4 transition-colors duration-150 group-not-aria-selected:group-hover:text-ink-3 group-aria-selected:text-accent">
                {item.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate text-start">{item.label}</span>
            {item.marker}
          </TabsPrimitive.Tab>
        ))}
      </TabsPrimitive.List>
    );
  const sub = variant === 'sub';
  return (
    <TabsPrimitive.List
      aria-label={label}
      data-ui="tabs"
      activateOnFocus
      className={cn(
        // Scrolls sideways only: the selected stem hangs a pixel below the tabs.
        'flex gap-1 overflow-x-auto overflow-y-hidden [scrollbar-width:none]',
        sub && 'border-b border-line',
        className,
      )}
    >
      {items.map((item) => (
        <TabsPrimitive.Tab
          key={item.id}
          value={item.id}
          data-ui="tab"
          disabled={item.disabled}
          className={cn(
            'relative inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md',
            'font-medium text-ink-3 transition-colors duration-150 ease-grow',
            'not-data-disabled:hover:text-ink aria-selected:text-ink data-disabled:cursor-default data-disabled:opacity-45',
            'after:absolute after:inset-x-2.5 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent',
            'after:origin-center after:scale-x-0 after:opacity-0 after:transition-[scale,opacity]',
            'after:duration-300 after:ease-grow aria-selected:after:scale-x-100 aria-selected:after:opacity-100',
            'aria-selected:after:shadow-[0_0_10px_var(--color-accent-line)]',
            sub ? 'h-8 px-2.5 text-sm' : 'h-10 px-3 text-base',
            focusRing,
            'focus-visible:outline-offset-[-2px]',
          )}
        >
          {item.label}
          {item.badge !== undefined && item.badge !== null && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-3xs font-bold leading-none text-accent-ink figures">
              {item.badge}
            </span>
          )}
        </TabsPrimitive.Tab>
      ))}
    </TabsPrimitive.List>
  );
}

/**
 * The content of one tab. Unmounted while another tab is chosen unless `keepMounted`, which
 * keeps it (and its state) alive but hidden. It stays out of the tab order, since every
 * panel leads with its own controls.
 */
export function TabPanel({
  value,
  keepMounted = false,
  children,
  className,
}: {
  value: string;
  /** Keep the panel (and its state) alive while hidden. */
  keepMounted?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <TabsPrimitive.Panel
      value={value}
      keepMounted={keepMounted}
      tabIndex={-1}
      className={cn('animate-sprout', className)}
    >
      {children}
    </TabsPrimitive.Panel>
  );
}
