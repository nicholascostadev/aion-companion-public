import { ButtonLink } from '@/components/button-link';
import { Separator } from '@/components/ui/separator';
import { Wayseed } from '@/components/wayseed';
import { useI18n } from '@/i18n/context';
import { DOWNLOAD_URL, REPO_URL } from '@/lib/site';

export function SiteFooter() {
  const { m } = useI18n();
  const links = [
    { href: DOWNLOAD_URL, label: m.footer.releases, newTab: true },
    { href: REPO_URL, label: m.footer.source },
    { href: `${REPO_URL}/issues`, label: m.footer.issues },
    { href: `${REPO_URL}/blob/master/LICENSE`, label: m.footer.licence },
  ];
  return (
    <footer className="bg-void/60 backdrop-blur-md">
      <Separator />
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:justify-between">
        <div className="max-w-md">
          <div className="flex items-center gap-2.5">
            <Wayseed className="size-6" />
            <span className="font-display text-base font-semibold tracking-tight">
              Aion Companion
            </span>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            {m.footer.disclaimer}
          </p>
        </div>
        <nav aria-label={m.footer.links}>
          <ul className="-mx-2.5 flex flex-wrap gap-x-1 gap-y-1">
            {links.map((link) => (
              <li key={link.label}>
                <ButtonLink
                  href={link.href}
                  newTab={link.newTab}
                  variant="link"
                  size="sm"
                  className="px-2.5 text-muted-foreground hover:text-foreground"
                >
                  {link.label}
                </ButtonLink>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </footer>
  );
}
