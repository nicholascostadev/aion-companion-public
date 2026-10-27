import {
  PET_FAMILIES,
  type PetCatalogue,
  type PetEntry,
  type PetFamily,
  type PetGain,
  type PetMap,
  type PetMapArt,
  type PetMapOverview,
  type PetMapTile,
  type PetPosition,
  type PetSighting,
  type PetsStatus,
} from '../../types/pets';
import type { Formatters } from '../../i18n/formatters';
import type { Translate } from '../../i18n/provider';
import { FARM_MAPS, isFarmMap, labelMaps, type MapLabel, type Realm } from './maps';

/*
 * Pure pet collection, radar and map helpers shared by the workspace tab and the radar window.
 * Text helpers take the `pets` translator; game names (pets, monsters, maps) stay verbatim.
 */

export const MAX_LEVEL = 3;
/** Native drops these too; checked again so a late poll never shows stale data as live. */
export const POSITION_FRESH_MS = 15_000;
export const SIGHTING_FRESH_MS = 90_000;

export const FAMILY_LABEL: Record<PetFamily, string> = {
  Cognia: 'Cognia',
  Fera: 'Fera',
  Natura: 'Natura',
  Varia: 'Varia',
  Specia: 'Specia',
};
export { PET_FAMILIES };

/* ---------- Catalogue index ---------- */

export interface PetIndex {
  catalogue: PetCatalogue;
  pets: Map<number, PetEntry>;
  maps: Map<string, PetMap>;
  npcs: Map<number, string>;
  /** Static spawns by map, each tagged with its pet. */
  spawns: Map<string, { pet: number; npc: number; x: number; y: number }[]>;
  /** Readable, unique label of every map. */
  labels: Map<string, MapLabel>;
  /** The farming maps in this catalogue, in chooser order (Elyos, Asmodian, Abyss). */
  farmMaps: { map: PetMap; label: MapLabel; realm: Realm }[];
  /** Name of a monster the catalogue does not name, in the language the index was built in. */
  unnamedNpc: (id: number) => string;
}

/** Indexes a catalogue; map labels and unnamed monsters are worded with `t`. */
export function indexCatalogue(catalogue: PetCatalogue, t: Translate<'pets'>): PetIndex {
  const spawns = new Map<string, { pet: number; npc: number; x: number; y: number }[]>();
  for (const pet of catalogue.pets)
    for (const s of pet.spawns) {
      const rows = spawns.get(s.map_id) ?? [];
      rows.push({ pet: pet.id, npc: s.npc_id, x: s.x, y: s.y });
      spawns.set(s.map_id, rows);
    }
  const maps = new Map(catalogue.maps.map((m) => [m.id, m]));
  const labels = labelMaps(catalogue.maps, t);
  return {
    catalogue,
    pets: new Map(catalogue.pets.map((p) => [p.id, p])),
    maps,
    npcs: new Map(catalogue.npcs.map((n) => [n.id, n.name])),
    spawns,
    labels,
    farmMaps: FARM_MAPS.flatMap(({ id, realm }) => {
      const map = maps.get(id);
      const label = labels.get(id);
      return map && label ? [{ map, label, realm }] : [];
    }),
    unnamedNpc: (id) => t(($) => $.monsterFallback, { id }),
  };
}

export const npcName = (index: PetIndex, id: number) => index.npcs.get(id) ?? index.unnamedNpc(id);
export const mapName = (index: PetIndex, id: string) =>
  index.labels.get(id)?.label ?? index.maps.get(id)?.name ?? id;

/* ---------- Collection state ---------- */

export type PetStage = 'unknown' | 'unowned' | 'growing' | 'maxed';

export interface PetState {
  stage: PetStage;
  /** Null while the collection is unknown. */
  level: number | null;
  progress: number | null;
  /** Souls the current level needs; 0 at max. */
  needed: number | null;
  /** Souls still needed for the next level. */
  left: number | null;
  /** Souls still needed to reach the maximum level. */
  toMax: number | null;
  observedMs: number | null;
  /** Cached baseline plus observed pickups, pending a fresh game collection snapshot. */
  estimated: boolean;
}

const UNKNOWN: PetState = {
  stage: 'unknown',
  level: null,
  progress: null,
  needed: null,
  left: null,
  toMax: null,
  observedMs: null,
  estimated: false,
};

export const soulsFor = (thresholds: Record<number, number>, level: number) =>
  level >= MAX_LEVEL ? 0 : (thresholds[level] ?? 0);

export function stateFrom(
  thresholds: Record<number, number>,
  level: number,
  progress: number,
  observedMs: number | null,
  estimated = false,
): PetState {
  const lv = Math.max(0, Math.min(MAX_LEVEL, level));
  const needed = soulsFor(thresholds, lv);
  const have = lv >= MAX_LEVEL ? 0 : Math.min(progress, needed);
  const left = Math.max(0, needed - have);
  let toMax = left;
  for (let next = lv + 1; next < MAX_LEVEL; next++) toMax += soulsFor(thresholds, next);
  return {
    stage: lv >= MAX_LEVEL ? 'maxed' : lv === 0 ? 'unowned' : 'growing',
    level: lv,
    progress: have,
    needed,
    left,
    toMax,
    observedMs,
    estimated,
  };
}

/**
 * Collection state per pet. Observed rows are authoritative. A pet with no row is unowned
 * only once the full collection of this profile was synced; otherwise it stays unknown.
 */
