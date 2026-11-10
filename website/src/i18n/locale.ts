/** The site's languages: the same two the app ships (English and Português do Brasil). */
export const LOCALES = {
  en: { path: '/', html: 'en', short: 'EN', name: 'English', og: 'en_US' },
  'pt-BR': { path: '/pt-br', html: 'pt-BR', short: 'PT', name: 'Português', og: 'pt_BR' },
} as const;

export type Locale = keyof typeof LOCALES;

export const LOCALE_LIST = Object.keys(LOCALES) as Locale[];

/** The locale a path belongs to (the router path, without the deploy base). */
export function localeOfPath(pathname: string): Locale {
  return /^\/pt-br(\/|$)/i.test(pathname) ? 'pt-BR' : 'en';
}
