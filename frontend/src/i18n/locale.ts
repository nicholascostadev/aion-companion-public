/**
 * The interface languages and how a stored settings preference resolves to one.
 *
 * Settings keep a broader `locale` value for compatibility (other language codes may be
 * stored); only these are translated. Nothing here reads the operating system language:
 * English stays the default until the user saves another choice.
 */
export const UI_LOCALES = ['en', 'pt-BR'] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = 'en';

/** Each language named in itself, so it is recognisable whatever the current language. */
export const UI_LOCALE_NAMES: Record<UiLocale, string> = {
  en: 'English',
  'pt-BR': 'Português (Brasil)',
};

/** The `Intl` locale numbers and dates are formatted with. */
export const INTL_LOCALES: Record<UiLocale, string> = {
  en: 'en-US',
  'pt-BR': 'pt-BR',
};

export const isUiLocale = (value: unknown): value is UiLocale =>
  typeof value === 'string' && (UI_LOCALES as readonly string[]).includes(value);

/**
 * A stored preference → the interface language. `pt` is the legacy value for Brazilian
 * Portuguese; absent, invalid and untranslated values show English.
 */
export function resolveUiLocale(stored: unknown): UiLocale {
  if (stored === 'pt') return 'pt-BR';
  return isUiLocale(stored) ? stored : DEFAULT_UI_LOCALE;
}

/**
 * True when the stored value is a language the interface cannot show (it resolves to
 * English without being English), so the selector can say so instead of claiming `en`.
 */
export const isUntranslatedPreference = (stored: string) => stored !== 'pt' && !isUiLocale(stored);
