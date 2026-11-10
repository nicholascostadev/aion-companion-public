import type { Translate } from '../../i18n/provider';
import type { HotkeyAction, OfflineSettings } from '../../types/offline';
import { hotkeyLabel } from '../offline/settingsModel';

/**
 * A shortcut set on the meter step and not saved yet: the key as recorded, and why the
 * settings as saved refused it when it was last saved (empty until then). It is kept, and
 * shown in its box, until it is saved or put back.
 */
export interface ShortcutDraft {
  value: string;
  refused: string;
}
export type ShortcutDrafts = Partial<Record<HotkeyAction, ShortcutDraft>>;

const normal = (key: string | null | undefined) => (key ?? '').trim().toLowerCase();

/**
 * Why `settings` cannot take `value` for `action`, in Settings' own words, or '' when it
 * can: the lock shortcut cannot be empty, and a key used by another action or by a preset
 * is taken (as native's validation says). The message always lands on `action`, whichever
 * of the two shortcuts comes first.
 */
export function shortcutError(
  settings: OfflineSettings,
  action: HotkeyAction,
  value: string,
  t: Translate<'settings'>,
): string {
  const key = normal(value);
  if (!key) return action === 'toggle_lock' ? t(($) => $.validation.lockRequired) : '';
  for (const [other, used] of Object.entries(settings.hotkeys) as [HotkeyAction, string][])
    if (other !== action && normal(used) === key)
      return t(($) => $.validation.hotkeyTaken, { action: hotkeyLabel(t, other) });
  const preset = settings.presets.find((p) => normal(p.keybind) === key);
  if (preset)
    return t(($) => $.validation.presetKeyTaken, {
      preset: preset.name || t(($) => $.validation.anotherPreset),
    });
  return '';
}

/**
 * Applies the shortcuts in `wanted` to `settings` one by one, each checked against the
 * settings with the ones before it applied. Returns the settings to save (null when nothing
 * changes) and why each refused one was refused; a shortcut already saved as wanted is
 * neither.
 */
export function applyShortcuts(
  settings: OfflineSettings,
  wanted: readonly (readonly [HotkeyAction, string])[],
  t: Translate<'settings'>,
) {
  let next = settings;
  const refused: Partial<Record<HotkeyAction, string>> = {};
  let applied = false;
  for (const [action, value] of wanted) {
    if (next.hotkeys[action] === value) continue;
    const why = shortcutError(next, action, value, t);
    if (why) refused[action] = why;
    else {
      next = { ...next, hotkeys: { ...next.hotkeys, [action]: value } };
      applied = true;
    }
  }
  return { next: applied ? next : null, refused };
}
