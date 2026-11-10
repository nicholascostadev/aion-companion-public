import type { ComponentProps } from 'react';
import { Button } from '@/components/ui/button';

/**
 * shadcn's Button rendered as a link, for actions that navigate (downloads, GitHub, anchors).
 * `newTab` opens the link in a new tab, without giving that page a handle on this one.
 */
export function ButtonLink({
  href,
  newTab = false,
  ...props
}: Omit<ComponentProps<typeof Button>, 'render' | 'nativeButton'> & {
  href: string;
  newTab?: boolean;
}) {
  return (
    <Button
      nativeButton={false}
      render={({ children, ...renderProps }) => (
        <a
          {...renderProps}
          href={href}
          {...(newTab ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        >
          {children}
        </a>
      )}
      {...props}
    />
  );
}
