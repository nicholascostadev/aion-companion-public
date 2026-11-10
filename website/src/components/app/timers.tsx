import { CalendarClock, Lock, RotateCcw, Timer, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useI18n } from '@/i18n/context';
import { useNow } from '@/lib/use-now';
import { AppCaption, AppWindow, CaptionTitle, WinButton } from './primitives';

/**
 * The Timers window (frontend/src/features/timers/Timers.tsx). Hourly events count down on the
 * visitor's clock; the field boss row is the app's demo state.
 */

function nextAtMinute(now: Date, minute: number) {
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setMinutes(minute);
  if (next <= now) next.setHours(next.getHours() + 1);
  return next;
}

/** Global resets: daily 07:00 UTC, weekly on Wednesday (docs/ACTIVITIES.md). */
function nextReset(now: Date, weekly: boolean) {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  if (weekly) while (next.getUTCDay() !== 3) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** The app's countdown: m:ss under an hour, then 1h 11m, then 2d 18h. */
function countdown(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${Math.floor(s / 86_400)}d ${Math.floor((s % 86_400) / 3600)}h`;
}

const hm = (d: Date) =>
  `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

export function AppTimers({
  className,
  compact = false,
}: {
  className?: string;
  compact?: boolean;
}) {
  const now = useNow();
  const { m, fmt } = useI18n();
  const events = now
    ? [
        { name: 'Shugo Festival', at: nextAtMinute(now, 0) },
        { name: 'Dimensional Invasion', at: nextAtMinute(now, 30) },
      ].sort((a, b) => a.at.getTime() - b.at.getTime())
    : [
        { name: 'Shugo Festival', at: null, minute: '00' },
        { name: 'Dimensional Invasion', at: null, minute: '30' },
      ];
  const resets = (['daily', 'weekly'] as const).map((kind) => ({
    kind,
    at: now ? nextReset(now, kind === 'weekly') : null,
  }));

  return (
    <div aria-hidden="true" className={cn('w-full max-w-[300px]', className)}>
      <AppWindow>
        <AppCaption className="gap-1 pl-3">
          <CaptionTitle icon={Timer} label={m.app.timers} />
          <span className="max-w-32 min-w-0 truncate text-2xs text-app-ink-3">
            {m.app.yourClock}
          </span>
          <WinButton icon={Lock} />
          <WinButton icon={X} size={13} />
        </AppCaption>
        <table className="w-full table-fixed border-collapse">
          <colgroup>
            <col />
            <col className="w-12" />
            <col className="w-20" />
          </colgroup>
          <tbody>
            <tr className="h-7 bg-app-accent-soft">
              <th className="max-w-0 truncate py-1 pr-1 pl-3 text-left text-app-xs font-medium">
                Kusan the Mad Gladiator
              </th>
              <td
                colSpan={2}
                className="figures py-1 pr-3 pl-2 text-right text-app-xs font-semibold whitespace-nowrap text-app-success"
              >
                {m.app.alive}
              </td>
            </tr>
            {events.map((e) => (
              <tr key={e.name} className="h-7">
                <th className="max-w-0 truncate py-1 pr-1 pl-3 text-left text-app-xs font-medium">
                  {e.name}
                </th>
                <td className="figures py-1 text-right text-2xs text-app-ink-3">
                  {e.at ? hm(e.at) : 'minute' in e ? `--:${e.minute}` : ''}
                </td>
                <td className="figures py-1 pr-3 pl-2 text-right text-app-xs font-semibold whitespace-nowrap text-app-accent">
                  {e.at && now ? countdown(e.at.getTime() - now.getTime()) : '--:--'}
                </td>
              </tr>
            ))}
            {!compact && (
              <>
                <tr className="h-7">
                  <th className="max-w-0 truncate py-1 pr-1 pl-3 text-left text-app-xs font-medium">
                    Eternal Gartua
                  </th>
                  <td colSpan={2} className="py-1 pr-3 pl-2 text-right text-app-xs text-app-ink-3">
                    {m.app.unknown}
                  </td>
                </tr>
                <tr className="h-7">
                  <th className="max-w-0 truncate py-1 pr-1 pl-3 text-left text-app-xs font-medium">
                    Immortal Gartua
                  </th>
                  <td colSpan={2} className="py-1 pr-3 pl-2 text-right text-app-xs text-app-ink-3">
                    {m.app.unknown}
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
        <footer className="flex-none border-t border-app-line-strong py-1">
          {resets.map((r) => (
            <div key={r.kind} className="flex h-6 items-center gap-2 px-3 text-2xs">
              {r.kind === 'daily' ? (
                <RotateCcw className="size-3 text-app-accent" />
              ) : (
                <CalendarClock className="size-3 text-app-accent" />
              )}
              <span className="min-w-0 flex-1 truncate text-app-xs text-app-ink-2">
                {r.kind === 'daily' ? m.app.dailyReset : m.app.weeklyReset}
              </span>
              <span className="figures text-app-ink-3">
                {r.at ? `${fmt.weekday(r.at)} ${hm(r.at)}` : ''}
              </span>
              <span className="figures min-w-14 text-right font-semibold text-app-accent">
                {r.at && now ? countdown(r.at.getTime() - now.getTime()) : '--'}
              </span>
            </div>
          ))}
        </footer>
      </AppWindow>
    </div>
  );
}
