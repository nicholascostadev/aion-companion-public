/// <reference types="vite/client" />
import { HeadContent, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { LOCALES, localeOfPath } from '@/i18n/locale';
import { asset } from '@/lib/site';
import appCss from '@/styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'theme-color', content: '#100b07' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', type: 'image/svg+xml', href: asset('favicon.svg') },
      { rel: 'apple-touch-icon', href: asset('app-icon-128.png') },
    ],
  }),
  shellComponent: RootDocument,
});

/**
 * The page is complete without JavaScript: `no-js` on <html> shows every feature and answer
 * (styles.css). This one line swaps it to `js` before the first paint, so pages with scripts
 * get the interactive versions without a flash.
 */
const ENHANCE = "document.documentElement.classList.replace('no-js','js')";

function RootDocument({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const locale = LOCALES[localeOfPath(pathname)];
  return (
    <html lang={locale.html} className="no-js" suppressHydrationWarning>
      <head>
        {/* oxlint-disable-next-line react/no-danger -- a fixed string, no user input */}
        <script dangerouslySetInnerHTML={{ __html: ENHANCE }} />
        <HeadContent />
      </head>
      <body>
        <TooltipProvider>{children}</TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
