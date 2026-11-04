/*
 * Dev-only character profile commands for the browser preview, answered from the real
 * official responses recorded in `fixtures/profile` (see docs/CHARACTER_PROFILES.md).
 *
 * - `?view=profile&mock` opens the window on the recorded character.
 * - `?mock=profile-private`, `profile-busy` (429, 20 s), `profile-missing` and
 *   `profile-partial` (equipment fails) preview the failure states.
 * - `?mock=profile-denied` previews Windows refusing the window the foreground.
 * - `?mock=fresh` opens it with no character chosen (and one saved character to reopen).
 */
import search from '../../../fixtures/profile/search.json';
import info from '../../../fixtures/profile/info.json';
import equipment from '../../../fixtures/profile/equipment.json';
import weapon from '../../../fixtures/profile/item-weapon.json';
import ring from '../../../fixtures/profile/item-ring.json';
import arcana from '../../../fixtures/profile/item-arcana.json';
import board from '../../../fixtures/profile/board.json';
import lockedBoard from '../../../fixtures/profile/board-locked.json';

type Args = Record<string, unknown>;

const scenario =
  typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('mock') : null;
const opensEmpty = scenario === 'fresh';

const state = {
  requested: true,
  revision: opensEmpty ? 0 : 1,
  selection: opensEmpty ? null : { revision: 1, server_id: 2403, name: 'foxyyyynm' },
  favorites: (opensEmpty
    ? [{ server_id: 2403, server_name: 'Triniel', name: 'foxyyyynm', saved_ms: Date.now() }]
    : []) as { server_id: number; server_name: string | null; name: string; saved_ms: number }[],
};

const status = () => ({
  requested: state.requested,
  visible: state.requested,
  ready: true,
  game_active: true,
  hide_names: false,
  selection: state.selection,
  favorites: state.favorites,
  favorites_max: 50,
  errors: [],
  focus: {
    state: scenario === 'profile-denied' ? 'denied' : 'granted',
    revision: state.revision,
    cursor_released: false,
  },
});

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const error = (kind: string, message: string, retry_after_s: number | null = null) => ({
  kind,
  message,
  retry_after_s,
});
const ID = decodeURIComponent(search.list[0]!.characterId);

/** The recorded official item that best matches a slot; armor has no recording. */
function item(slot: number) {
  if (slot <= 2) return weapon;
  if (slot >= 10 && slot <= 22) return ring;
  if (slot >= 41) return arcana;
  return null;
}

export const profileCommands: Record<string, (args: Args) => unknown> = {
  profile_window_status: () => status(),
  profile_window_ready: () => null,
  profile_window_open: ({ serverId, name }) => {
    state.revision += 1;
    state.requested = true;
    state.selection = { revision: state.revision, server_id: Number(serverId), name: String(name) };
    return status();
  },
  profile_window_hide: () => {
    state.requested = false;
    return status();
  },
  profile_window_focus: () => status(),
  profile_character: async ({ serverId, name, lang }) => {
    await wait(500);
    if (scenario === 'profile-private') throw error('private', 'The service answered 451.');
    if (scenario === 'profile-missing')
      throw error('not_found', 'No public character has exactly this name on this server.');
    if (scenario === 'profile-busy') throw error('rate_limited', 'The service answered 429.', 20);
    const sheet = structuredClone(info);
    sheet.profile.characterName = String(name);
    return {
      identity: { character_id: ID, server_id: serverId, region: 'la', name, lang },
      info: sheet,
      info_error: null,
      equipment: scenario === 'profile-partial' ? null : equipment,
      equipment_error:
        scenario === 'profile-partial' ? error('unavailable', 'The service answered 503.') : null,
      cached: false,
      fetched_ms: Date.now(),
    };
  },
  profile_item: async ({ slotPos }) => {
    await wait(350);
    const found = item(Number(slotPos));
    if (!found) throw error('not_found', 'The official service has no such record.');
    return found;
  },
  profile_board: async ({ boardId }) => {
    await wait(350);
    return Number(boardId) === 85 ? lockedBoard : board;
  },
  profile_favorite_set: ({ serverId, name, saved }) => {
    const same = (f: { server_id: number; name: string }) =>
      f.server_id === Number(serverId) && f.name === String(name);
    state.favorites = state.favorites.filter((f) => !same(f));
    if (saved === true)
      state.favorites.unshift({
        server_id: Number(serverId),
        server_name: Number(serverId) === 2403 ? 'Triniel' : null,
        name: String(name),
        saved_ms: Date.now(),
      });
    return status();
  },
};

/** The original image behind a `profile-art` key, as the browser can load it directly. */
export function mockProfileArtSrc(key: string) {
  if (key.startsWith('r.'))
    return `https://assets.playnccdn.com/static-aion2-gamedata/resources/${key.slice(2)}`;
  const [, server, character] = key.split('.');
  return `https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=${server}&charKey=${character}`;
}
