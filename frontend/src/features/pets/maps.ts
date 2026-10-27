import type { Translate } from '../../i18n/provider';
import type { PetMap } from '../../types/pets';

/*
 * Readable, unique map labels derived only from catalogue facts: the map's own name and
 * the structure of its internal id. Faction folders (`World_L`, `World_D`, `Light`, `Dark`,
 * growth clusters `_L`/`_D`) name the faction; `_Easy`, `_Normal` and `_Hard` name a
 * difficulty. Any other suffix stays a neutral variant: nothing is guessed about it.
 * Catalogue and faction names stay verbatim; only the words around them are translated.
 */

export type Faction = 'Elyos' | 'Asmodian';
export type MapKind = 'field' | 'layer' | 'abyss' | 'dungeon' | 'growth' | 'other';

export interface MapLabel {
  id: string;
  /** Unique, readable label. */
  label: string;
  /** Place name without variant or faction. */
  place: string;
  /** Difficulty (`Easy`, `Normal`, `Hard`) or a neutral `Variant …`; null when single. */
  variant: string | null;
  faction: Faction | null;
  kind: MapKind;
  /** Map an instance layer belongs to. */
  parent: string | null;
  /** No display name in the catalogue: the place is spelled out from the internal id. */
  derived: boolean;
  /** Chooser section. */
  group: string;
  /** Group order in choosers; lower first. */
  rank: number;
}

const DIFFICULTIES = ['Easy', 'Normal', 'Hard'] as const;
type Difficulty = (typeof DIFFICULTIES)[number];
const isDifficulty = (word: string): word is Difficulty =>
  (DIFFICULTIES as readonly string[]).includes(word);
const LAYER = '/InstanceLayer/';

/** `GarrisonTerritory_L2_D2` → `Garrison Territory L2 D2`. */
export function spellId(token: string) {
  return token
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/[_\s]+/g, ' ')
    .trim();
}

const last = (id: string) => id.slice(id.lastIndexOf('/') + 1);

function factionOf(id: string): Faction | null {
  const parts = id.split('/');
  if (parts.some((p) => p === 'World_L' || p === 'Light' || p === 'ClusterofGrowth_L'))
    return 'Elyos';
  if (parts.some((p) => p === 'World_D' || p === 'Dark' || p === 'ClusterofGrowth_D'))
    return 'Asmodian';
  return null;
}

function kindOf(id: string): MapKind {
  if (id.includes(LAYER)) return 'layer';
  const root = id.split('/')[0];
  return root === 'World'
    ? 'field'
    : root === 'Intersever'
      ? 'abyss'
      : root === 'Dungeon'
        ? 'dungeon'
        : root === 'ClusterofGrowth'
          ? 'growth'
          : 'other';
}

/** True when the catalogue has no real name for the map, only `Map <id segment>`. */
const isDerived = (map: PetMap) =>
  !map.name || map.name === map.id || map.name === `Map ${last(map.id)}`;

/** Suffix variant of an id segment: a known difficulty or a neutral variant. */
function variantOf(segment: string, t: Translate<'pets'>): string | null {
  const variant = (id: string) => t(($) => $.maps.variant, { id });
  const g = /_G_(\d+)$/.exec(segment);
  if (g) return variant(`G${g[1]}`);
  const word = /_([A-Za-z]+)$/.exec(segment)?.[1];
  if (word && isDifficulty(word)) {
    const difficulty = word.toLowerCase() as Lowercase<Difficulty>;
    return t(($) => $.maps.difficulty[difficulty]);
  }
  if (word && /^[A-Z][a-z]+$/.test(word)) return variant(word);
  const n = /_(\d+)$/.exec(segment)?.[1];
  return n ? variant(n) : null;
}

/** Place name spelled from an id segment, without faction prefixes or folder words. */
function spelledPlace(map: PetMap, parent: PetMap | undefined): string {
  let token = last(map.id);
  if (parent) {
    const prefix = `${last(parent.id)}_`;
    if (token.startsWith(prefix)) token = token.slice(prefix.length);
    token = token.replace(/^(?:Layer|Ins)_/, '');
  } else {
    token = token.replace(/^World_[LD]_/, '').replace(/^Growth_/, '');
    if (map.id.includes('/ClusterofGrowth_')) token = token.replace(/_[LD]$/, '');
  }
  return spellId(token) || map.id;
}

