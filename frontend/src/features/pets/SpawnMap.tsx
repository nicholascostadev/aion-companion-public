import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type SVGProps,
} from 'react';
import { Button } from '../../components/ui/Button';
import { HoverCard, useHoverCard } from '../../components/ui/HoverCard';
import { Icon } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetFamily, PetMap, PetPosition } from '../../types/pets';
import { useMapArtDelivery } from '../maps/mapArt';
import { MapArtNotice } from '../maps/MapArtNotice';
import { MapArt, MapGraticule } from './MapArt';
import { PositionCard, SightingCard, SpawnCard } from './MarkCards';
import {
  FAMILY_LABEL,
  fitPoints,
  keepOnMap,
  limitZoom,
  FIT_ART_UPSCALE,
  MAX_ART_UPSCALE,
  MAX_MARKERS,
  markerCell,
  nextMark,
  npcName,
  PET_FAMILIES,
  projection,
  spawnMarkers,
  stateOf,
  visibleArea,
  wholeBox,
  type Box,
  type Marker,
  type NearbyRow,
  type PetIndex,
  type PetState,
} from './model';
import { FAMILY_BG, FAMILY_FILL, FamilyLabel } from './parts';
import { useMapPosition } from './useMapPosition';
import type { MapPosition } from './mapMotion';

interface Props {
  index: PetIndex;
  map: PetMap;
  /** Pets whose static spawns are drawn. */
  pets: ReadonlySet<number>;
  selected: number | null;
  /** Pet of the farming goal. */
  goal: number | null;
  pinned: ReadonlySet<number>;
  /** Fresh own position, only when it belongs to this map. */
  position: PetPosition | null;
  /** Fresh live sightings with coordinates, only when on this map. */
  sightings: readonly NearbyRow[];
  /** Collection state per pet, for the hover cards. */
  states: Map<number, PetState>;
  /** Native time, for the age of live data. */
  now: number;
  /** The character's active pet. */
  activeId?: number | null;
  /** A new value re-fits the view to the focused pet (a new selection, Start farming). */
  fitKey?: string;
  /**
   * False while the map is off screen: its art is released (the view, selection and every
   * other choice stay) and drawn again when it shows.
   */
  drawArt?: boolean;
  onSelect: (pet: number) => void;
  /**
   * Lets the selection go when the selected pet's spawn mark is chosen again; without it,
   * that mark selects as usual. A live sighting always selects.
   */
  onClear?: () => void;
}

const MIN_ZOOM = 1 / 1.25;
/**
 * Closest zoom of a coordinate chart, which is drawn in vector and never blurs. Map art has
 * no fixed limit: it stops where its native pixels would be magnified past `MAX_ART_UPSCALE`.
 */
const MAX_CHART_ZOOM = 64;
/** Zoom per Zoom in or Zoom out press. */
const ZOOM_STEP = 2;
/** Wheel distance, in pixels, that zooms by a factor of two; a mouse notch is about 100. */
const WHEEL_DOUBLING = 300;
/** Pixels per wheel line and per page, for wheels that do not report pixels. */
const WHEEL_UNITS = [1, 16, 400];
/** Extra area around the view, as a fraction of it, whose markers are kept for a pan. */
const MARKER_MARGIN = 0.1;
const MINUS = '−';

/** A mark you can point at or focus: a spawn group, a live sighting or yourself. */
interface Mark {
  key: string;
  x: number;
  y: number;
  /** Radius of its focus ring, in drawing units. */
  ring: number;
}

/** Whether focus came from the keyboard; engines without the selector say no. */
const focusVisible = (element: Element) => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
};

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/**
 * Static spawn coordinates of the chosen pets on one map, coloured by family. Maps with
 * original art draw it, calibrated, on parchment (the overview, and native tiles where the
 * view needs them); others draw a parchment coordinate chart over the map bounds, named in a
 * cartouche. Either way −Y is up and +X right. The view fits the focused pet's points (the
 * selection, else the goal) until the user zooms or pans, never closer than the art stays
 * sharp; nearby points split apart as the view zooms in. Live data is drawn distinctly.
 */
