import {
  BellRing,
  ChartNoAxesColumn,
  ChevronLeft,
  Compass,
  LockOpen,
  PanelsTopLeft,
  PawPrint,
  Power,
  Timer,
  type LucideIcon,
} from 'lucide-react';
import { Wayseed } from '@/components/wayseed';
import { useI18n } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { Divider } from './primitives';

/** The top menu (frontend/src/features/menu/MenuBar.tsx): one pill that runs every window. */

function Toggle({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span className="flex size-[22px] items-center justify-center rounded-full border border-app-accent-line bg-app-accent-soft text-app-accent">
      <Icon className="size-3" strokeWidth={2} />
    </span>
  );
}

function Plain({
  icon: Icon,
  className,
  dot = false,
}: {
  icon: LucideIcon;
  className?: string;
  dot?: boolean;
}) {
  return (
    <span
      className={cn(
        'relative flex size-[22px] items-center justify-center text-app-ink-2',
        className,
      )}
    >
      <Icon className="size-3" strokeWidth={2} />
      {dot ? (
        <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-app-warn" />
      ) : null}
    </span>
  );
}

export function AppMenuBar({ className, time = '0:24' }: { className?: string; time?: string }) {
  const { m } = useI18n();
  return (
    <div aria-hidden="true" className={cn('w-max max-w-none', className)}>
      <div className="app-halo app-inset flex h-8 w-max items-center gap-1 rounded-full whitespace-nowrap border border-app-line-strong bg-app-surface pr-1.5 pl-3 font-sans text-app-ink">
        <span className="flex items-center gap-1.5 pr-1.5">
          <Wayseed className="size-3.5" />
          <span className="text-2xs">
            <b className="font-bold tracking-wide">AION</b>{' '}
            <span className="text-app-ink-3">{m.app.companion}</span>
          </span>
        </span>
        <span className="flex items-center gap-1.5 pr-1.5">
          <span className="size-1.5 animate-breathe rounded-full bg-app-accent" />
          <b className="figures text-app-xs font-bold text-app-accent">{time}</b>
        </span>
        <Toggle icon={ChartNoAxesColumn} />
        <Toggle icon={PawPrint} />
        <Toggle icon={Timer} />
        <Toggle icon={Compass} />
        <Divider />
        <Plain icon={LockOpen} />
        <Plain icon={BellRing} className="text-app-warn" dot />
        <Plain icon={PanelsTopLeft} />
        <Divider />
        <Plain icon={Power} className="text-app-rose-ink" />
        <Divider />
        <Plain icon={ChevronLeft} />
      </div>
    </div>
  );
}
