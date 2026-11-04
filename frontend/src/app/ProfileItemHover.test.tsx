import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import info from '../../../fixtures/profile/info.json';
import equipment from '../../../fixtures/profile/equipment.json';
import arcana from '../../../fixtures/profile/item-arcana.json';
import ring from '../../../fixtures/profile/item-ring.json';
import { itemKey, useCharacterProfile } from '../hooks/useCharacterProfile';
import { normalizeItem, normalizeSheet, profileError } from '../lib/profileNormalize';
import * as service from '../services/profile';
import type { ItemDetail, ProfileSelection } from '../types/profile';
import { CharacterProfile } from '../features/profile/CharacterProfile';

vi.mock('../services/profile', async (original) => ({
  ...(await original<typeof service>()),
  readCharacterSheet: vi.fn<typeof service.readCharacterSheet>(),
  readItemDetail: vi.fn<typeof service.readItemDetail>(),
  readBoard: vi.fn<typeof service.readBoard>(),
}));

const selection: ProfileSelection = { revision: 1, server_id: 2403, name: 'foxyyyynm' };
const sheet = () =>
  normalizeSheet({
    identity: { character_id: 'id=', server_id: 2403, region: 'la', name: 'foxyyyynm' },
    info,
    equipment,
    fetched_ms: 1,
  });
/** One slot's own copy: the ring fixture with this slot's soul binding, or a rune. */
const detail = (slot: number): ItemDetail => {
  if (slot >= 41) return normalizeItem(arcana)!;
  const base = normalizeItem(ring)!;
  if (slot === 23) return { ...base, name: 'Clash Rune', soulBindRate: '7.5' };
  return { ...base, soulBindRate: slot === 13 ? '11.1' : '22.2' };
};

function Window() {
  const profile = useCharacterProfile(selection, 'en-US');
  return (
    <CharacterProfile
      native
      selection={selection}
      hideNames={false}
      profile={profile}
      itemKey={itemKey}
      onClose={onClose}
    />
  );
}
const onClose = vi.fn<() => void>();

const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const slot = (name: RegExp) => screen.getByRole('button', { name });
const rest = async (element: Element, ms = 300) => {
  fireEvent.pointerEnter(element, { pointerType: 'mouse' });
  await tick(ms);
};
const popover = () => screen.getByRole('dialog');
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const reads = () => vi.mocked(service.readItemDetail).mock.calls;

