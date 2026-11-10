import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import info from '../../../../fixtures/profile/info.json';
import equipment from '../../../../fixtures/profile/equipment.json';
import weapon from '../../../../fixtures/profile/item-weapon.json';
import arcana from '../../../../fixtures/profile/item-arcana.json';
import boardFixture from '../../../../fixtures/profile/board.json';
import nodeArt from '../../data/daevanion-art.json';
import {
  normalizeBoard,
  normalizeItem,
  normalizeSheet,
  profileError,
} from '../../lib/profileNormalize';
import type { EquippedItem, Lazy, ProfileSelection } from '../../types/profile';
import { CharacterProfile, type ProfileData } from './CharacterProfile';

afterEach(cleanup);

const selection: ProfileSelection = { revision: 1, server_id: 2403, name: 'foxyyyynm' };
const key = (i: EquippedItem) => `${i.id}@${i.slot}`;
const sheet = (overrides: Record<string, unknown> = {}) =>
  normalizeSheet({
    identity: {
      character_id: 'id=',
      server_id: 2403,
      region: 'la',
      name: 'foxyyyynm',
      lang: 'en-US',
    },
    info,
    equipment,
    fetched_ms: Date.UTC(2026, 10, 4, 14, 0),
    ...overrides,
  });

function data(overrides: Partial<ProfileData> = {}): ProfileData {
  return {
    sheet: { state: 'ready', data: sheet() },
    items: {},
    boards: {},
    refresh: vi.fn<() => void>(),
    retry: vi.fn<() => void>(),
    loadItem: vi.fn<ProfileData['loadItem']>(),
    loadBoard: vi.fn<ProfileData['loadBoard']>(),
    ...overrides,
  };
}

function show(profile: ProfileData, props: Partial<Parameters<typeof CharacterProfile>[0]> = {}) {
  const onClose = vi.fn<() => void>();
  const view = render(
    <CharacterProfile
      native
      selection={selection}
      hideNames={false}
      profile={profile}
      itemKey={key}
      onClose={onClose}
      {...props}
    />,
  );
  return { ...view, onClose };
}

