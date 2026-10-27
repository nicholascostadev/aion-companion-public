import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from '../../i18n/provider';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { cn } from '../../lib/cn';
import type { PetFacing, PetFamily } from '../../types/pets';
import { useMapArtDelivery } from '../maps/mapArt';
import { MapArtNotice } from '../maps/MapArtNotice';
import { MapArt, MapGraticule } from './MapArt';
import {
  age,
  fitPoints,
  MAX_ART_UPSCALE,
  projection,
  wholeBox,
  type NearbyRow,
  type PetIndex,
  type RadarMap,
} from './model';
import { FAMILY_FILL } from './parts';
import { useMapPosition } from './useMapPosition';

/** Recorded points drawn at most, so the overlay stays light. */
const MAX_POINTS = 600;
/** Frame assumed before the first measurement (and in tests). */
const FALLBACK = { width: 340, height: 160 };
/** Close view across the frame's long side, independent of the detection radius. */
const DEFAULT_SPAN = 30_000;

interface Point {
  key: string;
  x: number;
  y: number;
  role: 'goal' | 'pinned' | 'other';
  family: PetFamily | null;
}

/** Size of an element in CSS pixels, following window resizes. */
function useFrameSize(element: HTMLElement | null) {
  const [size, setSize] = useState(FALLBACK);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * The radar's map: the original map art (or a coordinate chart without one), north-up in
 * coordinate axes (−Y up), never rotated. It follows your position around a 300-metre
 * span with adjustable zoom, with the radius as a dashed ring while the position is fresh. A last observed
 * position stays as a hollow, dashed marker without a ring; without any position it frames
 * the goal's (or pins') recorded points and draws no player. Recorded spawn points of every
 * pet still worth farming are family dots (goal and pins ringed); live sightings are
 * diamonds over them.
 */
