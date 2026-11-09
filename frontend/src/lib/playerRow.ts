import type { CSSProperties } from 'react';
import type { Formatters } from '../i18n/formatters';
import type { LivePlayer } from '../types/companion';
import type { EntityId, ReportPlayer } from '../types/offline';
import { classColor } from './classColors';
import { shugoProfile, type ShugoProfile } from './shugo';

/*
 * A player on a row, the same in every window: the DPS meter, the workspace's live totals,
 * fight reports and compare. One native player goes in with the reader's privacy choice;
 * what the row shows comes out: its name or hidden label, hover title, class and class
 * colour, profile link and combat power. Party-room members share the row's chrome and its
 * combat power rule. Views only draw these fields; none of them re-decides privacy.
 */

/** Words a player's name is built from, in the reader's language. Observed names stay verbatim. */
export interface PlayerWords {
  /** Your own name while names are hidden. */
  you: string;
  /** A hidden player of an observed class, numbered: "Cleric 2". */
  classRank: (className: string, rank: number) => string;
  /** A hidden player of unknown class, numbered: "Player 2". */
  playerRank: (rank: number) => string;
  /** A player native named no one: "Player #12". */
  playerId: (id: string) => string;
  /** Marks your own row in a shown name's hover title ("Aria · Gladiator · you"). */
  youDetail?: string | undefined;
}

/** Live totals can carry an identity whose name has not arrived yet; these words name it. */
export interface LiveWords extends PlayerWords {
  pendingYou: (id: number) => string;
  pendingPlayer: (id: number) => string;
  pendingTitle: (details: string) => string;
  inferredClass: (className: string) => string;
  entity: (id: number) => string;
}

type ReportSourcePlayer = Pick<
  ReportPlayer,
  'id' | 'name' | 'class' | 'local' | 'server_id' | 'combat_power' | 'damage'
>;
type LiveSourcePlayer = Pick<
  LivePlayer,
  'entity' | 'label' | 'name' | 'class' | 'is_local' | 'name_known' | 'server_id' | 'damage'
>;

/**
 * Where the players come from. The meter and reports read the same native report but keep
 * the numbering each has always used (see `HiddenNumbering`), and a report names an unnamed
 * local player "You" where the meter shows their id.
 */
export type PlayerSource =
  | {
      kind: 'meter';
      players: readonly ReportSourcePlayer[];
      words: PlayerWords;
    }
  | {
      kind: 'report';
      players: readonly ReportSourcePlayer[];
      words: PlayerWords;
    }
  | { kind: 'live'; players: readonly LiveSourcePlayer[]; words: LiveWords };

/** One player as a row shows it. */
export interface PlayerRow {
  /** The native id as a string, the key every view looks a player up by. */
  id: string;
  local: boolean;
  /** The name on the row: observed, or while names are hidden "You" or class and rank. */
  name: string;
  /** Hover text: a shown name with its class and "you"; the hidden label otherwise. */
  title: string;
  /** A live identity whose name has not been observed yet. */
  pending: boolean;
  /** The class the row's emblem shows; null when unknown or kept private. */
  class: string | null;
  /** The row's class mark colour (`--mark`); neutral when the class is unknown or private. */
  color: string;
  /** The character's profile (observed name, Global server); null while names are hidden. */
  profile: ShugoProfile | null;
  /** Your row while names are shown: the ME tag stands beside your name. */
  meTag: boolean;
  /** Observed combat power (above 0), null when not observed; see `combatPower`. */
  combatPower: number | null;
  /** The combat power line shows: never while names are hidden, as it could identify a player. */
  showsPower: boolean;
}

const idOf = (id: EntityId | null | undefined) =>
  id === null || id === undefined ? '' : String(id);

/**
 * The class a row may show. Hidden names keep only your own class private: the others'
 * hidden labels already name theirs ("Cleric 2"), while yours reads "You".
 */
const shownClass = (player: { class: string | null; local: boolean | null }, hideNames: boolean) =>
  hideNames && player.local === true ? null : player.class;

/**
 * The class mark colour of a player's row, for views that colour a player without a whole
 * row (report charts, compare). Null (no player) is neutral.
 */
export function rowColor(
  player: { class: string | null; local: boolean | null } | null,
  hideNames: boolean,
): string {
  return classColor(player ? shownClass(player, hideNames) : null);
}

/**
 * How hidden names are numbered. The meter numbers by damage rank; a report by its list
 * position. Native lists a report's players by damage (ties by id), so for every native
 * report the two agree.
 */
type HiddenNumbering = 'damage' | 'listed';

/** Each player's 1-based number among `players` (input order), for its hidden label. */
function numbering(players: readonly { damage: number }[], order: HiddenNumbering) {
  const ranks = new Array<number>(players.length);
  const indices = players.map((_, index) => index);
  // A stable sort: equal damage keeps the listed order, as native's own sort does.
  if (order === 'damage') indices.sort((a, b) => players[b]!.damage - players[a]!.damage);
  indices.forEach((index, position) => (ranks[index] = position + 1));
  return ranks;
}

const hiddenName = (
  player: { local: boolean; class: string | null },
  rank: number,
  words: PlayerWords,
) => {
  if (player.local) return words.you;
  return player.class ? words.classRank(player.class, rank) : words.playerRank(rank);
};

