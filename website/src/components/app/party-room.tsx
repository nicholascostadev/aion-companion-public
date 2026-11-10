import { ChevronDown, CircleCheck, CircleMinus, Crown, Minus } from 'lucide-react';
import { classColor } from '@/components/class-emblem';
import { AVERAGE_CP, RAID_PARTY } from '@/data/party';
import { useI18n } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { AppWindow, ClassGlyph, CountChip, StatusDot, WinButton } from './primitives';

/**
 * The meter's party room before a run (frontend/src/features/live/PreparationView.tsx), with
 * the page's demo raid party (src/data/party.ts).
 */

const MEMBERS = RAID_PARTY;

export function AppPartyRoom({ className }: { className?: string }) {
  const { m: t, fmt } = useI18n();
  const ready = MEMBERS.filter((p) => p.ready).length;
  return (
    <div aria-hidden="true" className={cn('w-full max-w-[400px]', className)}>
      <AppWindow deep>
        <header className="flex h-7 flex-none items-center gap-1.5 border-b border-app-line-soft bg-app-sunken/40 pr-1 pl-2">
          <StatusDot />
          <span className="flex items-center rounded-full border border-app-line p-px text-2xs font-semibold">
            <span className="rounded-full border border-app-accent-line bg-app-accent-soft px-2 text-app-accent">
              {t.app.group}
            </span>
            <span className="px-2 text-app-ink-3">{t.app.dps}</span>
          </span>
          <span className="figures text-2xs font-semibold">5/5</span>
          <span className="text-3xs font-semibold tracking-[0.08em] text-app-ink-3 uppercase">
            {t.app.preparing}
          </span>
          <span className="ml-auto text-2xs font-semibold text-app-warn">{t.app.ready(ready)}</span>
          <span className="flex shrink-0 border-l border-app-line-soft pl-0.5">
            <WinButton icon={Minus} className="size-5" />
          </span>
        </header>
        <div className="px-2 pt-1.5">
          <p className="truncate text-app-sm font-semibold">{t.app.dungeon}</p>
          <p className="text-2xs text-app-ink-3">{t.app.readiness}</p>
        </div>
        <ol className="space-y-0.5 px-1.5 pt-1.5">
          {MEMBERS.map((m) => (
            <li
              key={m.name}
              className="app-mark-fade-25 relative flex min-h-[34px] items-center gap-1.5 overflow-hidden rounded-[6px] bg-app-row py-0.5 pr-[7px] pl-[5px] leading-tight"
              style={{ ['--mark' as string]: classColor(m.cls) }}
            >
              <span className="flex size-5.5 shrink-0 items-center justify-center">
                <ClassGlyph name={m.cls} size={22} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-center gap-1 text-app-xs font-semibold">
                  {m.name}
                  {m.leader ? <Crown className="size-3 text-app-accent" /> : null}
                </span>
                <span className="truncate text-3xs text-app-ink-3">
                  <b className="font-semibold text-app-ink-2">{m.cls}</b> ·{' '}
                  {t.app.gsLevel(fmt.integer(m.gs), m.level)}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <span className="figures text-app-sm leading-4 font-bold">{fmt.integer(m.cp)}</span>
                <span className="text-4xs font-semibold text-app-ink-3">{t.app.cp}</span>
              </span>
              {m.ready ? (
                <CircleCheck className="size-4 shrink-0 fill-app-success text-app-surface" />
              ) : (
                <CircleMinus className="size-4 shrink-0 text-app-warn" />
              )}
            </li>
          ))}
        </ol>
        <div className="flex items-center gap-2 px-2.5 pt-2 pb-2 text-2xs text-app-ink-3">
          <span>{t.app.inspected}</span>
          <CountChip>2</CountChip>
          <ChevronDown className="ml-auto size-3" />
          <span>{t.app.findCompare}</span>
        </div>
        <footer className="flex min-h-5.5 flex-none items-center gap-2 border-t border-app-line-soft bg-app-sunken/40 py-px pr-2 pl-2 text-3xs">
          <span className="text-app-ink-2">{t.app.live}</span>
          <span className="ml-auto text-app-ink-3">
            {t.app.average}{' '}
            <b className="figures text-2xs font-bold text-app-ink">{fmt.integer(AVERAGE_CP)}</b>{' '}
            {t.app.cp}
          </span>
        </footer>
      </AppWindow>
    </div>
  );
}
