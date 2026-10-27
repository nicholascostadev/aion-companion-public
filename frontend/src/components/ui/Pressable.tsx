import { Button as ButtonPrimitive } from '@base-ui/react/button';
import type { ButtonHTMLAttributes, Ref } from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

/** What every pressable surface shares: a pointer, left-aligned content, a focus ring. */
const pressable = cn(
  'cursor-pointer text-left transition-colors duration-150 ease-grow',
  'disabled:cursor-default disabled:opacity-45',
  focusRing,
);

export interface PressableProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A whole row, card or mark that is itself the click target (a log in the library, a pet
 * card, a meter row, a cast on the vine). Unlike `Button` it has no look of its own beyond
 * pointer, focus ring and disabled dimming: the caller draws the surface and must give it
 * a hover and a selected state (or put them on the row around it, see `selectableRow`).
 * Base UI's `Button` (a native `<button>`); defaults to `type="button"`.
 */
export function Pressable({ className, type = 'button', ...props }: PressableProps) {
  return (
    <ButtonPrimitive
      type={type}
      data-ui="pressable"
      className={cn(pressable, className)}
      {...props}
    />
  );
}

/**
 * The selectable row: a quiet row that lights with `bg-row-selected` and grows a small
 * accent stem on its leading edge when it is the chosen one (the log list, the preset list,
 * the pet picker). Put it on the row itself, which may be the `Pressable` or the list item
 * holding it.
 */
export function selectableRow(selected: boolean, className?: string) {
  return cn(
    'relative rounded-lg transition-colors duration-150 hover:bg-row-hover',
    'before:absolute before:inset-y-2.5 before:left-0 before:w-0.5 before:origin-center before:scale-y-0',
    'before:rounded-full before:bg-accent before:transition-transform before:duration-300 before:ease-grow',
    selected && 'bg-row-selected hover:bg-row-selected before:scale-y-100',
    className,
  );
}
