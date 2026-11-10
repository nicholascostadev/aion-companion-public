import { useEffect, useRef, useState } from 'react';
import { AppDetailsFrame } from '@/components/app/details-frame';
import game from '@/data/game.json';
import { useI18n } from '@/i18n/context';
import { asset } from '@/lib/site';
import { useSeen } from '@/lib/use-now';
import { cn } from '@/lib/utils';

const SPAN = 30; // seconds shown
const LOOP_MS = 9000;
const STEP_MS = 100;

/** A demo opener: [time in seconds, index into the Ranger skills, hits, crits]. */
const CASTS: [number, number, number, number][] = [
  [0.8, 0, 1, 1],
  [2.4, 1, 6, 2],
  [4.6, 2, 3, 1],
  [6.4, 3, 1, 1],
  [8.4, 4, 4, 2],
  [10.4, 5, 2, 0],
  [12.4, 6, 5, 3],
  [14.4, 0, 1, 0],
  [16.3, 1, 6, 1],
  [18.3, 7, 1, 0],
  [20.3, 2, 3, 2],
  [22.2, 3, 1, 1],
  [24.2, 4, 4, 1],
  [26.4, 6, 5, 2],
  [28.6, 0, 1, 1],
];

const HP = Array.from({ length: 31 }, (_, i) => 100 - i * 1.25 - Math.sin(i * 0.7) * 1.2);

export function RotationDemo() {
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeen(ref, '0px');
  const [t, setT] = useState(SPAN * 0.62);
  const phase = useRef(t);

  const [onScreen, setOnScreen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(([e]) => setOnScreen(e?.isIntersecting ?? false));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Ten steps a second: the playhead glides between them on a linear transition, so the
  // window re-renders rarely instead of every frame. Paused while off screen.
  useEffect(() => {
    if (!seen || !onScreen || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    const start = performance.now() - (phase.current / SPAN) * LOOP_MS;
    const id = window.setInterval(() => {
      const next = (((performance.now() - start) % LOOP_MS) / LOOP_MS) * SPAN;
      phase.current = next;
      setT(next);
    }, STEP_MS);
    return () => window.clearInterval(id);
  }, [seen, onScreen]);

  const { m, fmt } = useI18n();
  const current = CASTS.filter(([at]) => at <= t).at(-1) ?? CASTS[0]!;
  const skill = game.skills[current[1]]!;
  const hpAt = HP[Math.min(HP.length - 1, Math.floor(current[0]))]!;
  const x = (s: number) => `${(s / SPAN) * 100}%`;

  return (
    <div ref={ref}>
      <AppDetailsFrame player="Lyrienne" tab={6} className="mx-auto">
        <div className="space-y-2.5 px-3 pt-3 pb-3">
          <div className="flex items-center justify-between text-2xs text-app-ink-3">
            <span>
              <b className="font-semibold text-app-ink-2">{m.app.opener}</b> · {m.app.first30}
            </span>
            <span className="figures text-app-ink-2">{t.toFixed(1)} s</span>
          </div>

          <div className="relative space-y-2 rounded-[9px] border border-app-line-soft bg-app-sunken p-2">
            <div className="relative h-10">
              <svg
                viewBox="0 0 300 50"
                preserveAspectRatio="none"
                className="absolute inset-0 size-full"
              >
                <polyline
                  points={HP.map((v, i) => `${i * 10},${50 - (v - 55) * 1.05}`).join(' ')}
                  fill="none"
                  stroke="var(--color-app-rose)"
                  strokeWidth="1.5"
                  vectorEffect="non-scaling-stroke"
                />
              </svg>
              <span className="absolute top-0 right-0 text-4xs font-semibold tracking-wide text-app-rose-ink uppercase">
                {m.app.targetHp}
              </span>
            </div>
            <div className="relative h-7">
              {CASTS.map(([at, idx], i) => (
                <img
                  key={i}
                  src={asset(`art/skill/${game.skills[idx]!.key}.webp`)}
                  alt=""
                  width={128}
                  height={128}
                  className={cn(
                    'absolute top-1/2 size-[22px] -translate-1/2 rounded-[4px] ring-1 ring-app-line transition-[opacity,filter] duration-300',
                    at <= t ? 'opacity-100' : 'opacity-35 grayscale',
                  )}
                  style={{ left: x(at) }}
                />
              ))}
            </div>
            {[
              {
                label: m.app.buffsSelf,
                spans: [
                  [0, 11],
                  [14, 25],
                ],
              },
              { label: m.app.partyBuffs, spans: [[2, 20]] },
            ].map((lane) => (
              // The label has its own line above the lane, so it never depends on where the
              // buff windows fall.
              <div key={lane.label}>
                <span className="block text-4xs leading-3 text-app-ink-2">{lane.label}</span>
                <div className="relative mt-0.5 h-2 rounded-[3px] bg-app-ink/5">
                  {lane.spans.map(([a, b]) => (
                    <span
                      key={a}
                      className="absolute inset-y-0 rounded-[3px] border border-app-jade-ink/40 bg-app-jade-ink/25"
                      style={{ left: x(a!), width: x(b! - a!) }}
                    />
                  ))}
                </div>
              </div>
            ))}
            <span className="pointer-events-none absolute inset-2">
              <span
                className={cn(
                  'absolute inset-0 will-change-transform',
                  // Glide forward between steps; jump straight back when the loop restarts.
                  t > 0.4 && 'transition-transform duration-100 ease-linear',
                )}
                style={{ transform: `translateX(${(t / SPAN) * 100}%)` }}
              >
                <span className="absolute inset-y-0 left-0 w-px bg-app-accent" />
              </span>
            </span>
          </div>

          <div className="figures flex justify-between px-1 text-4xs text-app-ink-4">
            {[0, 5, 10, 15, 20, 25, 30].map((s) => (
              <span key={s}>{s}s</span>
            ))}
          </div>

          <div className="flex items-center gap-2.5 rounded-[9px] border border-app-line bg-app-surface-2 px-2.5 py-2">
            <img
              src={asset(`art/skill/${skill.key}.webp`)}
              alt=""
              width={128}
              height={128}
              className="size-8 rounded-[6px] ring-1 ring-app-accent-line"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-app-xs font-semibold">{skill.name}</p>
              <p className="figures text-3xs text-app-ink-3">
                {m.app.castAt(current[0].toFixed(1), fmt.pct(hpAt / 100, 0))}
              </p>
            </div>
            <dl className="figures grid grid-cols-2 gap-x-3 text-right text-3xs">
              <dt className="text-app-ink-3">{m.app.hits}</dt>
              <dd className="font-bold">{current[2]}</dd>
              <dt className="text-app-ink-3">{m.app.crits}</dt>
              <dd className="font-bold text-app-accent">{current[3]}</dd>
            </dl>
          </div>
        </div>
      </AppDetailsFrame>
    </div>
  );
}
