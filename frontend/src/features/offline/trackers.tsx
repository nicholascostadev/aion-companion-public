import { useRef, type CSSProperties, type PointerEvent } from 'react';
import { SkillIcon } from '../../components/ui/GameArt';
import type { Formatters } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type {
  OfflineSettings,
  TrackerBar,
  TrackerPreset,
  TrackerStatus,
} from '../../types/offline';

/** Remaining time text: "~" marks calibrated/derived timers; null is an open buff. */
export function trackerTime(status: TrackerStatus, t: Translate<'trackers'>, fmt: Formatters) {
  if (status.remaining_ms === null) return t(($) => $.time.active);
  // Only a raw wire zero (estimated: false) is an exact "ready"; an elapsed estimate keeps "~".
  const value =
    status.remaining_ms <= 0
      ? status.kind === 'cooldown'
        ? t(($) => $.time.ready)
        : t(($) => $.time.ending)
      : fmt.countdown(status.remaining_ms);
  return status.estimated ? t(($) => $.time.estimate, { value }) : value;
}

/** The kind of timer, as written next to its time. */
export const trackerKind = (status: TrackerStatus, t: Translate<'trackers'>) =>
  status.kind === 'cooldown' ? t(($) => $.kind.cooldown) : t(($) => $.kind.buff);

export function trackerTitle(status: TrackerStatus, t: Translate<'trackers'>, fmt: Formatters) {
  const name = status.name ?? t(($) => $.skillId, { id: status.skill });
  const { basis } = status;
  const how = status.estimated
    ? basis
      ? t(($) => $.title.estimatedFrom, { basis })
      : t(($) => $.title.estimated)
    : basis
      ? t(($) => $.title.measured, { basis })
      : '';
  const line = t(($) => $.title.line, {
    name,
    kind: trackerKind(status, t),
    time: trackerTime(status, t, fmt),
  });
  return [line, how].filter(Boolean).join('\n');
}

export function activePreset(settings: OfflineSettings | null): TrackerPreset | null {
  if (!settings) return null;
  return (
    settings.presets.find((p) => p.id === settings.active_preset) ??
    (settings.active_preset === null ? (settings.presets[0] ?? null) : null)
  );
}

