import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { focusRing } from './Button';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  disabled?: boolean;
}

/**
 * One choice out of a few, shown as pebbles in a sunken groove; the chosen one is lifted
 * and lit. Base UI's `ToggleGroup`: a named group of aria-pressed buttons that is one tab
 * stop, with the arrow keys, Home and End moving between segments. A chosen segment stays
 * chosen when it is pressed again.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  segmentAttributes,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name of the group. */
  label: string;
  /** `xs` is for dense overlay toolbars only. */
  size?: 'xs' | 'sm' | 'md';
  /** Data attributes for every segment, e.g. `{ 'data-hit': '' }` on a click-through overlay. */
  segmentAttributes?: Record<`data-${string}`, string>;
  className?: string;
}) {
  return (
    <ToggleGroup
      data-ui="segmented"
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next[0]);
        if (chosen) onChange(chosen.value);
      }}
      className={cn(
        'inline-flex w-fit max-w-full min-w-0 shrink-0 items-center gap-0.5 rounded-full border border-line bg-sunken p-0.5',
        className,
      )}
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          type="button"
          value={option.value}
          data-ui="segment"
          title={option.title}
          disabled={option.disabled}
          {...segmentAttributes}
          className={cn(
            'inline-flex cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full',
            'border border-transparent font-medium text-ink-3',
            'transition-[background-color,color,box-shadow,border-color] duration-200 ease-grow',
            'enabled:hover:text-ink disabled:cursor-default disabled:opacity-45',
            'aria-pressed:border-accent-line aria-pressed:bg-accent-soft aria-pressed:text-accent aria-pressed:shadow-1',
            { xs: 'h-[18px] px-2 text-2xs', sm: 'h-6 px-2.5 text-xs', md: 'h-7 px-3 text-sm' }[
              size
            ],
            focusRing,
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
