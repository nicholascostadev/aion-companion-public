import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import type { ShugoProfile } from '../lib/shugo';
import {
  normalizeBoard,
  normalizeItem,
  normalizeProfileWindowStatus,
  normalizeSheet,
  profileError,
} from '../lib/profileNormalize';
import type {
  Board,
  CharacterSheet,
  ItemDetail,
  ProfileSelection,
  ProfileWindowStatus,
} from '../types/profile';

/** Native serves official artwork through this scheme (`src-tauri/src/profile_api.rs`). */
export const PROFILE_ART_PROTOCOL = 'profile-art';

const RESOURCE = /^\/static-aion2-gamedata\/resources\/([A-Za-z0-9_.-]{1,120}\.png)$/;
const PORTRAIT = '/game_profile_images/aion2global/images';

/**
 * The address to draw an official image from: in the app, native's `profile-art` key for a
 * game-data resource or a character portrait; in a browser preview, the original itself.
 * Anything not on NCSOFT's two artwork hosts is null, so no other image is ever loaded.
 */
export function profileArtSrc(url: string | null | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  let key: string | null = null;
  const file = RESOURCE.exec(parsed.pathname)?.[1];
  if (parsed.hostname === 'assets.playnccdn.com' && file && !file.includes('..') && !parsed.search)
    key = `r.${file}`;
  if (parsed.hostname === 'profileimg.plaync.com' && parsed.pathname === PORTRAIT) {
    const server = parsed.searchParams.get('gameServerKey') ?? '';
    const character = parsed.searchParams.get('charKey') ?? '';
    if (/^\d{1,6}$/.test(server) && /^\d{1,24}$/.test(character)) key = `p.${server}.${character}`;
  }
  if (!key) return null;
  return isTauri() ? convertFileSrc(key, PROFILE_ART_PROTOCOL) : parsed.href;
}

export const readProfileWindowStatus = (): Promise<ProfileWindowStatus> =>
  invoke<unknown>('profile_window_status').then(normalizeProfileWindowStatus);
export const markProfileWindowReady = () => invoke<void>('profile_window_ready');
/** Opens the in-game profile window on one observed character (or retargets it). */
export const openProfileWindow = ({ name, serverId }: ShugoProfile): Promise<ProfileWindowStatus> =>
  invoke<unknown>('profile_window_open', { serverId, name }).then(normalizeProfileWindowStatus);
export const hideProfileWindow = (): Promise<ProfileWindowStatus> =>
  invoke<unknown>('profile_window_hide').then(normalizeProfileWindowStatus);
/** Asks Windows again to put the window in front, from the user's own click. */
export const focusProfileWindow = (): Promise<ProfileWindowStatus> =>
  invoke<unknown>('profile_window_focus').then(normalizeProfileWindowStatus);
/** Saves (or forgets) one exact character; native answers with the status and its list. */
export const setSavedCharacter = (
  { name, serverId }: ShugoProfile,
  saved: boolean,
): Promise<ProfileWindowStatus> =>
  invoke<unknown>('profile_favorite_set', { serverId, name, saved }).then(
    normalizeProfileWindowStatus,
  );

/** Official language codes for the app's languages. */
export const profileLanguage = (locale: string) => (locale === 'pt-BR' ? 'pt-BR' : 'en-US');

const lookup = (selection: ProfileSelection, lang: string) => ({
  serverId: selection.server_id,
  name: selection.name,
  lang,
});

/** Rejections are `ProfileError`s. */
export const readCharacterSheet = (
  selection: ProfileSelection,
  lang: string,
  refresh = false,
): Promise<CharacterSheet> =>
  invoke<unknown>('profile_character', { ...lookup(selection, lang), refresh }).then(
    normalizeSheet,
    (cause: unknown) => Promise.reject(profileError(cause)),
  );

export const readItemDetail = (
  selection: ProfileSelection,
  lang: string,
  characterId: string,
  item: { id: number; slot: number; enchant: number; breakthrough: number },
  refresh = false,
): Promise<ItemDetail> =>
  invoke<unknown>('profile_item', {
    ...lookup(selection, lang),
    characterId,
    itemId: item.id,
    slotPos: item.slot,
    // The service wants the total: enchant plus breakthrough picks the breakthrough bonuses.
    enchantLevel: item.enchant + item.breakthrough,
    refresh,
  }).then(
    (raw) => normalizeItem(raw) ?? Promise.reject(profileError('The item detail was empty.')),
    (cause: unknown) => Promise.reject(profileError(cause)),
  );

export const readBoard = (
  selection: ProfileSelection,
  lang: string,
  characterId: string,
  boardId: number,
  refresh = false,
): Promise<Board> =>
  invoke<unknown>('profile_board', {
    ...lookup(selection, lang),
    characterId,
    boardId,
    refresh,
  }).then(
    (raw) => normalizeBoard(raw, boardId) ?? Promise.reject(profileError('The board was empty.')),
    (cause: unknown) => Promise.reject(profileError(cause)),
  );
