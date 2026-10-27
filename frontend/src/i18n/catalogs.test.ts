import { describe, expect, it } from 'vitest';
import { UI_LOCALES } from './locale';
import { hasCatalog, NAMESPACES, VIEW_NAMESPACES } from './resources';
import { allResources, createTestI18n } from './testing';

/** Every message key, flattened, with plural suffixes folded into their family. */
function keys(messages: unknown, prefix = ''): string[] {
  return Object.entries(messages as Record<string, unknown>).flatMap(([key, value]) =>
    typeof value === 'string'
      ? [`${prefix}${key}`.replace(/_(zero|one|two|few|many|other)$/, '')]
      : keys(value, `${prefix}${key}.`),
  );
}

describe('shipped catalogs', () => {
  const resources = allResources();

  it('exist for every namespace in both languages, and only those', () => {
    for (const locale of UI_LOCALES)
      for (const ns of NAMESPACES) expect(hasCatalog(locale, ns), `${locale}/${ns}`).toBe(true);
    expect(Object.keys(resources).sort()).toEqual([...UI_LOCALES].sort());
    for (const locale of UI_LOCALES)
      expect(Object.keys(resources[locale] ?? {}).sort()).toEqual([...NAMESPACES].sort());
  });

  it('give Portuguese (Brazil) every English message', () => {
    for (const ns of NAMESPACES) {
      const en = new Set(keys(resources.en?.[ns]));
      const pt = new Set(keys(resources['pt-BR']?.[ns]));
      expect(
        [...en].filter((k) => !pt.has(k)),
        `pt-BR/${ns} missing`,
      ).toEqual([]);
      expect(
        [...pt].filter((k) => !en.has(k)),
        `pt-BR/${ns} extra`,
      ).toEqual([]);
    }
  });

  it('preload only namespaces that exist, and keep the workspace catalogs out of the menu', () => {
    for (const namespaces of Object.values(VIEW_NAMESPACES))
      for (const ns of namespaces) expect(NAMESPACES).toContain(ns);
    expect(VIEW_NAMESPACES.menu).not.toContain('settings');
    expect(VIEW_NAMESPACES['alert-popup']).not.toContain('workspace');
  });
});

describe('plural messages', () => {
  it('follow English rules for 0, 1, 2 and fractions', () => {
    const t = createTestI18n('en').getFixedT('en', 'settings');
    const problems = (count: number) => t(($) => $.saveBar.problems, { count });
    expect(problems(0)).toBe('0 fields need attention before saving.');
    expect(problems(1)).toBe('1 field needs attention before saving.');
    expect(problems(2)).toBe('2 fields need attention before saving.');
    expect(problems(1.5)).toBe('1.5 fields need attention before saving.');
  });

  it('follow Brazilian Portuguese rules, including fractions and millions', () => {
    const t = createTestI18n('pt-BR').getFixedT('pt-BR', 'settings');
    const problems = (count: number) => t(($) => $.saveBar.problems, { count });
    expect(problems(0)).toBe('0 campo precisa de atenção antes de salvar.');
    expect(problems(1)).toBe('1 campo precisa de atenção antes de salvar.');
    expect(problems(2)).toBe('2 campos precisam de atenção antes de salvar.');
    expect(problems(1.5)).toBe('1.5 campo precisa de atenção antes de salvar.');
    expect(problems(1_000_000)).toBe('1000000 de campos precisam de atenção antes de salvar.');
  });

  it('format a count in the language when the message asks for it', () => {
    const en = createTestI18n('en').getFixedT('en', 'settings');
    const pt = createTestI18n('pt-BR').getFixedT('pt-BR', 'settings');
    expect(en(($) => $.library.size, { count: 1234 })).toMatch(/^1,234 saved logs\./);
    expect(pt(($) => $.library.size, { count: 1234 })).toMatch(/^1\.234 registros salvos\./);
    expect(pt(($) => $.library.size, { count: 1 })).toMatch(/^1 registro salvo\./);
  });
});
