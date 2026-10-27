import { createInstance, type i18n as I18n, type Resource } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { DEFAULT_UI_LOCALE, UI_LOCALES, type UiLocale } from './locale';

/**
 * A synchronously ready engine over messages already in memory: the crash fallback and
 * tests use it. Windows use `createI18n`, which loads only the catalogs a view needs.
 */
export function createBundledI18n(resources: Resource, locale: UiLocale = DEFAULT_UI_LOCALE): I18n {
  const i18n = createInstance();
  i18n.use(initReactI18next);
  void i18n.init({
    resources,
    lng: locale,
    fallbackLng: DEFAULT_UI_LOCALE,
    supportedLngs: [...UI_LOCALES],
    load: 'currentOnly',
    defaultNS: 'common',
    fallbackNS: false,
    initAsync: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    returnEmptyString: false,
    react: { useSuspense: false, bindI18n: 'languageChanged loaded', bindI18nStore: 'added' },
  });
  return i18n;
}
