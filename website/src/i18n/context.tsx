import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { en, type Messages } from './en';
import type { Locale } from './locale';
import { pt } from './pt';

const MESSAGES: Record<Locale, Messages> = { en, 'pt-BR': pt };

/** Number and time formats for the locale, the way the app formats them. */
function formats(locale: Locale) {
  const compactFmt = new Intl.NumberFormat(locale, {
    notation: 'compact',
    maximumFractionDigits: 1,
  });
  const integerFmt = new Intl.NumberFormat(locale);
  return {
    compact: (n: number) => compactFmt.format(n),
    integer: (n: number) => integerFmt.format(n),
    pct: (fraction: number, digits = 1) =>
      new Intl.NumberFormat(locale, {
        style: 'percent',
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(fraction),
    /** A clock time: 10:51 PM in English, 22:51 in Portuguese. */
    time: (hours: number, minutes: number) =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'UTC',
      }).format(new Date(Date.UTC(2026, 0, 1, hours, minutes))),
    weekday: (d: Date) => d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', ''),
  };
}

type I18n = { locale: Locale; m: Messages; fmt: ReturnType<typeof formats> };

const Ctx = createContext<I18n>({ locale: 'en', m: en, fmt: formats('en') });

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo(() => ({ locale, m: MESSAGES[locale], fmt: formats(locale) }), [locale]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n() {
  return useContext(Ctx);
}
