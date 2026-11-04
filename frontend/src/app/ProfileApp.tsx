import { useCallback, useState } from 'react';
import { CharacterProfile } from '../features/profile/CharacterProfile';
import { ProfileArtContext } from '../features/profile/parts';
import { itemKey, useCharacterProfile } from '../hooks/useCharacterProfile';
import { useProfileWindow } from '../hooks/useProfileWindow';
import { useLocale, useTranslation } from '../i18n/provider';
import { copyTextNative } from '../services/offline';
import {
  focusProfileWindow,
  openProfileWindow,
  profileArtSrc,
  profileLanguage,
  setSavedCharacter,
} from '../services/profile';
import { copyShugoProfileLink, openShugoProfile } from '../services/shugo';
import type { ProfileSelection, SavedCharacter } from '../types/profile';

const same = (a: ProfileSelection | null, b: ProfileSelection | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.revision === b.revision &&
    a.server_id === b.server_id &&
    a.name === b.name);

/**
 * The in-game character profile window. Native owns which character it shows and the saved
 * characters; every poll of the window status hands over the same selection until another
 * open replaces it, so only a new revision starts a new lookup.
 */
export default function ProfileApp() {
  const { t } = useTranslation('profile');
  const controls = useProfileWindow();
  const lang = profileLanguage(useLocale());
  const latest = controls.status.hide_names ? null : controls.status.selection;
  const [selection, setSelection] = useState<ProfileSelection | null>(latest);
  if (!same(selection, latest)) setSelection(latest);
  const profile = useCharacterProfile(selection, lang);
  const [error, setError] = useState('');

  const close = useCallback(() => {
    void controls.hide();
  }, [controls]);
  const character = selection ? { name: selection.name, serverId: selection.server_id } : null;
  const shugo = character
    ? () =>
        void openShugoProfile(character).then(
          () => setError(''),
          (cause: unknown) => setError(String(cause)),
        )
    : undefined;
  const copy = (text: string) =>
    copyTextNative(text).then(
      () => setError(''),
      (cause: unknown) => {
        setError(t(($) => $.actions.copyFailed, { reason: String(cause) }));
        throw cause;
      },
    );
  const copyLink = character
    ? () =>
        copyShugoProfileLink(character).then(
          () => setError(''),
          (cause: unknown) => {
            setError(t(($) => $.actions.linkFailed, { reason: String(cause) }));
            throw cause;
          },
        )
    : undefined;
  // Both answer with the window status, so the list and selection shown are native's.
  const setSaved = character
    ? (saved: boolean) =>
        controls
          .act(() =>
            setSavedCharacter(character, saved).catch((cause: unknown) => {
              throw t(($) => $.saved.failed, { reason: String(cause) });
            }),
          )
          .then(() => setError(''))
    : undefined;
  const openSaved = (saved: SavedCharacter) =>
    void controls
      .act(() =>
        openProfileWindow({ name: saved.name, serverId: saved.server_id }).catch(
          (cause: unknown) => {
            throw t(($) => $.saved.openFailed, { reason: String(cause) });
          },
        ),
      )
      .then(() => setError(''));

  // Windows refused this open the foreground: the game may still hold the mouse.
  const { focus } = controls.status;
  const takeFocus =
    controls.native &&
    selection &&
    focus.state === 'denied' &&
    focus.revision === selection.revision
      ? () => void controls.act(focusProfileWindow)
      : undefined;

  return (
    <ProfileArtContext value={profileArtSrc}>
      {/* A new character opens on its equipment with nothing pinned, like the game's inspect. */}
      <CharacterProfile
        key={selection?.revision ?? 0}
        native={controls.native}
        selection={selection}
        hideNames={controls.status.hide_names}
        profile={profile}
        itemKey={itemKey}
        windowError={error || controls.error}
        onClose={close}
        saved={controls.status.favorites}
        savedMax={controls.status.favorites_max}
        onTakeFocus={takeFocus}
        {...(controls.native
          ? {
              onCopy: copy,
              onCopyLink: copyLink,
              onOpenShugo: shugo,
              onSetSaved: setSaved,
              onOpenSaved: openSaved,
            }
          : {})}
      />
    </ProfileArtContext>
  );
}
