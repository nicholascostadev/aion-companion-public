import { asset } from '@/lib/site';
import { cn } from '@/lib/utils';

export const CLASSES = [
  'Gladiator',
  'Templar',
  'Ranger',
  'Assassin',
  'Sorcerer',
  'Spiritmaster',
  'Cleric',
  'Chanter',
  'Brawler',
] as const;

export type ClassName = (typeof CLASSES)[number];

export function classColor(name: ClassName) {
  return `var(--class-${name.toLowerCase()})`;
}

/** Original AION 2 class emblem (NCSOFT artwork, see docs/GAME_ARTWORK.md). */
export function ClassEmblem({
  name,
  className,
  decorative = false,
}: {
  name: ClassName;
  className?: string;
  decorative?: boolean;
}) {
  return (
    <img
      src={asset(`art/class/${name.toLowerCase()}.webp`)}
      alt={decorative ? '' : `${name} emblem`}
      width={128}
      height={128}
      loading="lazy"
      decoding="async"
      className={cn('object-contain', className)}
    />
  );
}
