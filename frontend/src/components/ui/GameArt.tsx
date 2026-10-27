import { useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import resourceArt from '../../data/resource-art.json';
import { classArt, skillArt } from '../../lib/gameArt';
import { petArt } from '../../lib/petArt';
import { petTypeArt } from '../../lib/petTypeArt';
import type { EntityId } from '../../types/offline';

/** Artwork that failed to load once stays hidden everywhere instead of retrying. */
const failed = new Set<string>();

/**
 * One bundled artwork image. Decorative (empty alt) unless `label` names it; never
 * draggable, so pressing it still moves a draggable panel. A missing or broken image
 * renders `fallback` (by default nothing), leaving the written label in charge.
 */
function ArtImage({
  src,
  size,
  label,
  fallback = null,
  className,
  lazy = false,
}: {
  src: string | null;
  size: number;
  label?: string;
  fallback?: ReactNode;
  className?: string;
  /** Defer loading until near the viewport; for long scrolling grids. */
  lazy?: boolean;
}) {
  const [, setBroken] = useState(0);
  if (!src || failed.has(src)) return <>{fallback}</>;
  return (
    <img
      className={cn(
        // Shape and fit are left to the caller: square skill and class art is rounded and
        // cropped; pet portraits and type symbols are fitted whole, never cropped.
        'pointer-events-none inline-block shrink-0 align-middle select-none [-webkit-user-drag:none]',
        className,
      )}
      src={src}
      width={size}
      height={size}
      alt={label ?? ''}
      {...(label ? {} : { 'aria-hidden': true })}
      draggable={false}
      decoding="async"
      {...(lazy ? { loading: 'lazy' as const } : {})}
      onError={() => {
        failed.add(src);
        setBroken((n) => n + 1);
      }}
    />
  );
}

/** Original Odyle energy artwork, with its written name if the bundled image fails. */
export function OdyleIcon({ label, size = 13 }: { label: string; size?: number }) {
  return (
    <ArtImage
      src={`/resource-art/${resourceArt.odyle.file}`}
      size={size}
      label={label}
      fallback={label}
      className="object-contain"
    />
  );
}

/** Original red Hidden Cube artwork (`P_Img_HiddenCube_01_V04`), for HTML and SVG `<image>`. */
export const cubeArtSrc = `/resource-art/${resourceArt.cube.file}`;

/**
 * Original Hidden Cube artwork, fitted whole and never recoloured. With `label` it is named
 * and its written label stands in when the bundled image fails; without, it is decorative
 * and adjacent text already names it.
 */
export function CubeIcon({
  size = 14,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string | undefined;
}) {
  return (
    <ArtImage
      src={cubeArtSrc}
      size={size}
      fallback={label ?? null}
      className={cn('object-contain', className)}
      {...(label ? { label } : {})}
    />
  );
}

const gatheringArt: Readonly<Record<string, { file: string } | undefined>> = resourceArt.gathering;

/**
 * Original artwork of a gathering resource by its exact native icon key, for HTML and SVG
 * `<image>`; null when the key is missing or has no verified bundled art.
 */
export const gatheringArtSrc = (iconKey: string | null | undefined): string | null => {
  const entry = iconKey && Object.hasOwn(gatheringArt, iconKey) ? gatheringArt[iconKey] : undefined;
  return entry ? `/resource-art/${entry.file}` : null;
};

/**
 * A gathering resource's original artwork, fitted whole and never recoloured. Without
 * verified art (or when it fails to load) its short written label stands in a dashed
 * frame, never a substitute picture. `label` names it; without, it is decorative.
 */
export function GatheringIcon({
  iconKey,
  short,
  size = 18,
  label,
  className,
}: {
  iconKey: string | null;
  /** One or two letters of the resource's name, written when no art is shown. */
  short: string;
  size?: number;
  label?: string;
  className?: string | undefined;
}) {
  const src = gatheringArtSrc(iconKey);
  const written = (
    <span
      data-art="label"
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-xs border border-dashed border-line-strong font-semibold text-ink-2',
        size >= 20 ? 'text-2xs' : 'text-4xs',
        className,
      )}
      style={{ width: size, height: size }}
      {...(label ? { role: 'img', 'aria-label': label, title: label } : { 'aria-hidden': true })}
    >
      {short}
    </span>
  );
  if (!src) return written;
  return (
    <ArtImage
      src={src}
      size={size}
      fallback={written}
      className={cn('object-contain', className)}
      {...(label ? { label } : {})}
    />
  );
}

