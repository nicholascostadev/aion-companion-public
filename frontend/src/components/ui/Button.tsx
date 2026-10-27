import { Button as ButtonPrimitive } from '@base-ui/react/button';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
/** `2xs` is for dense overlay toolbars only (the DPS meter). */
export type ButtonSize = '2xs' | 'xs' | 'sm' | 'md';

/** Shared focus ring for every pressable thing. */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const base = cn(
  'relative inline-flex shrink-0 cursor-pointer select-none items-center justify-center',
  'whitespace-nowrap rounded-full border font-medium leading-none',
  'transition-[background-color,border-color,color,box-shadow,translate] duration-150 ease-grow',
  'enabled:active:translate-y-px disabled:cursor-default disabled:opacity-45',
  'aria-disabled:cursor-default aria-disabled:opacity-45',
  focusRing,
);

/*
 * aria-pressed turns a secondary or ghost button into a toggle that lights up with the
 * accent; no separate "active" class is ever needed.
 */
const variants: Record<ButtonVariant, string> = {
  primary: cn(
    'border-transparent bg-accent font-semibold text-accent-ink shadow-1',
    'enabled:hover:bg-accent-strong',
  ),
  secondary: cn(
    'border-line-strong bg-surface-3 text-ink shadow-1',
    'enabled:hover:border-line-strong enabled:hover:bg-surface-hover',
    'aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-accent',
  ),
  ghost: cn(
    'border-transparent bg-transparent text-ink-2',
    'enabled:hover:bg-surface-3 enabled:hover:text-ink',
    'aria-pressed:bg-accent-soft aria-pressed:text-accent',
  ),
  danger: cn(
    'border-danger-line bg-transparent text-danger',
    'enabled:hover:border-danger enabled:hover:bg-danger-soft',
  ),
  link: cn(
    'h-auto gap-1 rounded-xs border-0 bg-transparent p-0 font-medium text-accent',
    'underline-offset-2 enabled:hover:underline',
  ),
};

/*
 * Every Lucide glyph inside a button takes the button's icon size, whatever size the caller
 * asked for, so the same size of button always carries the same size of icon.
 */
const glyphs: Record<ButtonSize, string> = {
  '2xs': '[&_svg.icon]:size-2.75',
  xs: '[&_svg.icon]:size-3',
  sm: '[&_svg.icon]:size-3.5',
  md: '[&_svg.icon]:size-3.75',
};
const sizes: Record<ButtonSize, string> = {
  '2xs': cn('h-5 gap-1 px-2 text-2xs', glyphs['2xs']),
  xs: cn('h-6 gap-1 px-2.5 text-xs', glyphs.xs),
  sm: cn('h-7 gap-1.5 px-3 text-sm', glyphs.sm),
  md: cn('h-8 gap-1.5 px-3.5 text-sm', glyphs.md),
};
const iconOnlySizes: Record<ButtonSize, string> = {
  '2xs': cn('size-5 p-0', glyphs['2xs']),
  xs: cn('size-6 p-0', glyphs.xs),
  sm: cn('size-7 p-0', glyphs.sm),
  md: cn('size-8 p-0', glyphs.md),
};
const iconSizes: Record<ButtonSize, number> = { '2xs': 11, xs: 12, sm: 14, md: 15 };

/** Class string for a button look; for links or labels that must look like a button. */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  iconOnly?: boolean;
  className?: string | undefined;
} = {}) {
  return cn(
    base,
    variants[variant],
    variant !== 'link' && (iconOnly ? iconOnlySizes[size] : sizes[size]),
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Square, icon-only button. Requires an aria-label. */
  iconOnly?: boolean;
  /** Leading icon; sized to the button. */
  icon?: ReactNode;
  /** Shows a spinner, sets aria-busy and blocks clicks while keeping the label. */
  loading?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * The one button, on Base UI's `Button` (a native `<button>`). Pebble-shaped (fully rounded)
 * so pressable things read differently from the leaf-cornered panels that hold content.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  iconOnly = false,
  icon,
  loading = false,
  disabled,
  className,
  children,
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      type={type}
      data-ui="button"
      className={buttonClasses({ variant, size, iconOnly, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Icon name="loader" size={iconSizes[size]} className="animate-spin" /> : icon}
      {children}
    </ButtonPrimitive>
  );
}
