/*
 * Pure display models for the character profile: how slots group, how skills sort, and
 * which bonuses the official documents themselves attribute to a skill or a stat. Nothing
 * here estimates a value the service does not publish.
 */
import type {
  Board,
  BoardNode,
  CharacterInfo,
  EquippedItem,
  Grade,
  ItemDetail,
  ItemSet,
  ItemStat,
  Skill,
} from '../../types/profile';

export type EquipmentGroup = 'weapons' | 'armor' | 'accessories' | 'runes' | 'arcana' | 'other';

const GROUP_OF: [RegExp, EquipmentGroup][] = [
  [/^(MainHand|SubHand)$/, 'weapons'],
  [/^(Helmet|Shoulder|Torso|Pants|Gloves|Boots|Cape)$/, 'armor'],
  [/^(Necklace|Earring\d*|Ring\d*|Bracelet\d*|Belt|Amulet)$/, 'accessories'],
  [/^Rune\d*$/, 'runes'],
  [/^Arcana\d*$/, 'arcana'],
];

/** The armor order a character sheet reads in, head to feet. */
const ARMOR_ORDER = ['Helmet', 'Shoulder', 'Torso', 'Pants', 'Gloves', 'Boots', 'Cape'];

export const groupOf = (item: Pick<EquippedItem, 'slotName'>): EquipmentGroup =>
  GROUP_OF.find(([pattern]) => pattern.test(item.slotName))?.[1] ?? 'other';

/** Equipped items by group, in game order; a slot the app does not know still shows. */
export function equipmentGroups(items: readonly EquippedItem[]) {
  const groups = new Map<EquipmentGroup, EquippedItem[]>();
  for (const item of items) {
    const group = groupOf(item);
    groups.set(group, [...(groups.get(group) ?? []), item]);
  }
  const armor = groups.get('armor');
  if (armor)
    armor.sort((a, b) => ARMOR_ORDER.indexOf(a.slotName) - ARMOR_ORDER.indexOf(b.slotName));
  return (['weapons', 'armor', 'accessories', 'runes', 'arcana', 'other'] as const)
    .map((group) => ({ group, items: groups.get(group) ?? [] }))
    .filter((g) => g.items.length > 0);
}

/** The game's five arcana slots, `Arcana1` to `Arcana5`. */
export const ARCANA_SLOTS = [1, 2, 3, 4, 5] as const;

/** `Arcana3` → 3; null for a slot outside the five the game lays out. */
export function arcanaPosition(item: Pick<EquippedItem, 'slotName'>): number | null {
  const match = /^Arcana(\d)$/.exec(item.slotName);
  const at = match ? Number(match[1]) : null;
  return at !== null && (ARCANA_SLOTS as readonly number[]).includes(at) ? at : null;
}

/** `20`, `+3`, `1.5%` → the number and its unit; anything else is not a plain amount. */
function amount(text: string | null): { value: number; unit: '' | '%' } | null {
  const match = /^([+-]?\d+(?:\.\d+)?)(%?)$/.exec((text ?? '').replace(/[,\s]/g, ''));
  return match ? { value: Number(match[1]), unit: match[2] === '%' ? '%' : '' } : null;
}

/**
 * How much one official stat line adds. A plain line is its value plus the enchant bonus
 * (`20` and `3` → 23, as the game totals it); a breakthrough line's whole value is its
 * `extra`. A rolled range (`287 ~ 395`), a worded value, or a value and a bonus in
 * different units add nothing, so they are never summed into a guess.
 */
export function statAmount(stat: ItemStat) {
  if (stat.min !== null) return null;
  if (stat.breakthrough) return amount(stat.extra ?? stat.value);
  const value = amount(stat.value);
  if (!value) return null;
  if (stat.extra === null) return value;
  const extra = amount(stat.extra);
  return extra && extra.unit === value.unit
    ? { value: value.value + extra.value, unit: value.unit }
    : null;
}

export interface ArcanaEffects {
  /** Main stats summed by stat and unit, in the order the cards first list them. */
  stats: { key: string; name: string; total: number; unit: '' | '%' }[];
  /** Skill options summed by skill; `levels` is null when no card sent a level for it. */
  skills: { key: string; name: string; icon: string | null; levels: number | null }[];
  /** Each set once, however many cards belong to it. */
  sets: {
    key: string;
    name: string;
    /** The pieces worn: the service's own count, else the read cards of the set. */
    count: number;
    /** False when `count` is only the read cards of the set (the service sent none). */
    official: boolean;
    bonuses: { degree: number | null; descriptions: string[]; active: boolean }[];
  }[];
  /** Cards whose official detail is in the totals, of the equipped ones. */
  read: number;
  equipped: number;
}