export function collectionStates(
  catalogue: PetCatalogue,
  status: PetsStatus | null,
): Map<number, PetState> {
  const states = new Map<number, PetState>();
  const synced = !!status?.profile_id && status.collection_synced;
  const rows = new Map((status?.profile_id ? status.progress : []).map((p) => [p.pet_id, p]));
  for (const pet of catalogue.pets) {
    const row = rows.get(pet.id);
    states.set(
      pet.id,
      row
        ? stateFrom(
            catalogue.thresholds,
            row.level,
            row.progress,
            row.observed_ms,
            row.progress_estimated ?? false,
          )
        : synced
          ? stateFrom(catalogue.thresholds, 0, 0, null)
          : UNKNOWN,
    );
  }
  return states;
}

export const stateOf = (states: Map<number, PetState>, id: number) => states.get(id) ?? UNKNOWN;

export const stageLabel = (state: PetState, t: Translate<'pets'>) =>
  state.stage === 'unknown'
    ? t(($) => $.stage.unknown)
    : state.stage === 'unowned'
      ? t(($) => $.stage.unowned)
      : state.stage === 'maxed'
        ? t(($) => $.stage.maxed)
        : t(($) => $.stage.level, { level: state.level ?? 0 });

/** `~` before an estimated soul count. */
const approx = (state: PetState) => (state.estimated ? '~' : '');

/** Short "souls left" text, e.g. `12 souls to Lv 2`. */
export function soulsLeftLabel(state: PetState, t: Translate<'pets'>) {
  if (state.stage === 'unknown') return t(($) => $.souls.unknown);
  if (state.stage === 'maxed') return t(($) => $.souls.complete);
  const values = { count: state.left ?? 0, approx: approx(state) };
  return state.stage === 'unowned'
    ? t(($) => $.souls.toObtain, values)
    : t(($) => $.souls.toLevel, { ...values, level: (state.level ?? 0) + 1 });
}

/** Souls left in a dense row, e.g. `12 to Lv 2`; the full words are `soulsLeftLabel`. */
export function shortSoulsLabel(state: PetState, t: Translate<'pets'>) {
  if (state.stage === 'unknown') return t(($) => $.stage.unknown);
  if (state.stage === 'maxed') return t(($) => $.souls.complete);
  const values = { count: state.left ?? 0, approx: approx(state) };
  return state.stage === 'unowned'
    ? t(($) => $.souls.shortToObtain, values)
    : t(($) => $.souls.shortToLevel, { ...values, level: (state.level ?? 0) + 1 });
}

/** How many souls obtain a pet, from the catalogue's own growth rules. */
export function obtainHint(thresholds: Record<number, number>, t: Translate<'pets'>) {
  return t(($) => $.souls.obtainHint, { count: soulsFor(thresholds, 0) });
}

/* ---------- Family summary ---------- */

export interface FamilySummary {
  family: PetFamily | 'all';
  total: number;
  owned: number;
  maxed: number;
  unknown: number;
}

export function familySummaries(
  catalogue: PetCatalogue,
  states: Map<number, PetState>,
): FamilySummary[] {
  const make = (family: PetFamily | 'all'): FamilySummary => ({
    family,
    total: 0,
    owned: 0,
    maxed: 0,
    unknown: 0,
  });
  const all = make('all');
  const by = new Map(PET_FAMILIES.map((f) => [f, make(f)]));
  for (const pet of catalogue.pets) {
    const state = stateOf(states, pet.id);
    for (const summary of [all, by.get(pet.family)]) {
      if (!summary) continue;
      summary.total++;
      if (state.stage === 'unknown') summary.unknown++;
      if (state.stage === 'growing' || state.stage === 'maxed') summary.owned++;
      if (state.stage === 'maxed') summary.maxed++;
    }
  }
  return [all, ...PET_FAMILIES.map((f) => by.get(f) ?? make(f))];
}

/**
 * How many pets of a summary are at level 3, as far as the collection says: `exact` when
 * every pet's level is known, `atLeast` when some are unknown (the count only covers the
 * known ones), and `unknown` when none is known. Unknown never reads as zero; a type with
 * no pets counts none.
 */
export type LevelThree =
  | { kind: 'exact' | 'atLeast'; count: number; total: number; unknown: number }
  | { kind: 'unknown'; total: number };

export function levelThree(summary: FamilySummary): LevelThree {
  const { total, unknown, maxed } = summary;
  if (total > 0 && unknown >= total) return { kind: 'unknown', total };
  return { kind: unknown ? 'atLeast' : 'exact', count: maxed, total, unknown };
}

/* ---------- Filters ---------- */

export type PetFilter = 'all' | 'unowned' | 'incomplete' | 'maxed' | 'pinned';

export interface PetQuery {
  family: PetFamily | 'all';
  filter: PetFilter;
  search: string;
  pinned: readonly number[];
}

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase();

/** Pets matching the query: pinned first (in pin order), then by name. */
export function filterPets(
  index: PetIndex,
  states: Map<number, PetState>,
  query: PetQuery,
): PetEntry[] {
  const needle = fold(query.search.trim());
  const pinned = new Set(query.pinned);
  const matches = index.catalogue.pets.filter((pet) => {
    if (query.family !== 'all' && pet.family !== query.family) return false;
    const stage = stateOf(states, pet.id).stage;
    if (query.filter === 'pinned' && !pinned.has(pet.id)) return false;
    if (query.filter === 'unowned' && stage !== 'unowned') return false;
    if (query.filter === 'incomplete' && stage !== 'growing') return false;
    if (query.filter === 'maxed' && stage !== 'maxed') return false;
    if (!needle) return true;
    const haystack = [
      pet.name,
      pet.family,
      ...pet.npc_ids.map((id) => npcName(index, id)),
      ...pet.regions.map((r) => r.name),
      ...new Set(pet.spawns.map((s) => mapName(index, s.map_id))),
    ];
    return haystack.some((text) => fold(text).includes(needle));
  });
  const order = new Map(query.pinned.map((id, i) => [id, i]));
  return matches.sort((a, b) => {
    const pa = order.get(a.id);
    const pb = order.get(b.id);
    if (pa !== undefined || pb !== undefined) return (pa ?? Infinity) - (pb ?? Infinity);
    return a.name.localeCompare(b.name);
  });
}

