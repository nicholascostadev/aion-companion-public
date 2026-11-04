/*
 * Official character documents (see `docs/CHARACTER_PROFILES.md`) into the shapes in
 * `types/profile.ts`. Defensive: a missing or malformed field becomes null or empty rather
 * than zero, and nothing the service sends is invented.
 */
import type {
  Board,
  BoardNode,
  BoardSummary,
  CharacterEquipment,
  CharacterInfo,
  CharacterSheet,
  Companion,
  EquippedItem,
  ItemDetail,
  ItemSet,
  ItemStat,
  ProfileError,
  ProfileErrorKind,
  ProfileFocus,
  ProfileWindowStatus,
  SavedCharacter,
  Skill,
  Stat,
  Title,
} from '../types/profile';

type Obj = Record<string, unknown>;

const obj = (v: unknown): Obj | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : null;
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const flag = (v: unknown): boolean | null =>
  typeof v === 'boolean' ? v : v === 1 ? true : v === 0 ? false : null;
const texts = (v: unknown): string[] =>
  list(v)
    .map((x) => (typeof x === 'string' ? x : text(obj(x)?.desc)))
    .filter((x) => x !== '');
const nonEmpty = (v: unknown): string | null => {
  const s = text(v).trim();
  return s === '' ? null : s;
};

const ERROR_KINDS: readonly ProfileErrorKind[] = [
  'invalid',
  'not_found',
  'private',
  'rate_limited',
  'unavailable',
  'network',
];

/** A native profile error object, or any other rejection as an `unavailable` message. */
export function profileError(cause: unknown): ProfileError {
  const o = obj(cause);
  const kind = o && ERROR_KINDS.find((k) => k === o.kind);
  if (o && kind)
    return {
      kind,
      message: text(o.message),
      retryAfterS: num(o.retry_after_s),
      receivedMs: Date.now(),
    };
  return {
    kind: 'unavailable',
    message: cause instanceof Error ? cause.message : String(cause),
    retryAfterS: null,
    receivedMs: Date.now(),
  };
}

export function normalizeProfileWindowStatus(raw: unknown): ProfileWindowStatus {
  const o = obj(raw) ?? {};
  const s = obj(o.selection);
  const serverId = num(s?.server_id);
  const revision = num(s?.revision);
  const name = text(s?.name);
  return {
    requested: o.requested === true,
    visible: o.visible === true,
    ready: o.ready === true,
    game_active: o.game_active === true,
    hide_names: o.hide_names === true,
    selection:
      s && serverId !== null && revision !== null && name
        ? { revision, server_id: serverId, name }
        : null,
    favorites: list(o.favorites)
      .map((raw): SavedCharacter | null => {
        const f = obj(raw);
        const server = num(f?.server_id);
        const name = text(f?.name);
        return f && server !== null && name
          ? {
              server_id: server,
              server_name: nonEmpty(f.server_name),
              name,
              saved_ms: num(f.saved_ms) ?? 0,
            }
          : null;
      })
      .filter((f) => f !== null),
    favorites_max: num(o.favorites_max) ?? 50,
    errors: list(o.errors).filter((e): e is string => typeof e === 'string'),
    focus: profileFocus(o.focus),
  };
}

const FOCUS_STATES: readonly ProfileFocus['state'][] = [
  'idle',
  'pending',
  'granted',
  'denied',
  'left',
];

function profileFocus(raw: unknown): ProfileFocus {
  const o = obj(raw);
  const state = FOCUS_STATES.find((s) => s === o?.state) ?? 'idle';
  return { state, revision: num(o?.revision) ?? 0, cursor_released: o?.cursor_released === true };
}

/** The service's own base-stat types; everything else in the list is divine or item level. */
const BASE_STATS = ['STR', 'DEX', 'INT', 'CON', 'AGI', 'WIS'];

function stat(raw: unknown): Stat | null {
  const o = obj(raw);
  const value = num(o?.value);
  if (!o || value === null) return null;
  return { type: text(o.type), name: text(o.name), value, effects: texts(o.statSecondList) };
}

function title(raw: unknown): Title | null {
  const o = obj(raw);
  const id = num(o?.id);
  if (!o || id === null) return null;
  return {
    id,
    name: text(o.name),
    grade: text(o.grade),
    category: text(o.equipCategory),
    equipEffects: texts(o.equipStatList),
    ownEffects: texts(o.statList),
    ownedPercent: num(o.ownedPercent),
  };
}

