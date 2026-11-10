import { useState } from 'react';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import atlas from '@/data/verteron-atlas.json';
import { useI18n } from '@/i18n/context';
import { cn } from '@/lib/utils';

/**
 * Every hidden cube and gathering placement in Verteron, from the app's bundled data, drawn as
 * a star chart. Positions use the app's calibrated map projection; there is no map art here.
 * It is plain SVG (one path of zero-length round-capped strokes per layer), so it is in the
 * static HTML; the twinkle is CSS and the layer toggles need scripts.
 */

const LAYERS = [
  { key: 'cube', color: '--primary', width: 3.4 },
  { key: 'ore', color: '--gather-ore', width: 2.6 },
  { key: 'herb', color: '--gather-herb', width: 2.6 },
  { key: 'gemstone', color: '--gather-gemstone', width: 2.6 },
  { key: 'aether', color: '--gather-aether', width: 2.6 },
  { key: 'food', color: '--gather-food', width: 2.6 },
  { key: 'wood', color: '--gather-wood', width: 2.6 },
] as const;
type LayerKey = (typeof LAYERS)[number]['key'];
const data = atlas as Record<LayerKey, [number, number][]>;

// Fit the chart to where the points are, as a square with a margin.
const ALL = LAYERS.flatMap((l) => data[l.key]);
const X0 = Math.min(...ALL.map((p) => p[0]));
const X1 = Math.max(...ALL.map((p) => p[0]));
const Y0 = Math.min(...ALL.map((p) => p[1]));
const Y1 = Math.max(...ALL.map((p) => p[1]));
const SPAN = Math.max(X1 - X0, Y1 - Y0) * 1.12;
const VIEW = `${(X0 + X1 - SPAN) / 2} ${(Y0 + Y1 - SPAN) / 2} ${SPAN} ${SPAN}`;

const PATHS = Object.fromEntries(
  LAYERS.map((l) => [l.key, data[l.key].map(([x, y]) => `M${x} ${y}h0`).join('')]),
) as Record<LayerKey, string>;

export function AtlasDemo() {
  const { m, fmt } = useI18n();
  const [on, setOn] = useState<LayerKey[]>(LAYERS.map((l) => l.key));

  return (
    <div className="relative">
      <div className="relative mx-auto aspect-square max-w-xl overflow-hidden rounded-full border border-border bg-[radial-gradient(closest-side,oklch(0.22_0.03_70/0.6),transparent)]">
        <span
          aria-hidden="true"
          className="absolute inset-[12%] rounded-full border border-border/60"
        />
        <span
          aria-hidden="true"
          className="absolute inset-[30%] rounded-full border border-border/40"
        />
        <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-px bg-border/50" />
        <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px bg-border/50" />
        <p className="sr-only">{m.app.mapLabel}</p>
        <svg aria-hidden="true" viewBox={VIEW} className="absolute inset-[4%] size-[92%]">
          {LAYERS.map((l, i) => (
            <path
              key={l.key}
              d={PATHS[l.key]}
              fill="none"
              stroke={`var(${l.color})`}
              strokeWidth={l.width}
              strokeLinecap="round"
              className={cn(
                'mix-blend-plus-lighter transition-opacity duration-300 motion-safe:animate-[twinkle_4s_ease-in-out_infinite]',
                !on.includes(l.key) && 'opacity-0',
              )}
              style={{ animationDelay: `${-i * 0.6}s` }}
            />
          ))}
        </svg>
        <span className="absolute top-3 left-1/2 -translate-x-1/2 text-[0.625rem] tracking-[0.3em] text-ink-4">
          {m.app.north}
        </span>
        <span className="absolute bottom-[14%] left-1/2 -translate-x-1/2 font-display text-base font-medium tracking-[0.25em] text-ink-2 uppercase">
          Verteron
        </span>
      </div>

      {/* With scripts the layers can be switched; without, the legend lists them. */}
      <ToggleGroup
        multiple
        aria-label={m.app.layers}
        variant="outline"
        size="sm"
        spacing={1.5}
        value={on}
        onValueChange={(values) =>
          setOn(LAYERS.map((l) => l.key).filter((k) => values.includes(k)))
        }
        className="js-only mx-auto mt-6 flex-wrap justify-center"
      >
        {LAYERS.map((l) => (
          <ToggleGroupItem
            key={l.key}
            value={l.key}
            className="rounded-full border-border px-3 text-xs text-muted-foreground line-through decoration-ink-4 aria-pressed:bg-foreground/10 aria-pressed:text-foreground aria-pressed:no-underline"
          >
            <Swatch color={l.color} />
            {m.app.layer[l.key]}
            <Count n={fmt.integer(data[l.key].length)} />
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <ul
        aria-label={m.app.layers}
        className="no-js-only mx-auto mt-6 flex flex-wrap justify-center gap-x-4 gap-y-2 text-xs text-ink-2"
      >
        {LAYERS.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <Swatch color={l.color} />
            {m.app.layer[l.key]}
            <Count n={fmt.integer(data[l.key].length)} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function Swatch({ color }: { color: string }) {
  return <span className="size-2 rounded-full" style={{ background: `var(${color})` }} />;
}

function Count({ n }: { n: string }) {
  return <span className="figures text-[0.6875rem] text-muted-foreground">{n}</span>;
}
