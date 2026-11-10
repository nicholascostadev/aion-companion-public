import manifest from '../data/daevanion-art.json';
import gameArt from '../data/game-art.json';
import { canonicalClass } from './gameArt';

/*
 * Original AION 2 Daevanion board node art bundled under `public/daevanion-art`, as NCSOFT's
 * character page draws it: a stat or skill node by its grade, closed or open, and the start
 * node by the character's class. Anything else (an unknown grade, a class without its own
 * start node) has no art and keeps its written mark.
 */

const nodes: Record<string, { file?: unknown }> = manifest.nodes;
const classes: Record<string, { original_key?: string }> = gameArt.classes;

/** Hashed bundle file name, never a path. */
const FILE = /^[a-f0-9]{20}\.webp$/;
const GRADES = new Set(['common', 'rare', 'unique', 'legend']);

/** The character-site asset key of a node, or null when the site draws none for it. */
export function daevanionNodeKey(
  node: { kind: string; grade: string; open: boolean },
  playerClass: string | null | undefined,
): string | null {
  if (node.kind === 'start') {
    const canonical = canonicalClass(playerClass);
    const key = canonical && Object.hasOwn(classes, canonical) && classes[canonical]?.original_key;
    return key ? `start_${key}` : null;
  }
  if (node.kind === 'empty') return null;
  const grade = node.grade.toLowerCase();
  return GRADES.has(grade) ? `${grade}${node.open ? '_open' : ''}` : null;
}

/** Bundled art of a node, or null when none is bundled; never a network request. */
export function daevanionNodeArt(
  node: { kind: string; grade: string; open: boolean },
  playerClass: string | null | undefined,
  base = import.meta.env.BASE_URL,
): string | null {
  const key = daevanionNodeKey(node, playerClass);
  const file = key && Object.hasOwn(nodes, key) ? nodes[key]?.file : undefined;
  return typeof file === 'string' && FILE.test(file) ? `${base}daevanion-art/${file}` : null;
}
