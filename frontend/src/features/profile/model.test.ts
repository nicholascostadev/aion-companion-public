import { describe, expect, it } from 'vitest';
import equipmentFixture from '../../../../fixtures/profile/equipment.json';
import boardFixture from '../../../../fixtures/profile/board.json';
import arcanaFixture from '../../../../fixtures/profile/item-arcana.json';
import ringFixture from '../../../../fixtures/profile/item-ring.json';
import { normalizeBoard, normalizeEquipment, normalizeItem } from '../../lib/profileNormalize';
import type { ItemDetail, ItemStat } from '../../types/profile';
import {
  arcanaEffects,
  arcanaPosition,
  boardSkillEffects,
  equipmentGroups,
  nearestNode,
  parseSkillBonus,
  skillBonuses,
  skillGroups,
  splitDeity,
} from './model';

const gear = normalizeEquipment(equipmentFixture)!;
const board = normalizeBoard(boardFixture, 81)!;

describe('profile display model', () => {
  it('groups equipped slots like the game, head to feet for armor', () => {
    const groups = equipmentGroups(gear.items);
    expect(groups.map((g) => [g.group, g.items.length])).toEqual([
      ['weapons', 2],
      ['armor', 7],
      ['accessories', 9],
      ['runes', 2],
      ['arcana', 5],
    ]);
    expect(groups[1]!.items.map((i) => i.slotName)).toEqual([
      'Helmet',
      'Shoulder',
      'Torso',
      'Pants',
      'Gloves',
      'Boots',
      'Cape',
    ]);
    // A slot the app has no group for is still shown.
    const odd = { ...gear.items[0]!, slot: 70, slotName: 'Mystery' };
    expect(equipmentGroups([odd]).map((g) => g.group)).toEqual(['other']);
  });

  it('sorts learned skills by level and groups stigmas by slotted, learned and locked', () => {
    const groups = skillGroups(gear.skills);
    expect(groups.active[0]).toMatchObject({ name: 'Dark Crush', level: 21 });
    expect(groups.active.map((s) => s.level)).toEqual(
      [...groups.active.map((s) => s.level)].sort((a, b) => b! - a!),
    );
    expect(groups.stigma.equipped.map((s) => s.name)).toEqual([
      'Guardian Blessing',
      'Power of the Storm',
      'Undefeated Mantra',
      "Marchutan's Wrath",
      'Focused Defense',
      'Sprint Mantra',
    ]);
    expect(groups.stigma.learned).toHaveLength(6);
    expect(groups.stigma.locked.map((s) => s.name)).toEqual(['Barrier Spell']);
  });

  it('splits a board’s skill upgrades by the character’s own skill list', () => {
    const split = boardSkillEffects(board, gear.skills);
    expect(split.passive).toEqual([
      'Inspiring Spell +2',
      'Crossguard +1',
      'Protection Circle +2',
      'Attack Preparation +2',
      'Blessing of Life +2',
    ]);
    expect(split.active).toHaveLength(10);
    expect(split.other).toEqual([]);
  });

  it('names only the level bonuses the loaded documents state', () => {
    const onslaught = gear.skills.find((s) => s.name === 'Onslaught')!;
    const ring = normalizeItem(ringFixture)!;
    expect(skillBonuses(onslaught, [{ name: 'Nezekan', board }], [ring])).toEqual([
      { kind: 'board', source: 'Nezekan', levels: 1 },
      { kind: 'item', source: 'Enraged Kromede Ring', levels: 1 },
    ]);
    const barrier = gear.skills.find((s) => s.name === 'Barrier Spell')!;
    expect(skillBonuses(barrier, [{ name: 'Nezekan', board }], [ring])).toEqual([]);
    expect(parseSkillBonus("Marchutan's Wrath +12")).toEqual({
      name: "Marchutan's Wrath",
      levels: 12,
    });
    expect(parseSkillBonus('HP +600')).toEqual({ name: 'HP', levels: 600 });
    expect(parseSkillBonus('Cooldown Reduction +3%')).toBeNull();
  });

  it('moves between board nodes in the arrow key’s direction', () => {
    const nodes = board.nodes.filter((n) => n.kind !== 'empty');
    const from = nodes.find((n) => n.row === 3 && n.col === 12)!;
    expect(nearestNode(nodes, from, 'ArrowRight')).toMatchObject({ row: 3, col: 13 });
    expect(nearestNode(nodes, from, 'ArrowLeft')).toMatchObject({ row: 3, col: 11 });
    expect(nearestNode(nodes, from, 'ArrowDown')!.row).toBeGreaterThan(3);
    expect(nearestNode(nodes, from, 'Enter')).toBeNull();
  });

  it('reads a divine stat’s deity from its name', () => {
    expect(splitDeity('Justice [Nezekan]')).toEqual({ stat: 'Justice', deity: 'Nezekan' });
    expect(splitDeity('Might')).toEqual({ stat: 'Might', deity: null });
  });
});

