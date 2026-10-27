import { createInstance, type BackendModule, type i18n as I18n } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_UI_LOCALE, UI_LOCALES, type UiLocale } from './locale';
import { loadCatalog, type Namespace } from './resources';

/** Reads catalogs from the packaged assets; nothing is fetched over the network. */
const packagedCatalogs: BackendModule = {
  type: 'backend',
  init() {},
  read(language, namespace, callback) {
    loadCatalog(language, namespace).then(
      (messages) => callback(null, messages),
      (cause: unknown) =>
        callback(cause instanceof Error ? cause : new Error(String(cause)), false),
    );
  },
};

interface Options {
  locale?: UiLocale;
  /** Namespaces loaded (in both languages) before the promise resolves. */
  namespaces: readonly Namespace[];
  /** Messages that went missing; English fills in, but a shipped catalog has none. */
  onMissing?: (locale: string, ns: string, key: string) => void;
}

/**
 * This window's translation engine. Every WebView has its own: the saved preference, not
 * a shared JavaScript object, keeps the windows in one language.
 */
export async function createI18n({
  locale = DEFAULT_UI_LOCALE,
  namespaces,
  onMissing,
}: Options): Promise<I18n> {
  const i18n = createInstance();
  i18n.use(packagedCatalogs).use(initReactI18next);
  await i18n.init({
    lng: locale,
    fallbackLng: DEFAULT_UI_LOCALE,
    supportedLngs: [...UI_LOCALES],
    // `pt-BR` is a complete language here, never narrowed to `pt`.
    load: 'currentOnly',
    ns: [...namespaces],
    defaultNS: 'common',
    fallbackNS: false,
    preload: [...UI_LOCALES],
    // React escapes interpolated values; messages never contain markup.
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    saveMissing: onMissing !== undefined,
    missingKeyHandler: onMissing ? (lngs, ns, key) => onMissing(lngs.join(','), ns, key) : false,
    react: { useSuspense: true, bindI18n: 'languageChanged loaded', bindI18nStore: 'added' },
  });
  return i18n;
}

/** Switches language once its catalogs are loaded, so no frame shows missing text. */
export async function applyLocale(i18n: I18n, locale: UiLocale) {
  if (i18n.language === locale) return;
  await i18n.loadLanguages(locale);
  await i18n.changeLanguage(locale);
}