/** Original skill icon for an exact native skill id, else `fallback` (default nothing). */
export function SkillIcon({
  id,
  size = 18,
  label,
  fallback,
  className,
}: {
  id: EntityId | null | undefined;
  size?: number;
  /** Accessible name; omit when adjacent text already names the skill. */
  label?: string;
  /** Shown without verified artwork or when the image fails, e.g. the skill initials. */
  fallback?: ReactNode;
  className?: string;
}) {
  return (
    <ArtImage
      src={skillArt(id)?.src ?? null}
      size={size}
      fallback={fallback}
      className={cn('rounded-xs object-cover', className)}
      {...(label ? { label } : {})}
    />
  );
}

/** Original class emblem for a known class name, or nothing. */
export function ClassIcon({
  name,
  size = 16,
  label,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  /** Accessible name; omit when adjacent text already names the class. */
  label?: string;
  className?: string;
}) {
  return (
    <ArtImage
      src={classArt(name)?.src ?? null}
      size={size}
      className={cn('rounded-xs object-cover', className)}
      {...(label ? { label } : {})}
    />
  );
}

/**
 * Original pet type symbol of a family, fitted uncropped into a square box, or nothing,
 * leaving the written family name in charge.
 */
export function PetTypeIcon({
  family,
  size = 14,
  label,
  className,
}: {
  family: string | null | undefined;
  size?: number;
  /** Accessible name; omit when adjacent text already names the family. */
  label?: string;
  className?: string;
}) {
  return (
    <ArtImage
      src={petTypeArt(family)?.src ?? null}
      size={size}
      className={cn('pet-type-art object-contain', className)}
      {...(label ? { label } : {})}
    />
  );
}

/**
 * Original portrait of a catalogue pet, scaled to fit a square frame without cropping, in
 * a soft pool of light. With no verified portrait, or when it fails to load, the frame
 * shows a short written note. The frame has no width of its own: the caller sizes it
 * (`w-full`, `w-10` …) and may reshape it (`rounded-full`).
 */
export function PetPortrait({
  id,
  label,
  lazy = false,
  className,
}: {
  id: number;
  /** Accessible name; omit when adjacent text already names the pet. */
  label?: string;
  lazy?: boolean;
  className?: string;
}) {
  const art = petArt(id);
  return (
    <span
      className={cn(
        'pet-portrait relative grid aspect-square shrink-0 place-items-center overflow-hidden rounded-md bg-ink/5',
        className,
      )}
      {...(label ? {} : { 'aria-hidden': true })}
    >
      <ArtImage
        src={art?.src ?? null}
        size={art?.width ?? 256}
        lazy={lazy}
        fallback={
          <span
            className="p-1 text-center text-3xs leading-tight text-ink-3"
            {...(label ? { role: 'img', 'aria-label': label } : {})}
          >
            No portrait
          </span>
        }
        className="size-full object-contain"
        {...(label ? { label } : {})}
      />
    </span>
  );
}

/** Written label led by its artwork; the text truncates, the icon never shrinks. */
function ArtLabel({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full min-w-0 items-center gap-1.5 align-middle">
      {icon}
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

/** Skill name with its original icon when the id has verified artwork. */
export function SkillLabel({
  id,
  size,
  children,
}: {
  id: EntityId | null | undefined;
  size?: number;
  children: ReactNode;
}) {
  return <ArtLabel icon={<SkillIcon id={id} {...(size ? { size } : {})} />}>{children}</ArtLabel>;
}

/**
 * Text (a player or class name) led by a class emblem. `name` is the class; pass null
 * to keep the text alone, e.g. when the class must stay private.
 */
export function ClassLabel({
  name,
  size,
  children,
}: {
  name: string | null | undefined;
  size?: number;
  children: ReactNode;
}) {
  return (
    <ArtLabel icon={<ClassIcon name={name} {...(size ? { size } : {})} />}>{children}</ArtLabel>
  );
}
