import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import info from '../../../fixtures/profile/info.json';
import equipment from '../../../fixtures/profile/equipment.json';
import weapon from '../../../fixtures/profile/item-weapon.json';
import boardFixture from '../../../fixtures/profile/board.json';
import { CharacterProfile } from '../features/profile/CharacterProfile';
import { normalizeBoard, normalizeItem, normalizeSheet } from '../lib/profileNormalize';
import * as service from '../services/profile';
import type { CharacterSheet, ItemDetail, ProfileSelection } from '../types/profile';
import { itemKey, useCharacterProfile } from './useCharacterProfile';

vi.mock('../services/profile', () => ({
  readCharacterSheet: vi.fn<typeof service.readCharacterSheet>(),
  readItemDetail: vi.fn<typeof service.readItemDetail>(),
  readBoard: vi.fn<typeof service.readBoard>(),
}));

afterEach(() => {
  vi.resetAllMocks();
});

const sheetFor = (name: string): CharacterSheet => {
  const sheet = normalizeSheet({
    identity: { character_id: `${name}-id=`, server_id: 2403, region: 'la', name, lang: 'en-US' },
    info,
    equipment,
    fetched_ms: 1,
  });
  return { ...sheet, info: sheet.info && { ...sheet.info, name } };
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const first: ProfileSelection = { revision: 1, server_id: 2403, name: 'Aria' };
const second: ProfileSelection = { revision: 2, server_id: 2403, name: 'Bryn' };

describe('character profile hook', () => {
  it('never lets a slow answer for an earlier character replace a newer one', async () => {
    const slow = deferred<CharacterSheet>();
    vi.mocked(service.readCharacterSheet).mockImplementation((selection) =>
      selection.name === 'Aria' ? slow.promise : Promise.resolve(sheetFor('Bryn')),
    );
    const { result, rerender } = renderHook(
      ({ selection }) => useCharacterProfile(selection, 'en-US'),
      { initialProps: { selection: first } },
    );
    expect(result.current.sheet?.state).toBe('loading');
    rerender({ selection: second });
    await waitFor(() => expect(result.current.sheet?.data?.info?.name).toBe('Bryn'));
    await act(async () => slow.resolve(sheetFor('Aria')));
    expect(result.current.sheet?.data?.info?.name).toBe('Bryn');
  });

  it('starts empty for a new character and keeps the shown one while refreshing', async () => {
    vi.mocked(service.readCharacterSheet).mockResolvedValue(sheetFor('Aria'));
    const { result } = renderHook(() => useCharacterProfile(first, 'en-US'));
    await waitFor(() => expect(result.current.sheet?.state).toBe('ready'));
    const again = deferred<CharacterSheet>();
    vi.mocked(service.readCharacterSheet).mockReturnValue(again.promise);
    act(() => result.current.refresh());
    expect(result.current.sheet).toMatchObject({
      state: 'loading',
      data: { identity: { name: 'Aria' } },
    });
    expect(service.readCharacterSheet).toHaveBeenLastCalledWith(first, 'en-US', true);
    // A failed refresh keeps the last good answer under its error.
    await act(async () => again.reject({ kind: 'rate_limited', message: '', retryAfterS: 9 }));
    expect(result.current.sheet).toMatchObject({
      state: 'error',
      data: { identity: { name: 'Aria' } },
    });
  });

  it('reads each item detail once, per slot, until refreshed', async () => {
    vi.mocked(service.readCharacterSheet).mockResolvedValue(sheetFor('Aria'));
    vi.mocked(service.readItemDetail).mockResolvedValue({ id: 310330053 } as never);
    const { result } = renderHook(() => useCharacterProfile(first, 'en-US'));
    await waitFor(() => expect(result.current.sheet?.state).toBe('ready'));
    const gear = result.current.sheet!.data!.equipment!.items;
    const [ring1, ring2] = gear.filter((i) => i.id === 310330053);
    act(() => result.current.loadItem(ring1!));
    act(() => result.current.loadItem(ring1!));
    await waitFor(() => expect(result.current.items[itemKey(ring1!)]?.state).toBe('ready'));
    act(() => result.current.loadItem(ring1!));
    expect(service.readItemDetail).toHaveBeenCalledTimes(1);
    expect(service.readItemDetail).toHaveBeenCalledWith(first, 'en-US', 'Aria-id=', ring1, false);
    // The same ring in the other hand is another copy with its own rolls.
    act(() => result.current.loadItem(ring2!));
    expect(itemKey(ring1!)).not.toBe(itemKey(ring2!));
    expect(service.readItemDetail).toHaveBeenCalledTimes(2);
    act(() => result.current.loadItem(ring1!, true));
    expect(service.readItemDetail).toHaveBeenLastCalledWith(
      first,
      'en-US',
      'Aria-id=',
      ring1,
      true,
    );
  });

  it('drops a board answer for a character no longer shown', async () => {
    vi.mocked(service.readCharacterSheet).mockImplementation((selection) =>
      Promise.resolve(sheetFor(selection.name)),
    );
    const board = deferred<never>();
    vi.mocked(service.readBoard).mockReturnValue(board.promise);
    const { result, rerender } = renderHook(
      ({ selection }) => useCharacterProfile(selection, 'en-US'),
      { initialProps: { selection: first } },
    );
    await waitFor(() => expect(result.current.sheet?.state).toBe('ready'));
    act(() => result.current.loadBoard(81));
    expect(result.current.boards[81]?.state).toBe('loading');
    rerender({ selection: second });
    await waitFor(() => expect(result.current.sheet?.data?.info?.name).toBe('Bryn'));
    await act(async () => board.resolve({ id: 81 } as never));
    expect(result.current.boards[81]).toBeUndefined();
  });

  it('asks for nothing without a character', () => {
    const { result } = renderHook(() => useCharacterProfile(null, 'en-US'));
    expect(result.current.sheet).toBeNull();
    expect(service.readCharacterSheet).not.toHaveBeenCalled();
  });

  it('never lets an answer from before a Refresh settle a request made after it', async () => {
    vi.mocked(service.readCharacterSheet).mockResolvedValue(sheetFor('Aria'));
    const before = deferred<ItemDetail>();
    const after = deferred<ItemDetail>();
    vi.mocked(service.readItemDetail)
      .mockReturnValueOnce(before.promise)
      .mockReturnValueOnce(after.promise);
    const { result } = renderHook(() => useCharacterProfile(first, 'en-US'));
    await waitFor(() => expect(result.current.sheet?.state).toBe('ready'));
    const ring = result.current.sheet!.data!.equipment!.items.find((i) => i.id === 310330053)!;
    act(() => result.current.loadItem(ring));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.sheet?.state).toBe('ready'));
    // The refreshed sheet starts a new run: the item is asked for again, past native's cache.
    act(() => result.current.loadItem(ring));
    expect(service.readItemDetail).toHaveBeenLastCalledWith(first, 'en-US', 'Aria-id=', ring, true);
    await act(async () => before.resolve({ name: 'Old' } as ItemDetail));
    expect(result.current.items[itemKey(ring)]?.state).toBe('loading');
    // The old answer did not clear the new request, so asking again starts nothing new.
    act(() => result.current.loadItem(ring));
    expect(service.readItemDetail).toHaveBeenCalledTimes(2);
    await act(async () => after.resolve({ name: 'New' } as ItemDetail));
    expect(result.current.items[itemKey(ring)]).toMatchObject({
      state: 'ready',
      data: { name: 'New' },
    });
  });
});