/** Adds or removes one pin; new pins go first. */
export function withPin(pinned: readonly number[], id: number, pin: boolean) {
  const rest = pinned.filter((p) => p !== id);
  return pin ? [id, ...rest] : rest;
}

/* ---------- Live state ---------- */

export type LiveState =
  | { kind: 'preview' }
  | { kind: 'connecting'; error: string | null }
  | { kind: 'identifying' }
  | { kind: 'saved' }
  | { kind: 'live'; positionFresh: boolean };

/** Whether `status` describes the character playing right now, with a fresh own position. */
export function liveState(status: PetsStatus | null, native: boolean): LiveState {
  if (!native) return { kind: 'preview' };
  if (!status || !status.running)
    return { kind: 'connecting', error: status?.phase === 'error' ? status.message || null : null };
  if (!status.active_profile_id) return { kind: 'identifying' };
  if (status.profile_id !== status.active_profile_id) return { kind: 'saved' };
  return { kind: 'live', positionFresh: positionFresh(status) };
}

/* ---------- Collection sync ---------- */

/**
 * How current the shown collection is, apart from position and sightings. `collection_synced`
 * only says a full collection of the profile was received once, possibly long ago; only
 * `live_synced` on the character playing now says it arrived on this connection.
 * `syncedMs` is that profile's last full sync, null when it never had one. `name` is the
 * profile's character name, null when its profile row is missing (see `syncName`).
 */
export type CollectionSync =
  /** Nothing to report: browser preview or no status yet. */
  | { kind: 'none' }
  /** No profile known yet, so no collection either. */
  | { kind: 'empty' }
  /** The character playing now, its full collection received on this connection. */
  | { kind: 'current'; name: string | null; syncedMs: number | null }
  /** The character playing now, without a full collection on this connection. */
  | { kind: 'waiting'; name: string | null; syncedMs: number | null }
  /**
   * Following the character playing now, but capture has not identified it (`identifying`)
   * or is not connected (`offline`), so the last played profile is shown from disk.
   */
  | {
      kind: 'cached';
      name: string | null;
      syncedMs: number | null;
      reason: 'identifying' | 'offline';
    }
  /** A saved profile the user chose, other than the character playing now. */
  | { kind: 'saved'; name: string | null; syncedMs: number | null };

/** The character a sync describes: its observed name, or a neutral fallback. */
export const syncName = (sync: { name: string | null }, t: Translate<'pets'>) =>
  sync.name ?? t(($) => $.collection.thisCharacter);

/**
 * Collection sync state of `status`. `requested` is the profile the user chose, null while
 * following the character playing now. No age makes a collection stale; only identity and
 * this connection's sync do.
 */
export function collectionSync(
  status: PetsStatus | null,
  native: boolean,
  requested: string | null = null,
): CollectionSync {
  if (!native || !status) return { kind: 'none' };
  if (!status.profile_id) return { kind: 'empty' };
  const profile = status.profiles.find((p) => p.id === status.profile_id);
  const name = profile?.name || null;
  const syncedMs = status.collection_synced ? (profile?.synced_ms ?? null) : null;
  const active = status.running ? status.active_profile_id : null;
  if (active && status.profile_id === active)
    return { kind: status.live_synced ? 'current' : 'waiting', name, syncedMs };
  if (requested !== null && requested === status.profile_id)
    return { kind: 'saved', name, syncedMs };
  return { kind: 'cached', name, syncedMs, reason: status.running ? 'identifying' : 'offline' };
}

/**
 * The prominent explanation of a collection that is not current, or null when none is
 * needed: current collections and synced saved profiles the user chose are described by
 * the status line alone.
 */
export function collectionNotice(
  sync: CollectionSync,
  now: number,
  t: Translate<'pets'>,
  observed = 0,
): { tone: 'warn' | 'info'; text: string } | null {
  // What to do to sync the collection; passive capture cannot ask the game for it.
  const recovery = () => t(($) => $.collection.recovery);
  switch (sync.kind) {
    case 'none':
    case 'current':
      return null;
    case 'saved':
      return sync.syncedMs === null
        ? {
            tone: 'info',
            text: t(($) => $.collection.notice.savedNeverSynced, { name: syncName(sync, t) }),
          }
        : null;
    case 'empty':
      return { tone: 'info', text: t(($) => $.collection.notice.empty) };
    case 'waiting':
      return {
        tone: 'warn',
        text:
          sync.syncedMs === null
            ? observed
              ? t(($) => $.collection.notice.neverSyncedObserved, {
                  count: observed,
                  recovery: recovery(),
                })
              : t(($) => $.collection.notice.neverSynced, { recovery: recovery() })
            : t(($) => $.collection.notice.notThisSession, {
                name: syncName(sync, t),
                ago: ago(now - sync.syncedMs, t),
                recovery: recovery(),
              }),
      };
    case 'cached': {
      const name = syncName(sync, t);
      const when =
        sync.syncedMs === null
          ? t(($) => $.collection.notice.cachedNeverSynced)
          : t(($) => $.collection.notice.cachedLastSync, { ago: ago(now - sync.syncedMs, t) });
      return {
        tone: 'warn',
        text:
          sync.reason === 'identifying'
            ? t(($) => $.collection.notice.cachedIdentifying, {
                name,
                when,
                recovery: recovery(),
              })
            : t(($) => $.collection.notice.cachedOffline, { name, when }),
      };
    }
  }
}

