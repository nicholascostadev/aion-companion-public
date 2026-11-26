import { useCallback, useState } from 'react';
import type { IconName } from '../../components/ui/Icon';
import type { OfflineSettings } from '../../types/offline';
import { BACKUPS_RESTORE_ID, BACKUPS_SECTION_ID } from '../backups/BackupsPanel';
import { DIAGNOSTICS_SECTION_ID } from '../diagnostics/DiagnosticsPanel';
import type { SettingsErrors } from '../offline/settingsModel';
import { SETUP_SECTION_ID } from '../setup/model';
import { UPDATES_SECTION_ID } from '../updates/UpdatesPanel';

/** The places in Settings, in rail order: preferences first, then the app and its data. */
export const SETTINGS_CATEGORIES = [
  'general',
  'meter',
  'appearance',
  'hotkeys',
  'data',
  'setup',
  'updates',
  'diagnostics',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export const isSettingsCategory = (value: unknown): value is SettingsCategory =>
  (SETTINGS_CATEGORIES as readonly unknown[]).includes(value);

export const CATEGORY_ICONS: Record<SettingsCategory, IconName> = {
  general: 'sliders',
  meter: 'gauge',
  appearance: 'layers',
  hotkeys: 'keyboard',
  data: 'database',
  setup: 'wrench',
  updates: 'installer',
  diagnostics: 'bug',
};

/** The first category of the second group in the rail. */
export const FIRST_APP_CATEGORY: SettingsCategory = 'data';

/**
 * Element ids of every Settings section, which deep links and search results scroll to and
 * focus. The ones other screens already link to keep their earlier values.
 */
export const SETTINGS_SECTION_IDS = {
  region: 'settings-region',
  privacy: 'settings-privacy',
  meter: 'settings-meter',
  dummy: 'settings-dummy',
  appearance: 'settings-appearance',
  hotkeys: 'settings-hotkeys',
  library: 'settings-library',
  catalogue: 'settings-catalogue',
  backups: BACKUPS_SECTION_ID,
  restore: BACKUPS_RESTORE_ID,
  setup: SETUP_SECTION_ID,
  updates: UPDATES_SECTION_ID,
  diagnostics: DIAGNOSTICS_SECTION_ID,
  capabilities: 'settings-capabilities',
} as const;
export type SettingsSectionKey = keyof typeof SETTINGS_SECTION_IDS;

/** Which category shows each section. */
export const SECTION_CATEGORY: Record<SettingsSectionKey, SettingsCategory> = {
  region: 'general',
  privacy: 'general',
  meter: 'meter',
  dummy: 'meter',
  appearance: 'appearance',
  hotkeys: 'hotkeys',
  library: 'data',
  catalogue: 'data',
  backups: 'data',
  restore: 'data',
  setup: 'setup',
  updates: 'updates',
  diagnostics: 'diagnostics',
  capabilities: 'diagnostics',
};

/** The category that holds the section with this element id, if Settings has one. */
export function categoryOfSection(id: string): SettingsCategory | null {
  for (const key of Object.keys(SETTINGS_SECTION_IDS) as SettingsSectionKey[])
    if (SETTINGS_SECTION_IDS[key] === id) return SECTION_CATEGORY[key];
  return null;
}

/** The saved settings each category edits; the rest of the draft belongs to Trackers. */
const CATEGORY_FIELDS: Partial<Record<SettingsCategory, readonly (keyof OfflineSettings)[]>> = {
  general: ['region', 'locale', 'hide_names'],
  meter: [
    'dps_mode',
    'target_mode',
    'party_only',
    'idle_timeout_seconds',
    'refresh_ms',
    'dummy_length_seconds',
    'dummy_cooldown_seconds',
  ],
  appearance: ['opacity', 'scale', 'fade_after_seconds', 'fade_opacity', 'compact_strip'],
  hotkeys: ['hotkeys'],
  data: ['auto_save'],
};

export type CategoryState = 'problem' | 'unsaved';

/**
 * Which categories hold a field that fails validation or differs from the saved settings.
 * An error key names its field first (`opacity`, `hotkeys.toggle_lock`).
 */
export function draftStates(
  draft: OfflineSettings | null,
  saved: OfflineSettings | null,
  errors: SettingsErrors,
): Partial<Record<SettingsCategory, CategoryState>> {
  const states: Partial<Record<SettingsCategory, CategoryState>> = {};
  if (!draft) return states;
  const failing = new Set(Object.keys(errors).map((key) => key.split(/[.[]/)[0]));
  for (const category of SETTINGS_CATEGORIES) {
    const fields = CATEGORY_FIELDS[category] ?? [];
    if (fields.some((field) => failing.has(field))) states[category] = 'problem';
    else if (
      saved &&
      fields.some((field) => JSON.stringify(draft[field]) !== JSON.stringify(saved[field]))
    )
      states[category] = 'unsaved';
  }
  return states;
}

/* ---------- Search ---------- */

/** One section as search sees it: its words, already in the interface language. */
export interface SearchEntry {
  key: SettingsSectionKey;
  title: string;
  /** The names of the settings inside it. */
  terms: string[];
}

export interface SearchHit {
  key: SettingsSectionKey;
  category: SettingsCategory;
  title: string;
  /** Settings inside the section that the query named, when the title did not. */
  matched: string[];
}

/** Lower case without accents, so `configuracoes` finds `Configurações`. */
export const foldText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

/**
 * Sections whose title, category or settings contain every word of the query, title
 * matches first, otherwise in rail order.
 */
export function searchSections(
  entries: readonly SearchEntry[],
  query: string,
  categoryLabel: (category: SettingsCategory) => string,
): SearchHit[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const hits: (SearchHit & { titled: boolean; order: number })[] = [];
  entries.forEach((entry, order) => {
    const category = SECTION_CATEGORY[entry.key];
    const title = foldText(`${entry.title} ${categoryLabel(category)}`);
    const terms = entry.terms.map(foldText);
    const text = `${title} ${terms.join(' ')}`;
    if (!words.every((word) => text.includes(word))) return;
    const titled = words.every((word) => title.includes(word));
    const matched = titled
      ? []
      : entry.terms.filter((_, i) => words.some((word) => terms[i]?.includes(word))).slice(0, 3);
    hits.push({ key: entry.key, category, title: entry.title, matched, titled, order });
  });
  return hits
    .sort((a, b) => Number(b.titled) - Number(a.titled) || a.order - b.order)
    .map(({ key, category, title, matched }) => ({ key, category, title, matched }));
}

/* ---------- The remembered category ---------- */

const STORED_CATEGORY = 'aion-companion.settings.category';

const readCategory = (): SettingsCategory => {
  try {
    const stored = localStorage.getItem(STORED_CATEGORY);
    return isSettingsCategory(stored) ? stored : 'general';
  } catch {
    return 'general';
  }
};

/** The chosen Settings category, remembered on this PC for the next start. */
export function useSettingsCategory() {
  const [category, setCategory] = useState<SettingsCategory>(readCategory);
  const choose = useCallback((next: SettingsCategory) => {
    setCategory(next);
    try {
      localStorage.setItem(STORED_CATEGORY, next);
    } catch {
      // Remembered for this session only.
    }
  }, []);
  return [category, choose] as const;
}
