import { LockOpen, Navigation2, PawPrint, Pin, Target, X, ZoomIn, ZoomOut } from 'lucide-react';
import type { ReactNode } from 'react';
import radar from '@/data/radar.json';
import { useI18n } from '@/i18n/context';
import { asset } from '@/lib/site';
import { cn } from '@/lib/utils';
import { AppCaption, AppWindow, CountChip, WinButton } from './primitives';

/**
 * The pet radar window (frontend/src/features/pets/PetRadar.tsx, MarkCards.tsx): the app's demo
 * marks (the farming goal, then pinned pets), then the local map. The map is the original
 * Verteron terrain around the goal's spawns, with markers at real spawn points
 * (scripts/sync-game-data.mjs).
 */

type Card = {
  pet: number;
  monster: string | null;
  count?: number;
  name: string;
  family: 'Cognia' | 'Natura';
  level: number;
  /** Souls still needed; `nextLevel` 0 means the pet is not obtained yet. */
  souls: number;
  nextLevel: number;
  distance: string | null;
  /** Spawn points on this map, shown when the pet is not nearby. */
  points?: number;
  goal?: boolean;
};

const CARDS: Card[] = [
  {
    pet: 1002,
    monster: 'Krall Armed Soldier',
    count: 3,
    name: 'Krall laborer',
    family: 'Cognia',
    level: 1,
    souls: 22,
    nextLevel: 2,
    distance: '50 m',
    goal: true,
  },
  {
    pet: 1003,
    monster: null,
    name: 'Forest Specter',
    family: 'Natura',
    level: 1,
    souls: 5,
    nextLevel: 2,
    distance: null,
    points: 46,
  },
  {
    pet: 1005,
    monster: 'Wandering Klaw',
    count: 4,
    name: 'Klaw',
    family: 'Cognia',
    level: 0,
    souls: 5,
    nextLevel: 0,
    distance: '73 m',
  },
];

const COGNIA = 'var(--family-cognia)';
const GOLD = 'var(--color-app-accent)';
const SKY = 'var(--color-app-sky-ink)';
const LIVE = 'oklch(0.75 0.12 290)';
type Point = number[];

/** The spawn points nearest the player, where the radar currently sees the monsters. */
const nearest = (points: Point[], n: number) =>
  [...points]
    .sort((a, b) => Math.hypot(a[0]! - 0.5, a[1]! - 0.5) - Math.hypot(b[0]! - 0.5, b[1]! - 0.5))
    .slice(0, n);
const LIVE_GOAL = nearest(radar.goal, 3);
const LIVE_PINNED = nearest(radar.pinned, 4);

function Dots({ level }: { level: number }) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className={cn(
            'size-[5px] rounded-full',
            i < level ? 'bg-app-ink-2' : 'border border-app-ink-3',
          )}
        />
      ))}
    </span>
  );
}

export function AppPetRadar({
  className,
  mapHeight = 300,
}: {
  className?: string;
  /** Height of the map in px; the window is resizable in the app, so scenes use a shorter one. */
  mapHeight?: number;
}) {
  const { m } = useI18n();
  return (
    <div aria-hidden="true" className={cn('w-full max-w-[340px]', className)}>
      <AppWindow>
        <AppCaption className="gap-1.5">
          <span className="flex min-w-0 flex-1 items-center gap-2">
            <PawPrint className="size-[13px] shrink-0 text-app-accent" />
            <b className="truncate text-2xs font-semibold tracking-[0.08em] uppercase">Verteron</b>
            <span className="flex items-center gap-1 text-2xs font-semibold tracking-[0.08em] text-app-accent uppercase">
              <span className="size-1.5 animate-breathe rounded-full bg-app-accent" />
              {m.app.radarLive}
            </span>
            <CountChip>0 s</CountChip>
          </span>
          <WinButton icon={LockOpen} className="text-app-accent" />
          <WinButton icon={X} size={13} />
        </AppCaption>
        <ul className="space-y-1 p-1.5">
          {CARDS.map((c) => (
            <MarkCard key={c.pet} card={c} />
          ))}
        </ul>
        <RadarMap height={mapHeight} />
      </AppWindow>
    </div>
  );
}