/**
 * The equipped effects and set bonuses of the arcana, from the official details read so
 * far. Only details that answered count; a card not read yet adds nothing (the view says
 * the totals are partial), so no total is ever a zero standing in for a missing card.
 */
export function arcanaEffects(details: readonly (ItemDetail | null)[]): ArcanaEffects {
  const stats = new Map<string, ArcanaEffects['stats'][number]>();
  const skills = new Map<string, ArcanaEffects['skills'][number]>();
  const sets = new Map<
    string,
    { name: string; official: number | null; members: number; bonuses: ItemSet['bonuses'] }
  >();
  const read = details.filter((d): d is ItemDetail => d !== null);
  for (const detail of read) {
    for (const stat of detail.mainStats) {
      const add = statAmount(stat);
      if (!add) continue;
      const key = `${stat.id || stat.name}|${add.unit}`;
      const known = stats.get(key);
      if (known) known.total += add.value;
      else stats.set(key, { key, name: stat.name, total: add.value, unit: add.unit });
    }
    for (const skill of detail.subSkills) {
      const key = skill.id !== null ? String(skill.id) : skill.name;
      const known = skills.get(key);
      if (!known) skills.set(key, { key, name: skill.name, icon: skill.icon, levels: skill.level });
      else if (skill.level !== null) known.levels = (known.levels ?? 0) + skill.level;
    }
    const set = detail.set;
    if (set) {
      const key = set.id ?? set.name;
      const known = sets.get(key);
      if (known) {
        known.members += 1;
        known.official ??= set.equippedCount;
      } else
        sets.set(key, {
          name: set.name,
          official: set.equippedCount,
          members: 1,
          bonuses: set.bonuses,
        });
    }
  }
  return {
    // Floating sums (`0.1 + 0.2`) print as the service would.
    stats: [...stats.values()].map((s) => ({ ...s, total: Math.round(s.total * 100) / 100 })),
    skills: [...skills.values()],
    sets: [...sets.entries()].map(([key, set]) => {
      // The service's own count is authoritative; the read cards stand in only without it.
      const count = set.official ?? set.members;
      return {
        key,
        name: set.name,
        count,
        official: set.official !== null,
        bonuses: set.bonuses.map((b) => ({
          ...b,
          active: b.degree !== null && count >= b.degree,
        })),
      };
    }),
    read: read.length,
    equipped: details.length,
  };
}

/** Skills by level, highest first (an unsent level last); then by the level that unlocks them. */
const byLevel = (a: Skill, b: Skill) =>
  (b.level ?? -1) - (a.level ?? -1) || a.needLevel - b.needLevel || a.name.localeCompare(b.name);

export function skillGroups(skills: readonly Skill[]) {
  const of = (category: string) => skills.filter((s) => s.category === category);
  const stigma = of('stigma');
  return {
    active: of('active').sort(byLevel),
    passive: of('passive').sort(byLevel),
    stigma: {
      // The service may mark a slotted stigma not acquired; it stays where it is slotted.
      equipped: stigma.filter((s) => s.equipped).sort(byLevel),
      learned: stigma.filter((s) => !s.equipped && s.acquired).sort(byLevel),
      locked: stigma.filter((s) => !s.equipped && !s.acquired).sort(byLevel),
    },
    other: skills
      .filter((s) => !['active', 'passive', 'stigma'].includes(s.category))
      .sort(byLevel),
  };
}

/** `Onslaught +1` → the skill and the levels it adds. */
export function parseSkillBonus(text: string): { name: string; levels: number } | null {
  const match = /^(.+?)\s*\+(\d+)$/.exec(text.trim());
  return match ? { name: match[1]!, levels: Number(match[2]) } : null;
}

