import type { LucideIcon } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { classColor, type ClassName } from '@/components/class-emblem';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { asset } from '@/lib/site';
import { cn } from '@/lib/utils';

/*
 * Faithful copies of the app's in-game window chrome (frontend/src/components/ui/Overlay.tsx),
 * drawn with the app's own tokens (`app-*` in styles.css). They are pictures of the app for the
 * landing page: no controls here do anything, so they are hidden from assistive technology by
 * the demos that use them.
 */

/** The sheet every in-game window is drawn on. `deep` is solid (the DPS meter, details). */
export function AppWindow({
  deep = false,
  className,
  style,
  children,
}: {
  deep?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        'app-halo app-inset relative flex flex-col overflow-hidden rounded-[12px] border border-app-line-strong font-sans text-2xs leading-snug text-app-ink select-none',
        deep ? 'bg-app-surface' : 'bg-app-glass',
        className,
      )}
      style={style}
    >
      {children}
    </section>
  );
}

/** A window's title row. */
export function AppCaption({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <header
      className={cn(
        'flex h-8 flex-none items-center gap-2 border-b border-app-line-soft bg-app-sunken/40 pr-1 pl-3',
        className,
      )}
    >
      {children}
    </header>
  );
}

/** A window's name: its glyph lit with the accent, then a caps label. */
export function CaptionTitle({ icon: Icon, label }: { icon?: LucideIcon; label: string }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2">
      {Icon ? <Icon className="size-[13px] shrink-0 text-app-accent" strokeWidth={2} /> : null}
      <b className="min-w-0 truncate text-2xs font-semibold tracking-[0.08em] text-app-ink uppercase">
        {label}
      </b>
    </span>
  );
}

/** A caption's quiet icon button. */
export function WinButton({
  icon: Icon,
  size = 12,
  className,
}: {
  icon: LucideIcon;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex size-6 items-center justify-center rounded-[6px] text-app-ink-3',
        className,
      )}
    >
      <Icon style={{ width: size, height: size }} strokeWidth={2} />
    </span>
  );
}

/** The small light beside a live state; `live` breathes. */
export function StatusDot({ live = true, className }: { live?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-block size-1.5 rounded-full',
        live ? 'animate-breathe bg-app-accent' : 'bg-app-ink-3',
        className,
      )}
    />
  );
}

/** Original class emblem filled with the class's meter colour, as the app's `solid` ClassIcon. */
export function ClassGlyph({ name, size }: { name: ClassName; size: number }) {
  const url = `url(${asset(`art/class/${name.toLowerCase()}.webp`)})`;
  return (
    <span
      className="pointer-events-none inline-block shrink-0 align-middle"
      style={{
        width: size,
        height: size,
        background: classColor(name),
        maskImage: url,
        WebkitMaskImage: url,
        maskSize: 'contain',
        WebkitMaskSize: 'contain',
        maskPosition: 'center',
        WebkitMaskPosition: 'center',
        maskRepeat: 'no-repeat',
        WebkitMaskRepeat: 'no-repeat',
      }}
    />
  );
}

/** A small boxed tag beside a row's name (ME): shadcn's Badge in the app's tag size. */
export function NameTag({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'figures h-3.5 gap-0.5 rounded-[3px] px-1 py-0 text-4xs leading-none font-semibold',
        className,
      )}
    >
      {children}
    </Badge>
  );
}

/** A small count pill (0 s, 2): shadcn's Badge on the app's raised surface. */
export function CountChip({ children }: { children: ReactNode }) {
  return (
    <Badge
      variant="secondary"
      className="figures h-4 rounded-full bg-app-surface-3 px-1.5 py-0 text-3xs font-normal text-app-ink-2"
    >
      {children}
    </Badge>
  );
}

/** A thin vertical rule between groups of controls: shadcn's Separator. */
export function Divider({ className }: { className?: string }) {
  return (
    <Separator
      orientation="vertical"
      className={cn(
        'mx-0.5 bg-app-line-strong data-vertical:h-3.5 data-vertical:self-center',
        className,
      )}
    />
  );
}

/** The app's compact number format: 11.8K, 109.7K, 5.7M. */
export const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
export const integer = new Intl.NumberFormat('en-US');
export const pct = (fraction: number, digits = 1) => `${(fraction * 100).toFixed(digits)}%`;
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