const initials = (name: string) =>
  name
    .replace(/#\d+/, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || '#';

/**
 * Remembers the longest remaining time seen for each running timer so a bar can
 * show progress. The fill is relative to when the timer was first observed.
 */
function useLongest() {
  const longest = useRef(new Map<string, number>());
  return (t: TrackerStatus) => {
    if (t.remaining_ms === null) return null;
    const id = `${t.bar_id}|${t.skill}|${t.kind}|${t.target ?? ''}`;
    const seen = Math.max(longest.current.get(id) ?? 0, t.remaining_ms);
    longest.current.set(id, seen);
    if (t.remaining_ms <= 0) longest.current.delete(id);
    return seen > 0 ? t.remaining_ms / seen : 0;
  };
}

/** Compact chips for the DPS meter when no dedicated tracker surface exists. */
export function TrackerChips({
  trackers,
  limit = 8,
}: {
  trackers: TrackerStatus[];
  limit?: number;
}) {
  const { t } = useTranslation('trackers');
  const fmt = useFormat();
  const sorted = [...trackers].sort(
    (a, b) => (a.remaining_ms ?? Infinity) - (b.remaining_ms ?? Infinity),
  );
  if (!sorted.length) return null;
  return (
    <div className="flex flex-wrap gap-1 px-1.5 pb-1" aria-label={t(($) => $.chips.label)}>
      {sorted.slice(0, limit).map((status, i) => (
        <span
          key={`${status.bar_id}-${status.skill}-${status.kind}-${i}`}
          className={cn(
            'inline-flex max-w-full items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1 text-2xs',
            status.kind === 'buff' ? 'border-fern-ink/45 bg-fern/18' : 'border-sky/50 bg-sky/14',
            status.estimated && 'border-dashed',
          )}
          data-kind={status.kind}
          title={trackerTitle(status, t, fmt)}
        >
          <SkillIcon id={status.skill} size={14} className="rounded-full" />
          <b className="min-w-0 truncate font-semibold">{status.name ?? `#${status.skill}`}</b>
          <span className="font-bold tabular-nums">{trackerTime(status, t, fmt)}</span>
        </span>
      ))}
    </div>
  );
}

interface Arrange {
  /** Overrides while a bar is being dragged in game. */
  positions?: Record<string, { x: number; y: number }>;
  onDragStart?: (bar: TrackerBar, event: PointerEvent<HTMLElement>) => void;
}

/** Frame colour of a skill icon by timer state; estimates are dashed, unknown dotted. */
const ICON_STATE: Record<string, string> = {
  cooling: 'border-sky/75',
  buff: 'border-fern-ink/85 ring-1 ring-fern-ink/40',
  ready: 'border-accent',
  unknown: 'border-dotted border-line-strong',
};

function Bar({
  bar,
  trackers,
  progress,
  positions,
  onDragStart,
}: {
  bar: TrackerBar;
  trackers: TrackerStatus[];
  progress: (t: TrackerStatus) => number | null;
} & Arrange) {
  const { t: tr } = useTranslation('trackers');
  const fmt = useFormat();
  const size = bar.icon_size;
  const barName = bar.name || tr(($) => $.bar.fallbackName);
  const at = positions?.[bar.id] ?? bar;
  const editing = !!onDragStart;
  const bars = bar.appearance === 'bars';
  const style = { left: at.x, top: at.y, '--icon-size': `${size}px` } as CSSProperties;
  const mine = trackers.filter((t) => t.bar_id === bar.id);
  // Every configured skill keeps its slot; absent cooldowns are ready, absent buffs inactive.
  const slots = bar.skills.map((skill) => ({
    skill,
    running: mine.filter((t) => t.skill === skill),
  }));
  return (
    <section
      data-appearance={bar.appearance}
      data-state={bar.hidden ? 'hidden' : undefined}
      className={cn(
        'absolute flex gap-1 text-[calc(var(--icon-size)*0.3)] text-ink drop-shadow-ink',
        bars && 'w-[calc(var(--icon-size)*5)] flex-col',
        editing &&
          'cursor-grab touch-none rounded-lg border border-dashed border-accent-line bg-shade/55 px-1 pt-4.5 pb-1 active:cursor-grabbing',
        bar.hidden && 'opacity-45',
      )}
      style={style}
      aria-label={bar.name || tr(($) => $.bar.label)}
      onPointerDown={onDragStart ? (event) => onDragStart(bar, event) : undefined}
    >
      {editing && (
        <span className="absolute top-0.5 left-1.5 text-3xs whitespace-nowrap text-accent">
          {bar.hidden
            ? tr(($) => $.bar.positionHidden, {
                name: barName,
                x: Math.round(at.x),
                y: Math.round(at.y),
              })
            : tr(($) => $.bar.position, {
                name: barName,
                x: Math.round(at.x),
                y: Math.round(at.y),
              })}
        </span>
      )}
      {!slots.length && editing && (
        <span className="relative flex items-center gap-1.5 opacity-45" data-state="inactive">
          {tr(($) => $.bar.noSkills)}
        </span>
      )}
      {slots.map(({ skill, running }) => {
        const t = running[0];
        const name = t?.name ?? tr(($) => $.skillId, { id: skill });
        const fill = t ? progress(t) : null;
        // Ready only on an observed zero; no status means no timer was observed, not ready.
        const state = !t
          ? 'unknown'
          : t.kind === 'cooldown'
            ? t.remaining_ms === 0
              ? 'ready'
              : 'cooling'
            : 'buff';
        return (
          <div
            key={skill}
            data-state={state}
            className={cn(
              'relative flex items-center gap-1.5',
              bars &&
                'h-[calc(var(--icon-size)*0.6)] overflow-hidden rounded-sm bg-shade/70 pr-1.5',
              state === 'unknown' && 'opacity-45',
            )}
            title={t ? trackerTitle(t, tr, fmt) : tr(($) => $.bar.notObserved, { name })}
          >
            <span
              className={cn(
                'relative grid shrink-0 place-items-center overflow-hidden border bg-surface-3',
                'text-[calc(var(--icon-size)*0.32)] font-bold',
                // A bar's icon sits flush in its row, so it takes the row's corners.
                bars
                  ? 'size-[calc(var(--icon-size)*0.6)] rounded-sm'
                  : 'size-(--icon-size) rounded-md',
                ICON_STATE[state],
                t?.estimated && 'border-dashed',
              )}
            >
              <SkillIcon
                id={skill}
                size={size}
                fallback={initials(name)}
                className="absolute inset-0 size-full rounded-none"
              />
              {fill !== null && (
                <i
                  className="absolute inset-0 bg-[conic-gradient(var(--color-scrim)_calc(var(--fill)*360deg),transparent_0)]"
                  style={{ '--fill': fill } as CSSProperties}
                  aria-hidden="true"
                />
              )}
            </span>
            {bars && <span className="min-w-0 truncate">{name}</span>}
            <span
              className={cn(
                'pointer-events-none font-extrabold tabular-nums text-halo-strong',
                bars
                  ? 'ml-auto'
                  : 'absolute inset-0 grid w-(--icon-size) place-items-center text-[calc(var(--icon-size)*0.34)]',
              )}
            >
              {t ? trackerTime(t, tr, fmt) : ''}
            </span>
            {running.length > 1 && (
              <span className="absolute -right-0.5 -bottom-0.5 rounded-xs bg-shade px-0.75 text-4xs">
                ×{running.length}
              </span>
            )}
          </div>
        );
      })}
    </section>
  );
}

/** Positioned bars for the active preset, drawn at their configured x/y. */
export function TrackerBars({
  settings,
  trackers,
  positions,
  onDragStart,
}: { settings: OfflineSettings | null; trackers: TrackerStatus[] } & Arrange) {
  const progress = useLongest();
  const preset = activePreset(settings);
  if (!preset) return null;
  return (
    <>
      {preset.bars
        // Hidden bars are only drawn while arranging, so they can still be moved.
        .filter((bar) => !bar.hidden || onDragStart)
        .map((bar) => (
          <Bar
            key={bar.id}
            bar={bar}
            trackers={trackers}
            progress={progress}
            {...(positions ? { positions } : {})}
            {...(onDragStart ? { onDragStart } : {})}
          />
        ))}
    </>
  );
}
