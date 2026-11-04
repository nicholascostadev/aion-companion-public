import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../../components/ui/Icon';
import { WindowButton } from '../../components/ui/Overlay';
import { useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Grade } from '../../types/profile';
import { gradeStyle } from './model';

/**
 * Where an official image is drawn from (native's artwork scheme in the app). Provided by
 * the window, so views never build image addresses themselves.
 */
export const ProfileArtContext = createContext<(url: string | null) => string | null>(() => null);

/** Official art that failed once stays hidden for the window's lifetime. */
const broken = new Set<string>();

/**
 * One original NCSOFT image (an item, skill, board or portrait), never draggable. Without
 * art, or when it fails, the written `fallback` (an initial) takes its place. `fill` draws
 * it at its box's size instead of `size`, for art that scales with its frame.
 */
export function OfficialArt({
  url,
  size,
  label,
  fallback,
  fill = false,
  className,
}: {
  url: string | null;
  size: number;
  label?: string;
  fallback?: ReactNode;
  fill?: boolean;
  className?: string;
}) {
  const resolve = useContext(ProfileArtContext);
  const [, setFailed] = useState(0);
  const src = resolve(url);
  if (!src || broken.has(src))
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center bg-surface-3 text-2xs font-semibold text-ink-3 uppercase',
          fill && 'size-full',
          className,
        )}
        style={fill ? undefined : { width: size, height: size }}
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
      >
        {fallback}
      </span>
    );
  return (
    <img
      src={src}
      width={size}
      height={size}
      alt={label ?? ''}
      {...(label ? {} : { 'aria-hidden': true })}
      draggable={false}
      decoding="async"
      loading="lazy"
      className={cn(
        'pointer-events-none inline-block shrink-0 object-cover select-none [-webkit-user-drag:none]',
        fill && 'size-full',
        className,
      )}
      onError={() => {
        broken.add(src);
        setFailed((n) => n + 1);
      }}
    />
  );
}

/** The first letter of a name, the written stand-in for missing art. */
export const initial = (name: string) => {
  const code = name.trim().codePointAt(0);
  return code === undefined ? '?' : String.fromCodePoint(code);
};

/**
 * Item, skin or wing art in a frame edged by its grade. `enchant` sits in the corner as the
 * game prints it (`+15`), breakthrough as small diamonds under the frame.
 */
export function GradeArt({
  url,
  name,
  grade,
  size = 40,
  enchant,
  breakthrough = 0,
  dim = false,
  className,
}: {
  url: string | null;
  name: string;
  grade: Grade | null;
  size?: number;
  enchant?: number | null | undefined;
  breakthrough?: number;
  dim?: boolean;
  className?: string;
}) {
  const style = gradeStyle(grade);
  return (
    <span
      className={cn('relative inline-flex shrink-0 flex-col items-center', className)}
      aria-hidden="true"
    >
      <span
        className={cn(
          'relative overflow-hidden rounded-sm border-2 bg-sunken',
          style.edge,
          dim && 'opacity-45 grayscale',
        )}
      >
        <OfficialArt url={url} size={size} fallback={initial(name)} className="rounded-xs" />
        {enchant ? (
          <span className="absolute top-0 right-0 rounded-bl-xs bg-shade/90 px-0.5 text-3xs leading-tight font-semibold text-ink figures">
            +{enchant}
          </span>
        ) : null}
      </span>
      {breakthrough > 0 && (
        <span className="mt-0.5 flex h-1.5 gap-0.5">
          {Array.from({ length: breakthrough }, (_, i) => (
            <span key={i} className="size-1.5 rotate-45 bg-ember" />
          ))}
        </span>
      )}
    </span>
  );
}

/** A caps label over a block of the profile. */
export function SectionTitle({
  children,
  count,
  className,
}: {
  children: ReactNode;
  count?: ReactNode;
  className?: string;
}) {
  return (
    <h3
      className={cn(
        'mb-2 flex items-baseline gap-2 text-2xs font-semibold tracking-caps text-ink-3 uppercase',
        className,
      )}
    >
      {children}
      {count !== undefined && <span className="text-ink-4 figures">{count}</span>}
    </h3>
  );
}

