import { en } from '@/i18n/en';
import { LOCALE_LIST, LOCALES, type Locale } from '@/i18n/locale';
import { pt } from '@/i18n/pt';
import { absoluteUrl } from '@/lib/site';

const META = { en: en.meta, 'pt-BR': pt.meta };

/** Title, description, social cards and the alternate-language links for one locale. */
export function pageHead(locale: Locale) {
  const meta = META[locale];
  return {
    meta: [
      { title: meta.title },
      { name: 'description', content: meta.description },
      { property: 'og:title', content: meta.title },
      { property: 'og:description', content: meta.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: LOCALES[locale].og },
      { property: 'og:image', content: absoluteUrl('shots/workspace.png') },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    links: LOCALE_LIST.map((l) => ({
      rel: 'alternate',
      hrefLang: LOCALES[l].html,
      href: absoluteUrl(LOCALES[l].path),
    })),
  };
}