function MarkCard({ card: c }: { card: Card }) {
  const { m, fmt } = useI18n();
  const progress =
    c.nextLevel === 0 ? m.app.toObtain(c.souls) : m.app.toLevel(c.souls, c.nextLevel);
  return (
    <li
      className={cn(
        'relative flex items-center gap-2 overflow-hidden rounded-[9px] border py-1.5 pr-1.5 pl-2.5',
        c.goal
          ? 'border-app-accent-line/50 bg-app-accent-soft'
          : 'border-app-line bg-app-surface-2/80',
      )}
    >
      <span
        className={cn(
          'absolute inset-y-1 left-0.5 w-[3px] rounded-full',
          c.goal ? 'bg-app-accent' : 'bg-app-sky-ink',
        )}
      />
      <img
        src={asset(`art/pet/${c.pet}.webp`)}
        alt=""
        width={256}
        height={256}
        className={cn(
          'size-9 shrink-0 rounded-full bg-app-shade object-cover ring-2',
          c.goal ? 'ring-app-accent' : 'ring-app-sky-ink',
        )}
      />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1 text-app-xs">
          {c.goal ? <Target className="size-3 shrink-0 text-app-accent" /> : null}
          {c.monster ? <Pin className="size-2.5 shrink-0 text-app-sky-ink" /> : null}
          <b className="min-w-0 truncate font-semibold">{c.monster ?? c.name}</b>
          {c.count ? <span className="text-app-ink-3">×{c.count}</span> : null}
          <span className="ml-auto flex shrink-0 items-center gap-1">
            {c.distance ? (
              <>
                <Navigation2 className="size-3 rotate-[65deg] text-app-accent" />
                <b className="figures font-bold">{c.distance}</b>
              </>
            ) : (
              <span className="text-app-ink-3">{m.app.notNearby}</span>
            )}
          </span>
        </span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-2xs text-app-ink-3">
          {c.monster ? <span className="truncate">{c.name}</span> : null}
          <img
            src={asset(`art/pet-type/${c.family.toLowerCase()}.webp`)}
            alt=""
            width={94}
            height={106}
            className="h-3 w-auto opacity-80"
          />
          <b className="font-semibold text-app-ink-2">{c.family}</b>
          <Dots level={c.level} />
          <span className="truncate">
            {progress}
            {c.points ? ` · ${m.app.pointsOnMap(fmt.integer(c.points))}` : ''}
          </span>
        </span>
      </span>
      {/* The pinned pebble (frontend/src/features/pets/parts.tsx PinButton): a ring, not a
          border, around a filled pin, centred on a grid so the glyph never drifts. */}
      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-app-sky-ink/15 text-app-sky-ink ring-1 ring-app-sky-ink/45">
        <Pin className="block size-[11px] fill-app-sky-ink/70" />
      </span>
    </li>
  );
}

const at = (p: Point) => ({ left: `${p[0]! * 100}%`, top: `${p[1]! * 100}%` });

/** A spawn marker as the app draws it: a ring in the mark's colour around the family dot. */
function Ring({ point, ring }: { point: Point; ring: string }) {
  return (
    <span
      className="absolute flex size-3.5 -translate-1/2 items-center justify-center rounded-full border-2 bg-app-shade/70"
      style={{ ...at(point), borderColor: ring }}
    >
      <span className="size-1.5 rounded-full" style={{ background: COGNIA }} />
    </span>
  );
}

/** A live sighting: a diamond beside the spawn point it was seen at. */
function Diamond({ point, color }: { point: Point; color: string }) {
  return (
    <span
      className="absolute size-2.5 -translate-1/2 rotate-45 rounded-[2px] border-2 bg-app-shade/60"
      style={{
        left: `calc(${point[0]! * 100}% + 9px)`,
        top: `calc(${point[1]! * 100}% - 7px)`,
        borderColor: color,
      }}
    />
  );
}

function RadarMap({ height }: { height: number }) {
  const { m } = useI18n();
  return (
    <div className="px-1.5 pb-1.5">
      <div
        className="relative overflow-hidden rounded-[9px] border border-app-line-strong"
        style={{ height }}
      >
        {/* The square view, centred on the player; a shorter window crops it top and bottom. */}
        <div className="absolute inset-x-0 top-1/2 aspect-square -translate-y-1/2">
          <img
            src={asset('art/map/verteron-radar.webp')}
            alt=""
            width={640}
            height={640}
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
          {radar.spawns.map((p, i) => (
            <span
              key={`s${i}`}
              className="absolute size-1.5 -translate-1/2 rounded-full bg-app-ink/80"
              style={at(p)}
            />
          ))}
          {radar.pinned.map((p, i) => (
            <Ring key={`p${i}`} point={p} ring={SKY} />
          ))}
          {radar.goal.map((p, i) => (
            <Ring key={`g${i}`} point={p} ring={GOLD} />
          ))}
          {LIVE_PINNED.map((p, i) => (
            <Diamond key={`lp${i}`} point={p} color={LIVE} />
          ))}
          {LIVE_GOAL.map((p, i) => (
            <Diamond key={`lg${i}`} point={p} color={LIVE} />
          ))}
          {/* You, facing the goal. */}
          <span className="absolute top-1/2 left-1/2 flex size-5 -translate-1/2 items-center justify-center rounded-full border border-app-ink/60 bg-app-shade/50">
            <span className="size-2 rounded-full bg-app-ink" />
            <Navigation2 className="absolute -top-2 left-3 size-3.5 rotate-[40deg] fill-app-accent text-app-accent" />
          </span>
        </div>
        <span className="absolute top-2 right-2 flex flex-col gap-1.5">
          {[ZoomIn, ZoomOut].map((Icon, i) => (
            <span
              key={i}
              className="flex size-7 items-center justify-center rounded-full bg-app-shade/90 text-app-ink"
            >
              <Icon className="size-3.5" />
            </span>
          ))}
        </span>
        <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1.5 rounded-full bg-app-shade/90 px-2 py-0.5 text-3xs text-app-ink-2">
          <Key>
            <span className="size-2 rounded-full border-2" style={{ borderColor: GOLD }} />
          </Key>
          {m.app.mapKey.goal}
          <Key>
            <span className="size-2 rounded-full border-2" style={{ borderColor: SKY }} />
          </Key>
          {m.app.mapKey.pinned}
          <Key>
            <span className="size-1.5 rounded-full bg-app-ink/80" />
          </Key>
          {m.app.mapKey.spawns}
          <Key>
            <span className="size-1.5 rotate-45 rounded-[1px]" style={{ background: LIVE }} />
          </Key>
          {m.app.mapKey.live}
        </span>
      </div>
    </div>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <span className="ml-1 flex items-center">{children}</span>;
}
