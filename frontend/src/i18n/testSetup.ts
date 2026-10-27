import { afterEach } from 'vitest';
import { createTestI18n } from './testing';

/*
 * Vitest setup: components rendered without a provider use this real engine over the
 * shipped catalogs. Tests run in English unless they switch language explicitly; the
 * language is reset after each test.
 */
const i18n = createTestI18n('en');

afterEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en');
});
