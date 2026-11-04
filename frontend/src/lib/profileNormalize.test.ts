import { describe, expect, it } from 'vitest';
import info from '../../../fixtures/profile/info.json';
import equipment from '../../../fixtures/profile/equipment.json';
import weapon from '../../../fixtures/profile/item-weapon.json';
import ring from '../../../fixtures/profile/item-ring.json';
import arcana from '../../../fixtures/profile/item-arcana.json';
import board from '../../../fixtures/profile/board.json';
import lockedBoard from '../../../fixtures/profile/board-locked.json';
import {
  normalizeBoard,
  normalizeEquipment,
  normalizeInfo,
  normalizeItem,
  normalizeProfileWindowStatus,
  normalizeSheet,
  profileError,
} from './profileNormalize';

// The fixtures are official answers recorded on 2026-11-04 (docs/CHARACTER_PROFILES.md).
describe('official character sheet', () => {
  const sheet = normalizeInfo(info)!;

  it('reads who the character is', () => {
    expect(sheet).toMatchObject({
      name: 'foxyyyynm',
      level: 45,
      className: 'Chanter',
      raceName: 'Asmodians',
      serverName: 'Triniel',
      combatPower: 166140,
      title: { name: 'Has Exceptional Skill', grade: 'Special' },
    });
    expect(sheet.portrait).toMatch(/^https:\/\/profileimg\.plaync\.com\//);
  });

  it('splits base and divine stats and keeps the item level apart from both', () => {
    expect(sheet.baseStats.map((s) => [s.type, s.value])).toEqual([
      ['STR', 90],
      ['DEX', 42],
      ['INT', 0],
      ['CON', 26],
      ['AGI', 35],
      ['WIS', 0],
    ]);
    expect(sheet.divineStats).toHaveLength(10);
    expect(sheet.divineStats.find((s) => s.type === 'Time')).toEqual({
      type: 'Time',
      name: 'Time [Siel]',
      value: 74,
      effects: ['Combat Speed +7.4%', 'Double Resist +7.4%'],
    });
    // The service names this row in Korean in every language, so only its value is kept.
    expect(sheet.itemLevel).toBe(2752);
    expect(sheet.divineStats.some((s) => s.type === 'ItemLevel')).toBe(false);
    // A stat without secondary effects has an empty list, not a missing one.
    expect(sheet.baseStats[2]!.effects).toEqual([]);
  });

  it('keeps equipped titles with both kinds of effect, owned counts and every board', () => {
    expect(sheet.titles.map((t) => [t.category, t.name])).toEqual([
      ['Defense', 'Saint of Altgard'],
      ['Attack', 'Unbound by Genus'],
      ['Etc', 'Executioner of High Commander Lagta'],
    ]);
    expect(sheet.titles[0]).toMatchObject({
      equipEffects: ['Defense Bonus +300', 'Damage Tolerance +3%', 'Block +100'],
      ownEffects: ['MP +20'],
      ownedPercent: 77,
    });
    expect([sheet.titlesOwned, sheet.titlesTotal]).toEqual([232, 307]);
    expect(sheet.boards.map((b) => [b.id, b.name, b.openNodes, b.totalNodes, b.open])).toEqual([
      [81, 'Nezekan', 59, 88, true],
      [82, 'Zikel', 59, 88, true],
      [83, 'Vaizel', 62, 88, true],
      [84, 'Triniel', 71, 116, true],
      [85, 'Ariel', 0, 152, false],
      [86, 'Azphel', 21, 152, true],
    ]);
    // `rankingList: null` means none was published, never an empty ranking.
    expect(sheet.rankings).toBeNull();
  });

  it('refuses a document without a profile', () => {
    expect(normalizeInfo({})).toBeNull();
    expect(normalizeInfo(null)).toBeNull();
  });
});

describe('official equipment', () => {
  const gear = normalizeEquipment(equipment)!;

  it('keeps every equipped slot, two copies of one ring included', () => {
    expect(gear.items).toHaveLength(25);
    const rings = gear.items.filter((i) => i.id === 310330053);
    expect(rings.map((r) => [r.slot, r.slotName])).toEqual([
      [13, 'Ring1'],
      [14, 'Ring2'],
    ]);
    expect(gear.items.find((i) => i.slot === 1)).toMatchObject({
      name: 'Aulamus Staff',
      enchant: 15,
      breakthrough: 2,
      grade: 'Unique',
    });
  });

  it('keeps appearance items per slot, the same earrings twice, and the wing appearance', () => {
    expect(gear.skins).toHaveLength(10);
    expect(gear.skins.filter((s) => s.id === 50019101).map((s) => s.slotName)).toEqual([
      'EarringL',
      'EarringR',
    ]);
    expect(gear.pet).toMatchObject({ name: 'Kuru Overseer', level: 3 });
    expect(gear.wing).toMatchObject({ name: 'Dark Veil Wings', grade: 'Unique', enchant: 0 });
    expect(gear.wingSkin).toMatchObject({ name: "Fairy's Dream Wings", grade: 'Rare' });
  });

  it('reads skills with the service calling stigmas Dp', () => {
    const by = (category: string) => gear.skills.filter((s) => s.category === category);
    expect([by('active').length, by('passive').length, by('stigma').length]).toEqual([12, 10, 13]);
    expect(gear.skills.find((s) => s.name === 'Focused Defense')).toMatchObject({
      acquired: false,
      equipped: true,
      level: 0,
      needLevel: 22,
    });
    // A learned stigma keeps the 0 the service sent; a level it did not send stays unknown.
    expect(gear.skills.find((s) => s.name === 'Obliterate')).toMatchObject({
      acquired: true,
      level: 0,
    });
    const list = equipment.skill.skillList.map((s) =>
      s.name === 'Obliterate' ? { ...s, skillLevel: undefined } : s,
    );
    const unsent = normalizeEquipment({
      ...equipment,
      skill: { skillList: list },
    })!.skills.find((s) => s.name === 'Obliterate');
    expect(unsent).toMatchObject({ acquired: true, level: null });
  });
});

describe('official item detail', () => {
  it('separates the enchant bonus, the rolled range and breakthrough lines', () => {
    const staff = normalizeItem(weapon)!;
    expect(staff).toMatchObject({ level: 70, levelBonus: 25, maxEnchant: 15, maxBreakthrough: 3 });
    expect(staff.mainStats[0]).toEqual({
      id: 'WeaponFixingDamage',
      name: 'Attack',
      value: '395',
      min: '287',
      extra: '119',
      breakthrough: false,
    });
    // `0` is no enchant bonus rather than a bonus of zero.
    expect(staff.mainStats[1]!.extra).toBeNull();
    expect(staff.mainStats.filter((s) => s.breakthrough).map((s) => [s.name, s.extra])).toEqual([
      ['Attack', '20'],
      ['Damage Boost', '2%'],
    ]);
    expect(staff.subStats.map((s) => `${s.name} ${s.value}`)).toEqual([
      'Back Attack 82',
      'Combat Speed 11.3%',
      'Might 24',
      'Weapon Damage Boost 7.6%',
    ]);
    expect(staff.sockets.map((s) => `${s.slot}:${s.name} ${s.value}`)).toEqual([
      '0:Block +10',
      '1:Attack +5',
      '2:HP +100',
      '3:Block +10',
    ]);
    expect([staff.socketSlots, staff.godstoneSlots, staff.soulBindRate]).toEqual([4, 1, '62.3']);
    expect(staff.costumes).toEqual(['Endless Prelude (Staff)']);
    expect(staff.sources).toEqual(['Reward Chest', 'Expedition', 'Sanctuary']);
    expect(staff.flags).toMatchObject({ tradable: false, enchantable: true, storable: true });
    // Nothing the service sent is dropped: there is no field the view does not show.
    expect(staff.other).toEqual([]);
  });

  it('keeps an accessory’s skill options and soul stones', () => {
    const detail = normalizeItem(ring)!;
    expect(detail.type).toBe('Accessory');
    expect(detail.subSkills.map((s) => [s.id, s.name, s.level])).toEqual([
      [18010000, 'Onslaught', 1],
      [18040000, 'Incandescent Blow', 1],
    ]);
    expect(detail.sockets[0]!.icon).toMatch(/SoulStone/);
  });

  it('reads a set with its worn pieces and bonuses by piece count', () => {
    const detail = normalizeItem(arcana)!;
    expect(detail.set).toMatchObject({
      id: 'Arcana_A_set_001',
      name: 'Primal Vigor',
      equippedCount: 3,
    });
    expect(detail.set!.items.map((i) => [i.name, i.equipped, i.variants])).toEqual([
      ['Chalice of Vigor', true, 3],
      ['Parchment of Vigor', true, 3],
      ['Compass of Vigor', true, 3],
      ['Bell of Vigor', false, 3],
      ['Mirror of Vigor', false, 3],
    ]);
    expect(detail.set!.bonuses).toEqual([
      { degree: 2, descriptions: ['+60 PvE Attack when HP is 70% or more'] },
      { degree: 4, descriptions: ['+150 PvE Attack when HP is 70% or more'] },
    ]);
  });

  it('shows a field it does not know rather than dropping it, and strips markup', () => {
    const detail = normalizeItem({
      id: 1,
      name: 'X',
      desc: 'Heals <desc_point>10%</desc_point> HP',
      godStoneStat: [{ name: 'Stone', grade: 'Legend', desc: 'Strikes <b>hard</b>' }],
      newField: ['a', 'b'],
      favorite: false,
    })!;
    expect(detail.description).toBe('Heals 10% HP');
    expect(detail.godstones[0]!.description).toBe('Strikes hard');
    expect(detail.other).toEqual([['newField', 'a, b']]);
    expect(detail.level).toBeNull();
    expect(normalizeItem({ name: 'no id' })).toBeNull();
  });
});

describe('official Daevanion board', () => {
  it('keeps every node at its row and column with its open state and effects', () => {
    const b = normalizeBoard(board, 81)!;
    expect(b.nodes).toHaveLength(225);
    expect([b.rows, b.cols]).toEqual([15, 15]);
    const kinds = b.nodes.reduce<Record<string, number>>(
      (all, n) => ({ ...all, [n.kind]: (all[n.kind] ?? 0) + 1 }),
      {},
    );
    expect(kinds).toEqual({ empty: 136, skill: 22, stat: 66, start: 1 });
    expect(b.nodes.find((n) => n.id === 810043)).toEqual({
      id: 810043,
      row: 3,
      col: 13,
      kind: 'stat',
      grade: 'Unique',
      name: 'Cooldown Reduction',
      open: true,
      effects: ['Cooldown Reduction +1.5%'],
    });
    expect([b.skillEffects.length, b.statEffects.length]).toEqual([15, 8]);
  });

  it('reads a locked board with no node open', () => {
    const b = normalizeBoard(lockedBoard, 85)!;
    expect(b.nodes.some((n) => n.open)).toBe(false);
    expect(b.skillEffects).toEqual([]);
    expect(normalizeBoard({}, 85)).toBeNull();
  });
});

describe('native answers', () => {
  it('reads a sheet with one half failed', () => {
    const sheet = normalizeSheet({
      identity: {
        character_id: 'abc=',
        server_id: 2403,
        region: 'la',
        name: 'foxyyyynm',
        lang: 'en-US',
      },
      info,
      info_error: null,
      equipment: null,
      equipment_error: { kind: 'unavailable', message: 'The official service answered 503.' },
      cached: true,
      fetched_ms: 5,
    });
    expect(sheet.info?.name).toBe('foxyyyynm');
    expect(sheet.equipment).toBeNull();
    expect(sheet.equipmentError).toMatchObject({ kind: 'unavailable', retryAfterS: null });
    expect([sheet.cached, sheet.fetchedMs, sheet.identity.region]).toEqual([true, 5, 'la']);
  });

  it('keeps a rate limit wait and turns anything else into an unavailable error', () => {
    expect(
      profileError({ kind: 'rate_limited', message: 'slow', retry_after_s: 30 }),
    ).toMatchObject({
      kind: 'rate_limited',
      retryAfterS: 30,
    });
    expect(profileError({ kind: 'private', message: 'x' }).kind).toBe('private');
    expect(profileError('boom')).toMatchObject({ kind: 'unavailable', message: 'boom' });
    expect(profileError({ kind: 'surprise' }).kind).toBe('unavailable');
  });

  it('reads the window status and refuses an incomplete selection', () => {
    expect(
      normalizeProfileWindowStatus({
        requested: true,
        hide_names: false,
        selection: { revision: 4, server_id: 2403, name: 'foxyyyynm' },
        errors: ['x', 3],
      }),
    ).toMatchObject({
      requested: true,
      selection: { revision: 4, server_id: 2403, name: 'foxyyyynm' },
      errors: ['x'],
    });
    expect(
      normalizeProfileWindowStatus({ selection: { revision: 1, name: 'x' } }).selection,
    ).toBeNull();
    expect(normalizeProfileWindowStatus(null).hide_names).toBe(false);
  });

  it('reads the foreground state of the last open, and an unknown one as idle', () => {
    expect(
      normalizeProfileWindowStatus({
        focus: { state: 'denied', revision: 3, cursor_released: false },
      }).focus,
    ).toEqual({ state: 'denied', revision: 3, cursor_released: false });
    expect(normalizeProfileWindowStatus({ focus: { state: 'stolen' } }).focus).toEqual({
      state: 'idle',
      revision: 0,
      cursor_released: false,
    });
    expect(normalizeProfileWindowStatus(null).focus.state).toBe('idle');
  });
});
