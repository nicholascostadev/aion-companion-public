import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';
import { useEffect, useRef, type ReactNode } from 'react';
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
  overflow = 'fit',
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
  /**
   * `scroll` keeps the groove one pill high when its segments are wider than the room it
   * has: they slide sideways inside it (wheel, keyboard or drag), the chosen one is kept in
   * view, and the groove clips their hit regions on a click-through overlay.
   */
  overflow?: 'fit' | 'scroll';
  /** Data attributes for every segment, e.g. `{ 'data-hit': '' }` on a click-through overlay. */
  segmentAttributes?: Record<`data-${string}`, string>;
  className?: string;
}) {
  const scroll = overflow === 'scroll';
  const groove = useRef<HTMLDivElement>(null);

  // Bring the chosen segment fully into view, without moving anything outside the groove.
  useEffect(() => {
    const el = groove.current;
    if (!scroll || !el) return;
    const chosen = el.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!chosen) return;
    const pad = 4;
    const start = chosen.getBoundingClientRect().left - el.getBoundingClientRect().left;
    const left = el.scrollLeft + start - pad;
    const right = left + chosen.offsetWidth + 2 * pad;
    if (left < el.scrollLeft) el.scrollLeft = left;
    else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
  }, [scroll, value]);

  // A vertical wheel slides the segments sideways while there is somewhere to go.
  useEffect(() => {
    const el = groove.current;
    if (!scroll || !el) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaX !== 0 || event.deltaY === 0) return;
      const before = el.scrollLeft;
      el.scrollLeft += event.deltaY;
      if (el.scrollLeft !== before) event.preventDefault();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [scroll]);

  return (
    <ToggleGroup
      ref={groove}
      data-ui="segmented"
      data-hit-clip={scroll ? '' : undefined}
      aria-label={label}
      value={[value]}
      onValueChange={(next) => {
        const chosen = options.find((option) => option.value === next[0]);
        if (chosen) onChange(chosen.value);
      }}
      className={cn(
        'inline-flex w-fit max-w-full min-w-0 items-center gap-0.5 rounded-full border border-line bg-sunken p-0.5',
        scroll ? 'overflow-x-auto overflow-y-hidden [scrollbar-width:none]' : 'shrink-0',
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
            // Inside the segment, so the sideways-scrolling groove never clips the ring.
            scroll && 'shrink-0 focus-visible:outline-offset-[-2px]',
          )}
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
