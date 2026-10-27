import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { Toggle } from '@base-ui/react/toggle';
import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

export interface ChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'onChange' | 'value'
> {
  /** Toggle state, exposed as aria-pressed. Omit for a plain pressable chip. */
  pressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  /** Leading icon or swatch. */
  icon?: ReactNode;
  /** Trailing count, shown muted. */
  count?: ReactNode;
  size?: 'xs' | 'sm';
  ref?: Ref<HTMLButtonElement>;
}

export const chipClasses = (size: 'xs' | 'sm' = 'sm', className?: string) =>
  cn(
    'group inline-flex shrink-0 cursor-pointer select-none items-center gap-1.5 whitespace-nowrap',
    'rounded-full border border-line bg-surface-2 font-medium text-ink-2',
    'transition-[background-color,border-color,color] duration-150 ease-grow',
    'enabled:hover:border-line-strong enabled:hover:text-ink',
    'aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-accent',
    'disabled:cursor-default disabled:opacity-45',
    size === 'xs' ? 'h-5 px-2 text-2xs' : 'h-6 px-2.5 text-xs',
    focusRing,
    className,
  );

/**
 * Small pill for filters and quick toggles; many can sit side by side in a row. With
 * `pressed` it is Base UI's `Toggle` (aria-pressed); without, a plain Base UI `Button`.
 */
export function Chip({
  pressed,
  onPressedChange,
  icon,
  count,
  size = 'sm',
  className,
  children,
  ...props
}: ChipProps) {
  const content = (
    <>
      {icon}
      {children}
      {count !== undefined && count !== null && (
        <span className="tabular-nums text-ink-3 group-aria-pressed:text-accent/80">{count}</span>
      )}
    </>
  );
  if (pressed === undefined)
    return (
      <ButtonPrimitive
        type="button"
        data-ui="chip"
        className={chipClasses(size, className)}
        {...props}
      >
        {content}
      </ButtonPrimitive>
    );
  return (
    <Toggle
      type="button"
      data-ui="chip"
      pressed={pressed}
      onPressedChange={(next) => onPressedChange?.(next)}
      className={chipClasses(size, className)}
      {...props}
    >
      {content}
    </Toggle>
  );
}
