import { describe, expect, it } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import {
  categoryOfSection,
  draftStates,
  SECTION_CATEGORY,
  searchSections,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTION_IDS,
  type SearchEntry,
  type SettingsCategory,
} from './categories';

describe('Settings categories', () => {
  it('finds the category of every section, including the ones other screens link to', () => {
    expect(categoryOfSection('app-updates')).toBe('updates');
    expect(categoryOfSection('app-setup')).toBe('setup');
    expect(categoryOfSection('backups')).toBe('data');
    expect(categoryOfSection('settings-hotkeys')).toBe('hotkeys');
    expect(categoryOfSection('elsewhere')).toBeNull();
    // Every category holds at least one section, and every id is unique.
    const ids = Object.values(SETTINGS_SECTION_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    for (const category of SETTINGS_CATEGORIES)
      expect(Object.values(SECTION_CATEGORY)).toContain(category);
  });

  it('marks a category with an unsaved change, and one with a field to fix above it', () => {
    const saved = SETTINGS_FALLBACK;
    expect(draftStates(saved, saved, {})).toEqual({});
    expect(draftStates(null, saved, {})).toEqual({});
    const draft = {
      ...saved,
      opacity: 0.5,
      hide_names: !saved.hide_names,
      hotkeys: { ...saved.hotkeys, reset: 'Ctrl+R' },
      presets: [],
    };
    expect(
      draftStates(draft, saved, { 'hotkeys.toggle_lock': 'Required', 'presets[0].name': 'x' }),
    ).toEqual({ appearance: 'unsaved', general: 'unsaved', hotkeys: 'problem' });
  });
});

describe('Settings search', () => {
  const labels: Record<SettingsCategory, string> = {
    general: 'Geral',
    meter: 'Medidor',
    appearance: 'Aparência',
    hotkeys: 'Atalhos',
    data: 'Dados',
    setup: 'Configuração',
    updates: 'Atualizações',
    diagnostics: 'Diagnóstico',
  };
  const entries: SearchEntry[] = [
    { key: 'meter', title: 'Medidor e lutas', terms: ['DPS exibido', 'Atualização do medidor'] },
    {
      key: 'appearance',
      title: 'Aparência do medidor',
      terms: ['Opacidade', 'Opacidade esmaecida'],
    },
    { key: 'updates', title: 'Atualizações do aplicativo', terms: ['Procurar atualizações'] },
  ];
  const search = (query: string) => searchSections(entries, query, (c) => labels[c]);

  it('ignores case and accents and needs every word', () => {
    expect(search('OPACIDADE').map((hit) => hit.key)).toEqual(['appearance']);
    expect(search('aparencia medidor').map((hit) => hit.key)).toEqual(['appearance']);
    expect(search('opacidade dps')).toEqual([]);
    expect(search('   ')).toEqual([]);
  });

  it('puts title matches first and names the settings a match came from', () => {
    const hits = search('atualiza');
    expect(hits.map((hit) => hit.key)).toEqual(['updates', 'meter']);
    expect(hits[0]).toMatchObject({ category: 'updates', matched: [] });
    expect(hits[1]).toMatchObject({ category: 'meter', matched: ['Atualização do medidor'] });
  });
});
