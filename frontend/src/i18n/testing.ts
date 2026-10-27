import type { Resource } from 'i18next';
import { createBundledI18n } from './bundled';
import type { UiLocale } from './locale';

const catalogs = import.meta.glob<Record<string, unknown>>(
  ['./locales/*/*.json', '!./locales/*/native.json'],
  { eager: true, import: 'default' },
);

/** Every window catalog in both languages, keyed like i18next resources. */
export function allResources(): Resource {
  const resources: Resource = {};
  for (const [file, messages] of Object.entries(catalogs)) {
    const [, locale = '', ns = ''] = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(file) ?? [];
    (resources[locale] ??= {})[ns] = messages;
  }
  return resources;
}

/** A real engine over the shipped catalogs, for rendering features in either language. */
export const createTestI18n = (locale: UiLocale = 'en') =>
  createBundledI18n(allResources(), locale);