/** The board as the service answers after the character raised Onslaught. */
const raisedBoard = JSON.parse(
  JSON.stringify(boardFixture).replaceAll('"Onslaught +1"', '"Onslaught +3"'),
) as unknown;

/** The window as `ProfileApp` composes it: the real hook feeding the real tabs. */
function ProfileWindow({ selection }: { selection: ProfileSelection }) {
  const profile = useCharacterProfile(selection, 'en-US');
  return (
    <CharacterProfile
      native
      selection={selection}
      hideNames={false}
      profile={profile}
      itemKey={itemKey}
      onClose={() => undefined}
    />
  );
}

describe('a refreshed profile with a detail open', () => {
  afterEach(cleanup);

  /** Every detail answers from the service's newer data only when native's cache is bypassed. */
  function serve() {
    let sheet = deferred<CharacterSheet>();
    vi.mocked(service.readCharacterSheet).mockImplementation(() => sheet.promise);
    vi.mocked(service.readItemDetail).mockImplementation((_s, _l, _id, _item, refresh) =>
      Promise.resolve(
        normalizeItem(refresh ? { ...weapon, soulBindRate: '70.1' } : weapon) as ItemDetail,
      ),
    );
    vi.mocked(service.readBoard).mockImplementation((_s, _l, _id, boardId, refresh) =>
      Promise.resolve(normalizeBoard(refresh ? raisedBoard : boardFixture, boardId)!),
    );
    render(<ProfileWindow selection={first} />);
    return {
      answer: async () => {
        await act(async () => sheet.resolve(sheetFor('Aria')));
      },
      refresh: async () => {
        sheet = deferred<CharacterSheet>();
        fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
        await act(async () => sheet.resolve(sheetFor('Aria')));
      },
    };
  }

  it('reads the open item again and shows its new rolls', async () => {
    const profile = serve();
    await profile.answer();
    fireEvent.click(screen.getByRole('button', { name: /^Main hand: Aulamus Staff/ }));
    const detail = () => screen.getByRole('complementary', { name: 'Details of Aulamus Staff' });
    await waitFor(() => expect(within(detail()).getByText('62.3%')).toBeTruthy());
    await profile.refresh();
    await waitFor(() => expect(within(detail()).getByText('70.1%')).toBeTruthy());
    expect(within(detail()).queryByText('Reading this item')).toBeNull();
    expect(service.readItemDetail).toHaveBeenCalledTimes(2);
    expect(vi.mocked(service.readItemDetail).mock.calls.map((call) => call[4])).toEqual([
      false,
      true,
    ]);
  });

  it('reads the shown Daevanion board again instead of waiting forever', async () => {
    const profile = serve();
    await profile.answer();
    fireEvent.click(screen.getByRole('tab', { name: 'Daevanion' }));
    await waitFor(() => expect(screen.getByText('Onslaught +1')).toBeTruthy());
    await profile.refresh();
    await waitFor(() => expect(screen.getByText('Onslaught +3')).toBeTruthy());
    expect(screen.queryByText('Reading this board')).toBeNull();
    expect(vi.mocked(service.readBoard).mock.calls.map((call) => [call[3], call[4]])).toEqual([
      [81, false],
      [81, true],
    ]);
  });

  it('reads an open skill’s boards again without showing “no bonuses” meanwhile', async () => {
    const profile = serve();
    await profile.answer();
    fireEvent.click(screen.getByRole('tab', { name: 'Skills' }));
    fireEvent.click(screen.getByRole('button', { name: 'Onslaught, Level 16' }));
    const detail = () => screen.getByRole('complementary', { name: 'Details of Onslaught' });
    await waitFor(() => expect(within(detail()).getAllByText('+1').length).toBeGreaterThan(0));
    const held = deferred<void>();
    vi.mocked(service.readBoard).mockImplementation((_s, _l, _id, boardId) =>
      held.promise.then(() => normalizeBoard(raisedBoard, boardId)!),
    );
    await profile.refresh();
    expect(within(detail()).getByText('Reading Daevanion boards')).toBeTruthy();
    expect(within(detail()).queryByText('None in what has been read so far.')).toBeNull();
    await act(async () => held.resolve());
    await waitFor(() => expect(within(detail()).getAllByText('+3').length).toBeGreaterThan(0));
    expect(within(detail()).queryByText('+1')).toBeNull();
    expect(within(detail()).queryByText('Reading Daevanion boards')).toBeNull();
    const refreshed = vi.mocked(service.readBoard).mock.calls.filter((call) => call[4]);
    expect(refreshed.map((call) => call[3])).toEqual([81, 82, 83, 84, 86]);
  });
});
