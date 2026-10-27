import { useCallback, useMemo, useState } from 'react';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import type {
  AlertSchedule,
  HotkeyAction,
  OfflineSettings,
  TrackerBar,
  TrackerPreset,
} from '../../types/offline';

/** Field path → message. Mirrors native validation so Save is never a surprise. */
export type SettingsErrors = Record<string, string>;
type T = Translate<'settings'>;
/** Range limits as written today (0.15, 1000), with the language's decimal sign. */
const RANGE_NUMBER = { maximumFractionDigits: 2, useGrouping: false } as const;

const RANGES: [keyof OfflineSettings, number, number, boolean][] = [
  ['idle_timeout_seconds', 1, 600, true],
  ['dummy_cooldown_seconds', 0, 300, true],
  ['refresh_ms', 50, 1000, true],
  ['opacity', 0.15, 1, false],
  ['scale', 0.75, 2, false],
  ['fade_after_seconds', 0, 600, true],
  ['fade_opacity', 0.05, 1, false],
];

/** Hotkey actions in the order Settings lists them. */
export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  'toggle_overlay',
  'toggle_lock',
  'reset',
  'copy_summary',
  'compact_strip',
];

export const hotkeyLabel = (t: T, action: HotkeyAction) => t(($) => $.hotkeys.actions[action]);

const isInt = (n: number) => Number.isInteger(n);
const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max;
const u32 = (n: number) => isInt(n) && n >= 0 && n <= 0xffffffff;

function presetErrors(
  preset: TrackerPreset,
  i: number,
  errors: SettingsErrors,
  ids: Set<string>,
  names: Set<string>,
  t: T,
) {
  const at = `presets.${i}`;
  if (!preset.id || preset.id.length > 100) errors[`${at}.id`] = t(($) => $.validation.presetId);
  else if (ids.has(preset.id)) errors[`${at}.id`] = t(($) => $.validation.presetIdUnique);
  ids.add(preset.id);
  const name = preset.name.trim();
  if (!name || name.length > 200) errors[`${at}.name`] = t(($) => $.validation.presetName);
  else if (names.has(name.toLocaleLowerCase()))
    errors[`${at}.name`] = t(($) => $.validation.presetNameTaken);
  names.add(name.toLocaleLowerCase());
  if (preset.bars.length > 32) errors[`${at}.bars`] = t(($) => $.validation.tooManyBars);
  const barIds = new Set<string>();
  preset.bars.forEach((bar: TrackerBar, j) => {
    const b = `${at}.bars.${j}`;
    if (!bar.id || barIds.has(bar.id)) errors[`${b}.id`] = t(($) => $.validation.barIdUnique);
    barIds.add(bar.id);
    if (bar.skills.length > 128) errors[`${b}.skills`] = t(($) => $.validation.tooManySkills);
    else if (bar.skills.some((s) => !u32(s) || s === 0))
      errors[`${b}.skills`] = t(($) => $.validation.skillIds);
    if (!isInt(bar.x) || !inRange(bar.x, -20000, 20000))
      errors[`${b}.x`] = t(($) => $.validation.barX);
    if (!isInt(bar.y) || !inRange(bar.y, -20000, 20000))
      errors[`${b}.y`] = t(($) => $.validation.barY);
    if (!isInt(bar.icon_size) || !inRange(bar.icon_size, 16, 128))
      errors[`${b}.icon_size`] = t(($) => $.validation.iconSize);
  });
}

function alertErrors(alert: AlertSchedule, i: number, errors: SettingsErrors, t: T) {
  const at = `alerts.${i}`;
  if (!inRange(alert.volume, 0, 1)) errors[`${at}.volume`] = t(($) => $.validation.volume);
  if (!isInt(alert.lead_seconds) || !inRange(alert.lead_seconds, 0, 86400))
    errors[`${at}.lead_seconds`] = t(($) => $.validation.leadTime);
  if (
    alert.repeat_seconds !== null &&
    (!isInt(alert.repeat_seconds) || !inRange(alert.repeat_seconds, 1, 31_536_000))
  )
    errors[`${at}.repeat_seconds`] = t(($) => $.validation.repeat);
  if (alert.at_ms !== null && (!isInt(alert.at_ms) || alert.at_ms < 0))
    errors[`${at}.at_ms`] = t(($) => $.validation.dateTime);
  if (alert.enabled && alert.at_ms === null)
    errors[`${at}.at_ms`] = t(($) => $.validation.firstTime);
}

