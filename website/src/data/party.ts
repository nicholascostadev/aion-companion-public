import type { ClassName } from '@/components/class-emblem';
import run from './run.json';

/**
 * The one party every example on the page uses: the five players of a real Atiel clear in Deus
 * Research Base (src/data/run.json). Classes, levels, gear score and Combat Power are theirs.
 * The developer's own character keeps its name, foxyyyynm, with permission; the other four get
 * fictional names so no real player is identified.
 */
export type PartyMember = {
  name: string;
  cls: ClassName;
  level: number;
  gs: number;
  cp: number;
  ready: boolean;
  me?: boolean;
  leader?: boolean;
};

/** Fictional names by class (the app's own demo roster). */
const NAMES: Partial<Record<ClassName, string>> = {
  Assassin: 'Nyxalis',
  Cleric: 'Seraphine',
  Gladiator: 'Kaelthos',
  Ranger: 'Lyrienne',
  Sorcerer: 'Vexmora',
  Templar: 'Dorrin',
  Spiritmaster: 'Tovrak',
  Brawler: 'Brannoc',
  Chanter: 'Mirelle',
};

export const RAID_PARTY: PartyMember[] = run.party.map((p) => {
  const cls = p.cls as ClassName;
  return {
    name: p.me ? 'foxyyyynm' : (NAMES[cls] ?? cls),
    cls,
    level: p.level,
    gs: p.gs,
    cp: p.cp,
    // One member still has to ready up in the party room.
    ready: cls !== 'Gladiator',
    me: p.me,
    leader: p.me,
  };
});

export const AVERAGE_CP = Math.round(
  RAID_PARTY.reduce((sum, m) => sum + m.cp, 0) / RAID_PARTY.length,
);
