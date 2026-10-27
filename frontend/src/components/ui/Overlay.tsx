import type { ComponentProps, HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { StatusDot } from './Badge';
import { Button, type ButtonProps } from './Button';

/**
 * The sheet of glass every in-game window is drawn on. `clear` glass keeps the game
 * visible behind figures you glance at (the meter, the menu); `deep` glass is for windows
 * you read (group, pet radar, damage details). Unlocked windows that can be moved wear an
 * accent edge (`editing`). Text always carries a halo for legibility over any background.
 */
export function overlayWindow({
  glass = 'clear',
  editing = false,
  className,
}: {
  glass?: 'clear' | 'deep';
  editing?: boolean;
  className?: string | undefined;
} = {}) {
  return cn(
    'relative flex h-full flex-col overflow-hidden rounded-xl border text-ink text-halo',
    'inset-shadow-light select-none transition-[border-color,opacity] duration-300 ease-grow',
    glass === 'clear' ? 'bg-surface' : 'bg-shade/80',
    editing ? 'cursor-move border-accent-line' : 'border-line-strong',
    className,
  );
}

/** Title row of an in-game window; spread drag-region attributes onto it as needed. */
export function OverlayCaption({ className, ...props }: ComponentProps<'header'>) {
  return (
    <header
      data-ui="overlay-caption"
      className={cn(
        'flex h-8 flex-none items-center gap-2 border-b border-line-soft bg-sunken/40 pr-1 pl-3',
        className,
      )}
      {...props}
    />
  );
}

/** A window's name: its glyph lit with the accent, then a caps label and any extras. */
export function CaptionTitle({
  icon,
  label,
  children,
  className,
  ...props
}: {
  icon?: ReactNode;
  label: ReactNode;
  children?: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-2', className)} {...props}>
      {icon && <span className="flex shrink-0 text-accent">{icon}</span>}
      <b
        className="min-w-0 truncate text-2xs font-semibold tracking-caps text-ink uppercase"
        title={typeof label === 'string' ? label : undefined}
      >
        {label}
      </b>
      {children}
    </span>
  );
}

const stateTones = {
  live: 'text-accent',
  warn: 'text-warn',
  muted: 'text-ink-3',
} as const;

/** A window's state in its caption: a small light and a word; `live` breathes. */
export function CaptionState({
  tone = 'muted',
  children,
  className,
  ...props
}: {
  tone?: keyof typeof stateTones;
  children: ReactNode;
  className?: string;
} & Omit<HTMLAttributes<HTMLSpanElement>, 'children'>) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-3xs font-semibold tracking-caps whitespace-nowrap uppercase',
        stateTones[tone],
        className,
      )}
      {...props}
    >
      <StatusDot live={tone === 'live'} className="size-1.5 text-current" />
      {children}
    </span>
  );
}

/**
 * Icon-only window control (hide, lock, close). Ghost by default; `close` warms to the
 * danger tone on hover so closing never looks like any other action.
 */
export function WindowButton({
  close = false,
  size = 'xs',
  className,
  ...props
}: Omit<ButtonProps, 'variant' | 'iconOnly'> & { close?: boolean }) {
  return (
    <Button
      variant="ghost"
      size={size}
      iconOnly
      className={cn(
        'text-ink-3',
        close && 'enabled:hover:bg-danger-soft enabled:hover:text-danger-strong',
        className,
      )}
      {...props}
    />
  );
}
