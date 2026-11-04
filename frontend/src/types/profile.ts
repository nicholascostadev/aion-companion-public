/*
 * Character profiles from NCSOFT's official character service, read by native (see
 * `docs/CHARACTER_PROFILES.md`). `lib/profileNormalize.ts` turns the official documents into
 * these shapes; anything the service did not send stays null or empty, never zero.
 */

/** The character the profile window shows; `revision` grows with every open. */
export interface ProfileSelection {
  revision: number;
  server_id: number;
  name: string;
}

/** One saved character: an exact name on one Global server, kept by native. */
export interface SavedCharacter {
  server_id: number;
  /** The server's name, when the app knows it. */
  server_name: string | null;
  name: string;
  saved_ms: number;
}

export interface ProfileWindowStatus {
  requested: boolean;
  visible: boolean;
  ready: boolean;
  game_active: boolean;
  /** Names are hidden: native closed the window and forgot the character. */
  hide_names: boolean;
  selection: ProfileSelection | null;
  /** Saved characters, newest first; empty while names are hidden. */
  favorites: SavedCharacter[];
  favorites_max: number;
  errors: string[];
  /** The foreground the user's open lends the window, so the game lets go of the mouse. */
  focus: ProfileFocus;
}

/**
 * `pending` until the window is shown; `granted` while it holds the foreground; `denied`
 * when Windows kept another window in front; `left` after the user moved elsewhere.
 */
export interface ProfileFocus {
  state: 'idle' | 'pending' | 'granted' | 'denied' | 'left';
  /** The open (selection revision) the state is about. */
  revision: number;
  /** A cursor confinement left after the grant was released once. */
  cursor_released: boolean;
}

export const INITIAL_PROFILE_WINDOW: ProfileWindowStatus = {
  requested: false,
  visible: false,
  ready: false,
  game_active: false,
  hide_names: false,
  selection: null,
  favorites: [],
  favorites_max: 50,
  errors: [],
  focus: { state: 'idle', revision: 0, cursor_released: false },
};

export type ProfileErrorKind =
  | 'invalid'
  | 'not_found'
  | 'private'
  | 'rate_limited'
  | 'unavailable'
  | 'network';

export interface ProfileError {
  kind: ProfileErrorKind;
  message: string;
  /** Seconds the service asked to wait (429), when it said. */
  retryAfterS: number | null;
  /** When the error reached this window, for counting down `retryAfterS`. */
  receivedMs: number;
}

/** An item, skin, wing or skill grade as the service names it (`Unique`, `Legend` …). */
export type Grade = string;

export interface Stat {
  type: string;
  name: string;
  value: number;
  /** The secondary effects the service lists under the stat, already worded. */
  effects: string[];
}

export interface Title {
  id: number;
  name: string;
  grade: Grade;
  /** The slot it is equipped in: `Attack`, `Defense`, `Etc`. */
  category: string;
  /** Effects while equipped. */
  equipEffects: string[];
  /** Effects of owning it. */
  ownEffects: string[];
  /** Share of characters that own it, when the service says. */
  ownedPercent: number | null;
}

export interface BoardSummary {
  id: number;
  name: string;
  icon: string | null;
  open: boolean;
  openNodes: number;
  totalNodes: number;
  percent: number | null;
}

/** One ranking entry, kept as the labelled facts the service sent. */
export type RankingEntry = [string, string][];

export interface CharacterInfo {
  name: string;
  level: number | null;
  className: string;
  raceName: string;
  genderName: string;
  serverName: string;
  combatPower: number | null;
  portrait: string | null;
  title: { id: number; name: string; grade: Grade } | null;
  baseStats: Stat[];
  divineStats: Stat[];
  itemLevel: number | null;
  titles: Title[];
  titlesOwned: number | null;
  titlesTotal: number | null;
  /** Null when the service sent no ranking list. */
  rankings: RankingEntry[] | null;
  boards: BoardSummary[];
}

export interface EquippedItem {
  id: number;
  name: string;
  grade: Grade;
  icon: string | null;
  /** Equipment slot number: two rings or earrings share an id, never a slot. */
  slot: number;
  slotName: string;
  enchant: number;
  breakthrough: number;
}

