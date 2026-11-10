import { Pause, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useI18n } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { AppWindow } from './primitives';

/** The damage details window's chrome (frontend/src/features/live/DamageDetails.tsx). */

export function AppDetailsFrame({
  player,
  tab,
  children,
  className,
}: {
  player: string;
  /** Index of the selected tab (Rotation is 6). */
  tab: number;
  children: ReactNode;
  className?: string;
}) {
  const { m } = useI18n();
  return (
    <div aria-hidden="true" className={cn('w-full max-w-[540px]', className)}>
      <AppWindow deep>
        <header className="flex h-9 flex-none items-center gap-2 border-b border-app-line-soft bg-app-sunken/40 pr-1.5 pl-3">
          <b className="text-2xs font-semibold tracking-[0.08em] text-app-ink-2 uppercase">
            {m.app.detailsTitle}
          </b>
          <b className="text-app-xs font-semibold">{player}</b>
          <span className="ml-auto flex items-center gap-1 text-2xs font-semibold tracking-[0.08em] text-app-accent uppercase">
            <span className="size-1.5 animate-breathe rounded-full bg-app-accent" />
            {m.app.live}
          </span>
          <span className="flex h-5.5 items-center gap-1 rounded-full border border-app-accent-line bg-app-accent-soft px-2 text-2xs text-app-accent">
            <Pause className="size-3" />
            {m.app.pause}
          </span>
          <span className="flex size-6 items-center justify-center text-app-ink-3">
            <X className="size-3.5" />
          </span>
        </header>
        <div className="px-3 pt-3">
          <p className="text-app-sm font-semibold">{m.app.encounter}</p>
          <p className="figures mt-0.5 text-2xs text-app-ink-3">{m.app.encounterMeta('1:02')}</p>
        </div>
        <nav className="mt-2 flex gap-4 overflow-hidden border-b border-app-line-soft px-3 text-app-xs whitespace-nowrap [mask-image:linear-gradient(to_right,black_88%,transparent)]">
          {m.app.tabs.map((t, i) => (
            <span
              key={t}
              className={cn(
                'relative py-2',
                i === tab ? 'font-semibold text-app-ink' : 'text-app-ink-3',
              )}
            >
              {t}
              {i === tab ? (
                <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-app-accent" />
              ) : null}
            </span>
          ))}
        </nav>
        {children}
      </AppWindow>
    </div>
  );
}