/** A shown name's hover title: the name, then its class (unless the name is it) and "you". */
const shownTitle = (
  name: string,
  job: string | null | undefined,
  local: boolean,
  words: PlayerWords,
) => {
  const details = [job && job !== name && job, local && words.youDetail].filter(Boolean);
  return details.length ? `${name} · ${details.join(' · ')}` : name;
};

/** What a row shows while names are shown, from one native player. */
interface Shown {
  id: string;
  local: boolean;
  class: string | null;
  damage: number;
  name: string;
  title: string;
  pending: boolean;
  profile: ShugoProfile | null;
  combatPower: number | null;
}

function shownFromReport(
  player: ReportSourcePlayer,
  kind: 'meter' | 'report',
  words: PlayerWords,
): Shown {
  const id = idOf(player.id);
  const local = player.local === true;
  // A report has always called an unnamed local player "You"; the meter shows their id.
  const name =
    kind === 'report' && local && !player.name ? words.you : (player.name ?? words.playerId(id));
  return {
    id,
    local,
    class: player.class,
    damage: player.damage,
    name,
    title: shownTitle(name, player.class, local, words),
    pending: false,
    profile: shugoProfile(player.name, player.server_id),
    combatPower: combatPower(player.combat_power),
  };
}

/**
 * A live row's name. Only an explicitly observed identity is shown as a character name; an
 * inferred class is never presented as one. Older payloads without `name_known` keep their
 * backend `label`.
 */
function shownFromLive(player: LiveSourcePlayer, words: LiveWords): Shown {
  const local = player.is_local === true;
  const job = player.class?.trim();
  const base = {
    id: String(player.entity),
    local,
    class: player.class ?? null,
    damage: player.damage,
    // Live totals carry no combat power.
    combatPower: null,
  };
  if (player.name_known === false) {
    const id = player.entity;
    const details = [job && words.inferredClass(job), words.entity(id)].filter(Boolean);
    return {
      ...base,
      name: local ? words.pendingYou(id) : words.pendingPlayer(id),
      title: words.pendingTitle(details.join(' · ')),
      pending: true,
      profile: null,
    };
  }
  const name = (player.name_known && player.name?.trim()) || player.label;
  return {
    ...base,
    name,
    title: shownTitle(name, job, local, words),
    pending: false,
    // A pending identity has no observed name, whatever its label says.
    profile: player.name_known === true ? shugoProfile(player.name, player.server_id) : null,
  };
}

/**
 * The rows of `source`'s players, in their input order, with names shown or hidden. Hidden
 * names hide every name, profile and combat power, and your own class and its colour; the
 * others keep their class, numbered (meter and live by damage rank, a report by position).
 */
export function playerRows(source: PlayerSource, hideNames: boolean): PlayerRow[] {
  const shown: Shown[] =
    source.kind === 'live'
      ? source.players.map((p) => shownFromLive(p, source.words))
      : source.players.map((p) => shownFromReport(p, source.kind, source.words));
  const ranks = numbering(shown, source.kind === 'report' ? 'listed' : 'damage');
  return shown.map((player, index) => {
    const job = shownClass(player, hideNames);
    const hidden = hideNames ? hiddenName(player, ranks[index]!, source.words) : null;
    return {
      id: player.id,
      local: player.local,
      name: hidden ?? player.name,
      title: hidden ?? player.title,
      pending: !hideNames && player.pending,
      class: job,
      color: classColor(job),
      profile: hideNames ? null : player.profile,
      meTag: player.local && !hideNames,
      combatPower: player.combatPower,
      showsPower: !hideNames,
    };
  });
}

/* ---------- Combat power ---------- */

/** Combat power as observed: a finite number above 0, else null (not observed). */
export function combatPower(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * How each view writes combat power; each keeps its own.
 * - `compact`: meter rows, 126.6K; a dash when not observed.
 * - `full`: party-room cards and their comparison, 109,681; a dash when not observed.
 * - `inline`: inspected profiles, 109,681; nothing when not observed (the segment is left out).
 */
export type PowerFormat = 'compact' | 'full' | 'inline';

/** Combat power written in `format`; null only for `inline` when not observed. */
export function powerText(value: unknown, format: 'inline', fmt: Formatters): string | null;
export function powerText(value: unknown, format: 'compact' | 'full', fmt: Formatters): string;
export function powerText(value: unknown, format: PowerFormat, fmt: Formatters): string | null {
  const power = combatPower(value);
  if (format === 'inline') return power === null ? null : fmt.number.format(power);
  return fmt.maybe(power, format === 'compact' ? fmt.compact : fmt.number);
}

/* ---------- Row chrome ---------- */

/**
 * The chrome a meter-sized player row draws, the meter's rows and the party room's members
 * alike, so both keep one height: filled in the row's class colour (`--mark`) with no edge of
 * its own. The padding keeps the pixel the old edge took. Each view adds its own layout.
 */
export function rowChrome(color: string): {
  className: string;
  style: CSSProperties;
} {
  return {
    className:
      'min-h-7 items-center gap-1.5 rounded-sm bg-row-hover py-0.5 pr-1.75 pl-1.25 leading-tight',
    style: { '--mark': color } as CSSProperties,
  };
}
