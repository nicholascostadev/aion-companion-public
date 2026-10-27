import { useRef, type PointerEvent } from 'react';
import { useFormat, useTranslation } from '../../../i18n/provider';
import type { TimeWindow } from '../analysis';
import { Button } from '../../../components/ui/Button';
import { Icon } from '../../../components/ui/Icon';
import { cn } from '../../../lib/cn';

const MIN_SPAN = 500;

export function clampWindow(window: TimeWindow, total: number): TimeWindow {
  const span = Math.min(total, Math.max(MIN_SPAN, window.to - window.from));
  const from = Math.min(Math.max(0, window.from), Math.max(0, total - span));
  return { from, to: from + span };
}

export function zoom(window: TimeWindow, total: number, factor: number, at?: number): TimeWindow {
  const center = at ?? (window.from + window.to) / 2;
  const span = (window.to - window.from) * factor;
  return clampWindow({ from: center - span / 2, to: center + span / 2 }, total);
}

export interface RangeMark {
  at: number;
  kind: 'death' | 'cast' | 'highlight';
  label: string;
}

/**
 * Overview track of the whole fight with the zoomed window highlighted. Drag on
 * the track to select a range, drag the window to pan; the buttons (keyboard
 * accessible) zoom and step.
 */
export function TimeRange({
  total,
  window,
  onChange,
  marks = [],
}: {
  total: number;
  window: TimeWindow;
  onChange: (window: TimeWindow) => void;
  marks?: RangeMark[];
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ mode: 'pan' | 'select'; start: number; origin: TimeWindow } | null>(null);
  const full = window.from <= 0 && window.to >= total;
  const at = (clientX: number) => {
    const rect = track.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return 0;
    return Math.min(total, Math.max(0, ((clientX - rect.left) / rect.width) * total));
  };
  const left = total ? (window.from / total) * 100 : 0;
  const width = total ? ((window.to - window.from) / total) * 100 : 100;

  const onDown = (event: PointerEvent<HTMLDivElement>) => {
    const time = at(event.clientX);
    const inside = time >= window.from && time <= window.to && !full;
    drag.current = { mode: inside ? 'pan' : 'select', start: time, origin: window };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    const time = at(event.clientX);
    if (state.mode === 'pan') {
      const delta = time - state.start;
      onChange(
        clampWindow({ from: state.origin.from + delta, to: state.origin.to + delta }, total),
      );
    } else if (Math.abs(time - state.start) > total * 0.005) {
      onChange(
        clampWindow({ from: Math.min(state.start, time), to: Math.max(state.start, time) }, total),
      );
    }
  };
  const onUp = () => {
    drag.current = null;
  };
  const step = (direction: number) => {
    const span = window.to - window.from;
    onChange(
      clampWindow(
        { from: window.from + direction * span * 0.25, to: window.to + direction * span * 0.25 },
        total,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-ink-2 tabular-nums" aria-live="polite">
          {full ? (
            <>{t(($) => $.range.wholeFightAt, { time: fmt.preciseClock(total) })}</>
          ) : (
            <>
              {fmt.preciseClock(window.from)} – {fmt.preciseClock(window.to)}{' '}
              <small className="text-xs text-ink-3">
                {t(($) => $.range.span, {
                  seconds: fmt
                    .numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 })
                    .format((window.to - window.from) / 1000),
                })}
              </small>
            </>
          )}
        </span>
        <span className="flex items-center gap-0.5">
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t(($) => $.range.stepBack)}
            title={t(($) => $.range.stepBack)}
            disabled={window.from <= 0}
            onClick={() => step(-1)}
          >
            <Icon name="chevronLeft" size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t(($) => $.range.zoomIn)}
            title={t(($) => $.range.zoomIn)}
            disabled={window.to - window.from <= MIN_SPAN}
            onClick={() => onChange(zoom(window, total, 0.5))}
          >
            <Icon name="zoomIn" size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t(($) => $.range.zoomOut)}
            title={t(($) => $.range.zoomOut)}
            disabled={full}
            onClick={() => onChange(zoom(window, total, 2))}
          >
            <Icon name="zoomOut" size={14} />
          </Button>
          <Button
            size="xs"
            variant="ghost"
            iconOnly
            aria-label={t(($) => $.range.stepForward)}
            title={t(($) => $.range.stepForward)}
            disabled={window.to >= total}
            onClick={() => step(1)}
          >
            <Icon name="chevronRight" size={14} />
          </Button>
          <Button
            size="xs"
            className="ml-1"
            disabled={full}
            onClick={() => onChange({ from: 0, to: total })}
          >
            {t(($) => $.range.wholeFight)}
          </Button>
        </span>
      </div>
      <div
        ref={track}
        data-ui="time-range-track"
        className="relative h-7 cursor-crosshair touch-none rounded-full border border-line-soft bg-sunken inset-shadow-well"
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {/* The fight's thread: a faint line the marks hang on. */}
        <span className="absolute inset-x-3 top-1/2 h-px bg-line" />
        {marks.map((mark, i) => (
          <i
            key={`${mark.kind}-${i}`}
            className={cn(
              'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full',
              mark.kind === 'death'
                ? 'z-[1] size-2 bg-danger shadow-[0_0_0_2px_var(--color-sunken)]'
                : 'h-3 w-px bg-ink-4/60',
            )}
            style={{ left: `${(mark.at / Math.max(1, total)) * 100}%` }}
            title={`${mark.label} · ${fmt.preciseClock(mark.at)}`}
          />
        ))}
        <span
          className={cn(
            'absolute inset-y-0.5 cursor-grab rounded-full border border-accent-line bg-accent-soft',
            'transition-[left,width] duration-150 ease-grow active:cursor-grabbing',
            !full && 'shadow-glow',
          )}
          style={{ left: `${left}%`, width: `${width}%` }}
        />
      </div>
    </div>
  );
}
