import { useMemo, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { clock } from '../../../i18n/formatters';
import { useFormat, useTranslation } from '../../../i18n/provider';
import { cn } from '../../../lib/cn';
import type { TimeWindow } from '../analysis';

export interface Point {
  t: number;
  v: number;
}

export interface ChartMarker {
  at: number;
  label: string;
  kind: 'death' | 'revive' | 'cast' | 'selected';
}

/* Plot coordinates: x spans 0…W, y spans the pixel height; labels live outside in HTML. */
const W = 1000;
const PAD = { top: 10, bottom: 4 };

const MARKER_CLASSES: Record<ChartMarker['kind'], string> = {
  death: 'stroke-danger',
  revive: 'stroke-success',
  cast: 'stroke-ink-4',
  selected: 'stroke-warn [stroke-dasharray:3_3]',
};

function niceTicks(max: number, count = 4) {
  if (max <= 0) return [0];
  const raw = max / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  return ticks;
}

function timeTicks(window: TimeWindow) {
  const span = window.to - window.from;
  const step =
    [500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000].find(
      (s) => span / s <= 8,
    ) ?? 600_000;
  const ticks: number[] = [];
  for (let t = Math.ceil(window.from / step) * step; t <= window.to; t += step) ticks.push(t);
  return ticks;
}

/**
 * Monotone cubic path (Fritsch–Carlson): a curve that bends like a stem between samples
 * but never overshoots them, so peaks and troughs stay honest.
 */
function smoothPath(points: [number, number][]) {
  const n = points.length;
  if (n < 3) return points.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    dx.push(x1 - x0);
    slope.push(x1 === x0 ? 0 : (y1 - y0) / (x1 - x0));
  }
  const tangent = [slope[0]!];
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1]!;
    const b = slope[i]!;
    tangent.push(
      a * b <= 0
        ? 0
        : (3 * (dx[i - 1]! + dx[i]!)) /
            ((2 * dx[i]! + dx[i - 1]!) / a + (dx[i]! + 2 * dx[i - 1]!) / b),
    );
  }
  tangent.push(slope[n - 2]!);
  let d = `M${points[0]![0]},${points[0]![1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i]!;
    const [x1, y1] = points[i + 1]!;
    const h = dx[i]! / 3;
    d += `C${x0 + h},${y0 + tangent[i]! * h} ${x1 - h},${y1 - tangent[i + 1]! * h} ${x1},${y1}`;
  }
  return d;
}

/**
 * Single-series line over time with a crosshair tooltip. One y-axis only; a second
 * measure belongs in its own chart. The area beneath fades into the ground like light
 * through leaves.
 */
export function LineChart({
  points,
  window,
  color,
  label,
  height = 160,
  yMax,
  formatValue,
  markers = [],
  step = false,
  footer,
}: {
  points: Point[];
  window: TimeWindow;
  color: string;
  label: string;
  height?: number;
  yMax?: number;
  formatValue?: (value: number) => string;
  markers?: ChartMarker[];
  /** Hold each value until the next sample (HP), instead of interpolating. */
  step?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const format = formatValue ?? ((v: number) => fmt.compact.format(v));
  const svg = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Point | null>(null);
  const visible = useMemo(() => {
    const inside = points.filter((p) => p.t >= window.from && p.t <= window.to);
    // Carry the last value before the window so the curve starts at the edge.
    const before = [...points].reverse().find((p) => p.t < window.from);
    return before ? [{ t: window.from, v: before.v }, ...inside] : inside;
  }, [points, window]);
  const max = yMax ?? Math.max(1, ...visible.map((p) => p.v));
  const ticks = niceTicks(max);
  const top = Math.max(max, ticks.at(-1) ?? max);
  const plotH = height - PAD.top - PAD.bottom;
  const span = Math.max(1, window.to - window.from);
  const x = (t: number) => ((t - window.from) / span) * W;
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;

  const path = step
    ? visible.map((p, i) => (i ? `H${x(p.t)}V${y(p.v)}` : `M${x(p.t)},${y(p.v)}`)).join('')
    : smoothPath(visible.map((p) => [x(p.t), y(p.v)]));
  const last = visible.at(-1);
  const area = last && visible[0] ? `${path}V${y(0)}H${x(visible[0].t)}Z` : '';

  const nearest = (clientX: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || !visible.length) return null;
    const at = window.from + ((clientX - rect.left) / rect.width) * span;
    let best = visible[0]!;
    for (const p of visible) if (Math.abs(p.t - at) < Math.abs(best.t - at)) best = p;
    return best;
  };
  const onMove = (event: PointerEvent) => setHover(nearest(event.clientX));
  const percentX = (t: number) => `${(x(t) / W) * 100}%`;

  return (
    <figure className="m-0">
      <figcaption className="sr-only">{label}</figcaption>
      <div className="flex">
        {/* Value axis: HTML labels, so text never stretches with the plot. */}
        <div className="relative w-11 shrink-0" style={{ height }} aria-hidden="true">
          {ticks.map((tick) => (
            <span
              key={tick}
              className="absolute right-2.5 -translate-y-1/2 text-2xs text-ink-4 tabular-nums"
              style={{ top: y(tick) }}
            >
              {format(tick)}
            </span>
          ))}
        </div>
        <div className="relative min-w-0 flex-1">
          <svg
            ref={svg}
            viewBox={`0 0 ${W} ${height}`}
            preserveAspectRatio="none"
            className="block w-full overflow-visible"
            style={{ height }}
            aria-hidden="true"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          >
            {ticks.map((tick) => (
              <line
                key={tick}
                className={cn(
                  'stroke-line-soft [vector-effect:non-scaling-stroke]',
                  tick > 0 && '[stroke-dasharray:2_4]',
                )}
                x1={0}
                x2={W}
                y1={y(tick)}
                y2={y(tick)}
              />
            ))}
            {markers
              .filter((m) => m.at >= window.from && m.at <= window.to)
              .map((m, i) => (
                <line
                  key={`${m.kind}-${i}`}
                  className={cn(
                    'stroke-[1.5] [vector-effect:non-scaling-stroke]',
                    MARKER_CLASSES[m.kind],
                  )}
                  x1={x(m.at)}
                  x2={x(m.at)}
                  y1={PAD.top}
                  y2={PAD.top + plotH}
                >
                  <title>
                    {m.label} · {fmt.preciseClock(m.at)}
                  </title>
                </line>
              ))}
            {area && <path d={area} fill={color} fillOpacity={0.12} />}
            {path && (
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {hover && (
              <line
                className="stroke-ink-3 [stroke-dasharray:2_3] [vector-effect:non-scaling-stroke]"
                x1={x(hover.t)}
                x2={x(hover.t)}
                y1={PAD.top}
                y2={PAD.top + plotH}
              />
            )}
          </svg>
          {/* Point marks are HTML so they stay round on a stretched plot. */}
          {last && !hover && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-sunken"
              style={{ left: percentX(last.t), top: y(last.v), background: color }}
            />
          )}
          {hover && (
            <>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-ink"
                style={{ left: percentX(hover.t), top: y(hover.v), background: color }}
              />
              <output
                className="pointer-events-none absolute top-0 z-[1] flex min-w-15 -translate-x-1/2 items-center gap-1.5 rounded-full border border-line-strong bg-veil px-2.5 py-1 text-2xs whitespace-nowrap text-ink-2 shadow-3 backdrop-blur-sm"
                // Kept inside the plot so it never covers the chart's heading or spills out.
                style={{ left: `clamp(4.5rem, ${percentX(hover.t)}, calc(100% - 4.5rem))` }}
              >
                <i
                  className="h-0.5 w-2 rounded-full"
                  style={{ background: color }}
                  aria-hidden="true"
                />
                <b className="font-semibold text-ink tabular-nums">{format(hover.v)}</b>{' '}
                {t(($) => $.chart.atTime, { time: fmt.preciseClock(hover.t) })}
              </output>
            </>
          )}
          {!visible.length && (
            <div className="absolute inset-0 grid place-items-center text-xs text-ink-3">
              {t(($) => $.chart.noSamples)}
            </div>
          )}
          {/* Time axis. */}
          <div className="relative h-5" aria-hidden="true">
            {timeTicks(window).map((tick) => (
              <span
                key={tick}
                className="absolute top-1 -translate-x-1/2 text-2xs text-ink-4 tabular-nums"
                style={{ left: percentX(tick) }}
              >
                {clock(tick)}
              </span>
            ))}
          </div>
        </div>
      </div>
      {footer}
    </figure>
  );
}