/** `format` writes the numbers in range messages in the interface language. */
export function validateSettings(
  s: OfflineSettings,
  t: T,
  format: (n: number) => string = String,
): SettingsErrors {
  const errors: SettingsErrors = {};
  for (const [field, min, max, integer] of RANGES) {
    const value = s[field] as number;
    if (!inRange(value, min, max))
      errors[field] = t(($) => $.validation.range, { min: format(min), max: format(max) });
    else if (integer && !isInt(value)) errors[field] = t(($) => $.validation.wholeNumber);
  }
  const dummy = s.dummy_length_seconds;
  if (!isInt(dummy) || !(dummy === 0 || inRange(dummy, 10, 300)))
    errors.dummy_length_seconds = t(($) => $.validation.dummyLength);
  const seen = new Map<string, HotkeyAction>();
  for (const [action, value] of Object.entries(s.hotkeys) as [HotkeyAction, string][]) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      if (action === 'toggle_lock')
        errors[`hotkeys.${action}`] = t(($) => $.validation.lockRequired);
      continue;
    }
    const other = seen.get(normalized);
    if (other)
      errors[`hotkeys.${action}`] = t(($) => $.validation.hotkeyTaken, {
        action: hotkeyLabel(t, other),
      });
    seen.set(normalized, action);
  }
  // Preset switch keys share the global shortcut space with the actions above.
  const presetKeys = new Map<string, string>();
  s.presets.forEach((preset, i) => {
    const normalized = (preset.keybind ?? '').trim().toLowerCase();
    if (!normalized) return;
    const at = `presets.${i}.keybind`;
    if (seen.has(normalized))
      errors[at] = t(($) => $.validation.hotkeyTaken, {
        action: hotkeyLabel(t, seen.get(normalized) as HotkeyAction),
      });
    else if (presetKeys.has(normalized))
      errors[at] = t(($) => $.validation.presetKeyTaken, {
        preset: presetKeys.get(normalized) ?? '',
      });
    presetKeys.set(normalized, preset.name || t(($) => $.validation.anotherPreset));
  });
  if (s.presets.length > 100) errors.presets = t(($) => $.validation.tooManyPresets);
  const ids = new Set<string>();
  const names = new Set<string>();
  s.presets.forEach((p, i) => presetErrors(p, i, errors, ids, names, t));
  if (s.active_preset !== null && !s.presets.some((p) => p.id === s.active_preset))
    errors.active_preset = t(($) => $.validation.activePresetMissing);
  if (s.alerts.length > 200) errors.alerts = t(($) => $.validation.tooManyAlerts);
  s.alerts.forEach((a, i) => alertErrors(a, i, errors, t));
  return errors;
}

export const newId = (prefix: string) =>
  `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Bar positions also change outside the draft (in-game arranging saves them
 * immediately). Before saving, every bar whose x/y the user did not edit here (same
 * as `origin`, the settings this draft started from) takes the latest native
 * position, so a settings save never undoes an in-game drag.
 */
export function rebaseBarPositions(
  draft: OfflineSettings,
  origin: OfflineSettings | null,
  latest: OfflineSettings | null,
): OfflineSettings {
  if (!origin || !latest) return draft;
  const find = (s: OfflineSettings, preset: string, bar: string) =>
    s.presets.find((p) => p.id === preset)?.bars.find((b) => b.id === bar);
  return {
    ...draft,
    presets: draft.presets.map((preset) => ({
      ...preset,
      bars: preset.bars.map((bar) => {
        const before = find(origin, preset.id, bar.id);
        const now = find(latest, preset.id, bar.id);
        const untouched = before && before.x === bar.x && before.y === bar.y;
        return untouched && now ? { ...bar, x: now.x, y: now.y } : bar;
      }),
    })),
  };
}

/**
 * One editable copy of the settings shared by the Settings and Trackers tabs.
 * Polls never overwrite unsaved edits; after a save the draft adopts native's
 * validated result. Native changes made elsewhere (hotkeys, the tracker surface,
 * another window) flow in whenever the draft is clean.
 */
export function useSettingsDraft(
  settings: OfflineSettings | null,
  save: (s: OfflineSettings) => Promise<boolean>,
) {
  const json = JSON.stringify(settings);
  const [draft, setDraft] = useState<OfflineSettings | null>(settings);
  // The native settings the draft was last adopted from (baseline for rebasing).
  const [origin, setOrigin] = useState<OfflineSettings | null>(settings);
  const [base, setBase] = useState(json);
  const [adopt, setAdopt] = useState(false);
  const [saving, setSaving] = useState(false);
  // When the last save succeeded; worded at render, so it follows the interface language.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { t } = useTranslation('settings');
  const fmt = useFormat();
  const dirty = draft !== null && JSON.stringify(draft) !== base;

  // Follow native, adjusted during render: clean drafts and just-saved drafts adopt it.
  if (json !== base) {
    setBase(json);
    if (!dirty || adopt) {
      setDraft(settings);
      setOrigin(settings);
      setAdopt(false);
    }
  }

  // Messages follow the language: recomputed with `t`, never stored with the draft.
  const errors = useMemo(
    () => (draft ? validateSettings(draft, t, (n) => fmt.numberWith(RANGE_NUMBER).format(n)) : {}),
    [draft, t, fmt],
  );
  const valid = Object.keys(errors).length === 0;

  const update = useCallback((change: (s: OfflineSettings) => OfflineSettings) => {
    setDraft((current) => (current ? change(current) : current));
    setSavedAt(null);
  }, []);

  const commit = useCallback(async () => {
    if (!draft || !valid) return false;
    setSaving(true);
    setAdopt(true);
    const ok = await save(rebaseBarPositions(draft, origin, settings));
    setSaving(false);
    if (ok) setSavedAt(Date.now());
    else setAdopt(false);
    return ok;
  }, [draft, valid, save, origin, settings]);

  return {
    draft,
    update,
    dirty,
    errors,
    valid,
    saving,
    saved: savedAt === null ? '' : t(($) => $.saveBar.savedAt, { time: fmt.timeOfDay(savedAt) }),
    save: commit,
    discard: () => {
      setDraft(settings);
      setOrigin(settings);
      setSavedAt(null);
    },
  };
}

export type SettingsDraft = ReturnType<typeof useSettingsDraft>;
