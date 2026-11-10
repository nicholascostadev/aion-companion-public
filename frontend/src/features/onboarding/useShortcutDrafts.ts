import { useCallback, useRef, useState } from 'react';
import type { Translate } from '../../i18n/provider';
import type { HotkeyAction } from '../../types/offline';
import { applyShortcuts, type ShortcutDrafts } from './shortcuts';
import type { SaveSettings } from './steps';

const without = (drafts: ShortcutDrafts, action: HotkeyAction) => {
  const rest = { ...drafts };
  delete rest[action];
  return rest;
};

/**
 * The meter step's shortcuts set and not saved yet, held for as long as the guide is: a key
 * stays in its box while it is saved, after a failed save and while it is refused, wherever
 * the reader goes in the guide, until it is saved or put back. Mirrored in a ref, so a save
 * (or its retry) works on the draft as it stands when it runs.
 */
export function useShortcutDrafts() {
  const live = useRef<ShortcutDrafts>({});
  const [drafts, setDrafts] = useState<ShortcutDrafts>({});
  const update = useCallback((change: (drafts: ShortcutDrafts) => ShortcutDrafts) => {
    live.current = change(live.current);
    setDrafts(live.current);
  }, []);

  return {
    drafts,
    /** Records a key just set for `action`; it is not saved by this. */
    set: useCallback(
      (action: HotkeyAction, value: string) =>
        update((d) => ({ ...d, [action]: { value, refused: '' } })),
      [update],
    ),
    /** Puts every unsaved shortcut back to the saved one. */
    discard: useCallback(() => update(() => ({})), [update]),
    /**
     * Saves the key drafted for `action` as it stands now (nothing once it was put back),
     * checked again against the settings as saved at that moment, not as last polled. Saved,
     * the draft goes; refused there, it stays with the reason, and nothing is saved; a failed
     * save keeps it as it was. Resolves false only when the save failed.
     */
    save: useCallback(
      async (action: HotkeyAction, save: SaveSettings, t: Translate<'settings'>) => {
        const draft = live.current[action];
        if (!draft) return true;
        const { value } = draft;
        let refused = '';
        const ok = await save((settings) => {
          const result = applyShortcuts(settings, [[action, value]], t);
          refused = result.refused[action] ?? '';
          return result.next;
        });
        update((d) => {
          // A newer key recorded meanwhile, or the draft put back, is left as it is.
          if (d[action]?.value !== value) return d;
          if (refused) return { ...d, [action]: { value, refused } };
          return ok ? without(d, action) : d;
        });
        return ok;
      },
      [update],
    ),
  };
}

export type ShortcutDraftsControl = ReturnType<typeof useShortcutDrafts>;