function board(raw: unknown): BoardSummary | null {
  const o = obj(raw);
  const id = num(o?.id);
  if (!o || id === null) return null;
  return {
    id,
    name: text(o.name),
    icon: nonEmpty(o.icon),
    open: flag(o.open) === true,
    openNodes: num(o.openNodeCount) ?? 0,
    totalNodes: num(o.totalNodeCount) ?? 0,
    percent: num(o.openPercent),
  };
}

/** A ranking entry as its labelled primitive facts; the service sent none for the fixture. */
function ranking(raw: unknown): [string, string][] {
  const o = obj(raw);
  if (!o) return [];
  return Object.entries(o)
    .filter(([, v]) => ['string', 'number', 'boolean'].includes(typeof v))
    .map(([k, v]) => [k, String(v)]);
}

export function normalizeInfo(raw: unknown): CharacterInfo | null {
  const o = obj(raw);
  const p = obj(o?.profile);
  if (!o || !p) return null;
  const stats = list(obj(o.stat)?.statList)
    .map(stat)
    .filter((s): s is Stat => s !== null);
  const titleId = num(p.titleId);
  const titles = obj(o.title);
  const rankings = obj(o.ranking)?.rankingList;
  return {
    name: text(p.characterName),
    level: num(p.characterLevel),
    className: text(p.className),
    raceName: text(p.raceName),
    genderName: text(p.genderName),
    serverName: text(p.serverName),
    combatPower: num(p.combatPower),
    portrait: nonEmpty(p.profileImage),
    title:
      titleId !== null && text(p.titleName)
        ? { id: titleId, name: text(p.titleName), grade: text(p.titleGrade) }
        : null,
    baseStats: stats.filter((s) => BASE_STATS.includes(s.type)),
    // The item level row is named in Korean in every language; the view labels it itself.
    divineStats: stats.filter((s) => !BASE_STATS.includes(s.type) && s.type !== 'ItemLevel'),
    itemLevel: stats.find((s) => s.type === 'ItemLevel')?.value ?? null,
    titles: list(titles?.titleList)
      .map(title)
      .filter((t): t is Title => t !== null),
    titlesOwned: num(titles?.ownedCount),
    titlesTotal: num(titles?.totalCount),
    rankings: Array.isArray(rankings) ? rankings.map(ranking).filter((r) => r.length > 0) : null,
    boards: list(obj(o.daevanion)?.boardList)
      .map(board)
      .filter((b): b is BoardSummary => b !== null),
  };
}

function equipped(raw: unknown): EquippedItem | null {
  const o = obj(raw);
  const id = num(o?.id);
  const slot = num(o?.slotPos);
  if (!o || id === null || slot === null) return null;
  return {
    id,
    name: text(o.name),
    grade: text(o.grade),
    icon: nonEmpty(o.icon),
    slot,
    slotName: text(o.slotPosName),
    enchant: num(o.enchantLevel) ?? 0,
    breakthrough: num(o.exceedLevel) ?? 0,
  };
}

function companion(raw: unknown): Companion | null {
  const o = obj(raw);
  const id = num(o?.id);
  if (!o || id === null) return null;
  return {
    id,
    name: text(o.name),
    icon: nonEmpty(o.icon),
    grade: nonEmpty(o.grade),
    level: num(o.level),
    enchant: num(o.enchantLevel),
  };
}

/** The service calls stigma skills `Dp`. */
const CATEGORIES: Record<string, Skill['category']> = {
  Active: 'active',
  Passive: 'passive',
  Dp: 'stigma',
  Stigma: 'stigma',
};

function skill(raw: unknown): Skill | null {
  const o = obj(raw);
  const id = num(o?.id);
  if (!o || id === null) return null;
  const category = text(o.category);
  return {
    id,
    name: text(o.name),
    icon: nonEmpty(o.icon),
    category: CATEGORIES[category] ?? category,
    level: num(o.skillLevel),
    needLevel: num(o.needLevel) ?? 0,
    acquired: flag(o.acquired) === true,
    equipped: flag(o.equip) === true,
  };
}

