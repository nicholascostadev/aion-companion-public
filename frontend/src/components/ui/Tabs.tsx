import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

/**
 * The state of a set of tabs: Base UI's `Tabs.Root`, holding the chosen tab for the
 * `TabList` and every `TabPanel` inside it, which it links to each other (ids,
 * aria-controls, aria-labelledby). It lays out nothing itself (`display: contents`), so
 * the list and the panels can sit anywhere in the page, such as a sticky nav above `main`.
 */
export function Tabs<T extends string>({
  value,
  onValueChange,
  className,
  children,
}: {
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TabsPrimitive.Root
      data-ui="tabs-root"
      value={value}
      onValueChange={(next: T) => onValueChange(next)}
      className={cn('contents', className)}
    >
      {children}
    </TabsPrimitive.Root>
  );
}

/**
 * Tab list with roving focus: the arrow keys, Home and End move between tabs and choose
 * them as they go. The selected tab is marked by a small accent stem that grows out from
 * its centre.
 */
export function TabList<T extends string>({
  items,
  label,
  variant = 'primary',
  className,
}: {
  items: TabItem<T>[];
  label: string;
  variant?: 'primary' | 'sub';
  className?: string;
}) {
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
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-3xs font-bold leading-none text-accent-ink tabular-nums">
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