describe('arcana effects', () => {
  const chalice = normalizeItem(arcanaFixture)!;
  const stat = (over: Partial<ItemStat>): ItemStat => ({
    id: 'Life',
    name: 'Life [Yustiel]',
    value: '20',
    min: null,
    extra: null,
    breakthrough: false,
    ...over,
  });
  /** Another card of the chalice's set, with its own stats and skill options. */
  const card = (over: Partial<ItemDetail>): ItemDetail => ({ ...chalice, ...over });

  it('totals a card as the game does: its stat plus the enchant bonus', () => {
    const effects = arcanaEffects([chalice]);
    expect(effects.stats).toEqual([{ key: 'Time|', name: 'Time [Siel]', total: 23, unit: '' }]);
    expect(effects.skills.map((s) => [s.name, s.levels])).toEqual([
      ['Blessing of Life', 1],
      ['Dark Crush', 3],
      ['Wave Blow', 2],
      ['Impact Hit', 1],
    ]);
    expect(effects).toMatchObject({ read: 1, equipped: 1 });
  });

  it('sums each stat and skill across cards, never mixing units or guessing', () => {
    const parchment = card({
      id: 810230001,
      mainStats: [
        stat({ extra: '5' }),
        stat({ id: 'Time', name: 'Time [Siel]', value: '2%' }),
        // A range, a worded value and a bonus in another unit say no single amount.
        stat({ id: 'Attack', name: 'Attack', min: '10', value: '20' }),
        stat({ id: 'Wisdom', name: 'Wisdom', value: 'High' }),
        stat({ id: 'Freedom', name: 'Freedom', value: '4', extra: '1%' }),
        stat({ id: 'Death', name: 'Death', value: '9', extra: '+3', breakthrough: true }),
      ],
      subSkills: [
        { id: 18100000, name: 'Dark Crush', level: 4, icon: null },
        { id: 18100000, name: 'Dark Crush', level: null, icon: null },
        { id: null, name: 'Rushing Smash', level: null, icon: null },
      ],
    });
    const effects = arcanaEffects([chalice, parchment]);
    expect(effects.stats.map((s) => [s.name, s.total, s.unit])).toEqual([
      ['Time [Siel]', 23, ''],
      ['Life [Yustiel]', 25, ''],
      ['Time [Siel]', 2, '%'],
      ['Death', 3, ''],
    ]);
    expect(effects.skills.find((s) => s.name === 'Dark Crush')?.levels).toBe(7);
    // A skill no card gave a level for has no level, not zero.
    expect(effects.skills.find((s) => s.name === 'Rushing Smash')?.levels).toBeNull();
  });

  it('counts a card not read yet as missing, not as zero', () => {
    const effects = arcanaEffects([null, null]);
    expect(effects).toMatchObject({ stats: [], skills: [], sets: [], read: 0, equipped: 2 });
    expect(arcanaEffects([chalice, null])).toMatchObject({ read: 1, equipped: 2 });
  });

  it('shows a set once, with its worn count and the bonuses that count reaches', () => {
    const effects = arcanaEffects([chalice, card({ id: 810230001 }), card({ id: 810330001 })]);
    expect(effects.sets).toHaveLength(1);
    expect(effects.sets[0]).toMatchObject({ name: 'Primal Vigor', count: 3, official: true });
    expect(effects.sets[0]!.bonuses.map((b) => [b.degree, b.active])).toEqual([
      [2, true],
      [4, false],
    ]);
  });

  it('counts the read cards of a set when the service sent no count', () => {
    const set = { ...chalice.set!, equippedCount: null };
    const one = arcanaEffects([card({ set })]);
    expect(one.sets[0]).toMatchObject({ count: 1, official: false });
    expect(one.sets[0]!.bonuses.every((b) => !b.active)).toBe(true);
    const two = arcanaEffects([card({ set }), card({ set }), null]);
    expect(two.sets[0]).toMatchObject({ count: 2, official: false });
    expect(two.sets[0]!.bonuses.map((b) => b.active)).toEqual([true, false]);
    // Sets are told apart by their official id, not their name.
    const other = { ...set, id: 'Arcana_B_set_001' };
    expect(arcanaEffects([card({ set }), card({ set: other })]).sets).toHaveLength(2);
  });

  it('places the five slots by their number and leaves any other slot unplaced', () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => arcanaPosition({ slotName: `Arcana${n}` }))).toEqual([
      1,
      2,
      3,
      4,
      5,
      null,
    ]);
    expect(arcanaPosition({ slotName: 'Arcana' })).toBeNull();
  });
});
