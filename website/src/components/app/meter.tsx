import {
  Activity,
  History,
  Copy,
  Lock,
  Minimize2,
  Minus,
  Radio,
  RotateCcw,
  Skull,
  UserRoundSearch,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { RAID_PARTY } from '@/data/party';
import run from '@/data/run.json';
import { useI18n } from '@/i18n/context';
import { asset } from '@/lib/site';
import { cn } from '@/lib/utils';
import { AppWindow, ClassGlyph, NameTag, StatusDot, WinButton, clock } from './primitives';
import { classColor } from '@/components/class-emblem';

/**
 * The DPS meter window (frontend/src/features/live/DpsOverlay.tsx), replaying a real clear of
 * Atiel in Deus Research Base from the developer's saved logs (src/data/run.json, made by
 * scripts/extract-run.mjs). Every tick is the party's real damage and the boss's real HP; only the
 * names are fictional (src/data/party.ts). The figure is rolling DPS over the last 4 s and the
 * ranking follows it once a second; the share is the share of the whole fight so far.
 */

const PARTY = RAID_PARTY;
const TICK_MS = run.tick_ms;
const TICKS = run.boss_hp.length;
/** The page opens 24 s into the fight, with the race already on. */
const SNAPSHOT_TICKS = Math.round(24_000 / TICK_MS);
/** Each replay starts a few seconds in, so the rolling figures have something to show. */
const RESTART_TICKS = Math.round(4_000 / TICK_MS);
/** Rolling DPS window: the last 4 s. */
const WINDOW = 16;
/** The ranking settles once a second, so each overtake reads as one clear move. */
const RANK_EVERY = 4;
/** The kill estimate uses the boss's HP drop over the last 20 s, as the app does. */
const KILL_WINDOW = Math.round(20_000 / TICK_MS);
const CLEARED_PAUSE_MS = 3600;
const ROW = 35;
const PITCH = ROW + 2;

/** Damage by player up to (not including) tick t, and over the rolling window before it. */
const CUMULATIVE = run.damage.map((ticks) => {
  const sums = [0];
  for (const d of ticks) sums.push(sums[sums.length - 1]! + d);
  return sums;
});
const upTo = (i: number, t: number) => CUMULATIVE[i]![Math.min(t, TICKS)]!;
const rollingAt = (i: number, t: number) => {
  const from = Math.max(0, t - WINDOW);
  return (upTo(i, t) - upTo(i, from)) / ((t - from || 1) * (TICK_MS / 1000));
};
const rankAt = (t: number) =>
  PARTY.map((_, i) => ({ dps: rollingAt(i, t), i }))
    .sort((a, b) => b.dps - a.dps)
    .map(({ i }) => i);
const hpAt = (t: number) => run.boss_hp[Math.min(TICKS - 1, Math.max(0, t - 1))] ?? 0;

/** `t` is the replay tick; `shown` is the tick the rows were last ranked at, so the figures
 * and the order always agree (both settle once a second). */
type Fight = { t: number; shown: number; order: number[] };
const at = (t: number): Fight => ({ t, shown: t, order: rankAt(t) });
const INITIAL = at(SNAPSHOT_TICKS);
const ME = PARTY.find((p) => p.me) ?? PARTY[0]!;

export function AppMeter({
  className,
  locked = true,
  onClock,
}: {
  className?: string;
  locked?: boolean;
  /** Reports the fight's elapsed seconds, so the top menu can show the same timer. */
  onClock?: (seconds: number) => void;
}) {
  const [fight, setFight] = useState<Fight>(INITIAL);
  const root = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const observer = new IntersectionObserver(([e]) => setVisible(e?.isIntersecting ?? true));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const cleared = fight.t >= TICKS;
  useEffect(() => {
    if (!visible) return;
    if (cleared) {
      const restart = window.setTimeout(() => setFight(at(RESTART_TICKS)), CLEARED_PAUSE_MS);
      return () => window.clearTimeout(restart);
    }
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      setFight((f) => {
        if (f.t >= TICKS) return f;
        const t = f.t + 1;
        return t % RANK_EVERY === 0 || t >= TICKS ? at(t) : { ...f, t };
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [visible, cleared]);

  const { m: t, fmt } = useI18n();
  const seconds = (Math.min(fight.t, TICKS) * TICK_MS) / 1000;
  useEffect(() => {
    onClock?.(seconds);
  }, [onClock, seconds]);
  const totals = PARTY.map((_, i) => upTo(i, fight.shown));
  const dealt = totals.reduce((a, b) => a + b, 0);
  const hpNow = cleared ? 0 : hpAt(fight.t);
  const hp = Math.max(0, hpNow / run.boss_hp_max);
  const dps = PARTY.map((_, i) => rollingAt(i, fight.shown));
  const top = Math.max(...dps, 1);
  const order = fight.order;
  const live = !cleared;
  const span = Math.min(KILL_WINDOW, fight.t);
  const drop = span > 0 ? (hpAt(fight.t - span) - hpNow) / ((span * TICK_MS) / 1000) : 0;
  const killIn = live && drop > 0 ? hpNow / drop : null;
  const deathsBy = (i: number) =>
    run.deaths.filter((d) => d.player === i && d.at_ms <= fight.t * TICK_MS).length;

  return (
    <div ref={root} aria-hidden="true" className={cn('w-full max-w-[380px]', className)}>
      <AppWindow deep className={cn(!locked && 'border-app-accent-line')}>
        {/* Caption */}
        <header className="relative flex h-7 flex-none items-center gap-1.5 border-b border-app-line-soft bg-app-sunken/40 pr-1 pl-2">
          <StatusDot live={live} />
          <span className="flex min-w-0 shrink-[4] items-baseline gap-1.5">
            <b className="min-w-0 truncate text-app-xs font-semibold text-app-ink-2">
              {t.app.damageDealt}
            </b>
            <span
              className={cn(
                'figures shrink-0 text-2xs font-semibold',
                live ? 'text-app-ink' : 'text-app-ink-2',
              )}
            >
              {clock(seconds)}
            </span>
          </span>
          <span className="ml-auto flex shrink-0">
            <WinButton icon={Activity} className="size-5" />
            <WinButton icon={History} className="size-5" />
            <WinButton icon={Copy} className="size-5" />
            <WinButton icon={RotateCcw} className="size-5" />
          </span>
          {!locked && (
            <span className="flex shrink-0 border-l border-app-line-soft pl-0.5">
              <WinButton icon={Minimize2} className="size-5" />
              <WinButton icon={Minus} className="size-5" />
            </span>
          )}
        </header>

        {/* Boss status */}
        <section className="mx-1.5 mt-1">
          <div className="relative isolate flex min-h-[18px] items-center gap-1.5 overflow-hidden rounded-[6px] border border-app-rose/45 bg-app-shade/50 px-1.5">
            <span
              className="absolute inset-0 -z-10 origin-left bg-app-rose/40 transition-transform duration-300 ease-out will-change-transform"
              style={{ transform: `scaleX(${hp})` }}
            />
            <span className="flex min-w-0 flex-1 items-baseline gap-1.5">
              <span className="shrink-0 text-4xs font-semibold tracking-wide text-app-rose-ink uppercase">
                {t.app.boss}
              </span>
              <b className="min-w-0 flex-1 truncate text-app-xs font-bold text-app-ink">
                {run.boss}
              </b>
              <b
                className={cn(
                  'figures shrink-0 text-app-xs font-bold',
                  live ? 'text-app-ink' : 'text-app-ink-2',
                )}
              >
                {live ? fmt.pct(hp) : t.app.defeated}
              </b>
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 px-1 text-3xs whitespace-nowrap text-app-ink-3">
            <span className="inline-flex items-baseline gap-1.25">
              {t.app.kill}{' '}
              <b className="figures text-app-ink">
                {live ? (killIn === null ? '—' : clock(killIn)) : t.app.done}
              </b>
            </span>
            {/* Atiel has no rage timer in the catalogue, so, like the app, none is shown. */}
            {run.berserk_seconds ? (
              <span className="inline-flex items-baseline gap-1.25">
                {t.app.rage}{' '}
                <b className="figures text-app-success">
                  {clock(Math.max(0, run.berserk_seconds - seconds))}
                </b>
              </span>
            ) : null}
          </div>
        </section>

        {/* Ranking */}
        <div className="relative overflow-hidden" style={{ height: PARTY.length * PITCH + 6 }}>
          <ol className="relative m-0 px-1.5 pt-1">
            {PARTY.map((m, i) => {
              const total = totals[i] ?? 0;
              const deaths = deathsBy(i);
              const now = dps[i] ?? 0;
              const rank = order.indexOf(i);
              return (
                <li
                  key={m.name}
                  className="absolute inset-x-1.5 transition-transform duration-500 ease-[cubic-bezier(0.2,0.7,0.2,1)] will-change-transform"
                  style={{ top: 4, transform: `translateY(${rank * PITCH}px)` }}
                >
                  <div
                    className="relative isolate flex items-center gap-1.5 overflow-hidden rounded-[6px] bg-app-row py-0.5 pr-[7px] pl-[5px] leading-tight"
                    style={{ height: ROW, ['--mark' as string]: classColor(m.cls) }}
                  >
                    <span
                      className={cn(
                        'absolute inset-0 -z-10 origin-left transition-transform duration-300 ease-out will-change-transform',
                        rank === 0 ? 'app-mark-fade-35' : 'app-mark-fade-25',
                      )}
                      style={{ transform: `scaleX(${Math.min(1, now / top)})` }}
                    />
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="flex size-5.5 shrink-0 items-center justify-center">
                        <ClassGlyph name={m.cls} size={22} />
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="flex min-w-0 items-center gap-1 text-app-xs font-semibold">
                          <span className="min-w-0 truncate">{m.name}</span>
                          {m.me ? (
                            <NameTag className="border-app-accent-line text-app-accent">
                              {t.app.me}
                            </NameTag>
                          ) : null}
                          <UserRoundSearch className="size-[11px] shrink-0 text-app-ink-3" />
                          {deaths > 0 ? (
                            <NameTag className="border-app-danger-line text-app-danger">
                              <Skull className="size-[9px]" />
                              {deaths}
                            </NameTag>
                          ) : null}
                        </span>
                        <span className="figures text-3xs font-semibold text-app-ink-2">
                          {fmt.compact(m.cp)}{' '}
                          <span className="text-4xs text-app-ink-3">{t.app.cp}</span>
                        </span>
                      </span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end">
                      <span className="figures text-app-sm leading-4 font-bold text-app-ink">
                        {fmt.compact(Math.round(now))}
                      </span>
                      <span className="figures text-3xs text-app-ink-3">
                        {fmt.pct(dealt > 0 ? total / dealt : 0)}
                      </span>
                    </span>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Footer */}
        <footer className="flex min-h-5.5 flex-none items-center gap-2 border-t border-app-line-soft bg-app-sunken/40 py-px pr-1.5 pl-2 text-3xs">
          <span className="inline-flex max-w-28 min-w-0 shrink items-center gap-1 font-semibold text-app-ink-2">
            <ClassGlyph name={ME.cls} size={14} />
            <span className="truncate">{ME.name}</span>
          </span>
          <span className="figures inline-flex shrink-0 items-center gap-1 text-2xs whitespace-nowrap">
            <img
              src={asset('art/resource/odyle.webp')}
              alt=""
              width={13}
              height={13}
              className="size-[13px] object-contain"
            />
            <b className="font-bold text-app-ink">15</b>
            <span className="font-semibold text-app-jade-ink">(+275)</span>
          </span>
          <span className="min-w-0 flex-1" />
          <span
            className={cn(
              'inline-flex min-w-0 shrink items-center gap-1',
              live ? 'text-app-ink-2' : 'text-app-ink-3',
            )}
          >
            <Radio className={cn('size-[11px]', live && 'text-app-accent')} />
            <span className="truncate">
              {live ? t.app.liveSince(fmt.time(22, 50)) : t.app.savedToLogs}
            </span>
          </span>
          <Lock className="size-[11px] shrink-0 text-app-ink-3" />
        </footer>
      </AppWindow>
    </div>
  );
}