export function LocalMap({
  index,
  view: shown,
  facing,
  radius,
  rows,
  pets,
  goal,
  pinned,
  now,
  drawArt = true,
  className,
}: {
  index: PetIndex;
  view: RadarMap;
  facing?: PetFacing | null;
  /** Metres from you to the edge of the nearby range. */
  radius: number;
  /** Live sightings of the character playing now; drawn only on that character's map. */
  rows: readonly NearbyRow[];
  /** Pets whose recorded points are drawn. */
  pets: ReadonlySet<number>;
  goal: number | null;
  pinned: ReadonlySet<number>;
  now: number;
  /**
   * False while the map is off screen: its art is released (the view, selection and every
   * other choice stay) and drawn again when it shows.
   */
  drawArt?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('pets');
  const { map, source } = shown;
  const fresh = source === 'here';
  const direction =
    shown.player &&
    facing &&
    Number.isFinite(facing.degrees) &&
    now >= facing.observed_ms &&
    now - facing.observed_ms <= 10_000
      ? facing.degrees
      : null;
  const player = useMapPosition(shown.player, drawArt && fresh, now);
  const [zoom, setZoom] = useState(1);
  const [frame, setFrame] = useState<HTMLElement | null>(null);
  const size = useFrameSize(frame);
  const view = useMemo(() => projection(map), [map]);
  const whole = useMemo(() => wholeBox(map, view), [map, view]);
  // Downloaded on first showing; until then the art's own canvas is drawn as a chart.
  const art = useMapArtDelivery(map.art, drawArt);
  const spawns = useMemo(() => index.spawns.get(map.id) ?? [], [index, map]);

  // Detection range and off-screen sightings never force a close view back out.
  const sharp = view.art ? 1 / MAX_ART_UPSCALE : 0;
  const [x0] = view.project(0, 0);
  const [x1] = view.project(DEFAULT_SPAN, 0);
  const close = Math.abs(x1 - x0) / Math.max(size.width, size.height);
  let centre: [number, number];
  let unit: number;
  if (player) {
    const [cx, cy] = view.project(player.x, player.y);
    centre = [cx, cy];
    unit = Math.max(sharp, close / zoom);
  } else {
    const focus = spawns.filter((s) => s.pet === goal);
    const chosen = focus.length ? focus : spawns.filter((s) => pinned.has(s.pet));
    const box = chosen.length
      ? fitPoints(
          map,
          view,
          chosen.map((s) => {
            const [x, y] = view.project(s.x, s.y);
            return { x, y };
          }),
        )
      : whole;
    centre = [box.x + box.width / 2, box.y + box.height / 2];
    unit = Math.max(sharp, box.width / size.width / zoom, box.height / size.height / zoom);
  }
  const box = {
    x: centre[0] - (size.width * unit) / 2,
    y: centre[1] - (size.height * unit) / 2,
    width: size.width * unit,
    height: size.height * unit,
  };
  const inside = (x: number, y: number) =>
    x >= box.x && x <= box.x + box.width && y >= box.y && y <= box.y + box.height;

  // Goal and pins first, so a cap never drops them; drawn in reverse so they sit on top.
  const points: Point[] = [];
  const ranked = useMemo(
    () =>
      [...spawns]
        .filter((s) => pets.has(s.pet))
        .sort(
          (a, b) =>
            Number(b.pet === goal) - Number(a.pet === goal) ||
            Number(pinned.has(b.pet)) - Number(pinned.has(a.pet)),
        ),
    [spawns, pets, goal, pinned],
  );
  // The catalogue repeats some records of a pet at the very same spot: one mark each.
  const seen = new Set<string>();
  for (const s of ranked) {
    const [x, y] = view.project(s.x, s.y);
    const key = `${s.pet}:${s.x}:${s.y}`;
    if (!inside(x, y) || seen.has(key)) continue;
    seen.add(key);
    points.push({
      key,
      x,
      y,
      role: s.pet === goal ? 'goal' : pinned.has(s.pet) ? 'pinned' : 'other',
      family: index.pets.get(s.pet)?.family ?? null,
    });
    if (points.length >= MAX_POINTS) break;
  }
  // Sightings belong to the map you are on; a goal or chosen map has none of them.
  const live = player
    ? rows.flatMap((r) => {
        if (r.sighting.x === null || r.sighting.y === null) return [];
        const [x, y] = view.project(r.sighting.x, r.sighting.y);
        return inside(x, y) ? [{ row: r, x, y }] : [];
      })
    : [];
  const me = player ? view.project(player.x, player.y) : null;
  const ringR =
    player && me ? Math.abs(view.project(player.x + radius * 100, player.y)[0] - me[0]) : 0;
  const label = index.labels.get(map.id)?.label ?? map.name;
  const u = unit;
  const lastAge = player && !fresh ? age(now - player.observed_ms) : null;
  const has = (role: Point['role']) => points.some((p) => p.role === role);
  const subject = view.art
    ? player
      ? fresh
        ? t(($) => $.localMap.subject.artHere, { map: label })
        : t(($) => $.localMap.subject.artLast, { map: label })
      : t(($) => $.localMap.subject.art, { map: label })
    : player
      ? fresh
        ? t(($) => $.localMap.subject.chartHere, { map: label })
        : t(($) => $.localMap.subject.chartLast, { map: label })
      : t(($) => $.localMap.subject.chart, { map: label });
  const recorded = t(($) => $.localMap.recorded, { count: points.length });
  const title = live.length
    ? t(($) => $.localMap.titleLive, {
        subject,
        recorded,
        live: t(($) => $.localMap.live, { count: live.length }),
      })
    : t(($) => $.localMap.title, { subject, recorded });

  return (
    <figure
      ref={setFrame}
      className={cn(
        'pet-local-map relative m-0 min-h-0 overflow-hidden rounded-md border border-line inset-shadow-well',
        view.art && art.ready ? 'bg-paper' : 'bg-parchment',
        className,
      )}
      data-source={source}
      data-ground={view.art && art.ready ? 'sheet' : 'chart'}
    >
      <svg
        className="absolute inset-0 block size-full"
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid slice"
      >
        <title>{title}</title>
        {map.art ? (
          // The box has the frame's proportions, so it is exactly the area on screen.
          drawArt &&
          (art.ready ? (
            <MapArt art={map.art} delivery={art} whole={whole} area={box} unit={unit} />
          ) : (
            <MapGraticule whole={whole} unit={u} />
          ))
        ) : (
          // A chart: a faint graticule in tenths inside the map's neatline.
          <g className="pointer-events-none fill-none" data-chart="graticule">
            {Array.from({ length: 9 }, (_, i) => {
              const fx = (whole.width * (i + 1)) / 10;
              const fy = (whole.height * (i + 1)) / 10;
              return (
                <g key={i} className="stroke-paper-line">
                  <line x1={fx} y1={0} x2={fx} y2={whole.height} strokeWidth={u} />
                  <line x1={0} y1={fy} x2={whole.width} y2={fy} strokeWidth={u} />
                </g>
              );
            })}
            <rect
              className="stroke-paper-ink/45"
              width={whole.width}
              height={whole.height}
              strokeWidth={1.6 * u}
            />
          </g>
        )}
        {/* The nearby range, a pen-drawn ring, only around a fresh position. */}
        {me && fresh && (
          <circle
            data-mark="range"
            className="fill-none stroke-paper-ink/55"
            cx={me[0]}
            cy={me[1]}
            r={ringR}
            strokeWidth={u * 1.1}
            strokeDasharray={`${u * 4} ${u * 3}`}
          />
        )}
        {/* Recorded points: family dots with a dark rim; goal and pins inside a ring. */}
        {[...points].reverse().map((p) => (
          <g key={p.key} data-mark={p.role === 'other' ? 'spawn' : p.role}>
            {p.role !== 'other' && (
              <>
                <circle
                  className="fill-none stroke-ink-inverse/80"
                  cx={p.x}
                  cy={p.y}
                  r={u * 5}
                  strokeWidth={u * 2.6}
                />
                <circle
                  className={cn(
                    'fill-none',
                    p.role === 'goal' ? 'stroke-marker-goal' : 'stroke-marker-pinned',
                  )}
                  cx={p.x}
                  cy={p.y}
                  r={u * 5}
                  strokeWidth={u * 1.4}
                />
              </>
            )}
            <circle
              className={cn(
                'stroke-ink-inverse',
                p.family ? FAMILY_FILL[p.family] : 'fill-family-unknown',
              )}
              cx={p.x}
              cy={p.y}
              r={u * (p.role === 'other' ? 2.6 : 2.8)}
              strokeWidth={u * 0.9}
            />
          </g>
        ))}
        {/* Live sightings: diamonds in the colour of what they are; the goal's ripples. */}
        {live.map(({ row, x, y }) => {
          const tone = row.goal ? 'goal' : row.pinned ? 'pinned' : 'live';
          return (
            <g key={row.sighting.entity_id} data-mark={`live-${tone}`}>
              {row.goal && (
                <circle
                  className="origin-center animate-ripple fill-none stroke-marker-goal [transform-box:fill-box]"
                  cx={x}
                  cy={y}
                  r={u * 6}
                  strokeWidth={u}
                />
              )}
              <rect
                className={cn(
                  'stroke-ink-inverse',
                  tone === 'goal'
                    ? 'fill-marker-goal'
                    : tone === 'pinned'
                      ? 'fill-marker-pinned'
                      : 'fill-marker-live',
                )}
                x={x - u * 3.6}
                y={y - u * 3.6}
                width={u * 7.2}
                height={u * 7.2}
                rx={u * 0.8}
                transform={`rotate(45 ${x} ${y})`}
                strokeWidth={u * 1.1}
              />
            </g>
          );
        })}
        {me && direction !== null && (
          <g
            data-mark="player-facing"
            transform={`translate(${me[0]} ${me[1]}) rotate(${direction}) scale(${u})`}
          >
            <title>{t(($) => $.localMap.facingTitle)}</title>
            {/* Coordinate yaw: +X is right; +Y is down on this north-up map. */}
            <path
              d="M 18 0 L 6 -7 L 8 0 L 6 7 Z"
              className="fill-accent stroke-ink"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
          </g>
        )}
        {/* You: a dark dot in a pale rim; last known, a hollow dashed rim. */}
        {me &&
          (fresh ? (
            <g data-mark="player">
              {player?.estimated && (
                <circle
                  data-mark="player-estimate"
                  className="fill-none stroke-ink-inverse/70"
                  cx={me[0]}
                  cy={me[1]}
                  r={Math.max(
                    u * 12,
                    Math.abs(
                      view.project(player.x + player.uncertainty_m * 100, player.y)[0] - me[0],
                    ),
                  )}
                  strokeWidth={u}
                  strokeDasharray={`${u * 3} ${u * 2}`}
                />
              )}
              <circle
                className="fill-ink-inverse/10 stroke-ink-inverse/60"
                cx={me[0]}
                cy={me[1]}
                r={u * 9}
                strokeWidth={u}
              />
              <circle
                className="fill-ink-inverse stroke-ink"
                cx={me[0]}
                cy={me[1]}
                r={u * 4}
                strokeWidth={u * 1.6}
              />
            </g>
          ) : (
            <g data-mark="player-last">
              <circle
                className="fill-none stroke-ink-inverse"
                cx={me[0]}
                cy={me[1]}
                r={u * 6}
                strokeWidth={u * 1.6}
                strokeDasharray={`${u * 2.4} ${u * 1.8}`}
              />
              <circle className="fill-ink-inverse/60" cx={me[0]} cy={me[1]} r={u * 2} />
            </g>
          ))}
      </svg>
      {drawArt && <MapArtNotice delivery={art} compact hit />}
      <div className="absolute top-7 right-1 flex flex-col gap-1" data-hit="map-zoom">
        <Button
          iconOnly
          size="sm"
          className="bg-veil"
          aria-label={t(($) => $.spawnMap.zoomIn)}
          disabled={zoom >= 8 || (!!view.art && unit <= sharp * 1.001)}
          onClick={() => setZoom((z) => Math.min(8, z * 1.6))}
        >
          <Icon name="zoomIn" size={12} />
        </Button>
        <Button
          iconOnly
          size="sm"
          className="bg-veil"
          aria-label={t(($) => $.spawnMap.zoomOut)}
          disabled={zoom <= 0.25}
          onClick={() => setZoom((z) => Math.max(0.25, z / 1.6))}
        >
          <Icon name="zoomOut" size={12} />
        </Button>
      </div>
      <span className="pointer-events-none absolute top-1 right-1 flex max-w-[70%] gap-1">
        {player?.estimated && fresh && (
          <span
            className="min-w-0 truncate rounded-full bg-veil px-1.5 text-3xs text-ink-2"
            data-chip="estimated-position"
            title={t(($) => $.localMap.estimatedTitle)}
          >
            {t(($) => $.localMap.estimated)}
          </span>
        )}
        {lastAge !== null && (
          <span
            className="min-w-0 truncate rounded-full bg-veil px-1.5 text-3xs text-warn"
            data-chip="last-known"
            title={t(($) => $.localMap.lastKnownTitle, { age: lastAge })}
          >
            {t(($) => $.localMap.lastKnown)}
          </span>
        )}
        {!player && (
          <span className="min-w-0 truncate rounded-full bg-veil px-1.5 text-3xs text-ink-2">
            {source === 'goal' ? t(($) => $.localMap.farmingMap) : t(($) => $.localMap.chosenMap)}
          </span>
        )}
        {!view.art && (
          <span className="shrink-0 rounded-full bg-veil px-1.5 text-3xs text-ink-2">
            {t(($) => $.localMap.chart)}
          </span>
        )}
        {map.art?.approximate && (
          <span className="shrink-0 rounded-full bg-veil px-1.5 text-3xs text-ink-2">
            {t(($) => $.localMap.approximate)}
          </span>
        )}
      </span>
      {(points.length > 0 || live.length > 0) && (
        <ul
          className="pointer-events-none absolute bottom-1 left-1 m-0 flex max-w-[calc(100%-0.5rem)] list-none gap-2 overflow-hidden rounded-full bg-veil px-1.5 text-3xs whitespace-nowrap text-ink-2"
          aria-label={t(($) => $.mapKey.label)}
        >
          {has('goal') && (
            <li className="flex items-center gap-1">
              <MarkGlyph kind="goal" />
              {t(($) => $.mapKey.goal)}
            </li>
          )}
          {has('pinned') && (
            <li className="flex items-center gap-1">
              <MarkGlyph kind="pinned" />
              {t(($) => $.mapKey.pinned)}
            </li>
          )}
          {has('other') && (
            <li className="flex items-center gap-1">
              <MarkGlyph kind="spawn" />
              {t(($) => $.mapKey.spawns)}
            </li>
          )}
          {live.length > 0 && (
            <li className="flex items-center gap-1">
              <MarkGlyph kind="live" />
              {t(($) => $.mapKey.live)}
            </li>
          )}
        </ul>
      )}
    </figure>
  );
}

/** The key's copy of a map mark: ringed dots (goal, pinned), a dot (spawn), a diamond (live). */
function MarkGlyph({ kind }: { kind: 'goal' | 'pinned' | 'spawn' | 'live' }) {
  return (
    <svg viewBox="-5 -5 10 10" className="size-2.5 shrink-0 overflow-visible" aria-hidden="true">
      {(kind === 'goal' || kind === 'pinned') && (
        <circle
          className={cn(
            'fill-none',
            kind === 'goal' ? 'stroke-marker-goal' : 'stroke-marker-pinned',
          )}
          r={4}
          strokeWidth={1.3}
        />
      )}
      {kind !== 'live' && <circle className="fill-ink-2" r={kind === 'spawn' ? 2.6 : 2} />}
      {kind === 'live' && (
        <rect
          className="fill-marker-live"
          x={-2.8}
          y={-2.8}
          width={5.6}
          height={5.6}
          transform="rotate(45)"
        />
      )}
    </svg>
  );
}
