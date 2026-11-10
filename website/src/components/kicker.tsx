import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

/** A section's name above its headline: the shadcn Badge in the honey outline style. */
export function Kicker({
  icon: Icon,
  children,
  className,
}: {
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'h-7 gap-2 border-honey/30 bg-honey-soft px-3 text-[0.6875rem] font-medium tracking-[0.2em] text-honey uppercase',
        className,
      )}
    >
      {Icon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
      {children}
    </Badge>
  );
}