/** A board's open skill effects split by what the character's skill list says they are. */
export function boardSkillEffects(board: Board, skills: readonly Skill[]) {
  const category = new Map(skills.map((s) => [s.name, s.category]));
  const split = { active: [] as string[], passive: [] as string[], other: [] as string[] };
  for (const effect of board.skillEffects) {
    const bonus = parseSkillBonus(effect);
    const kind = bonus ? category.get(bonus.name) : undefined;
    if (kind === 'active' || kind === 'stigma') split.active.push(effect);
    else if (kind === 'passive') split.passive.push(effect);
    else split.other.push(effect);
  }
  return split;
}

export interface SkillBonusSource {
  kind: 'board' | 'item';
  /** The board or item name. */
  source: string;
  levels: number;
}

/**
 * Level bonuses to one skill that the official documents already loaded name explicitly:
 * open Daevanion skill effects and equipment sub-skills. Never inferred from options.
 */
export function skillBonuses(
  skill: Skill,
  boards: readonly { name: string; board: Board }[],
  items: readonly ItemDetail[],
): SkillBonusSource[] {
  const found: SkillBonusSource[] = [];
  for (const { name, board } of boards)
    for (const effect of board.skillEffects) {
      const bonus = parseSkillBonus(effect);
      if (bonus?.name === skill.name)
        found.push({ kind: 'board', source: name, levels: bonus.levels });
    }
  for (const item of items)
    for (const sub of item.subSkills)
      if ((sub.id !== null ? sub.id === skill.id : sub.name === skill.name) && sub.level)
        found.push({ kind: 'item', source: item.name, levels: sub.level });
  return found;
}

/** `Justice [Nezekan]` → the stat and its deity, as the service names them. */
export function splitDeity(name: string): { stat: string; deity: string | null } {
  const match = /^(.*?)\s*\[(.+)\]$/.exec(name);
  return match ? { stat: match[1]!, deity: match[2]! } : { stat: name, deity: null };
}

/** Grade → the palette mark that edges its art and inks its name; the word always shows too. */
const GRADES: Record<string, { edge: string; ink: string; fill: string }> = {
  common: { edge: 'border-line-strong', ink: 'text-ink-2', fill: 'bg-ink-3' },
  rare: { edge: 'border-sky', ink: 'text-sky-ink', fill: 'bg-sky' },
  legend: { edge: 'border-jade', ink: 'text-jade-ink', fill: 'bg-jade' },
  unique: { edge: 'border-pollen', ink: 'text-pollen-ink', fill: 'bg-pollen' },
  epic: { edge: 'border-ember', ink: 'text-ember-ink', fill: 'bg-ember' },
  special: { edge: 'border-iris', ink: 'text-iris-ink', fill: 'bg-iris' },
  mythic: { edge: 'border-rose', ink: 'text-rose-ink', fill: 'bg-rose' },
};
const NO_GRADE = { edge: 'border-line', ink: 'text-ink', fill: 'bg-ink-4' };

export const gradeStyle = (grade: Grade | null | undefined) =>
  GRADES[(grade ?? '').toLowerCase()] ?? NO_GRADE;

/** The service's grade names, for a grade the app has a word for. */
export const KNOWN_GRADES = Object.keys(GRADES);

/** One line naming the character, for the clipboard. */
export function profileSummary(
  info: CharacterInfo,
  labels: { level: string; combatPower: string; itemLevel: string },
  fmt: { integer: Intl.NumberFormat },
) {
  return [
    info.name,
    info.level !== null ? `${labels.level} ${info.level}` : null,
    [info.raceName, info.className].filter(Boolean).join(' ') || null,
    info.serverName || null,
    info.combatPower !== null
      ? `${labels.combatPower} ${fmt.integer.format(info.combatPower)}`
      : null,
    info.itemLevel !== null ? `${labels.itemLevel} ${fmt.integer.format(info.itemLevel)}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The nearest node from `from` in an arrow key's direction, by grid distance. */
export function nearestNode(nodes: readonly BoardNode[], from: BoardNode, key: string) {
  const dir = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[key];
  if (!dir) return null;
  const [dr, dc] = dir as [number, number];
  let best: BoardNode | null = null;
  let bestScore = Infinity;
  for (const n of nodes) {
    const r = n.row - from.row;
    const c = n.col - from.col;
    const ahead = r * dr + c * dc;
    if (ahead <= 0) continue;
    const aside = Math.abs(r * dc) + Math.abs(c * dr);
    // Straight ahead first; a sideways step costs more than a forward one.
    const score = ahead + aside * 2;
    if (score < bestScore) {
      best = n;
      bestScore = score;
    }
  }
  return best;
}
