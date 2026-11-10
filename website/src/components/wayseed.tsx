import { cn } from '@/lib/utils';

const VANE = 'M10 36C5 23 14 8 29 7C39 6 49 11 54 20C41 17 28 20 23 30L17 41Z';

/** The Wayseed brand mark (branding/logo-mark.svg): two windborne vanes around a compass seed. */
export function Wayseed({ className, spin = false }: { className?: string; spin?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" className={cn('shrink-0', className)}>
      <g className={cn('origin-center', spin && 'motion-safe:animate-[spin_24s_linear_infinite]')}>
        <path d={VANE} className="fill-primary" />
        <path d={VANE} className="fill-sun" transform="rotate(180 32 32)" />
      </g>
      <path d="M32 25L36 32L32 39L28 32Z" className="fill-foreground" />
    </svg>
  );
}
