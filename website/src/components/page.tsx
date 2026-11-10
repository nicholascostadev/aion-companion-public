import { AetherSky } from '@/components/aether-sky';
import { Faq } from '@/components/sections/faq';
import { FinalCall } from '@/components/sections/final-call';
import { Features, Opening } from '@/components/sections/showcase';
import { Statement } from '@/components/sections/statement';
import { Toolkit } from '@/components/sections/toolkit';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import { I18nProvider, useI18n } from '@/i18n/context';
import type { Locale } from '@/i18n/locale';

/**
 * The whole page, in one language. Each language is its own prerendered route, so every word is
 * in the static HTML; JavaScript only adds the live demos on top.
 */
export function Page({ locale }: { locale: Locale }) {
  return (
    <I18nProvider locale={locale}>
      <Body />
    </I18nProvider>
  );
}

function Body() {
  const { m } = useI18n();
  return (
    <>
      <AetherSky />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {m.skip}
      </a>
      <SiteHeader />
      <main id="main">
        <Opening />
        <Features />
        <Toolkit />
        <Statement />
        <Faq />
        <FinalCall />
      </main>
      <SiteFooter />
    </>
  );
}