type MapGroup =
  | 'elyosRegions'
  | 'asmodianRegions'
  | 'regions'
  | 'abyss'
  | 'dungeons'
  | 'growth'
  | 'other'
  | 'layers';

const GROUPS: Record<MapKind, (f: Faction | null) => [MapGroup, number]> = {
  field: (f) =>
    f === 'Asmodian' ? ['asmodianRegions', 1] : f ? ['elyosRegions', 0] : ['regions', 2],
  abyss: () => ['abyss', 3],
  dungeon: () => ['dungeons', 4],
  growth: () => ['growth', 5],
  other: () => ['other', 6],
  layer: () => ['layers', 7],
};

/**
 * Labels every map once. Instance layers fold into their parent (`Verteron · HQ010`);
 * maps sharing a name are told apart by variant, then faction, then their id segment, so
 * every label is unique and stable for the same catalogue.
 */
export function labelMaps(maps: readonly PetMap[], t: Translate<'pets'>): Map<string, MapLabel> {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const labels = new Map<string, MapLabel>();
  for (const map of maps) {
    const kind = kindOf(map.id);
    const faction = factionOf(map.id);
    const parentId = kind === 'layer' ? map.id.slice(0, map.id.indexOf(LAYER)) : null;
    const parent = parentId ? byId.get(parentId) : undefined;
    const derived = isDerived(map);
    const own = derived ? spelledPlace(map, parent) : map.name.trim();
    const parentName = parent
      ? isDerived(parent)
        ? spelledPlace(parent, undefined)
        : parent.name.trim()
      : null;
    const place = parentName && derived ? `${parentName} · ${own}` : own;
    const [groupKey, rank] = GROUPS[kind](faction);
    const group = t(($) => $.maps.group[groupKey]);
    labels.set(map.id, {
      id: map.id,
      label: place,
      place,
      variant: null,
      faction,
      kind,
      parent: parent ? parent.id : null,
      derived,
      group,
      rank,
    });
  }
  // Tell maps with the same label apart, most readable distinction first.
  const clashes = (rows: MapLabel[]) => {
    const seen = new Map<string, MapLabel[]>();
    for (const row of rows) seen.set(row.label, [...(seen.get(row.label) ?? []), row]);
    return [...seen.values()].filter((same) => same.length > 1);
  };
  for (const same of clashes([...labels.values()]))
    for (const row of same) {
      const variant = variantOf(last(row.id), t);
      if (variant && !row.derived) {
        row.variant = variant;
        row.label = `${row.place} · ${variant}`;
      }
    }
  for (const same of clashes([...labels.values()])) {
    if (new Set(same.map((r) => r.faction)).size < same.length) continue;
    for (const row of same) if (row.faction) row.label = `${row.label} (${row.faction})`;
  }
  for (const same of clashes([...labels.values()]))
    for (const row of same) row.label = `${row.label} · ${last(row.id)}`;
  return labels;
}

/** Context line for a map outside its chooser group, e.g. `Elyos · Dungeon`. */
export function mapContext(label: MapLabel, t: Translate<'pets'>) {
  const kind = t(($) => $.maps.kind[label.kind]);
  return label.faction ? `${label.faction} · ${kind}` : kind;
}

/* ---------- Farming maps ---------- */

export type Realm = Faction | 'Abyss';

/**
 * The only maps pets are farmed on, one per realm: the Elyos and Asmodian main worlds and
 * the Abyss, each drawn on its verified original art (`frontend/src/data/pet-map-art.json`).
 * Every other catalogue map keeps its data for live tracking but is never offered as a choice.
 */
export const FARM_MAPS: readonly { id: string; realm: Realm }[] = [
  { id: 'World/World_L/World_L_A', realm: 'Elyos' },
  { id: 'World/World_D/World_D_A', realm: 'Asmodian' },
  { id: 'Intersever/Abyss/Abyss_Reshanta_A', realm: 'Abyss' },
];

const FARM_IDS = new Set(FARM_MAPS.map((m) => m.id));

/** True when `id` is one of the three farming maps. */
export const isFarmMap = (id: string | null | undefined): id is string => !!id && FARM_IDS.has(id);
