import { Link } from '@tanstack/react-router';
import { ArrowUpRight, Download } from 'lucide-react';
import { ButtonLink } from '@/components/button-link';
import { Button } from '@/components/ui/button';
import { Wayseed } from '@/components/wayseed';
import { useI18n } from '@/i18n/context';
import { LOCALE_LIST, LOCALES } from '@/i18n/locale';
import { DOWNLOAD_URL, REPO_URL } from '@/lib/site';
import { cn } from '@/lib/utils';

export function SiteHeader() {
  const { m } = useI18n();
  const nav = [
    { href: '#features', label: m.header.nav.features },
    { href: '#privacy', label: m.header.nav.privacy },
    { href: '#faq', label: m.header.nav.faq },
  ];
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-void/40 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <ButtonLink
          href="#top"
          variant="ghost"
          className="-ml-2.5 h-10 gap-2.5 px-2.5 hover:bg-transparent"
        >
          <Wayseed className="size-7" />
          <span className="font-display text-lg font-semibold tracking-tight max-sm:sr-only">
            Aion Companion
          </span>
        </ButtonLink>
        <nav aria-label={m.header.sections} className="hidden items-center gap-1 lg:flex">
          {nav.map((item) => (
            <ButtonLink
              key={item.href}
              href={item.href}
              variant="ghost"
              size="sm"
              className="px-3 text-muted-foreground"
            >
              {item.label}
            </ButtonLink>
          ))}
          <ButtonLink
            href={REPO_URL}
            variant="ghost"
            size="sm"
            className="px-3 text-muted-foreground has-data-[icon=inline-end]:pr-2.5"
          >
            GitHub
            <ArrowUpRight aria-hidden="true" data-icon="inline-end" />
          </ButtonLink>
        </nav>
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <ButtonLink
            size="sm"
            href={DOWNLOAD_URL}
            newTab
            className="shadow-[0_0_24px_-8px_var(--primary)]"
          >
            <Download aria-hidden="true" data-icon="inline-start" />
            {m.header.download}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}

/** EN | PT: plain links to each language's page, so switching works without scripts too. */
function LanguageSwitch() {
  const { m, locale } = useI18n();
  return (
    <nav
      aria-label={m.header.language}
      className="flex items-center rounded-full border border-border bg-void/40 p-0.5"
    >
      {LOCALE_LIST.map((l) => {
        const current = l === locale;
        return (
          <Button
            key={l}
            variant="ghost"
            size="xs"
            nativeButton={false}
            render={({ children, ...props }) => (
              <Link
                {...props}
                to={LOCALES[l].path}
                hrefLang={LOCALES[l].html}
                lang={LOCALES[l].html}
                aria-current={current ? 'page' : undefined}
                title={LOCALES[l].name}
              >
                {children}
              </Link>
            )}
            className={cn(
              'h-7 px-2.5 text-xs font-semibold text-muted-foreground',
              current && 'bg-gold-soft text-primary hover:bg-gold-soft hover:text-primary',
            )}
          >
            <span aria-hidden="true">{LOCALES[l].short}</span>
            <span className="sr-only">{LOCALES[l].name}</span>
          </Button>
        );
      })}
    </nav>
  );
}