/**
 * A few words for the compact radar about a collection that is not current, with the full
 * explanation as its tooltip; null when it is current or nothing is known.
 */
export function collectionBrief(
  sync: CollectionSync,
  now: number,
  t: Translate<'pets'>,
): { text: string; title: string } | null {
  const notice = collectionNotice(sync, now, t);
  if (!notice || sync.kind === 'empty' || sync.kind === 'saved') return null;
  const text =
    sync.kind === 'cached'
      ? t(($) => $.collection.brief.cached)
      : sync.kind === 'waiting' && sync.syncedMs !== null
        ? t(($) => $.collection.brief.notThisSession)
        : t(($) => $.collection.brief.notSynced);
  return { text, title: notice.text };
}

export const positionFresh = (status: PetsStatus) =>
  !!status.position && status.now_ms - status.position.observed_ms <= POSITION_FRESH_MS;

export interface NearbyPet {
  pet: PetEntry;
  state: PetState;
  pinned: boolean;
}
export interface NearbyRow {
  sighting: PetSighting;
  pets: NearbyPet[];
  /** At least one of its pets is pinned. */
  pinned: boolean;
  /** Pin order of its earliest pinned pet (newest pin first, see `withPin`); null unpinned. */
  pin: number | null;
  /** It drops souls of the farming goal. */
  goal: boolean;
  /** Smallest souls-left among its pets that still need souls; null if unknown. */
  needed: number | null;
  /** Direction is only shown with a fresh own position. */
  distance: number | null;
  bearing: number | null;
}

/** Pins always lead, in pin order; `null` (unpinned) sorts after every pin. */
const byPin = (a: number | null, b: number | null) => (a ?? Infinity) - (b ?? Infinity) || 0;

/**
 * Live source monsters for the live profile: pins first (in pin order, whatever their
 * distance or the goal), then the farming goal, then nearest. Sightings older than 90 s
 * are dropped; distance and direction need a fresh own position.
 */
export function nearbyRows(
  index: PetIndex,
  states: Map<number, PetState>,
  status: PetsStatus | null,
  native: boolean,
): NearbyRow[] {
  const live = liveState(status, native);
  if (!status || live.kind !== 'live') return [];
  const pinOrder = new Map(status.config.pinned_ids.map((id, i) => [id, i]));
  const goal = status.config.farming_goal?.pet_id ?? null;
  const rows: NearbyRow[] = [];
  for (const seen of status.nearby) {
    if (status.now_ms - seen.observed_ms > SIGHTING_FRESH_MS) continue;
    // A monster native could not name is worded in the interface language.
    const sighting = seen.name ? seen : { ...seen, name: npcName(index, seen.npc_id) };
    const pets = sighting.pet_ids.flatMap((id) => {
      const pet = index.pets.get(id);
      return pet ? [{ pet, state: stateOf(states, id), pinned: pinOrder.has(id) }] : [];
    });
    if (!pets.length) continue;
    const isGoal = goal !== null && pets.some((p) => p.pet.id === goal);
    // A pin, like the goal, is the user's own choice and overrides the max-level filter.
    const isPinned = pets.some((p) => p.pinned);
    if (
      !isGoal &&
      !isPinned &&
      !status.config.show_maxed &&
      pets.every((p) => p.state.stage === 'maxed')
    )
      continue;
    const lefts = pets.flatMap((p) => (p.state.left && p.state.left > 0 ? [p.state.left] : []));
    const pins = pets.flatMap((p) => pinOrder.get(p.pet.id) ?? []);
    rows.push({
      sighting,
      pets: pets.sort(
        (a, b) =>
          byPin(pinOrder.get(a.pet.id) ?? null, pinOrder.get(b.pet.id) ?? null) ||
          Number(b.pet.id === goal) - Number(a.pet.id === goal),
      ),
      pinned: isPinned,
      pin: pins.length ? Math.min(...pins) : null,
      goal: isGoal,
      needed: lefts.length ? Math.min(...lefts) : null,
      distance: live.positionFresh ? sighting.distance : null,
      bearing: live.positionFresh ? sighting.bearing : null,
    });
  }
  return rows.sort(
    (a, b) =>
      byPin(a.pin, b.pin) ||
      Number(b.goal) - Number(a.goal) ||
      (a.distance ?? Infinity) - (b.distance ?? Infinity) ||
      a.sighting.name.localeCompare(b.sighting.name),
  );
}

/** Live sightings of one monster type, led by its nearest entity with a known distance. */
export interface NearbyGroup {
  key: string;
  npcId: number;
  name: string;
  rows: NearbyRow[];
  /** The nearest entity with a known distance; its distance and bearing belong together. */
  nearest: NearbyRow | null;
  pets: NearbyPet[];
  pinned: boolean;
  /** Pin order of its earliest pinned pet; null unpinned. */
  pin: number | null;
  goal: boolean;
  /** Newest observation of any entity in the group. */
  observedMs: number;
}

/**
 * Groups live rows per monster type (`Test Wolf ×3`). A group's distance and bearing are
 * both those of its nearest entity with a known distance, never mixed across entities.
 * Order follows the rows: pins (in pin order), the goal, then nearest.
 */