export function normalizeEquipment(raw: unknown): CharacterEquipment | null {
  const o = obj(raw);
  if (!o) return null;
  const gear = obj(o.equipment);
  const petwing = obj(o.petwing);
  const items = (v: unknown) =>
    list(v)
      .map(equipped)
      .filter((i): i is EquippedItem => i !== null)
      .sort((a, b) => a.slot - b.slot);
  return {
    items: items(gear?.equipmentList),
    skins: items(gear?.skinList),
    pet: companion(petwing?.pet),
    wing: companion(petwing?.wing),
    wingSkin: companion(petwing?.wingSkin),
    skills: list(obj(o.skill)?.skillList)
      .map(skill)
      .filter((s): s is Skill => s !== null),
  };
}

export function normalizeSheet(raw: unknown): CharacterSheet {
  const o = obj(raw) ?? {};
  const id = obj(o.identity) ?? {};
  return {
    identity: {
      characterId: text(id.character_id),
      serverId: num(id.server_id) ?? 0,
      region: text(id.region),
      name: text(id.name),
      lang: text(id.lang),
    },
    fetchedMs: num(o.fetched_ms) ?? Date.now(),
    cached: o.cached === true,
    info: normalizeInfo(o.info),
    infoError: o.info_error ? profileError(o.info_error) : null,
    equipment: normalizeEquipment(o.equipment),
    equipmentError: o.equipment_error ? profileError(o.equipment_error) : null,
  };
}

function itemStat(raw: unknown): ItemStat | null {
  const o = obj(raw);
  if (!o || !text(o.name)) return null;
  const extra = nonEmpty(o.extra);
  return {
    id: text(o.id),
    name: text(o.name),
    value: text(o.value),
    min: nonEmpty(o.minValue),
    // `0` and `0%` mean no enchant bonus.
    extra: extra === '0' || extra === '0%' ? null : extra,
    breakthrough: o.exceed === true,
  };
}

function itemSet(raw: unknown): ItemSet | null {
  const o = obj(raw);
  if (!o) return null;
  const items = list(o.items)
    .map((r) => {
      const i = obj(r);
      if (!i || !text(i.name)) return null;
      return {
        id: num(i.id),
        name: text(i.name),
        grade: text(i.grade),
        equipped: i.equipped === true,
        variants: list(i.children).length,
      };
    })
    .filter((i) => i !== null);
  const bonuses = list(o.bonuses)
    .map((r) => {
      const b = obj(r);
      return b ? { degree: num(b.degree), descriptions: texts(b.descriptions) } : null;
    })
    .filter((b) => b !== null && b.descriptions.length > 0) as ItemSet['bonuses'];
  if (!items.length && !bonuses.length) return null;
  const id = nonEmpty(o.id) ?? (num(o.id) !== null ? String(o.id) : null);
  return { id, name: text(o.name), equippedCount: num(o.equippedCount), items, bonuses };
}

/** Every field the detail view shows under its own heading. */
const KNOWN_ITEM_FIELDS = new Set([
  'id',
  'name',
  'grade',
  'gradeName',
  'icon',
  'type',
  'categoryName',
  'equipCategory',
  'level',
  'levelValue',
  'enchantLevel',
  'maxEnchantLevel',
  'maxExceedEnchantLevel',
  'safeEnchantLevel',
  'equipLevel',
  'raceName',
  'classNames',
  'costumes',
  'desc',
  'mainStats',
  'subStats',
  'subStatCount',
  'subStatRandom',
  'subSkills',
  'subSkillCountMax',
  'soulBindRate',
  'magicStoneStat',
  'magicStoneSlotCount',
  'godStoneStat',
  'godStoneSlotCount',
  'set',
  'SetItem',
  'sources',
  'storable',
  'storableGuild',
  'tradable',
  'tradablePersonal',
  'enchantable',
  'decomposable',
  'durationMin',
  'durationMax',
  'coolTime',
  // Account-specific on the official site; never shown.
  'favorite',
]);

/** The game marks highlighted words in descriptions; the view shows plain text. */
const plainDescription = (v: unknown) =>
  text(v)
    .replace(/<\/?desc_point>/gi, '')
    .replace(/<[^>]*>/g, '');

