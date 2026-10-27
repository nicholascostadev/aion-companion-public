import manifest from '../data/game-art.json';

/*
 * Original AION 2 class and skill artwork bundled under `public/game-art`. Lookups are
 * exact: a skill resolves only through its own manifest entry or that entry's explicit
 * `base`, a class only through its name or a genuine game alias. Anything else has no
 * artwork and keeps its written label.
 */

interface ArtEntry {
  file?: string;
  name?: string | null;
  class?: string | null;
  base?: number;
}

const classes: Record<string, ArtEntry> = manifest.classes;
const skills: Record<string, ArtEntry> = manifest.skills;

/** Bundled asset URL; never a network request. */
const url = (file: string) => `${import.meta.env.BASE_URL}game-art/${file}`;

const own = <T>(table: Record<string, T>, id: string) =>
  Object.hasOwn(table, id) ? table[id] : undefined;

const normalized = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

/** Names the game itself uses for a class: the Spiritmaster is internally the Elementalist, the Brawler the Fighter. */
const CLASS_ALIASES: Record<string, string> = { elementalist: 'Spiritmaster', fighter: 'Brawler' };
const CLASS_KEYS = new Map(Object.keys(classes).map((name) => [normalized(name), name] as const));

export interface ClassArt {
  src: string;
  /** Canonical class name. */
  name: string;
}

/** The canonical class name for a native class name or a genuine game alias; null otherwise. */
export function canonicalClass(name: string | null | undefined): string | null {
  if (!name) return null;
  const wanted = normalized(name);
  return CLASS_KEYS.get(wanted) ?? own(CLASS_ALIASES, wanted) ?? null;
}

export function classArt(name: string | null | undefined): ClassArt | null {
  const canonical = canonicalClass(name);
  const file = canonical ? own(classes, canonical)?.file : undefined;
  return canonical && file ? { src: url(file), name: canonical } : null;
}

export interface SkillArt {
  src: string;
  /** Catalogue name of the skill that owns the artwork. */
  name: string | null;
  class: string | null;
}

/** Native skill id as a manifest key: a positive integer, written without leading zeros. */
function skillKey(id: number | string | null | undefined) {
  if (typeof id === 'number') return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  if (typeof id !== 'string') return null;
  const text = id.trim();
  return /^[1-9]\d*$/.test(text) ? text : null;
}

export function skillArt(id: number | string | null | undefined): SkillArt | null {
  const wanted = skillKey(id);
  const entry = wanted ? own(skills, wanted) : undefined;
  if (!entry) return null;
  // A variant points at its base exactly once; a base never chains further.
  const art = entry.base === undefined ? entry : own(skills, String(entry.base));
  if (!art?.file) return null;
  return { src: url(art.file), name: art.name ?? null, class: art.class ?? null };
}