export function groupNearby(rows: readonly NearbyRow[]): NearbyGroup[] {
  const groups = new Map<number, NearbyGroup>();
  for (const row of rows) {
    const npc = row.sighting.npc_id;
    const group = groups.get(npc);
    if (!group) {
      groups.set(npc, {
        key: `npc:${npc}`,
        npcId: npc,
        name: row.sighting.name,
        rows: [row],
        nearest: row.distance === null ? null : row,
        pets: row.pets,
        pinned: row.pinned,
        pin: row.pin,
        goal: row.goal,
        observedMs: row.sighting.observed_ms,
      });
      continue;
    }
    group.rows.push(row);
    group.observedMs = Math.max(group.observedMs, row.sighting.observed_ms);
    if (row.distance !== null && (group.nearest?.distance ?? Infinity) > row.distance)
      group.nearest = row;
  }
  return [...groups.values()].sort(
    (a, b) =>
      byPin(a.pin, b.pin) ||
      Number(b.goal) - Number(a.goal) ||
      (a.nearest?.distance ?? Infinity) - (b.nearest?.distance ?? Infinity) ||
      a.name.localeCompare(b.name),
  );
}

/** A pinned pet on the radar: where its nearest source monster is, or that none is near. */
export interface PinnedRow {
  pet: PetEntry;
  state: PetState;
  goal: boolean;
  /**
   * Its nearest live sighting (distance and direction need a fresh own position); null
   * when none of its monsters is near or nothing is live.
   */
  near: { distance: number | null; bearing: number | null; count: number } | null;
  /** Static spawn points on the map the character is on; null when that map is unknown. */
  here: number | null;
}

/**
 * Every pinned pet, whatever its distance, map, level or goal: a pin is the user's own
 * choice, and native keeps tracking its monsters at max level too. Pets with a live
 * sighting come first, nearest first; the rest keep pin order.
 */
export function pinnedRows(
  index: PetIndex,
  states: Map<number, PetState>,
  status: PetsStatus | null,
  native: boolean,
  hereMapId: string | null,
): PinnedRow[] {
  if (!status) return [];
  const live = liveState(status, native);
  const isLive = live.kind === 'live';
  const fresh = isLive && live.positionFresh;
  const goal = status.config.farming_goal?.pet_id ?? null;
  const spawns = hereMapId ? (index.spawns.get(hereMapId) ?? []) : null;
  const rows = status.config.pinned_ids.flatMap((id): PinnedRow[] => {
    const pet = index.pets.get(id);
    if (!pet) return [];
    const state = stateOf(states, id);
    let near: PinnedRow['near'] = null;
    if (isLive)
      for (const s of status.nearby) {
        if (status.now_ms - s.observed_ms > SIGHTING_FRESH_MS || !s.pet_ids.includes(id)) continue;
        const distance = fresh ? s.distance : null;
        if (!near) near = { distance, bearing: fresh ? s.bearing : null, count: 1 };
        else {
          near.count++;
          if (distance !== null && (near.distance ?? Infinity) > distance) {
            near.distance = distance;
            near.bearing = s.bearing;
          }
        }
      }
    return [
      {
        pet,
        state,
        goal: id === goal,
        near,
        here: spawns ? spawns.filter((s) => s.pet === id).length : null,
      },
    ];
  });
  // A stable sort: ties keep pin order.
  const far = (row: PinnedRow) => (row.near ? (row.near.distance ?? Number.MAX_VALUE) : Infinity);
  return rows.sort((a, b) => (far(a) === far(b) ? 0 : far(a) < far(b) ? -1 : 1));
}

/* ---------- Coordinate directions ---------- */

const MINUS = '−';
const SECTORS = [
  `${MINUS}Y`,
  `+X ${MINUS}Y`,
  '+X',
  '+X +Y',
  '+Y',
  `${MINUS}X +Y`,
  `${MINUS}X`,
  `${MINUS}X ${MINUS}Y`,
] as const;

/**
 * Coordinate direction of a bearing (0° = −Y, 90° = +X). This is the world coordinate
 * frame, not the player's facing, and is not claimed to be geographic north.
 */
export function axisLabel(bearing: number) {
  const b = ((bearing % 360) + 360) % 360;
  return SECTORS[Math.round(b / 45) % 8] ?? SECTORS[0];
}

/** Radar point for a bearing and distance, in a unit circle with −Y up and +X right. */
export function radarPoint(bearing: number, distance: number, radius: number) {
  const r = Math.min(1, Math.max(0, distance / Math.max(1, radius)));
  const a = (bearing * Math.PI) / 180;
  return { x: Math.sin(a) * r, y: -Math.cos(a) * r };
}