export function SpawnMap({
  index,
  map,
  pets,
  selected,
  goal,
  pinned,
  position: observedPosition,
  sightings,
  states,
  now,
  activeId = null,
  fitKey = '',
  drawArt = true,
  onSelect,
  onClear,
}: Props) {
  const { t } = useTranslation('pets');
  const view = useMemo(() => projection(map), [map]);
  // Downloaded on first showing; until then the art's own canvas is drawn as a chart.
  const art = useMapArtDelivery(map.art, drawArt);
  // Whole-map groups: what a fit frames and whether the focused pet has marks here.
  const { markers: groups, total } = useMemo(
    () => spawnMarkers(index, map.id, pets, view),
    [index, map.id, pets, view],
  );
  const focus = selected ?? goal;
  const focusGroups = useMemo(
    () => (focus === null ? [] : groups.filter((m) => m.pet === focus)),
    [groups, focus],
  );
  const whole = useMemo(() => wholeBox(map, view), [map, view]);
  const home = useMemo(
    () => fitPoints(map, view, focusGroups.length ? focusGroups : groups),
    [map, view, focusGroups, groups],
  );
  // The view follows the fitted box until the user moves it; a new map, focus or fit
  // request fits again. Live polls never reset a view the user chose.
  const key = `${map.id}|${focus ?? ''}|${fitKey}`;
  const [moved, setMoved] = useState<{ key: string; box: Box } | null>(null);
  const [following, setFollowing] = useState<string | null>(null);
  const position = useMapPosition(observedPosition, drawArt && following === key, now);
  const [size, setSize] = useState({ width: 640, height: 400 });
  /** Map art is never drawn closer than it stays sharp; a vector chart can zoom freely. */
  const sharp = (b: Box) => (view.art ? limitZoom(b, size, MAX_ART_UPSCALE) : b);
  /** The fitted view; on map art it keeps the land around a camp crisp. */
  const fitted = view.art ? limitZoom(home, size, FIT_ART_UPSCALE) : home;
  const chosenBox = moved && moved.key === key ? sharp(moved.box) : fitted;
  const follow = following === key && position ? view.project(position.x, position.y) : null;
  const box = follow
    ? { ...chosenBox, x: follow[0] - chosenBox.width / 2, y: follow[1] - chosenBox.height / 2 }
    : chosenBox;
  const setBox = (next: Box | ((current: Box) => Box)) =>
    setMoved({ key, box: keepOnMap(sharp(typeof next === 'function' ? next(box) : next), whole) });
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const pan = useRef<{ id: number; x: number; y: number; box: Box; moved: boolean } | null>(null);
  /** Swallows the click that ends a pan. */
  const suppress = useRef(false);
  const wheel = useRef<(event: globalThis.WheelEvent) => void>(() => undefined);
  const hover = useHoverCard();
  /** The mark that holds the map's one tab stop. */
  const [tabStop, setTabStop] = useState<string | null>(null);
  /** The mark showing a keyboard focus ring. */
  const [ringed, setRinged] = useState<string | null>(null);

  useEffect(() => {
    const element = frame;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry)
        setSize({
          width: Math.max(1, entry.contentRect.width),
          height: Math.max(1, entry.contentRect.height),
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [frame]);

  /** Drawing units per screen pixel, so markers keep their on-screen size at any zoom. */
  const unit = Math.max(box.width / size.width, box.height / size.height);
  const zoom = whole.width / box.width;
  /** Closest zoom reached: the art's sharpness limit, or the chart's. */
  const closest = view.art ? unit * MAX_ART_UPSCALE <= 1.001 : zoom >= MAX_CHART_ZOOM * 0.999;
  /** What the frame shows, in drawing units. */
  const area = visibleArea(box, size);
  // Markers around the view, grouped finer as it zooms in (the cell steps in powers of two).
  const cell = markerCell(view, unit);
  const { x: ax, y: ay, width: aw, height: ah } = area;
  const { markers, truncated } = useMemo(() => {
    const m = Math.max(aw, ah) * MARKER_MARGIN;
    const around = { x: ax - m, y: ay - m, width: aw + 2 * m, height: ah + 2 * m };
    return spawnMarkers(index, map.id, pets, view, cell, around);
  }, [index, map.id, pets, view, cell, ax, ay, aw, ah]);

  const zoomAt = (factor: number, cx = box.x + box.width / 2, cy = box.y + box.height / 2) => {
    const wanted = Math.max(MIN_ZOOM, zoom * factor);
    const next = view.art ? wanted : Math.min(MAX_CHART_ZOOM, wanted);
    // Stop at the art's sharpness limit, still about the pointer.
    const k = Math.max(zoom / next, view.art ? 1 / (unit * MAX_ART_UPSCALE) : 0);
    setBox({
      x: cx - (cx - box.x) * k,
      y: cy - (cy - box.y) * k,
      width: box.width * k,
      height: box.height * k,
    });
  };
  const toDrawing = (clientX: number, clientY: number) => {
    const element = svg.current;
    const rect = element?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    // preserveAspectRatio="xMidYMid meet": one scale, centred.
    const s = Math.max(box.width / rect.width, box.height / rect.height);
    return {
      x: box.x + box.width / 2 + (clientX - rect.left - rect.width / 2) * s,
      y: box.y + box.height / 2 + (clientY - rect.top - rect.height / 2) * s,
      s,
    };
  };
  const onWheel = (event: globalThis.WheelEvent) => {
    const at = toDrawing(event.clientX, event.clientY);
    if (!at) return;
    event.preventDefault();
    // In proportion to the wheel distance, so a notch and a touchpad glide both feel right.
    const distance = event.deltaY * (WHEEL_UNITS[event.deltaMode] ?? 1);
    zoomAt(Math.min(2, Math.max(0.5, 2 ** (-distance / WHEEL_DOUBLING))), at.x, at.y);
  };
  useEffect(() => {
    wheel.current = onWheel;
  });
  // Not passive, so zooming the map never scrolls the page.
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const listener = (event: globalThis.WheelEvent) => wheel.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, []);
  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    if (following === key) {
      setMoved({ key, box });
      setFollowing(null);
    }
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY, box, moved: false };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = pan.current;
    if (!start || start.id !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < 4) return;
    if (!start.moved) {
      start.moved = true;
      svg.current?.setPointerCapture?.(event.pointerId);
      // A card never rides along a drag.
      hover.hide({ immediate: true });
    }
    const at = toDrawing(event.clientX, event.clientY);
    const s = at?.s ?? unit;
    setBox({ ...start.box, x: start.box.x - dx * s, y: start.box.y - dy * s });
  };
  const endPan = (event: PointerEvent<SVGSVGElement>) => {
    if (pan.current?.id === event.pointerId) {
      if (pan.current.moved) svg.current?.releasePointerCapture?.(event.pointerId);
      // Keep `moved` for the click that follows, then forget the pan.
      const moved = pan.current.moved;
      pan.current = null;
      if (moved) suppress.current = true;
    }
  };
  const select = (pet: number, toggles = false) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (toggles && pet === selected && onClear) onClear();
    else onSelect(pet);
  };
  /** A spawn mark is a toggle: the selected pet's own mark lets the selection go. */
  const toggle = (pet: number) => select(pet, true);

  // Focused markers on top, then the goal, then pins.
  const weight = (m: Marker) =>
    m.pet === selected ? 3 : m.pet === goal ? 2 : pinned.has(m.pet) ? 1 : 0;
  const drawn = [...markers].sort((a, b) => weight(a) - weight(b));
  const r = 4.2 * unit;
  /** The ring around a selected, goal or pinned pet's dot: a coloured line in a dark casing. */
  const role = (pet: number): MarkRole | null =>
    pet === selected ? 'selected' : pet === goal ? 'goal' : pinned.has(pet) ? 'pinned' : null;
  const dotR = (pet: number) => (pet === selected || pet === goal ? r * 1.15 : r);
  const ringR = (pet: number) => dotR(pet) + 3.2 * unit;
  const player = position ? view.project(position.x, position.y) : null;
  const live = sightings.flatMap((row) =>
    row.sighting.x === null || row.sighting.y === null
      ? []
      : [{ row, at: view.project(row.sighting.x, row.sighting.y) }],
  );

  // Every mark is one stop of a single tab stop: arrows move between the marks in view.
  const marks: Mark[] = [
    ...drawn.map((m) => ({
      key: `spawn:${m.key}`,
      x: m.x,
      y: m.y,
      ring: (role(m.pet) ? ringR(m.pet) : r) + 3 * unit,
    })),
    ...live.map(({ row, at }) => ({
      key: `live:${row.sighting.entity_id}`,
      x: at[0],
      y: at[1],
      ring: r * 1.4 + 3 * unit,
    })),
    ...(player ? [{ key: 'you', x: player[0], y: player[1], ring: r * 2.4 + 3 * unit }] : []),
  ];
  const inView = (m: Mark) =>
    m.x >= box.x && m.x <= box.x + box.width && m.y >= box.y && m.y <= box.y + box.height;
  const visible = marks.filter(inView);
  const stop =
    (tabStop !== null && marks.some((m) => m.key === tabStop) ? tabStop : null) ??
    (focus !== null
      ? visible.find((m) => drawn.some((d) => `spawn:${d.key}` === m.key && d.pet === focus))?.key
      : undefined) ??
    visible[0]?.key ??
    marks[0]?.key;
  const focusRing = marks.find((m) => m.key === ringed) ?? null;

  /** Props of a mark: one tab stop, its hover card, and a ring while keyboard-focused. */
  const markProps = (key: string) => {
    const card = hover.trigger(key);
    return {
      ...card,
      'data-mark-key': key,
      tabIndex: key === stop ? 0 : -1,
      className: 'outline-none',
      onFocus: (event: FocusEvent<Element>) => {
        card.onFocus(event);
        setTabStop(key);
        setRinged(focusVisible(event.currentTarget) ? key : null);
      },
      onBlur: () => {
        card.onBlur();
        setRinged(null);
      },
    };
  };
  const activate = (key: string) => {
    if (key.startsWith('spawn:')) {
      const marker = drawn.find((m) => `spawn:${m.key}` === key);
      if (marker) toggle(marker.pet);
    } else if (key.startsWith('live:')) {
      const pet = live.find(({ row }) => `live:${row.sighting.entity_id}` === key)?.row.pets[0];
      if (pet) select(pet.pet.id);
    }
  };
  const onMarkKey = (event: KeyboardEvent<SVGGElement>) => {
    const key = (event.target as Element).getAttribute('data-mark-key');
    const from = marks.find((m) => m.key === key);
    if (!key || !from) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate(key);
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const next = nextMark(visible.includes(from) ? visible : marks, from, arrow[0], arrow[1]);
    if (!next) return;
    [...(svg.current?.querySelectorAll<SVGElement>('[data-mark-key]') ?? [])]
      .find((el) => el.getAttribute('data-mark-key') === next.key)
      ?.focus();
  };

  const shownKey = hover.shown?.key ?? null;
  const shownSpawn = shownKey?.startsWith('spawn:')
    ? drawn.find((m) => `spawn:${m.key}` === shownKey)
    : undefined;
  const shownLive = shownKey?.startsWith('live:')
    ? live.find(({ row }) => `live:${row.sighting.entity_id}` === shownKey)?.row
    : undefined;
  const card = shownSpawn ? (
    <SpawnCard
      id={shownSpawn.pet}
      pet={index.pets.get(shownSpawn.pet)}
      state={stateOf(states, shownSpawn.pet)}
      monsters={shownSpawn.npcs.map((id) => npcName(index, id))}
      points={shownSpawn.count}
      goal={shownSpawn.pet === goal}
      pinned={pinned.has(shownSpawn.pet)}
      selected={shownSpawn.pet === selected}
      clearable={!!onClear}
      active={shownSpawn.pet === activeId}
    />
  ) : shownLive ? (
    <SightingCard row={shownLive} now={now} />
  ) : shownKey === 'you' && observedPosition ? (
    <PositionCard position={observedPosition} now={now} />
  ) : null;
  const families = useMemo(() => {
    const present = new Set<PetFamily>();
    for (const m of groups) {
      const family = index.pets.get(m.pet)?.family;
      if (family) present.add(family);
    }
    return PET_FAMILIES.filter((f) => present.has(f));
  }, [index, groups]);

  const label = index.labels.get(map.id)?.label ?? map.name;
  const approximate = map.art?.approximate ?? false;
  /* A chart's graticule: tenths of the map, and fiftieths once zoomed in close. */
  const grid = useMemo(() => {
    if (view.art) return null;
    const lines: { key: string; x1: number; y1: number; x2: number; y2: number; minor: boolean }[] =
      [];
    for (let i = 1; i < 50; i++) {
      const x = (view.width * i) / 50;
      const y = (view.height * i) / 50;
      const minor = i % 5 !== 0;
      lines.push({ key: `v${i}`, x1: x, y1: 0, x2: x, y2: view.height, minor });
      lines.push({ key: `h${i}`, x1: 0, y1: y, x2: view.width, y2: y, minor });
    }
    return lines;
  }, [view]);
  const minorGrid = zoom >= 3;

  return (
    <figure className="m-0 flex min-h-0 flex-1 flex-col">
      <div
        ref={setFrame}
        className={cn(
          'relative min-h-60 flex-1 overflow-hidden rounded-lg border border-line inset-shadow-well',
          // Around a sheet, the plain tone of its margin, so the paper runs on without a seam.
          view.art && art.ready ? 'bg-paper' : 'bg-parchment',
        )}
        data-ground={view.art && art.ready ? 'sheet' : 'chart'}
      >
        <svg
          ref={svg}
          className="pet-map-svg block size-full cursor-grab touch-none select-none active:cursor-grabbing"
          viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
          preserveAspectRatio="xMidYMid meet"
          data-fit={key}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPan}
          onPointerCancel={endPan}
        >
          <title>
            {view.art
              ? t(($) => $.spawnMap.titleArt, { map: label, count: total })
              : t(($) => $.spawnMap.titleChart, { map: label, count: total })}
          </title>
          {map.art ? (
            drawArt &&
            (art.ready ? (
              <MapArt art={map.art} delivery={art} whole={whole} area={area} unit={unit} />
            ) : (
              <MapGraticule whole={whole} unit={unit} fine={minorGrid} />
            ))
          ) : (
            // A chart on parchment: a faint graticule inside a neatline with an outer hairline.
            <g className="pointer-events-none fill-none" data-chart="graticule">
              {grid?.map(
                (l) =>
                  (!l.minor || minorGrid) && (
                    <line
                      key={l.key}
                      className={l.minor ? 'stroke-paper-line/50' : 'stroke-paper-line'}
                      x1={l.x1}
                      y1={l.y1}
                      x2={l.x2}
                      y2={l.y2}
                      strokeWidth={unit}
                    />
                  ),
              )}
              <rect
                className="stroke-paper-ink/45"
                x={0}
                y={0}
                width={view.width}
                height={view.height}
                strokeWidth={1.6 * unit}
              />
              <rect
                className="stroke-paper-ink/25"
                x={-4 * unit}
                y={-4 * unit}
                width={view.width + 8 * unit}
                height={view.height + 8 * unit}
                strokeWidth={unit}
              />
            </g>
          )}
          <g
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no fieldset element
            role="group"
            aria-label={t(($) => $.spawnMap.marks)}
            onKeyDown={onMarkKey}
          >
            {drawn.map((m) => {
              const pet = index.pets.get(m.pet);
              const isSelected = m.pet === selected;
              const ring = role(m.pet);
              // Others step back only when the focused pet has marks here to stand out.
              const dim = focusGroups.length > 0 && m.pet !== focus && m.pet !== goal;
              const name = pet?.name ?? t(($) => $.petFallback, { id: m.pet });
              return (
                <g key={m.key} className={cn(dim && 'opacity-55')}>
                  {/* Selected, goal and pinned: a dot inside a ring, cased in dark so the ring
                      reads on pale paper and dark land alike. */}
                  {ring && (
                    <g className="pointer-events-none fill-none" data-ring={ring}>
                      <circle
                        className="stroke-ink-inverse/80"
                        cx={m.x}
                        cy={m.y}
                        r={ringR(m.pet)}
                        strokeWidth={(ring === 'pinned' ? 3.2 : 4.2) * unit}
                      />
                      <circle
                        className={RING_STROKE[ring]}
                        cx={m.x}
                        cy={m.y}
                        r={ringR(m.pet)}
                        strokeWidth={(ring === 'pinned' ? 1.5 : 2.2) * unit}
                      />
                    </g>
                  )}
                  <circle
                    {...markProps(`spawn:${m.key}`)}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG mark cannot be an HTML button
                    role="button"
                    aria-label={
                      pet
                        ? t(($) => $.spawnMap.markFamily, {
                            name,
                            family: FAMILY_LABEL[pet.family],
                            count: m.count,
                          })
                        : t(($) => $.spawnMap.mark, { name, count: m.count })
                    }
                    aria-pressed={isSelected}
                    className={cn(
                      'cursor-pointer outline-none [vector-effect:non-scaling-stroke]',
                      'stroke-ink-inverse [fill-opacity:0.92] [stroke-width:1.3px]',
                      'transition-[fill-opacity,stroke-width] duration-150',
                      'hover:[fill-opacity:1] hover:[stroke-width:2px]',
                      pet ? FAMILY_FILL[pet.family] : 'fill-family-unknown',
                      ring && '[fill-opacity:1]',
                    )}
                    cx={m.x}
                    cy={m.y}
                    r={dotR(m.pet)}
                    onClick={() => toggle(m.pet)}
                  />
                </g>
              );
            })}
            {live.length > 0 && (
              <g>
                {live.map(({ row, at }) => (
                  <g
                    key={row.sighting.entity_id}
                    {...markProps(`live:${row.sighting.entity_id}`)}
                    // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG mark cannot be an HTML button
                    role="button"
                    aria-label={t(($) => $.spawnMap.liveMark, { name: row.sighting.name })}
                    className="cursor-pointer outline-none"
                    transform={`translate(${at[0]} ${at[1]})`}
                    onClick={() => {
                      const first = row.pets[0];
                      if (first) select(first.pet.id);
                    }}
                  >
                    {/* Something alive right now: a ripple spreads from it. */}
                    <circle
                      className="pointer-events-none origin-center animate-ripple fill-none stroke-marker-live [transform-box:fill-box]"
                      r={r * 1.5}
                      strokeWidth={2 * unit}
                    />
                    <rect
                      className="fill-marker-live stroke-ink-inverse"
                      x={-r}
                      y={-r}
                      width={r * 2}
                      height={r * 2}
                      rx={0.3 * unit}
                      transform="rotate(45)"
                      strokeWidth={1.4 * unit}
                    />
                  </g>
                ))}
              </g>
            )}
            {position && observedPosition && (
              <MapPlayer
                position={observedPosition}
                display={following === key ? position : null}
                animate={drawArt && following !== key}
                now={now}
                project={view.project}
                unit={unit}
                mark={markProps('you')}
                label={t(($) => $.spawnMap.you)}
              />
            )}
          </g>
          {/* The keyboard focus ring of a mark, in place of an outline, on a dark rim so it
              reads on paper and painted land alike. */}
          {focusRing && (
            <g className="pointer-events-none fill-none" data-mark="focus-ring">
              <circle
                className="stroke-ink-inverse/70"
                cx={focusRing.x}
                cy={focusRing.y}
                r={focusRing.ring}
                strokeWidth={4 * unit}
              />
              <circle
                className="stroke-focus"
                cx={focusRing.x}
                cy={focusRing.y}
                r={focusRing.ring}
                strokeWidth={2 * unit}
              />
            </g>
          )}
        </svg>
        {drawArt && <MapArtNotice delivery={art} />}
        {!view.art && (
          // A chart is named like a map: a small cartouche with a double rule.
          <div
            className="pointer-events-none absolute top-3 left-3 max-w-[calc(100%-4.5rem)] rounded-sm border border-paper-ink/30 bg-paper/90 px-3 py-1.5 text-paper-ink shadow-1 outline-1 outline-offset-2 outline-paper-ink/20"
            data-chart="cartouche"
          >
            <p className="m-0 truncate text-xs font-semibold tracking-caps text-paper-ink uppercase">
              {label}
            </p>
            <p className="m-0 text-2xs text-paper-ink/80">{t(($) => $.spawnMap.noArt)}</p>
          </div>
        )}
        <div className="absolute top-2 right-2 flex flex-col gap-1">
          <Button
            iconOnly
            size="md"
            className="bg-veil backdrop-blur-sm"
            aria-label={t(($) => $.spawnMap.zoomIn)}
            title={closest ? t(($) => $.spawnMap.closest) : t(($) => $.spawnMap.zoomIn)}
            disabled={closest}
            onClick={() => zoomAt(ZOOM_STEP)}
          >
            <Icon name="zoomIn" size={14} />
          </Button>
          <Button
            iconOnly
            size="md"
            className="bg-veil backdrop-blur-sm"
            aria-label={t(($) => $.spawnMap.zoomOut)}
            title={t(($) => $.spawnMap.zoomOut)}
            onClick={() => zoomAt(1 / ZOOM_STEP)}
          >
            <Icon name="zoomOut" size={14} />
          </Button>
          <Button
            iconOnly
            size="md"
            className="bg-veil backdrop-blur-sm"
            aria-label={t(($) => $.spawnMap.fit)}
            title={
              focusGroups.length ? t(($) => $.spawnMap.fitFocused) : t(($) => $.spawnMap.fitShown)
            }
            disabled={!groups.length}
            onClick={() => {
              setFollowing(null);
              setBox(fitted);
            }}
          >
            <Icon name="crosshair" size={14} />
          </Button>
          <Button
            iconOnly
            size="md"
            className="bg-veil backdrop-blur-sm"
            aria-label={t(($) => $.spawnMap.whole)}
            title={t(($) => $.spawnMap.wholeTitle)}
            onClick={() => {
              setFollowing(null);
              setBox(whole);
            }}
          >
            <Icon name="fit" size={14} />
          </Button>
          {player && (
            <Button
              iconOnly
              size="md"
              className="bg-veil backdrop-blur-sm"
              aria-label={t(($) => $.spawnMap.centre)}
              title={t(($) => $.spawnMap.centre)}
              aria-pressed={following === key}
              onClick={() => {
                setFollowing(following === key ? null : key);
                setBox((b) => {
                  const span = Math.abs(view.project(30_000, 0)[0] - view.project(0, 0)[0]);
                  const width = following === key ? b.width : Math.min(b.width, span);
                  const height = (b.height * width) / b.width;
                  return { x: player[0] - width / 2, y: player[1] - height / 2, width, height };
                });
              }}
            >
              <Icon name="locate" size={14} />
            </Button>
          )}
        </div>
        <div className="pointer-events-none absolute bottom-2 left-2 flex flex-wrap items-center gap-1.5 text-2xs text-ink-2">
          <span
            className="flex gap-2.5 rounded-full bg-veil px-2 py-0.5 backdrop-blur-sm"
            aria-hidden="true"
          >
            <span className="inline-flex items-center gap-0.5">
              {MINUS}Y <Icon name="arrowUp" size={10} />
            </span>
            <span className="inline-flex items-center gap-0.5">
              +X <Icon name="chevronRight" size={10} />
            </span>
          </span>
          {approximate && (
            <span
              className="inline-flex items-center gap-1 rounded-full bg-veil px-2 py-0.5 backdrop-blur-sm"
              data-art="approximate"
            >
              <Icon name="info" size={10} />
              {t(($) => $.spawnMap.approximate)}
            </span>
          )}
        </div>
      </div>
      <figcaption className="mt-2.5 flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5 text-xs text-ink-3">
        <ul
          className="m-0 flex list-none flex-wrap gap-x-3.5 gap-y-1 p-0 text-xs text-ink-2"
          aria-label={t(($) => $.spawnMap.legend.label)}
        >
          {families.map((family) => (
            <li key={family} className="inline-flex items-center gap-1.5">
              <i
                className={cn(
                  'size-2.5 shrink-0 rounded-full ring-1 ring-ink-inverse',
                  FAMILY_BG[family],
                )}
                aria-hidden="true"
              />
              <FamilyLabel family={family} />
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <LegendGlyph kind="selected" /> {t(($) => $.spawnMap.legend.selected)}
          </li>
          {goal !== null && (
            <li className="inline-flex items-center gap-1.5">
              <LegendGlyph kind="goal" /> {t(($) => $.nearby.goal)}
            </li>
          )}
          {groups.some((m) => role(m.pet) === 'pinned') && (
            <li className="inline-flex items-center gap-1.5">
              <LegendGlyph kind="pinned" /> {t(($) => $.mapKey.pinned)}
            </li>
          )}
          <li className="inline-flex items-center gap-1.5">
            <LegendGlyph kind="live" /> {t(($) => $.cards.liveSighting)}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <LegendGlyph kind="you" /> {t(($) => $.spawnMap.legend.you)}
          </li>
        </ul>
        <span className="pet-map-count whitespace-nowrap">
          {view.art
            ? approximate
              ? t(($) => $.spawnMap.source.approximate)
              : t(($) => $.spawnMap.source.official)
            : t(($) => $.spawnMap.source.chart)}{' '}
          · {t(($) => $.spawnMap.staticPoints, { count: total })}
          {truncated && ` · ${t(($) => $.spawnMap.truncated, { count: MAX_MARKERS })}`}
          {live.length > 0 && ` · ${t(($) => $.localMap.live, { count: live.length })}`}
        </span>
      </figcaption>
      <HoverCard
        id={hover.id}
        anchor={card ? (hover.shown?.anchor ?? null) : null}
        boundary={frame}
      >
        {card}
      </HoverCard>
    </figure>
  );
}

type MarkRole = 'selected' | 'goal' | 'pinned';

/** Animate the player alone while browsing, without rebuilding thousands of spawn nodes. */
function MapPlayer({
  position,
  display,
  animate,
  now,
  project,
  unit,
  mark,
  label,
}: {
  position: PetPosition;
  display: MapPosition | null;
  animate: boolean;
  now: number;
  project: (x: number, y: number) => [number, number];
  unit: number;
  mark: SVGProps<SVGGElement>;
  label: string;
}) {
  const { t } = useTranslation('pets');
  const animated = useMapPosition(position, animate, now);
  const shown = display ?? animated ?? { ...position, estimated: false, uncertainty_m: 0 };
  const [x, y] = project(shown.x, shown.y);
  const r = 4.2 * unit;
  const estimateRadius = Math.abs(project(shown.x + shown.uncertainty_m * 100, shown.y)[0] - x);
  return (
    <g
      {...mark}
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG mark cannot be an HTML image
      role="img"
      aria-label={shown.estimated ? t(($) => $.localMap.estimated) : label}
      data-estimated={shown.estimated || undefined}
      className="pet-map-player outline-none"
      transform={`translate(${x} ${y})`}
    >
      {shown.estimated && (
        <>
          <title>{t(($) => $.localMap.estimatedTitle)}</title>
          <circle
            className="fill-none stroke-ink-inverse/70"
            r={Math.max(r * 3, estimateRadius)}
            strokeWidth={unit}
            strokeDasharray={`${unit * 3} ${unit * 2}`}
          />
        </>
      )}
      <circle
        className="pointer-events-none origin-center animate-ripple fill-none stroke-ink-inverse/70 [transform-box:fill-box]"
        r={r * 2.4}
        strokeWidth={1.8 * unit}
      />
      <circle
        r={r * 2.4}
        className="fill-ink-inverse/10 stroke-ink-inverse/60"
        strokeWidth={1.2 * unit}
      />
      <circle r={r * 1.15} className="fill-ink-inverse stroke-ink" strokeWidth={1.6 * unit} />
    </g>
  );
}

const RING_STROKE: Record<MarkRole, string> = {
  selected: 'stroke-marker-selected',
  goal: 'stroke-marker-goal',
  pinned: 'stroke-marker-pinned',
};

/** The legend's small copy of a map mark, drawn like the mark itself. */
function LegendGlyph({ kind }: { kind: MarkRole | 'live' | 'you' }) {
  return (
    <svg viewBox="-6 -6 12 12" className="size-3 shrink-0 overflow-visible" aria-hidden="true">
      {(kind === 'selected' || kind === 'goal' || kind === 'pinned') && (
        <>
          <circle
            className={cn('fill-none', RING_STROKE[kind])}
            r={4.6}
            strokeWidth={kind === 'pinned' ? 1.3 : 1.7}
          />
          <circle className="fill-family-unknown stroke-ink-inverse" r={2.4} strokeWidth={0.8} />
        </>
      )}
      {kind === 'live' && (
        <rect
          className="fill-marker-live stroke-ink-inverse"
          x={-3.2}
          y={-3.2}
          width={6.4}
          height={6.4}
          strokeWidth={0.8}
          transform="rotate(45)"
        />
      )}
      {kind === 'you' && (
        <>
          <circle className="fill-none stroke-ink-3" r={5} strokeWidth={0.9} />
          <circle className="fill-ink-inverse stroke-ink" r={2.6} strokeWidth={1.1} />
        </>
      )}
    </svg>
  );
}
