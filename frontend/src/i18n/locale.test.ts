import { describe, expect, it } from 'vitest';
import { LOCALES } from '../lib/offlineNormalize';
import { isUntranslatedPreference, resolveUiLocale, UI_LOCALE_NAMES, UI_LOCALES } from './locale';

describe('interface locale', () => {
  it('offers exactly English and Portuguese (Brazil)', () => {
    expect(UI_LOCALES).toEqual(['en', 'pt-BR']);
    expect(UI_LOCALE_NAMES).toEqual({ en: 'English', 'pt-BR': 'Português (Brasil)' });
  });

  it('resolves stored preferences, with pt as the legacy value for pt-BR', () => {
    expect(resolveUiLocale('en')).toBe('en');
    expect(resolveUiLocale('pt-BR')).toBe('pt-BR');
    expect(resolveUiLocale('pt')).toBe('pt-BR');
  });

  it('shows English for absent, invalid and untranslated preferences', () => {
    for (const stored of [undefined, null, '', 'xx', 'PT-BR', 'pt_BR', 'de', 'ja', 42])
      expect(resolveUiLocale(stored)).toBe('en');
  });

  it('tells an untranslated saved language apart from English', () => {
    expect(isUntranslatedPreference('de')).toBe(true);
    expect(isUntranslatedPreference('en')).toBe(false);
    expect(isUntranslatedPreference('pt')).toBe(false);
    expect(isUntranslatedPreference('pt-BR')).toBe(false);
  });

  it('keeps every stored settings value valid, pt-BR included', () => {
    expect(LOCALES).toEqual(['en', 'pt-BR', 'pt', 'de', 'es', 'fr', 'ja', 'ko', 'zh', 'ru']);
  });
});