async function open() {
  const view = render(<Window />);
  await tick();
  expect(screen.getByRole('heading', { level: 2, name: 'foxyyyynm' })).toBeTruthy();
  return view;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(service.readCharacterSheet).mockImplementation(() => Promise.resolve(sheet()));
  vi.mocked(service.readItemDetail).mockImplementation((_s, _l, _id, item) =>
    Promise.resolve(detail(item.slot)),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('item details on hover', () => {
  it('reads and shows the full detail of a rested-on slot without a click', async () => {
    await open();
    tab('Arcana');
    await tick();
    // The open tab reads its five cards for their effects, each once.
    expect(reads().map(([, , , item, again]) => [item.slot, again === true])).toEqual([
      [41, false],
      [42, false],
      [43, false],
      [44, false],
      [45, false],
    ]);
    expect(reads()[0]![3]).toMatchObject({ id: 810130001, slot: 41 });
    fireEvent.pointerEnter(slot(/^Arcana 1: Chalice of Vigor/), { pointerType: 'mouse' });
    await tick(100);
    expect(screen.queryByRole('dialog')).toBeNull();
    await tick(200);
    // The card's own detail, from what the tab already read.
    expect(reads()).toHaveLength(5);
    const shown = popover();
    expect(shown.getAttribute('aria-label')).toBe('Details of Chalice of Vigor');
    // The whole detail, as the pinned one shows it: set pieces and bonuses included.
    expect(within(shown).getByText('Primal Vigor')).toBeTruthy();
    expect(within(shown).getByText(/2 pieces/).textContent).toContain('active');
    expect(within(shown).getByText('Dark Crush')).toBeTruthy();
    expect(within(shown).getByText(/click the card to keep these details open/)).toBeTruthy();
    // Nothing was pinned.
    expect(screen.queryByRole('complementary')).toBeNull();

    // A rune and a ring, on the Equipment tab, are read and shown the same way.
    fireEvent.pointerLeave(slot(/^Arcana 1/), { pointerType: 'mouse' });
    await tick(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    tab('Equipment');
    fireEvent.pointerEnter(slot(/^Rune 1: Clash Rune/), { pointerType: 'mouse' });
    await tick(100);
    // Not yet: a pointer passing over reads nothing.
    expect(reads()).toHaveLength(5);
    await tick(200);
    expect(reads()).toHaveLength(6);
    expect(reads().at(-1)![3]).toMatchObject({ slot: 23 });
    expect(within(popover()).getByText('7.5%')).toBeTruthy();
    expect(within(popover()).getByText('Additional stats')).toBeTruthy();
  });

  it('stays open while the pointer crosses into it, scrolls, and retries a failed read', async () => {
    vi.mocked(service.readItemDetail).mockRejectedValueOnce(
      profileError({ kind: 'network', message: 'offline' }),
    );
    await open();
    const trigger = slot(/^Ring 1: Enraged Kromede Ring/);
    await rest(trigger);
    expect(within(popover()).getByText(/This item could not be read/)).toBeTruthy();
    // The pointer leaves the slot and reaches the popover across the gap.
    fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
    await tick(100);
    fireEvent.pointerEnter(popover(), { pointerType: 'mouse' });
    await tick(500);
    // Scrolling its own content keeps it open.
    fireEvent.scroll(popover());
    await tick();
    const retry = within(popover()).getByRole('button', { name: 'Try again' });
    fireEvent.click(retry);
    await tick();
    expect(reads()).toHaveLength(2);
    // A retry goes past native's cache, like the pinned detail's.
    expect(reads()[1]![4]).toBe(true);
    expect(within(popover()).getByText('11.1%')).toBeTruthy();
    // Leaving it closes it, after the same grace.
    fireEvent.pointerLeave(popover(), { pointerType: 'mouse' });
    await tick(300);
    expect(screen.queryByRole('dialog')).toBeNull();
    // A failed slot is not read again just by resting on it; its Retry asks.
    expect(reads()).toHaveLength(2);
  });

  it('closes when the list scrolls under it', async () => {
    await open();
    await rest(slot(/^Ring 1/));
    expect(popover()).toBeTruthy();
    fireEvent.scroll(window);
    await tick();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens at once on keyboard focus; Escape closes it before the window', async () => {
    await open();
    const trigger = slot(/^Main hand: Aulamus Staff/);
    act(() => trigger.focus());
    await tick();
    expect(popover().getAttribute('aria-label')).toBe('Details of Aulamus Staff');
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(popover().id);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    // Still focused, it stays closed until focus moves on.
    await tick(500);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('reads each slot once however often it is shown or rendered', async () => {
    const view = await open();
    const trigger = slot(/^Necklace: Enraged Kromede Necklace/);
    for (let i = 0; i < 3; i++) {
      await rest(trigger);
      view.rerender(<Window />);
      fireEvent.pointerLeave(trigger, { pointerType: 'mouse' });
      await tick(300);
    }
    expect(reads()).toHaveLength(1);
    // A quick sweep across slots reads none of them.
    fireEvent.pointerEnter(slot(/^Helmet/), { pointerType: 'mouse' });
    await tick(50);
    fireEvent.pointerLeave(slot(/^Helmet/), { pointerType: 'mouse' });
    fireEvent.pointerEnter(slot(/^Shoulders/), { pointerType: 'mouse' });
    await tick(50);
    fireEvent.pointerLeave(slot(/^Shoulders/), { pointerType: 'mouse' });
    await tick(500);
    expect(reads()).toHaveLength(1);
  });

  it('keeps the two copies of one ring apart, whatever order their answers arrive in', async () => {
    let answerFirst: (d: ItemDetail) => void = () => undefined;
    vi.mocked(service.readItemDetail).mockImplementation((_s, _l, _id, item) =>
      item.slot === 13
        ? new Promise((resolve) => {
            answerFirst = resolve;
          })
        : Promise.resolve(detail(item.slot)),
    );
    await open();
    await rest(slot(/^Ring 1: Enraged Kromede Ring/));
    expect(within(popover()).getByText('Reading this item')).toBeTruthy();
    fireEvent.pointerLeave(slot(/^Ring 1/), { pointerType: 'mouse' });
    await rest(slot(/^Ring 2: Enraged Kromede Ring/));
    expect(reads().map(([, , , item]) => item.slot)).toEqual([13, 14]);
    expect(within(popover()).getByText('22.2%')).toBeTruthy();
    // Ring 1's late answer is Ring 1's: it never shows in Ring 2's popover.
    await act(async () => answerFirst(detail(13)));
    expect(within(popover()).queryByText('11.1%')).toBeNull();
    expect(within(popover()).getByText('22.2%')).toBeTruthy();
    fireEvent.pointerLeave(slot(/^Ring 2/), { pointerType: 'mouse' });
    await tick(300);
    await rest(slot(/^Ring 1/));
    expect(within(popover()).getByText('11.1%')).toBeTruthy();
    expect(reads()).toHaveLength(2);
  });

  it('reads the hovered slot again after a Refresh and drops the answer from before it', async () => {
    let answerOld: (d: ItemDetail) => void = () => undefined;
    vi.mocked(service.readItemDetail).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerOld = resolve;
        }),
    );
    await open();
    await rest(slot(/^Ring 1/));
    expect(reads()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
    await tick();
    // The hovered slot is read again past native's cache, without a click.
    expect(reads()).toHaveLength(2);
    expect(reads()[1]![4]).toBe(true);
    expect(within(popover()).getByText('11.1%')).toBeTruthy();
    await act(async () => answerOld({ ...detail(13), soulBindRate: '99.9' }));
    expect(within(popover()).queryByText('99.9%')).toBeNull();
    expect(within(popover()).getByText('11.1%')).toBeTruthy();
  });

  it('describes pets, wings and appearances on hover without asking the service', async () => {
    await open();
    await rest(screen.getByRole('button', { name: /Pet/ }));
    expect(within(popover()).getByText(/publishes no further details/)).toBeTruthy();
    expect(within(popover()).getByText('Level')).toBeTruthy();
    fireEvent.pointerLeave(screen.getByRole('button', { name: /Pet/ }), { pointerType: 'mouse' });
    await tick(300);
    fireEvent.click(screen.getByRole('tab', { name: 'Cosmetics' }));
    const look = screen.getAllByRole('button', { name: /: / })[0]!;
    await rest(look);
    const shown = popover();
    expect(within(shown).getByText('Slot')).toBeTruthy();
    expect(within(shown).getByText(/publishes no further details/)).toBeTruthy();
    expect(reads()).toHaveLength(0);
  });

  it('reads every arcana again after a Refresh, past the cache, while one is hovered', async () => {
    await open();
    tab('Arcana');
    await rest(slot(/^Arcana 2: /));
    const slots = (again: boolean) => [41, 42, 43, 44, 45].map((n) => [n, again]);
    expect(reads().map(([, , , item, again]) => [item.slot, again === true])).toEqual(slots(false));
    expect(within(popover()).getByText('Primal Vigor')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
    await tick();
    expect(reads().map(([, , , item, again]) => [item.slot, again === true])).toEqual([
      ...slots(false),
      ...slots(true),
    ]);
    expect(within(popover()).getByText('Primal Vigor')).toBeTruthy();
    // Switching back finds Equipment's slots unchanged, read from the same cache.
    fireEvent.pointerLeave(slot(/^Arcana 2/), { pointerType: 'mouse' });
    await tick(300);
    tab('Equipment');
    await rest(slot(/^Ring 1/));
    expect(within(popover()).getByText('11.1%')).toBeTruthy();
    expect(reads()).toHaveLength(11);
  });

  it('pins on click (or a tap) and then shows no second copy on hover', async () => {
    await open();
    tab('Arcana');
    const trigger = slot(/^Arcana 1/);
    // A tap opens nothing by hovering; its click pins.
    fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
    await tick(400);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    await tick();
    expect(screen.getByRole('complementary', { name: 'Details of Chalice of Vigor' })).toBeTruthy();
    await rest(trigger);
    expect(screen.queryByRole('dialog')).toBeNull();
    // The five reads of the open tab; pinning and hovering read nothing more.
    expect(reads()).toHaveLength(5);
  });
});

describe('arcana tab', () => {
  const effects = () => screen.getByRole('region', { name: 'Arcana effects' });
  const total = (name: string) => within(effects()).getByText(name).nextElementSibling?.textContent;

  it('totals the effects of all five cards once each, partial until every card answers', async () => {
    vi.mocked(service.readItemDetail).mockImplementation((_s, _l, _id, item) =>
      item.slot === 45
        ? Promise.reject(profileError({ kind: 'network', message: 'offline' }))
        : Promise.resolve(detail(item.slot)),
    );
    await open();
    tab('Arcana');
    await tick();
    expect(reads()).toHaveLength(5);
    // Four chalices answered: 4 × (20 + 3), labelled partial, the fifth not counted as zero.
    expect(within(effects()).getByText('Partial: 4 of 5 cards read')).toBeTruthy();
    expect(within(effects()).getByText('1 card could not be read.')).toBeTruthy();
    expect(total('Time [Siel]')).toBe('92');
    expect(slot(/^Arcana 5: Mirror of Magic.*, could not be read$/)).toBeTruthy();
    // A failed card is not read again on its own.
    await tick(1000);
    expect(reads()).toHaveLength(5);

    vi.mocked(service.readItemDetail).mockImplementation((_s, _l, _id, item) =>
      Promise.resolve(detail(item.slot)),
    );
    fireEvent.click(within(effects()).getByRole('button', { name: 'Try again' }));
    await tick();
    expect(reads().at(-1)!.slice(3)).toMatchObject([{ slot: 45 }, true]);
    expect(within(effects()).queryByText(/^Partial/)).toBeNull();
    expect(total('Time [Siel]')).toBe('115');
    expect(total('Dark Crush')).toBe('Lv. +15');
    // Five cards of one set name it once, with the service's own worn count.
    expect(within(effects()).getAllByText('Primal Vigor')).toHaveLength(1);
    expect(within(effects()).getByText('3 pieces worn')).toBeTruthy();
  });

  it('opens the full detail of each of the five cards on hover', async () => {
    await open();
    tab('Arcana');
    await tick();
    const names = [
      'Chalice of Vigor',
      'Parchment of Vigor',
      'Compass of Vigor',
      'Bell of Magic',
      'Mirror of Magic',
    ];
    for (const [i, name] of names.entries()) {
      const card = slot(new RegExp(`^Arcana ${i + 1}: ${name}, enchant `));
      await rest(card);
      expect(popover().getAttribute('aria-label')).toBe(`Details of ${name}`);
      expect(within(popover()).getByText('Primal Vigor')).toBeTruthy();
      fireEvent.pointerLeave(card, { pointerType: 'mouse' });
      await tick(300);
      expect(screen.queryByRole('dialog')).toBeNull();
    }
    expect(reads()).toHaveLength(5);
  });
});