const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('character profile window', () => {
  it('heads the window with who the character is and what they wear', () => {
    show(data(), {
      onCopy: vi.fn<(text: string) => Promise<void>>(),
      onCopyLink: vi.fn<() => Promise<void>>(),
      onOpenShugo: vi.fn<() => void>(),
      onSetSaved: vi.fn<(saved: boolean) => Promise<void>>(),
      onOpenSaved: vi.fn<(c: { name: string }) => void>(),
    });
    const header = screen.getByRole('heading', { level: 2, name: 'foxyyyynm' }).closest('header')!;
    expect(within(header).getByText('Level 45 · Chanter · Asmodians · Triniel')).toBeTruthy();
    expect(within(header).getByText('166,140')).toBeTruthy();
    expect(within(header).getByText('2,752')).toBeTruthy();
    expect(within(header).getByText('Has Exceptional Skill')).toBeTruthy();
    const titles = within(header).getByRole('list', { name: 'Equipped titles' });
    expect(within(titles).getAllByRole('listitem')).toHaveLength(3);
    // Save and Share are labelled buttons beside who the character is, not caption icons.
    expect(within(header).getByRole('button', { name: 'Save' })).toBeTruthy();
    expect(within(header).getByRole('button', { name: 'Share' })).toBeTruthy();
    const caption = screen.getByRole('button', { name: 'Close' }).closest('header')!;
    expect(
      within(caption)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')),
    ).toEqual(['Refresh profile', 'Saved characters', 'Open in Shugo.gg', 'Close']);
    expect(within(caption).getByText(/^Read at \d{1,2}:\d{2}/)).toBeTruthy();
  });

  it('lists each slot as a row with its slot, grade word, enchant and breakthrough', () => {
    show(data());
    const weapons = screen.getByRole('region', { name: 'Weapons' });
    expect(within(weapons).getByRole('heading', { name: /^Weapons\s*2$/ })).toBeTruthy();
    const staff = within(weapons).getByRole('button', { name: /^Main hand: Aulamus Staff/ });
    // Art (its initial without art), name, slot · grade word, then the enchant figure.
    expect(staff.textContent).toMatch(/Aulamus StaffMain hand · Unique\+15$/);
    // Grade is written, never left to the frame's colour alone.
    expect(within(staff).getByText('Unique')).toBeTruthy();
    // A pet has no enchant, so its row shows its level instead.
    const pet = screen.getByRole('button', { name: /Kuru Overseer/ });
    expect(within(pet).getByText(/^Lv \d+$/)).toBeTruthy();
  });

  it('pins this character’s own item, with its stones, breakthrough and soul binding', () => {
    const profile = data();
    const { rerender } = show(profile);
    const staff = screen.getByRole('button', {
      name: 'Main hand: Aulamus Staff, Unique, enchant +15, breakthrough 2',
    });
    fireEvent.click(staff);
    expect(profile.loadItem).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 1, breakthrough: 2 }),
    );
    expect(screen.getByText('Reading this item')).toBeTruthy();

    const loaded: Record<string, Lazy<never>> = {
      '110830050@1': { state: 'ready', data: normalizeItem(weapon) as never },
    };
    rerender(
      <CharacterProfile
        native
        selection={selection}
        hideNames={false}
        profile={{ ...profile, items: loaded }}
        itemKey={key}
        onClose={vi.fn<() => void>()}
      />,
    );
    const detail = screen.getByRole('complementary', { name: 'Details of Aulamus Staff' });
    expect(within(detail).getByText('287 ~ 395')).toBeTruthy();
    expect(within(detail).getByText('(+119)')).toBeTruthy();
    expect(within(detail).getByText('Breakthrough bonuses')).toBeTruthy();
    expect(within(detail).getByText('+2%')).toBeTruthy();
    expect(within(detail).getByText('62.3%')).toBeTruthy();
    expect(within(detail).getByText('Manastones')).toBeTruthy();
    expect(within(detail).getByText('Back Attack')).toBeTruthy();
    expect(within(detail).getByText('Endless Prelude (Staff)')).toBeTruthy();
    expect(within(detail).getByText('Reward Chest')).toBeTruthy();
    // The two copies of one ring are two slots.
    expect(screen.getByRole('button', { name: /^Ring 1: Enraged Kromede Ring/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Ring 2: Enraged Kromede Ring/ })).toBeTruthy();
  });

  it('closes a pinned detail with Escape before Escape can close the window', () => {
    const { onClose } = show(data());
    fireEvent.click(screen.getByRole('button', { name: /^Main hand: Aulamus Staff/ }));
    expect(screen.getByRole('complementary', { name: 'Details of Aulamus Staff' })).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows set bonuses as active only for the pieces worn', () => {
    const profile = data({
      items: { '810130001@41': { state: 'ready', data: normalizeItem(arcana)! } },
    });
    show(profile);
    tab('Arcana');
    fireEvent.click(screen.getByRole('button', { name: /^Arcana 1: Chalice of Vigor/ }));
    const detail = screen.getByRole('complementary');
    expect(within(detail).getByText('Primal Vigor')).toBeTruthy();
    expect(within(detail).getByText(/2 pieces/).textContent).toContain('active');
    expect(within(detail).getByText('4 pieces').textContent).not.toContain('active');
    expect(within(detail).getByText('Dark Crush')).toBeTruthy();
  });

  it('lists arcana on their own tab and every other slot on Equipment, each once', () => {
    show(data());
    const slots = () =>
      screen.getAllByRole('button', { name: /^[^:]+: .*, enchant / }).map((b) => b.ariaLabel);
    const gear = slots();
    expect(gear.some((name) => name?.startsWith('Arcana'))).toBe(false);
    expect(screen.queryByRole('region', { name: 'Arcana' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Pet and wings' })).toBeTruthy();
    tab('Arcana');
    const arcana = slots();
    expect(arcana).toHaveLength(5);
    expect(arcana.every((name) => name?.startsWith('Arcana'))).toBe(true);
    expect(screen.queryByRole('region', { name: 'Pet and wings' })).toBeNull();
    // Together the two tabs show every equipped slot the sheet holds.
    expect(gear.length + arcana.length).toBe(sheet().equipment!.items.length);
  });

  /** The fixture's sheet wearing only the arcana in `keep` (`Arcana1`…`Arcana5`). */
  const wearingArcana = (...keep: string[]) => {
    const list = equipment.equipment.equipmentList.filter(
      (i) => !i.slotPosName.startsWith('Arcana') || keep.includes(i.slotPosName),
    );
    return data({
      sheet: {
        state: 'ready',
        data: sheet({
          equipment: { ...equipment, equipment: { ...equipment.equipment, equipmentList: list } },
        }),
      },
    });
  };

  it('keeps the arcana layout with a placeholder for every slot when none is equipped', () => {
    const profile = wearingArcana();
    show(profile);
    tab('Arcana');
    const cards = screen.getByRole('region', { name: 'Equipped arcana' });
    const slots = within(cards).getAllByRole('listitem');
    expect(slots.map((s) => s.textContent)).toEqual([
      'Arcana 1: emptyEmptyArcana 1',
      'Arcana 2: emptyEmptyArcana 2',
      'Arcana 3: emptyEmptyArcana 3',
      'Arcana 4: emptyEmptyArcana 4',
      'Arcana 5: emptyEmptyArcana 5',
    ]);
    // Placeholders open nothing, so they are no controls and no focus stops.
    expect(within(cards).queryAllByRole('button')).toHaveLength(0);
    // The words are said once, beside the placeholders, and nothing is read.
    expect(screen.getAllByText('No arcana are equipped.')).toHaveLength(1);
    expect(
      within(screen.getByRole('region', { name: 'Arcana effects' })).getByText(
        'No arcana are equipped.',
      ),
    ).toBeTruthy();
    expect(profile.loadItem).not.toHaveBeenCalled();
  });

  it('shows the worn cards and placeholders for the missing ones in the same grid', () => {
    show(wearingArcana('Arcana1', 'Arcana4'));
    tab('Arcana');
    const cards = screen.getByRole('region', { name: 'Equipped arcana' });
    const slots = within(cards).getAllByRole('listitem');
    expect(slots).toHaveLength(5);
    expect(
      within(slots[0]!).getByRole('button', { name: /^Arcana 1: Chalice of Vigor/ }),
    ).toBeTruthy();
    expect(
      within(slots[3]!).getByRole('button', { name: /^Arcana 4: Bell of Magic/ }),
    ).toBeTruthy();
    for (const at of [1, 2, 4]) {
      expect(within(slots[at]!).queryByRole('button')).toBeNull();
      expect(within(slots[at]!).getByText(`Arcana ${at + 1}: empty`)).toBeTruthy();
    }
    expect(screen.queryByText('No arcana are equipped.')).toBeNull();
  });

  it('describes pets, wings and appearance items with what the service publishes', () => {
    show(data());
    fireEvent.click(screen.getByText('Kuru Overseer'));
    const detail = screen.getByRole('complementary');
    expect(within(detail).getByText('Level')).toBeTruthy();
    expect(within(detail).getByText(/publishes no further details/)).toBeTruthy();

    tab('Cosmetics');
    expect(
      screen.getByRole('button', { name: "Earring (left): Auldor's Feather (Earrings)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: "Earring (right): Auldor's Feather (Earrings)" }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: "Wing appearance: Fairy's Dream Wings" }),
    ).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(14);
  });

  it('lists skills by kind and never invents what the service does not publish', () => {
    show(data());
    tab('Skills');
    const active = screen.getByRole('region', { name: 'Active' });
    expect(within(active).getAllByRole('button')).toHaveLength(12);
    const stigma = screen.getByRole('region', { name: 'Stigma' });
    expect(within(stigma).getByText('Slotted')).toBeTruthy();
    expect(within(stigma).getByText('Not learned')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Barrier Spell, Not learned' }));
    const detail = screen.getByRole('complementary', { name: 'Details of Barrier Spell' });
    expect(within(detail).getByText('22')).toBeTruthy();
    expect(
      within(detail).getByText(/Descriptions, cost, cooldown, cast time, range and specialties/),
    ).toBeTruthy();
    expect(within(detail).getByText(/does not publish which specialties/)).toBeTruthy();
    expect(within(detail).queryByText(/Cooldown|Cast time|Range|catalogue/)).toBeNull();
  });

  it('calls a stigma learned whenever the service says acquired, even at level 0', () => {
    show(data());
    tab('Skills');
    const stigma = screen.getByRole('region', { name: 'Stigma' });
    const tile = (name: RegExp) => within(stigma).getByRole('button', { name });
    // Official answer: Sprint Mantra slotted at 0, Obliterate learned and unslotted at 0,
    // Barrier Spell neither learned nor slotted at 0.
    const slotted = tile(/^Sprint Mantra, /);
    const learned = tile(/^Obliterate, /);
    const locked = tile(/^Barrier Spell, /);
    expect(slotted.getAttribute('aria-label')).toBe('Sprint Mantra, Level 0');
    expect(learned.getAttribute('aria-label')).toBe('Obliterate, Level 0');
    expect(locked.getAttribute('aria-label')).toBe('Barrier Spell, Not learned');
    expect([slotted, learned, locked].map((t) => t.hasAttribute('data-learned'))).toEqual([
      true,
      true,
      false,
    ]);
    expect(within(learned).getByText('Lv 0')).toBeTruthy();
    expect(within(locked).getByText('Lv 22+')).toBeTruthy();
    // The group it sits in agrees with its tile and its detail.
    const group = (title: string) => within(stigma).getByText(title).parentElement!;
    expect(
      within(group('Learned, not slotted')).getByRole('button', { name: /^Obliterate/ }),
    ).toBeTruthy();
    fireEvent.click(learned);
    const detail = screen.getByRole('complementary', { name: 'Details of Obliterate' });
    expect(within(detail).getByText('Skill level').nextElementSibling?.textContent).toBe('0');
    expect(within(detail).getByText('State').nextElementSibling?.textContent).toBe('Learned');
    fireEvent.click(locked);
    const none = screen.getByRole('complementary', { name: 'Details of Barrier Spell' });
    expect(within(none).getByText('Skill level').nextElementSibling?.textContent).toBe(
      'Not learned',
    );
  });

  it('says an unsent skill level is not published instead of calling it 0', () => {
    const base = sheet();
    const skills = base.equipment!.skills.map((s) =>
      s.name === 'Obliterate' ? { ...s, level: null } : s,
    );
    show(
      data({
        sheet: { state: 'ready', data: { ...base, equipment: { ...base.equipment!, skills } } },
      }),
    );
    tab('Skills');
    const tile = screen.getByRole('button', { name: 'Obliterate, Level not published' });
    expect(tile.hasAttribute('data-learned')).toBe(true);
    expect(within(tile).getByText('Lv –')).toBeTruthy();
  });

  it('reads the open boards once for a skill’s level bonuses and names the ones they state', () => {
    const profile = data();
    const { rerender } = show(profile);
    tab('Skills');
    expect(profile.loadBoard).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Onslaught, Level 16' }));
    // Every board with open nodes, and no locked one (Ariel has none open).
    expect(vi.mocked(profile.loadBoard).mock.calls.map(([id]) => id)).toEqual([81, 82, 83, 84, 86]);
    rerender(
      <CharacterProfile
        native
        selection={selection}
        hideNames={false}
        profile={{ ...profile, boards: { 81: { state: 'loading', data: null } } }}
        itemKey={key}
        onClose={vi.fn<() => void>()}
      />,
    );
    const detail = screen.getByRole('complementary', { name: 'Details of Onslaught' });
    expect(within(detail).getByText('Reading Daevanion boards')).toBeTruthy();
    expect(within(detail).queryByText('None in what has been read so far.')).toBeNull();

    rerender(
      <CharacterProfile
        native
        selection={selection}
        hideNames={false}
        profile={{
          ...profile,
          boards: {
            81: { state: 'ready', data: normalizeBoard(boardFixture, 81)! },
            ...Object.fromEntries(
              [82, 83, 84, 86].map((id) => [
                id,
                { state: 'error', error: profileError('down'), data: null },
              ]),
            ),
          },
        }}
        itemKey={key}
        onClose={vi.fn<() => void>()}
      />,
    );
    // Only Nezekan was read; the rest failed, so nothing is still pending.
    expect(profile.loadBoard).toHaveBeenCalledTimes(5);
    const ready = screen.getByRole('complementary', { name: 'Details of Onslaught' });
    expect(within(ready).getByText('Daevanion: Nezekan')).toBeTruthy();
    expect(within(ready).getByText('+1')).toBeTruthy();
    expect(within(ready).queryByText('Reading Daevanion boards')).toBeNull();
  });

  it('draws a board at the service’s rows and columns and explains a chosen node', () => {
    const profile = data({
      boards: { 81: { state: 'ready', data: normalizeBoard(boardFixture, 81)! } },
    });
    show(profile);
    tab('Daevanion');
    expect(profile.loadBoard).toHaveBeenCalledWith(81);
    expect(screen.getByRole('button', { name: 'Ariel: 0 of 152 nodes open' })).toBeTruthy();
    expect(screen.getByText('Active skill upgrades')).toBeTruthy();
    expect(screen.getByText('Stat bonuses')).toBeTruthy();
    const node = screen.getByRole('button', { name: 'Cooldown Reduction, Open, row 3, column 13' });
    // Each node is the official art for its grade and state; closed nodes recede, the start
    // node (the character's class) never does.
    const art = (name: string) => screen.getByRole('button', { name }).querySelector('img')!;
    expect(art('Cooldown Reduction, Open, row 3, column 13').getAttribute('src')).toBe(
      `/daevanion-art/${nodeArt.nodes.unique_open.file}`,
    );
    expect(art('Cooldown Reduction, Open, row 3, column 13').className).not.toContain('opacity-50');
    const closed = art('Skill Level Up - Wave Blow, Not open, row 3, column 9');
    expect(closed.getAttribute('src')).toBe(`/daevanion-art/${nodeArt.nodes.legend.file}`);
    expect(closed.className).toContain('opacity-50');
    const start = art('Nezekan - Start, Not open, row 8, column 8');
    expect(start.getAttribute('src')).toBe(`/daevanion-art/${nodeArt.nodes.start_chanter.file}`);
    expect(start.className).not.toContain('opacity-50');
    // The key names the grades this board uses, with their art.
    const key = screen.getByRole('list', { name: 'Node key' });
    expect(
      within(key)
        .getAllByText(/^(Common|Rare|Unique|Legendary)$/)
        .map((e) => e.textContent),
    ).toEqual(['Common', 'Rare', 'Unique', 'Legendary']);
    // Art that fails to load leaves the node's written initial.
    fireEvent.error(closed);
    const fallback = screen.getByRole('button', {
      name: 'Skill Level Up - Wave Blow, Not open, row 3, column 9',
    });
    expect(fallback.querySelector('img')).toBeNull();
    expect(fallback.textContent).toBe('S');
    fireEvent.click(node);
    expect(node.getAttribute('aria-pressed')).toBe('true');
    expect(node.className).toContain('ring-accent');
    expect(screen.getByText('Cooldown Reduction +1.5%')).toBeTruthy();
    expect(screen.getByText('Row 3, column 13')).toBeTruthy();
    // Arrow keys move between nodes.
    node.focus();
    fireEvent.keyDown(node, { key: 'ArrowLeft' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Critical Hit, Open, row 3, column 12',
    );
    // Escape leaves the node before the window.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.getByText('Active skill upgrades')).toBeTruthy();
  });

  it('opens a board at a readable size centred on its start, and still fits it whole', () => {
    // A frame that measures itself at once, like the real observer after layout.
    let frame = { width: 400, height: 300 };
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(private readonly callback: ResizeObserverCallback) {}
        observe() {
          this.callback([], this as unknown as ResizeObserver);
        }
        disconnect() {}
      },
    );
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => frame.width);
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(() => frame.height);
    try {
      const board = { 81: { state: 'ready', data: normalizeBoard(boardFixture, 81)! } } as const;
      const view = show(data({ boards: board }));
      tab('Daevanion');
      const canvas = screen.getByRole('group', { name: /^Board nodes/ });
      const cells = () => (canvas.firstElementChild as HTMLElement).style.gridTemplateColumns;
      const fit = screen.getByRole('button', { name: 'Fit the board' });
      // Fitting the 15 × 15 board in 400 × 300 would draw 18 px cells; it opens at 36 instead,
      // scrolled so the start node (row 8, column 8, centred at 8 + 7.5 × 36) sits mid-frame.
      expect(cells()).toBe('repeat(15, 36px)');
      expect(canvas.scrollLeft).toBe(8 + 7.5 * 36 - 200);
      expect(canvas.scrollTop).toBe(8 + 7.5 * 36 - 150);
      expect(fit.getAttribute('aria-pressed')).toBe('false');
      // Zooming keeps the point at the frame's centre there.
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(cells()).toBe('repeat(15, 45px)');
      expect(canvas.scrollLeft).toBe(Math.round(8 + 7.5 * 45 - 200));
      expect(canvas.scrollTop).toBe(Math.round(8 + 7.5 * 45 - 150));
      // Fit still shows the whole board, and says so only while it does.
      fireEvent.click(fit);
      expect(cells()).toBe('repeat(15, 18px)');
      expect(fit.getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
      expect(fit.getAttribute('aria-pressed')).toBe('false');
      view.unmount();

      // A frame large enough for the whole board at a readable size opens it fitted.
      frame = { width: 800, height: 700 };
      show(data({ boards: board }));
      tab('Daevanion');
      const large = screen.getByRole('group', { name: /^Board nodes/ });
      expect((large.firstElementChild as HTMLElement).style.gridTemplateColumns).toBe(
        'repeat(15, 45px)',
      );
      expect(
        screen.getByRole('button', { name: 'Fit the board' }).getAttribute('aria-pressed'),
      ).toBe('true');
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('shows stats on the wheel or as text, with sources and the honest limit', () => {
    // A stat the service leaves out keeps its place, marked, never shown as 0.
    const statList = info.stat.statList.filter((s) => s.type !== 'Space');
    show(
      data({ sheet: { state: 'ready', data: sheet({ info: { ...info, stat: { statList } } }) } }),
    );
    tab('Stats');
    const wheel = screen.getByRole('figure', { name: /Divine stats on the outer ring/ });
    expect(within(wheel).getByRole('button', { name: 'Intelligence 0' })).toBeTruthy();
    expect(within(wheel).getByRole('button', { name: 'Justice [Nezekan] 51' })).toBeTruthy();
    const might = within(wheel).getByRole('button', { name: 'Might 90' });
    // A base stat lights with a glow that fades inside it, never a box against the ring.
    expect(might.className).toContain('hover:bg-glow');
    expect(might.className).toContain('focus-visible:bg-glow');
    expect(might.className).not.toMatch(/hover:bg-surface-hover|rounded-md/);
    fireEvent.focus(might);
    expect(might.hasAttribute('data-shown')).toBe(true);
    const detail = screen.getByRole('dialog', { name: 'Details of Might' });
    expect(within(detail).getByText('Attack increase +9%')).toBeTruthy();
    fireEvent.focus(within(wheel).getByRole('button', { name: 'Space, not listed' }));
    expect(screen.getByText('The official service did not list this stat.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Text/ }));
    expect(screen.getByRole('region', { name: 'Base stats' })).toBeTruthy();
    expect(screen.getByText('Attack increase +9%')).toBeTruthy();
    expect(screen.getByText('232 of 307 owned')).toBeTruthy();
    expect(screen.getByText(/not the combined combat sheet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Read them' }));
  });

  it('keeps what loaded when one half of the sheet failed', () => {
    const half = sheet({
      equipment: null,
      equipment_error: { kind: 'unavailable', message: 'The official service answered 503.' },
    });
    const profile = data({ sheet: { state: 'ready', data: half } });
    show(profile);
    expect(screen.getByRole('heading', { level: 2, name: 'foxyyyynm' })).toBeTruthy();
    expect(screen.getByText(/Equipment could not be read/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(profile.refresh).toHaveBeenCalled();
    tab('Stats');
    expect(screen.getByRole('figure', { name: /Divine stats on the outer ring/ })).toBeTruthy();
  });

  it('explains a private profile and waits out a rate limit before retrying', () => {
    vi.useFakeTimers();
    try {
      const { rerender } = show(
        data({
          sheet: {
            state: 'error',
            error: profileError({ kind: 'private', message: '' }),
            data: null,
          },
        }),
      );
      expect(screen.getByText('This profile is private')).toBeTruthy();
      const busy = data({
        sheet: {
          state: 'error',
          error: profileError({ kind: 'rate_limited', message: '', retry_after_s: 2 }),
          data: null,
        },
      });
      rerender(
        <CharacterProfile
          native
          selection={selection}
          hideNames={false}
          profile={busy}
          itemKey={key}
          onClose={vi.fn<() => void>()}
        />,
      );
      const retry = screen.getByRole('button', { name: /Try again in 2 s/ }) as HTMLButtonElement;
      expect(retry.disabled).toBe(true);
      // One tick per second, as the countdown re-arms after each.
      for (let second = 0; second < 3; second++)
        act(() => {
          vi.advanceTimersByTime(1000);
        });
      const ready = screen.getByRole('button', { name: 'Try again' }) as HTMLButtonElement;
      expect(ready.disabled).toBe(false);
      fireEvent.click(ready);
      expect(busy.retry).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('refreshes, shares the profile link or a summary and offers the website', async () => {
    const onCopy = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
    const onCopyLink = vi.fn<() => Promise<void>>(() => Promise.resolve());
    const onOpenShugo = vi.fn<() => void>();
    const profile = data();
    show(profile, { onCopy, onCopyLink, onOpenShugo });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh profile' }));
    expect(profile.refresh).toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
    await act(async () =>
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy profile link' })),
    );
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(onCopy).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('Profile link copied');

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
    await act(async () =>
      fireEvent.click(await screen.findByRole('menuitem', { name: 'Copy summary' })),
    );
    expect(onCopy).toHaveBeenCalledWith(
      'foxyyyynm · Lv 45 · Asmodians Chanter · Triniel · CP 166,140 · iLvl 2,752',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open in Shugo.gg' }));
    expect(onOpenShugo).toHaveBeenCalled();
  });

  it('saves the shown character from the header and reopens a saved one from the caption', async () => {
    const onSetSaved = vi.fn<(saved: boolean) => Promise<void>>(() => Promise.resolve());
    const onOpenSaved = vi.fn<(c: { name: string }) => void>();
    const aahz = { server_id: 1304, server_name: 'Kaisinel', name: 'Aahz', saved_ms: 1 };
    const { rerender } = show(data(), { saved: [aahz], onSetSaved, onOpenSaved });
    const star = screen.getByRole('button', { name: 'Save' });
    expect(star.getAttribute('aria-pressed')).toBe('false');
    expect(star.title).toBe('Save foxyyyynm to your saved characters');
    await act(async () => fireEvent.click(star));
    expect(onSetSaved).toHaveBeenCalledWith(true);

    // Native's answer now lists the character: the star shows it saved, and removes it.
    const both = [
      { server_id: 2403, server_name: 'Triniel', name: 'foxyyyynm', saved_ms: 2 },
      aahz,
    ];
    rerender(
      <CharacterProfile
        native
        selection={selection}
        hideNames={false}
        profile={data()}
        itemKey={key}
        onClose={vi.fn<() => void>()}
        saved={both}
        onSetSaved={onSetSaved}
        onOpenSaved={onOpenSaved}
      />,
    );
    const saved = screen.getByRole('button', { name: 'Save' });
    expect(saved.getAttribute('aria-pressed')).toBe('true');
    expect(saved.title).toBe('Remove foxyyyynm from your saved characters');
    await act(async () => fireEvent.click(saved));
    expect(onSetSaved).toHaveBeenLastCalledWith(false);

    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Saved characters' })),
    );
    const shown = await screen.findByRole('menuitemradio', { name: /foxyyyynm/ });
    expect(shown.getAttribute('aria-checked')).toBe('true');
    await act(async () =>
      fireEvent.click(screen.getByRole('menuitemradio', { name: /Aahz\s*Kaisinel/ })),
    );
    expect(onOpenSaved).toHaveBeenCalledWith(aahz);
  });

  it('refuses a new save while the list is full but can still remove', () => {
    const full = Array.from({ length: 50 }, (_, i) => ({
      server_id: 1304,
      server_name: 'Kaisinel',
      name: `Name${i}`,
      saved_ms: i,
    }));
    show(data(), { saved: full, savedMax: 50, onSetSaved: vi.fn<(s: boolean) => Promise<void>>() });
    const star = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(star.disabled).toBe(true);
    expect(star.title).toMatch(/full/);
  });

  it('lists saved characters to reopen when no character is shown', () => {
    const onOpenSaved = vi.fn<(c: { name: string }) => void>();
    const aahz = { server_id: 1304, server_name: 'Kaisinel', name: 'Aahz', saved_ms: 1 };
    show(data({ sheet: null }), { selection: null, saved: [aahz], onOpenSaved });
    fireEvent.click(screen.getByRole('button', { name: 'Open Aahz on Kaisinel' }));
    expect(onOpenSaved).toHaveBeenCalledWith(aahz);
  });

  it('shows nothing about a character while names are hidden', () => {
    show(data(), {
      hideNames: true,
      selection: null,
      saved: [],
      onOpenSaved: vi.fn<(c: { name: string }) => void>(),
    });
    expect(screen.getByText('Character names are hidden')).toBeTruthy();
    expect(screen.queryByText('foxyyyynm')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Saved characters' })).toBeNull();
  });
});
