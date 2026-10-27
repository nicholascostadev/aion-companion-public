import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';

const soft: Record<Tone, string> = {
  neutral: 'border-line-strong bg-surface-2 text-ink-2',
  accent: 'border-accent-line bg-accent-soft text-accent',
  success: 'border-success-line bg-success-soft text-success',
  warn: 'border-warn-line bg-warn-soft text-warn',
  danger: 'border-danger-line bg-danger-soft text-danger',
  info: 'border-info-line bg-info-soft text-info',
};
const outline: Record<Tone, string> = {
  neutral: 'border-line-strong text-ink-2',
  accent: 'border-accent-line text-accent',
  success: 'border-success-line text-success',
  warn: 'border-warn-line text-warn',
  danger: 'border-danger-line text-danger',
  info: 'border-info-line text-info',
};
const solid: Record<Tone, string> = {
  neutral: 'border-transparent bg-ink-2 text-canvas',
  accent: 'border-transparent bg-accent text-accent-ink',
  success: 'border-transparent bg-success text-ink-inverse',
  warn: 'border-transparent bg-warn text-ink-inverse',
  danger: 'border-transparent bg-danger text-ink-inverse',
  info: 'border-transparent bg-info text-ink-inverse',
};
const dot: Record<Tone, string> = {
  neutral: 'text-ink-3',
  accent: 'text-accent',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  variant?: 'soft' | 'outline' | 'solid';
  /** `pill` for states and counts, `tag` for compact data labels inside tables. */
  shape?: 'pill' | 'tag';
  /** Leading status dot; `live` makes it breathe. */
  dot?: boolean | 'live';
  icon?: ReactNode;
}

/** Non-interactive label for a state, a count or a kind. Never colour alone: always words. */
export function Badge({
  tone = 'neutral',
  variant = 'soft',
  shape = 'pill',
  dot: withDot = false,
  icon,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      data-ui="badge"
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap border align-middle font-medium leading-none',
        shape === 'pill'
          ? 'h-6 rounded-full px-2.5 text-xs'
          : 'h-[18px] rounded-xs px-1.5 text-2xs font-semibold tracking-wide',
        (variant === 'soft' ? soft : variant === 'outline' ? outline : solid)[tone],
        className,
      )}
      {...props}
    >
      {withDot && <StatusDot tone={tone} live={withDot === 'live'} />}
      {icon}
      {children}
    </span>
  );
}

/** Small round state light. `live` breathes slowly, like something alive. */
export function StatusDot({
  tone = 'neutral',
  live = false,
  className,
}: {
  tone?: Tone;
  live?: boolean;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-block size-[7px] shrink-0 rounded-full bg-current',
        dot[tone],
        live && 'animate-breathe',
        className,
      )}
    />
  );
}
