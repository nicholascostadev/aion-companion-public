import type { ReactNode } from 'react';
import { ClassIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { ago, READY_FRESH_MS } from './model';

/**
 * Class name led by its original emblem; unknown or unobserved classes say so instead
 * of guessing, and a class without verified artwork keeps its written name alone.
 */
export function ClassName({ name }: { name: string | null }) {
  const { t } = useTranslation('group');
  return (
    <span
      className={cn(
        'shrink-0',
        "after:ml-1.25 after:font-normal after:text-ink-3 after:not-italic after:content-['·']",
        name ? 'font-semibold text-ink-2' : 'font-medium text-ink-3 italic',
      )}
    >
      <ClassIcon name={name} size={14} className="-mt-0.5 mr-1" />
      {name || t(($) => $.classUnknown)}
    </span>
  );
}

export function CombatPowerIcon() {
  return <Icon name="combatPower" size={12} strokeWidth={1.9} />;
}

export function Chevron({ open }: { open: boolean }) {
  return <Icon name={open ? 'chevronUp' : 'chevronDown'} size={12} strokeWidth={1.9} />;
}

/**
 * Ready check state. Only a fresh, timed observed `true` earns the solid green tick. An
 * old observation, or one without a time, keeps its state but fades to an outline, since
 * it may have changed since; nothing here turns into another state.
 */
export function ReadyMark({
  ready,
  observedMs = null,
  now,
}: {
  ready: boolean | null;
  /** Epoch ms when the state was observed. */
  observedMs?: number | null;
  /** The clock the observation's age is measured against. */
  now: number;
}) {
  const { t } = useTranslation('group');
  const fmt = useFormat();
  const state =
    ready === null
      ? t(($) => $.readyMark.unknown)
      : ready
        ? t(($) => $.readyMark.ready)
        : t(($) => $.readyMark.notReady);
  const age = observedMs === null ? null : Math.max(0, now - observedMs);
  const old = ready !== null && (age === null || age > READY_FRESH_MS);
  const spoken = !old
    ? state
    : age === null
      ? t(($) => $.readyMark.untimed, { state })
      : t(($) => $.readyMark.observedAgo, { state, ago: ago(age, t) });
  const observed =
    ready !== null && observedMs !== null
      ? t(($) => $.readyMark.observedAt, { state, time: fmt.timeOfDay(observedMs) })
      : state;
  const title = old
    ? t(($) => $.readyMark.mayHaveChanged, {
        text: observed,
        age: age === null ? t(($) => $.readyMark.timeNotObserved) : ago(age, t),
      })
    : observed;
  return (
    <span
      data-state={ready === null ? 'unknown' : ready ? 'ready' : 'waiting'}
      data-tone={old ? 'old' : undefined}
      className={cn(
        'grid size-4 place-items-center rounded-full',
        ready === null
          ? 'border-[1.5px] border-dashed border-line-strong'
          : old
            ? cn(
                'border-[1.5px]',
                ready ? 'border-success-line text-success' : 'border-warn-line text-ink-3',
              )
            : ready
              ? 'bg-success text-ink-inverse'
              : 'border-[1.5px] border-warn text-warn',
      )}
      title={title}
    >
      {ready !== null && <Icon name={ready ? 'check' : 'minus'} size={10} strokeWidth={3.4} />}
      <span className="sr-only">{spoken}</span>
    </span>
  );
}

/** Side-by-side figures of two picked members or profiles, with a note below. */
export function Comparison({
  label,
  children,
  note,
}: {
  label: string;
  children: ReactNode;
  note: ReactNode;
}) {
  return (
    <div
      className="mt-1.5 flex flex-wrap gap-2 rounded-lg border border-line bg-sunken px-2.5 py-2"
      aria-label={label}
    >
      {children}
      <p className="m-0 w-full text-2xs text-ink-2">{note}</p>
    </div>
  );
}

/** One side of a comparison: the name, its class line and the compared figures. */
export function ComparisonSide({
  name,
  sub,
  figures,
}: {
  name: string;
  sub: ReactNode;
  figures: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-px">
      <b className="truncate text-sm">{name}</b>
      <span className="text-2xs text-ink-3">{sub}</span>
      <strong className="text-xs text-accent tabular-nums">{figures}</strong>
    </div>
  );
}

/** A member or profile row: name and class line, figures, and an optional compare box. */
export const memberRow = cn(
  'grid items-center gap-2 rounded-lg border bg-row-hover px-2.5 py-1.5',
  'transition-[border-color,opacity] duration-150',
);
