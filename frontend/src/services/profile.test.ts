import { invoke, isTauri, type convertFileSrc } from '@tauri-apps/api/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { profileCommands } from '../dev/mockProfile';
import {
  focusProfileWindow,
  hideProfileWindow,
  markProfileWindowReady,
  openProfileWindow,
  profileArtSrc,
  profileLanguage,
  readBoard,
  readCharacterSheet,
  readItemDetail,
  readProfileWindowStatus,
  setSavedCharacter,
} from './profile';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn<typeof invoke>(),
  isTauri: vi.fn<typeof isTauri>(),
  convertFileSrc: vi.fn<typeof convertFileSrc>(
    (path, protocol) => `http://${protocol}.localhost/${path}`,
  ),
}));

afterEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReset();
});

const selection = { revision: 3, server_id: 2403, name: 'foxyyyynm' };
const ICON = 'https://assets.playnccdn.com/static-aion2-gamedata/resources/Icon_WP_ST_0028_T05.png';
const PORTRAIT =
  'https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=2403&charKey=676384369036038819';

describe('character profile service', () => {
  it('draws official art through native in the app and directly in a preview', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    expect(profileArtSrc(ICON)).toBe('http://profile-art.localhost/r.Icon_WP_ST_0028_T05.png');
    expect(profileArtSrc(PORTRAIT)).toBe('http://profile-art.localhost/p.2403.676384369036038819');
    vi.mocked(isTauri).mockReturnValue(false);
    expect(profileArtSrc(ICON)).toBe(ICON);
  });

  it('never loads an image from anywhere else', () => {
    vi.mocked(isTauri).mockReturnValue(true);
    for (const url of [
      'https://evil.example/static-aion2-gamedata/resources/x.png',
      'http://assets.playnccdn.com/static-aion2-gamedata/resources/x.png',
      'https://assets.playnccdn.com/static-aion2-gamedata/resources/x.png?y=1',
      'https://assets.playnccdn.com/other/x.png',
      'https://profileimg.plaync.com/game_profile_images/aion2global/images?gameServerKey=x&charKey=1',
      'not a url',
      '',
      null,
    ])
      expect(profileArtSrc(url)).toBeNull();
  });

  it('opens the window on a character by server and name', async () => {
    vi.mocked(invoke).mockResolvedValue({ requested: true, selection });
    const status = await openProfileWindow({ name: 'foxyyyynm', serverId: 2403 });
    expect(invoke).toHaveBeenCalledWith('profile_window_open', {
      serverId: 2403,
      name: 'foxyyyynm',
    });
    expect(status.selection).toEqual(selection);
  });

  it('asks for an item with its slot and enchant plus breakthrough', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 110830050, name: 'Aulamus Staff' });
    await readItemDetail(selection, 'en-US', 'abc=', {
      id: 110830050,
      slot: 1,
      enchant: 15,
      breakthrough: 2,
    });
    expect(invoke).toHaveBeenCalledWith('profile_item', {
      serverId: 2403,
      name: 'foxyyyynm',
      lang: 'en-US',
      characterId: 'abc=',
      itemId: 110830050,
      slotPos: 1,
      enchantLevel: 17,
      refresh: false,
    });
  });

  it('hands rejections over as profile errors', async () => {
    vi.mocked(invoke).mockRejectedValue({
      kind: 'private',
      message: 'Not public',
      retry_after_s: null,
    });
    await expect(readCharacterSheet(selection, 'pt-BR')).rejects.toMatchObject({ kind: 'private' });
    expect(invoke).toHaveBeenCalledWith('profile_character', {
      serverId: 2403,
      name: 'foxyyyynm',
      lang: 'pt-BR',
      refresh: false,
    });
    vi.mocked(invoke).mockResolvedValue({});
    await expect(readBoard(selection, 'en-US', 'abc=', 81)).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('reaches native only through the official profile commands, as the preview mock does', async () => {
    vi.mocked(invoke).mockResolvedValue({ id: 1, nodeList: [], info: {}, identity: {} });
    await Promise.allSettled([
      readProfileWindowStatus(),
      markProfileWindowReady(),
      openProfileWindow({ name: 'foxyyyynm', serverId: 2403 }),
      hideProfileWindow(),
      focusProfileWindow(),
      setSavedCharacter({ name: 'foxyyyynm', serverId: 2403 }, true),
      readCharacterSheet(selection, 'en-US'),
      readItemDetail(selection, 'en-US', 'abc=', { id: 1, slot: 1, enchant: 0, breakthrough: 0 }),
      readBoard(selection, 'en-US', 'abc=', 81),
    ]);
    const commands = new Set(vi.mocked(invoke).mock.calls.map(([command]) => command));
    // Native registers exactly these (src-tauri/src/main.rs); data comes from profile_api.rs,
    // which reads only NCSOFT's official hosts.
    const official = [
      'profile_window_status',
      'profile_window_ready',
      'profile_window_open',
      'profile_window_hide',
      'profile_window_focus',
      'profile_favorite_set',
      'profile_character',
      'profile_item',
      'profile_board',
    ];
    expect([...commands].sort()).toEqual([...official].sort());
    expect(Object.keys(profileCommands).sort()).toEqual([...official].sort());
  });

  it('asks in the language of the app', () => {
    expect(profileLanguage('pt-BR')).toBe('pt-BR');
    expect(profileLanguage('en')).toBe('en-US');
  });
});