export function normalizeItem(raw: unknown): ItemDetail | null {
  const o = obj(raw);
  const id = num(o?.id);
  if (!o || id === null) return null;
  const stats = (v: unknown) =>
    list(v)
      .map(itemStat)
      .filter((s): s is ItemStat => s !== null);
  const other: [string, string][] = Object.entries(o)
    .filter(([k, v]) => !KNOWN_ITEM_FIELDS.has(k) && v !== null && v !== '')
    .map(([k, v]) => [
      k,
      Array.isArray(v) && v.every((x) => typeof x !== 'object')
        ? v.join(', ')
        : typeof v === 'string'
          ? v
          : JSON.stringify(v),
    ]);
  const setRaw =
    obj(o.set) && (list(obj(o.set)?.items).length || list(obj(o.set)?.bonuses).length)
      ? o.set
      : o.SetItem;
  return {
    id,
    name: text(o.name),
    grade: text(o.grade),
    icon: nonEmpty(o.icon),
    type: text(o.type),
    category: text(o.categoryName) || text(o.equipCategory),
    level: num(o.level) || null,
    levelBonus: num(o.levelValue) || null,
    enchant: num(o.enchantLevel),
    maxEnchant: num(o.maxEnchantLevel),
    maxBreakthrough: num(o.maxExceedEnchantLevel),
    safeEnchant: num(o.safeEnchantLevel),
    equipLevel: num(o.equipLevel),
    race: text(o.raceName),
    classes: list(o.classNames).filter((c): c is string => typeof c === 'string'),
    costumes: list(o.costumes).filter((c): c is string => typeof c === 'string'),
    description: plainDescription(o.desc),
    mainStats: stats(o.mainStats),
    subStats: stats(o.subStats),
    subStatCount: num(o.subStatCount),
    subStatRandom: o.subStatRandom === true,
    subSkills: list(o.subSkills)
      .map((r) => {
        const s = obj(r);
        return s && text(s.name)
          ? { id: num(s.id), name: text(s.name), level: num(s.level), icon: nonEmpty(s.icon) }
          : null;
      })
      .filter((s) => s !== null),
    subSkillMax: num(o.subSkillCountMax),
    soulBindRate: nonEmpty(o.soulBindRate),
    sockets: list(o.magicStoneStat)
      .map((r) => {
        const s = obj(r);
        return s && text(s.name)
          ? {
              slot: num(s.slotPos) ?? 0,
              id: text(s.id),
              name: text(s.name),
              value: text(s.value),
              grade: text(s.grade),
              icon: nonEmpty(s.icon),
            }
          : null;
      })
      .filter((s) => s !== null)
      .sort((a, b) => a.slot - b.slot),
    socketSlots: num(o.magicStoneSlotCount),
    godstones: list(o.godStoneStat)
      .map((r) => {
        const s = obj(r);
        return s && text(s.name)
          ? {
              name: text(s.name),
              grade: text(s.grade),
              icon: nonEmpty(s.icon),
              description: plainDescription(s.desc),
            }
          : null;
      })
      .filter((s) => s !== null),
    godstoneSlots: num(o.godStoneSlotCount),
    set: itemSet(setRaw),
    sources: list(o.sources).filter((s): s is string => typeof s === 'string' && s !== ''),
    flags: {
      storable: flag(o.storable),
      storableGuild: flag(o.storableGuild),
      tradable: flag(o.tradable),
      tradablePersonal: flag(o.tradablePersonal),
      enchantable: flag(o.enchantable),
      decomposable: flag(o.decomposable),
    },
    durationMin: num(o.durationMin),
    durationMax: num(o.durationMax),
    coolTime: num(o.coolTime),
    other,
  };
}

const NODE_KINDS: Record<string, BoardNode['kind']> = {
  Stat: 'stat',
  SkillLevel: 'skill',
  Start: 'start',
  None: 'empty',
};

export function normalizeBoard(raw: unknown, id: number): Board | null {
  const o = obj(raw);
  if (!o || !Array.isArray(o.nodeList)) return null;
  const nodes = list(o.nodeList)
    .map((r): BoardNode | null => {
      const n = obj(r);
      const row = num(n?.row);
      const col = num(n?.col);
      if (!n || row === null || col === null || row < 1 || col < 1) return null;
      const kind = text(n.type);
      return {
        id: num(n.nodeId) ?? row * 1000 + col,
        row,
        col,
        kind: NODE_KINDS[kind] ?? (kind || 'empty'),
        grade: text(n.grade),
        name: text(n.name),
        open: flag(n.open) === true,
        effects: texts(n.effectList),
      };
    })
    .filter((n): n is BoardNode => n !== null)
    .sort((a, b) => a.row - b.row || a.col - b.col);
  return {
    id,
    nodes,
    rows: Math.max(0, ...nodes.map((n) => n.row)),
    cols: Math.max(0, ...nodes.map((n) => n.col)),
    skillEffects: texts(o.openSkillEffectList),
    statEffects: texts(o.openStatEffectList),
  };
}