export function metres(distance: number, fmt: Formatters) {
  if (distance < 1000) return `${fmt.integer.format(Math.round(distance))} m`;
  const digits = distance >= 10_000 ? 0 : 1;
  const km = fmt.numberWith({ minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${km.format(distance / 1000)} km`;
}

/* ---------- Map projection ---------- */

export interface Projection {
  /** Drawing space size (map-image pixels, or a scaled coordinate chart). */
  width: number;
  height: number;
  /** World coordinates to drawing space. */
  project: (x: number, y: number) => [number, number];
  /** Drawing space back to world coordinates. */
  unproject: (px: number, py: number) => [number, number];
  art: boolean;
}

/** Coordinate charts are drawn in a 1000-unit space along their longest side. */
const CHART = 1000;

/**
 * Original map art uses its calibration (native canvas pixel = offset + scale × world, no
 * flip). Maps without art get a plain chart over their bounds with the same orientation:
 * +X right, +Y down, so −Y is at the top in both.
 */
export function projection(map: PetMap): Projection {
  if (map.art) {
    const { scale, offset_x: ox, offset_y: oy, width, height } = map.art;
    return {
      width,
      height,
      project: (x, y) => [ox + scale * x, oy + scale * y],
      unproject: (px, py) => [(px - ox) / scale, (py - oy) / scale],
      art: true,
    };
  }
  const [minX, minY, maxX, maxY] = map.bounds;
  const k = CHART / Math.max(maxX - minX, maxY - minY);
  return {
    width: (maxX - minX) * k,
    height: (maxY - minY) * k,
    project: (x, y) => [(x - minX) * k, (y - minY) * k],
    unproject: (px, py) => [px / k + minX, py / k + minY],
    art: false,
  };
}

export interface Marker {
  key: string;
  pet: number;
  /** Drawing-space centre of the grouped spawn points. */
  x: number;
  y: number;
  count: number;
  npcs: number[];
}

/** Spawn points closer than this share one marker on the whole map (fraction of its longest side). */
const CELL = 1 / 220;
/** Screen pixels a grouping cell spans at most as the view zooms in. */
const CELL_PX = 3;
/** Finest grouping: the whole-map cell halved this many times. */
const MAX_CELL_LEVEL = 10;
/** Hard cap so a large world never renders thousands of nodes. */
export const MAX_MARKERS = 1200;

/**
 * Grouping cell, in drawing units, for a view drawing `unit` drawing units per screen pixel:
 * the whole-map cell halved in steps until a cell spans at most `CELL_PX` screen pixels, so
 * points that would sit apart on screen are never merged. Steps keep marker keys stable while
 * the view zooms within one level.
 */
export function markerCell(view: Projection, unit = Infinity) {
  const base = Math.max(view.width, view.height) * CELL;
  const level = Math.ceil(Math.log2(base / (CELL_PX * unit)));
  return base / 2 ** Math.min(MAX_CELL_LEVEL, Math.max(0, level));
}

/**
 * Static spawn markers of `pets` on one map, grouped per pet into cells of `cell` drawing
 * units (the whole-map cell by default) so dense camps stay readable. Only groups inside
 * `area`, when given, are kept, so the node cap applies to what is on screen.
 */
export function spawnMarkers(
  index: PetIndex,
  mapId: string,
  pets: ReadonlySet<number>,
  view: Projection,
  cell = markerCell(view),
  area?: Box,
): { markers: Marker[]; total: number; truncated: boolean } {
  const groups = new Map<string, Marker & { sx: number; sy: number }>();
  let total = 0;
  for (const s of index.spawns.get(mapId) ?? []) {
    if (!pets.has(s.pet)) continue;
    total++;
    const [px, py] = view.project(s.x, s.y);
    const key = `${s.pet}:${Math.floor(px / cell)}:${Math.floor(py / cell)}`;
    const group = groups.get(key);
    if (group) {
      group.count++;
      group.sx += px;
      group.sy += py;
      if (!group.npcs.includes(s.npc)) group.npcs.push(s.npc);
    } else
      groups.set(key, { key, pet: s.pet, x: px, y: py, sx: px, sy: py, count: 1, npcs: [s.npc] });
  }
  const markers = [...groups.values()]
    .map(({ sx, sy, ...m }) => ({ ...m, x: sx / m.count, y: sy / m.count }))
    .filter((m) => !area || contains(area, m.x, m.y));
  return {
    markers: markers.slice(0, MAX_MARKERS),
    total,
    truncated: markers.length > MAX_MARKERS,
  };
}

/**
 * The mark an arrow key moves to from `from`, in the direction (`dx`, `dy`) in drawing space
 * (+Y down): the nearest one ahead, preferring marks straight ahead over ones off to the side.
 * Marks drawn on the very same spot are stepped through in drawing order (right and down go
 * to later ones), so stacked marks stay reachable. Null when nothing lies that way.
 */
export function nextMark<T extends { x: number; y: number }>(
  marks: readonly T[],
  from: T,
  dx: number,
  dy: number,
): T | null {
  const at = marks.indexOf(from);
  const forward = dx + dy > 0;
  let best: T | null = null;
  let score = Infinity;
  marks.forEach((m, i) => {
    if (m === from) return;
    const vx = m.x - from.x;
    const vy = m.y - from.y;
    let s: number;
    if (vx === 0 && vy === 0) {
      if (forward ? i < at : i > at) return;
      // Stacked marks come first, nearest in drawing order first.
      s = -1 / (1 + Math.abs(i - at));
    } else {
      const along = vx * dx + vy * dy;
      if (along <= 0) return;
      s = along + 2 * Math.abs(vx * dy - vy * dx);
    }
    if (s < score) {
      score = s;
      best = m;
    }
  });
  return best;
}

/** Spawn counts per map for `pets`, most first. */
export function mapsFor(index: PetIndex, pets: ReadonlySet<number>) {
  const counts = new Map<string, number>();
  for (const [mapId, rows] of index.spawns) {
    let n = 0;
    for (const s of rows) if (pets.has(s.pet)) n++;
    if (n) counts.set(mapId, n);
  }
  return [...counts.entries()]
    .flatMap(([id, count]) => {
      const map = index.maps.get(id);
      return map ? [{ map, count }] : [];
    })
    .sort((a, b) => b.count - a.count || a.map.name.localeCompare(b.map.name));
}

/** True when the player's fresh position belongs to this map. */
export function onMap(position: PetPosition | null, map: PetMap) {
  if (!position) return false;
  if (position.map_id) return position.map_id === map.id;
  return position.zone_id !== null && map.zone_ids.includes(position.zone_id);
}

/** The map a position belongs to, only when exactly one catalogue map matches it. */
export function positionMap(index: PetIndex, position: PetPosition | null): PetMap | null {
  if (!position) return null;
  if (position.map_id) return index.maps.get(position.map_id) ?? null;
  if (position.zone_id === null) return null;
  const zone = position.zone_id;
  const matches = index.catalogue.maps.filter((m) => m.zone_ids.includes(zone));
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** The map the radar draws, and the own position on it (if any) with its freshness. */
export interface RadarMap {
  map: PetMap;
  /**
   * `here`: a fresh own position; `last`: the last observed one, too old for distances;
   * `goal`: the farming goal's map, `chosen`: the map last chosen, both without a player.
   */
  source: 'here' | 'last' | 'goal' | 'chosen';
  /** Own position on this map; null for `goal` and `chosen`. */
  player: PetPosition | null;
}

/**
 * The radar map: where a fresh own position is, else the last observed one (shown as last
 * known), else the farming goal's map, else the map last chosen; those two only when they
 * are farming maps. Positions count only for the character playing now, and only on an
 * unambiguously known map.
 */
export function radarMap(
  index: PetIndex,
  status: PetsStatus | null,
  native: boolean,
): RadarMap | null {
  if (!status) return null;
  if (liveState(status, native).kind === 'live') {
    const fresh = positionFresh(status) ? status.position : null;
    const here = positionMap(index, fresh);
    if (here && fresh) return { map: here, source: 'here', player: fresh };
    const last = status.last_position ?? status.position;
    const there = positionMap(index, last);
    if (there && last) return { map: there, source: 'last', player: last };
  }
  const goalId = status.config.farming_goal?.map_id;
  const goal = isFarmMap(goalId) ? index.maps.get(goalId) : null;
  if (goal) return { map: goal, source: 'goal', player: null };
  const chosenId = status.config.last_map_id;
  const chosen = isFarmMap(chosenId) ? index.maps.get(chosenId) : null;
  return chosen ? { map: chosen, source: 'chosen', player: null } : null;
}

/** Age of the newest own position, fresh or last known; null when none is known. */
export function lastPositionAge(status: PetsStatus | null) {
  if (!status) return null;
  const at = status.position ?? status.last_position;
  return at ? Math.max(0, status.now_ms - at.observed_ms) : null;
}

/**
 * Pets whose recorded spawn points the radar map draws: the goal, pins, and every pet that
 * still needs souls or whose collection is unknown (complete ones only with max-level pets
 * included).
 */
export function mapPets(
  index: PetIndex,
  states: Map<number, PetState>,
  status: PetsStatus | null,
): Set<number> {
  const pets = new Set<number>();
  const config = status?.config;
  for (const pet of index.catalogue.pets) {
    const maxed = stateOf(states, pet.id).stage === 'maxed';
    if (!maxed || config?.show_maxed) pets.add(pet.id);
  }
  for (const id of config?.pinned_ids ?? []) pets.add(id);
  if (config?.farming_goal) pets.add(config.farming_goal.pet_id);
  return pets;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The whole map: its original sheet, or the full coordinate chart. */
export function wholeBox(map: PetMap, view: Projection): Box {
  if (!map.art?.tiles.length) return { x: 0, y: 0, width: view.width, height: view.height };
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const t of map.art.tiles) {
    left = Math.min(left, t.x);
    top = Math.min(top, t.y);
    right = Math.max(right, t.x + t.width);
    bottom = Math.max(bottom, t.y + t.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

const contains = (box: Box, x: number, y: number) =>
  x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

/**
 * Closest map art is drawn: screen pixels per native texture pixel. Beyond this the painting
 * only turns to blur, so this, not a fixed factor, is the art's zoom limit.
 */
export const MAX_ART_UPSCALE = 4;
/** Closest a fit draws map art, so a fitted camp keeps the land around it crisp. */
export const FIT_ART_UPSCALE = 2;

/**
 * Drawing-space area a `box` shows in a `frame` of CSS pixels under SVG `xMidYMid meet`: the
 * box, widened on its slack axis to the frame's proportions.
 */
export function visibleArea(box: Box, frame: { width: number; height: number }): Box {
  const unit = Math.max(box.width / frame.width, box.height / frame.height);
  const width = frame.width * unit;
  const height = frame.height * unit;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** Extra area, as a fraction of the visible area, whose tiles load ahead of a pan. */
const TILE_MARGIN = 0.1;
/**
 * Most native pixels drawn at once in any view (64 Mpx, 256 MiB decoded): a 4K screen at full
 * native detail needs at most about 50 Mpx of tiles.
 */
export const MAX_TILE_PIXELS = 64 * 2 ** 20;
/**
 * Native tile pixels a view may decode per device pixel it shows: native art downscaled up to
 * about 4× on each axis, with room for the tile grid and the pan margin around it. Past that
 * the overview stands in, upscaled at most about `FIT_ART_UPSCALE` on the largest map, which
 * a fit already accepts as crisp; closer views always get their tiles.
 */
export const TILE_PIXELS_PER_SCREEN_PIXEL = 32;

/**
 * Most native pixels a view of `screen` device pixels decodes: in proportion to the screen,
 * so a small radar never holds what a 4K workspace may, but never less than the four tiles
 * around a grid corner (a small view at native detail) and never more than `MAX_TILE_PIXELS`.
 */
export function tileBudget(art: PetMapArt, screen: number) {
  const largest = art.tiles.reduce((n, t) => Math.max(n, t.width * t.height), 0);
  return Math.min(
    MAX_TILE_PIXELS,
    Math.max(4 * largest, Math.ceil(screen * TILE_PIXELS_PER_SCREEN_PIXEL)),
  );
}

/**
 * What map art draws for a view showing `area` at `unit` drawing units (native canvas pixels)
 * per CSS pixel on a screen of `dpr` device pixels per CSS pixel. The overview, when there is
 * one, is always drawn (under the tiles it fills seams and covers tiles still loading). Native
 * tiles are drawn only once the overview would be upscaled on screen, and then only the tiles
 * meeting the area, with a small margin while that fits the view's `tileBudget`, else without.
 * A view whose tiles exceed the budget either way draws the overview alone, so a large canvas
 * is never decoded whole. Art without an overview always draws its tiles.
 */
export function artLayers(
  art: PetMapArt,
  area: Box,
  unit: number,
  dpr = 1,
): { overview: PetMapOverview | null; tiles: PetMapTile[] } {
  const overview = art.overview;
  const density = overview ? Math.min(overview.width / art.width, overview.height / art.height) : 0;
  // Device pixels per drawing unit, against the overview's image pixels per drawing unit.
  if (overview && dpr / unit <= density) return { overview, tiles: [] };
  const meeting = (margin: number) => {
    const m = Math.max(area.width, area.height) * margin;
    const [left, top] = [area.x - m, area.y - m];
    const [right, bottom] = [area.x + area.width + m, area.y + area.height + m];
    return art.tiles.filter(
      (t) => t.x < right && t.x + t.width > left && t.y < bottom && t.y + t.height > top,
    );
  };
  const pixels = (tiles: PetMapTile[]) => tiles.reduce((n, t) => n + t.width * t.height, 0);
  if (!overview) return { overview, tiles: meeting(TILE_MARGIN) };
  // The area is the frame in drawing units, so this is the frame in device pixels.
  const budget = tileBudget(art, ((area.width * area.height) / (unit * unit)) * dpr * dpr);
  for (const margin of [TILE_MARGIN, 0]) {
    const tiles = meeting(margin);
    if (pixels(tiles) <= budget) return { overview, tiles };
  }
  return { overview, tiles: [] };
}

/**
 * `box` grown about its centre until, fitted whole into `frame` (like SVG `meet`), one
 * drawing unit spans at most `upscale` screen pixels. A box already that large is returned.
 */
export function limitZoom(
  box: Box,
  frame: { width: number; height: number },
  upscale: number,
): Box {
  const unit = Math.max(box.width / frame.width, box.height / frame.height);
  const k = 1 / (upscale * unit);
  if (!(k > 1)) return box;
  const width = box.width * k;
  const height = box.height * k;
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  };
}

/** `box` moved so its centre stays on `whole`: the map can never be dragged out of view. */
export function keepOnMap(box: Box, whole: Box): Box {
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const cx = clamp(box.x + box.width / 2, whole.x, whole.x + whole.width);
  const cy = clamp(box.y + box.height / 2, whole.y, whole.y + whole.height);
  return { ...box, x: cx - box.width / 2, y: cy - box.height / 2 };
}

/** Smallest area a fit shows, in world units (centimetres): a camp stays in context. */
export const MIN_FIT_WORLD = 30_000;

/**
 * Drawing-space box around `points`, padded, and never smaller than `MIN_FIT_WORLD` (or
 * the whole map, when that is smaller). Without points it is the whole map.
 */
export function fitPoints(
  map: PetMap,
  view: Projection,
  points: readonly { x: number; y: number }[],
): Box {
  const whole = wholeBox(map, view);
  if (!points.length) return whole;
  let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of points) {
    left = Math.min(left, p.x);
    top = Math.min(top, p.y);
    right = Math.max(right, p.x);
    bottom = Math.max(bottom, p.y);
  }
  const [x0] = view.project(0, 0);
  const [x1] = view.project(MIN_FIT_WORLD, 0);
  const least = Math.min(Math.abs(x1 - x0), Math.max(whole.width, whole.height));
  const pad = Math.max(right - left, bottom - top) * 0.12;
  const width = Math.max(right - left + pad * 2, least);
  const height = Math.max(bottom - top + pad * 2, least);
  return {
    x: (left + right) / 2 - width / 2,
    y: (top + bottom) / 2 - height / 2,
    width,
    height,
  };
}

/* ---------- Gains ---------- */

export const recentGains = (gains: PetGain[], limit = 50) =>
  [...gains].sort((a, b) => b.at_ms - a.at_ms).slice(0, limit);

/** How long ago, e.g. `just now`, `12s ago`, `3h ago`. */
export function ago(ms: number, t: Translate<'pets'>) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return t(($) => $.ago.justNow);
  if (s < 60) return t(($) => $.ago.seconds, { n: s });
  const m = Math.round(s / 60);
  if (m < 60) return t(($) => $.ago.minutes, { n: m });
  const h = Math.round(m / 60);
  if (h < 48) return t(($) => $.ago.hours, { n: h });
  return t(($) => $.ago.days, { n: Math.round(h / 24) });
}

/** Elapsed time, e.g. `12 min`, `1 h 05 min`: unit symbols read the same in every language. */
export function duration(ms: number) {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return '<1 min';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Seconds of age for freshness chips, e.g. `3 s`, `2 min`. */
export function age(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}

/** The capture session of the profile shown, or null when none belongs to it. */
export function sessionOf(status: PetsStatus | null) {
  const session = status?.session;
  if (!status || !session?.profile_id || session.started_ms === null) return null;
  return session.profile_id === status.profile_id ? session : null;
}