/** Labelled facts: a word on the left, the value on the right, hairlines between. */
export function Facts({ rows }: { rows: [ReactNode, ReactNode][] }) {
  if (!rows.length) return null;
  return (
    <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] text-xs">
      {rows.map(([term, value], i) => (
        <div key={i} className="contents">
          <dt className="border-t border-line-soft py-1 pr-3 text-ink-3 first:border-t-0">
            {term}
          </dt>
          <dd className="m-0 border-t border-line-soft py-1 text-right text-ink figures first:border-t-0">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** A quiet sentence that says what is not known and why. */
export function Unavailable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('m-0 flex gap-1.5 text-xs text-ink-3', className)}>
      <Icon name="info" size={13} className="mt-px shrink-0 text-ink-4" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The pinned detail of whatever was chosen in a tab. Beside the list in a wide window; in a
 * narrow one it covers the tab as a sheet, so it always stays inside the window.
 */
export function DetailPanel({
  label,
  closeLabel,
  onClose,
  children,
}: {
  label: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={label}
      className={cn(
        'flex min-h-0 flex-col overflow-hidden rounded-sm border border-line bg-surface-2 shadow-3',
        // Narrow: a sheet over the tab body. Wide: a column beside it.
        'absolute inset-1.5 z-10 @min-[44rem]:static @min-[44rem]:inset-auto @min-[44rem]:z-auto @min-[44rem]:shadow-none',
        'animate-sprout',
      )}
    >
      <div className="flex justify-end px-1 pt-1">
        <WindowButton size="2xs" close onClick={onClose} title={closeLabel} aria-label={closeLabel}>
          <Icon name="close" size={12} />
        </WindowButton>
      </div>
      <div className="-mt-5 min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
    </aside>
  );
}

/**
 * Escape runs `onEscape` (closing a detail, leaving full size) before the window's own
 * Escape can close the whole profile: it listens first and marks the key as handled.
 */
export function useEscape(onEscape: (() => void) | undefined) {
  useEffect(() => {
    if (!onEscape) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      onEscape();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onEscape]);
}

/** A tab body: its content and, when something is chosen, the detail beside or over it. */
export function TabBody({
  children,
  detail,
  onEscape,
}: {
  children: ReactNode;
  detail: ReactNode;
  /** Escape inside the tab closes its detail first, before it can close the window. */
  onEscape?: () => void;
}) {
  useEscape(detail ? onEscape : undefined);
  return (
    <div
      className={cn(
        'relative grid min-h-0 flex-1 gap-3 p-3',
        detail && '@min-[44rem]:grid-cols-[minmax(0,1fr)_19rem]',
      )}
    >
      <div className="min-h-0 min-w-0 overflow-y-auto pr-0.5">{children}</div>
      {detail}
    </div>
  );
}

/** A grade's word in its colour, so colour never stands alone. */
export function GradeWord({ grade, className }: { grade: Grade | null; className?: string }) {
  const { t } = useTranslation('profile');
  if (!grade) return null;
  return (
    <span className={cn(gradeStyle(grade).ink, 'font-semibold', className)}>
      {gradeName(t, grade)}
    </span>
  );
}

/** The app's word for a grade the service names; an unknown grade keeps the service's word. */
export function gradeName(t: Translate<'profile'>, grade: string) {
  const key = grade.toLowerCase();
  return isKnownGrade(key) ? t(($) => $.grade[key]) : grade;
}
const isKnownGrade = (key: string): key is (typeof GRADE_KEYS)[number] =>
  (GRADE_KEYS as readonly string[]).includes(key);
const GRADE_KEYS = ['common', 'rare', 'legend', 'unique', 'epic', 'special', 'mythic'] as const;
