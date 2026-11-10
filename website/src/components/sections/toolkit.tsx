import {
  Archive,
  BarChart3,
  Bug,
  Clapperboard,
  Copy,
  EyeOff,
  Languages,
  RefreshCw,
  Scale,
  type LucideIcon,
} from 'lucide-react';
import { useRef } from 'react';
import { AppCaption, AppWindow, CaptionTitle } from '@/components/app/primitives';
import { useI18n } from '@/i18n/context';
import { useCountUp, useSeen } from '@/lib/use-now';

/** Real counts from the app's bundled data (see website/README.md for sources). */
const STATS = [16_899, 207, 73, 2_811, 5_401, 106];

/** One icon per tool, in the order of the dictionary's toolkit.tools. */
const TOOL_ICONS: LucideIcon[] = [
  Scale,
  Clapperboard,
  Copy,
  EyeOff,
  Archive,
  RefreshCw,
  Bug,
  Languages,
];

export function Toolkit() {
  const { m } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref);
  return (
    <section
      aria-labelledby="toolkit-title"
      className="mx-auto grid max-w-7xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[22rem_1fr] lg:gap-20 lg:py-32"
    >
      <div ref={ref} className="lg:sticky lg:top-24 lg:self-start">
        <h2
          id="toolkit-title"
          className="font-display text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-5xl"
        >
          {m.toolkit.title}
        </h2>
        {/* The numbers, as the app would show a character's stats. */}
        <AppWindow className="mt-8">
          <AppCaption>
            <CaptionTitle icon={BarChart3} label={m.toolkit.statsWindow} />
          </AppCaption>
          <dl className="divide-y divide-app-line-soft px-3 py-1">
            {STATS.map((value, i) => (
              <Stat key={i} value={value} label={m.toolkit.stats[i] ?? ''} seen={seen} />
            ))}
          </dl>
        </AppWindow>
      </div>

      <ul className="grid content-start gap-x-12 sm:grid-cols-2">
        {m.toolkit.tools.map(({ title, body }, i) => {
          const Icon = TOOL_ICONS[i] ?? Scale;
          return (
            <li
              key={title}
              className="flex gap-4 border-t border-border py-6 first:border-t-0 sm:nth-2:border-t-0"
            >
              <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-honey" />
              <div>
                <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ value, label, seen }: { value: number; label: string; seen: boolean }) {
  const { fmt } = useI18n();
  const shown = useCountUp(value, seen);
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-app-xs text-app-ink-2">{label}</dt>
      <dd className="figures text-app-sm font-bold text-app-accent">{fmt.integer(shown)}</dd>
    </div>
  );
}
