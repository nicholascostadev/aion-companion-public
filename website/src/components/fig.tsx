import type { ReactNode } from 'react';

/** An inline figure in running copy: mono and bright. */
export function Fig({ children }: { children: ReactNode }) {
  return <span className="figures text-foreground">{children}</span>;
}
