import { Suspense, useEffect, type ReactNode } from 'react';
import type { i18n as I18n, TFunction } from 'i18next';
import { I18nextProvider, useTranslation } from 'react-i18next';
import { formattersFor, type Formatters } from './formatters';
import { resolveUiLocale, type UiLocale } from './locale';
import type { Namespace } from './resources';

/*
 * The presentation side of translation: views, features and primitives import from here.
 * Nothing in this folder talks to native; the app composition reads the saved preference
 * and switches this window's engine (see `services/uiPreferences.ts`).
 */

export { Trans, useTranslation } from 'react-i18next';

/** A translator for one namespace, for display models that build text outside React. */
export type Translate<Ns extends Namespace = 'common'> = TFunction<Ns>;

/** Keeps the document's language and title in step with the interface. */
function DocumentLanguage() {
  const { t, i18n } = useTranslation('common');
  const locale = resolveUiLocale(i18n.resolvedLanguage ?? i18n.language);
  const title = t(($) => $.documentTitle);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = title;
  }, [locale, title]);
  return null;
}

/**
 * Supplies this window's translation engine. Text rerenders in place when the language
 * changes: nothing is remounted and no state is reset.
 */
export function TranslationProvider({ i18n, children }: { i18n: I18n; children: ReactNode }) {
  return (
    <I18nextProvider i18n={i18n}>
      {/* Only a namespace no view preloads ever waits here, and only on first use. */}
      <Suspense fallback={null}>
        <DocumentLanguage />
        {children}
      </Suspense>
    </I18nextProvider>
  );
}

/** The interface language now shown. */
export function useLocale(): UiLocale {
  const { i18n } = useTranslation();
  return resolveUiLocale(i18n.resolvedLanguage ?? i18n.language);
}

/** Number, date and duration formatting in the interface language; stable per language. */
export function useFormat(): Formatters {
  return formattersFor(useLocale());
}
