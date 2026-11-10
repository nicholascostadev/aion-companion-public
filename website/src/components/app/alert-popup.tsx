import { Sparkles, X } from 'lucide-react';
import { useI18n } from '@/i18n/context';
import { cn } from '@/lib/utils';

/**
 * One alert popup card (frontend/src/features/alerts/AlertPopup.tsx): an event either starting
 * now or `minutes` before it starts.
 */
export function AppAlertCard({
  minutes,
  name,
  className,
}: {
  /** Minutes until the event; omitted for "starting now". */
  minutes?: number;
  name: string;
  className?: string;
}) {
  const { m } = useI18n();
  const now = minutes === undefined;
  return (
    <div
      aria-hidden="true"
      className={cn(
        'app-halo app-inset flex w-full max-w-[360px] items-center gap-3 rounded-[12px] border bg-app-shade/95 py-2.5 pr-2.5 pl-3 font-sans text-app-ink',
        now ? 'border-app-accent/70' : 'border-app-accent-line',
        className,
      )}
    >
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-app-jade-ink/30 bg-app-jade-ink/10 text-app-jade-ink">
        <Sparkles className="size-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-3xs font-semibold tracking-[0.08em] text-app-ink-3 uppercase">
          {m.app.event} · {now ? m.app.startingNow : m.app.minBefore(minutes)}
        </span>
        <b className="block truncate text-app-sm font-bold">{name}</b>
      </span>
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-app-surface-3 text-app-ink-2">
        <X className="size-3" />
      </span>
    </div>
  );
}