export interface Companion {
  id: number;
  name: string;
  icon: string | null;
  grade: Grade | null;
  level: number | null;
  enchant: number | null;
}

/** `active`, `passive`, `stigma`, or a category the app has no word for yet. */
export type SkillCategory = string;

export interface Skill {
  id: number;
  name: string;
  icon: string | null;
  category: SkillCategory;
  /**
   * The level as the service sent it; null when it sent none. A learned (`acquired`) skill
   * can be at level 0, so the level never decides whether a skill is learned.
   */
  level: number | null;
  needLevel: number;
  acquired: boolean;
  equipped: boolean;
}

export interface CharacterEquipment {
  items: EquippedItem[];
  skins: EquippedItem[];
  pet: Companion | null;
  wing: Companion | null;
  wingSkin: Companion | null;
  skills: Skill[];
}

export interface CharacterIdentity {
  characterId: string;
  serverId: number;
  region: string;
  name: string;
  lang: string;
}

export interface CharacterSheet {
  identity: CharacterIdentity;
  fetchedMs: number;
  cached: boolean;
  info: CharacterInfo | null;
  infoError: ProfileError | null;
  equipment: CharacterEquipment | null;
  equipmentError: ProfileError | null;
}

export interface ItemStat {
  id: string;
  name: string;
  value: string;
  /** The low end of a rolled range (`287 ~ 395`). */
  min: string | null;
  /** The enchant bonus, or the whole value of a breakthrough line. */
  extra: string | null;
  /** A bonus unlocked by breakthrough. */
  breakthrough: boolean;
}

export interface ItemSocket {
  slot: number;
  id: string;
  name: string;
  value: string;
  grade: Grade;
  icon: string | null;
}

export interface ItemGodstone {
  name: string;
  grade: Grade;
  icon: string | null;
  description: string;
}

export interface ItemSubSkill {
  id: number | null;
  name: string;
  level: number | null;
  icon: string | null;
}

export interface ItemSet {
  /** The official set id; two pieces of one set share it. */
  id: string | null;
  name: string;
  equippedCount: number | null;
  items: { id: number | null; name: string; grade: Grade; equipped: boolean; variants: number }[];
  bonuses: { degree: number | null; descriptions: string[] }[];
}

export interface ItemDetail {
  id: number;
  name: string;
  grade: Grade;
  icon: string | null;
  type: string;
  category: string;
  level: number | null;
  levelBonus: number | null;
  enchant: number | null;
  maxEnchant: number | null;
  maxBreakthrough: number | null;
  safeEnchant: number | null;
  equipLevel: number | null;
  race: string;
  classes: string[];
  costumes: string[];
  description: string;
  mainStats: ItemStat[];
  subStats: ItemStat[];
  subStatCount: number | null;
  subStatRandom: boolean;
  subSkills: ItemSubSkill[];
  subSkillMax: number | null;
  soulBindRate: string | null;
  sockets: ItemSocket[];
  socketSlots: number | null;
  godstones: ItemGodstone[];
  godstoneSlots: number | null;
  set: ItemSet | null;
  sources: string[];
  flags: {
    storable: boolean | null;
    storableGuild: boolean | null;
    tradable: boolean | null;
    tradablePersonal: boolean | null;
    enchantable: boolean | null;
    decomposable: boolean | null;
  };
  durationMin: number | null;
  durationMax: number | null;
  coolTime: number | null;
  /** Fields this version does not know yet, shown as written rather than dropped. */
  other: [string, string][];
}

/** `stat`, `skill` (a skill level), `start`, `empty`, or a kind the app does not know yet. */
export type NodeKind = string;

export interface BoardNode {
  id: number;
  row: number;
  col: number;
  kind: NodeKind;
  grade: Grade;
  name: string;
  open: boolean;
  effects: string[];
}

export interface Board {
  id: number;
  nodes: BoardNode[];
  rows: number;
  cols: number;
  skillEffects: string[];
  statEffects: string[];
}

/** Loading state of one lazily read detail (an item, a board). */
export type Lazy<T> =
  | { state: 'loading'; data: T | null }
  | { state: 'ready'; data: T }
  | { state: 'error'; error: ProfileError; data: T | null };
