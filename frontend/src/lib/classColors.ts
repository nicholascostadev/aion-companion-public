import { canonicalClass } from './gameArt';

/**
 * Class mark colours for the DPS meter, the live table and fight reports.
 *
 * Every player is marked in the fixed colour of their class (a design choice, not a game
 * palette; see docs/CLASS_COLORS_RESEARCH.md), so a class looks the same for everyone, in
 * every window and every fight; players of one class share it and are told apart by the
 * name beside the mark. A class that is unknown, or deliberately hidden, takes the neutral
 * `class-unknown`.
 * Colours are tokens from styles/theme.css, so they are passed as `var(--color-…)`.
 */

const token = (name: string) => `var(--color-class-${name})`;

/** Canonical class name → its mark colour. */
export const CLASS_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  [
    'Gladiator',
    'Templar',
    'Ranger',
    'Assassin',
    'Spiritmaster',
    'Sorcerer',
    'Cleric',
    'Chanter',
    'Brawler',
  ].map((name) => [name, token(name.toLowerCase())]),
);

/** The neutral mark of a player whose class is unknown or hidden. */
export const UNKNOWN_CLASS_COLOR = token('unknown');

/** The mark colour of a native class name; pass null to keep a class private. */
export function classColor(name: string | null | undefined): string {
  const canonical = canonicalClass(name);
  return (canonical && CLASS_COLORS[canonical]) || UNKNOWN_CLASS_COLOR;
}
