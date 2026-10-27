import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Button } from '../../components/ui/Button';
import { cubeArtSrc } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { MapArt, MapGraticule } from '../pets/MapArt';
import { nextMark, projection, visibleArea, wholeBox, type Box } from '../pets/model';
import type { AtlasMap } from './atlas';
import { useMapArtDelivery } from './mapArt';
import { MapArtNotice } from './MapArtNotice';
import {
  atClosest,
  atFarthest,
  centreOn,
  FOLLOW,
  followBox,
  panBox,
  unitOf,
  zoomBox,
  type Camera,
  type Frame,
} from './camera';
import { CLUSTER_PX, clusterCell, clusterPlaces, type Place, type SpotCluster } from './spots';

/** What a mark stands for. Each kind has its own glyph; a new kind adds its glyph here. */
export type MarkKind = 'cube';

/**
 * What a layer of fixed places stands for. A kind's places share one casing; a layer whose
 * places differ (gathering resources) names each place's own glyph.
 */
export type SpotKind = 'cube' | 'gathering';

/**
 * The picture on a place or a group tag: verified original artwork (`src`), else the short
 * written label of what is there. Never a substitute picture.
 */
export type SpotGlyph = { src: string } | { text: string };

/** `live`: may still be there; `busy`: something is happening to it; `past`: seen earlier. */
export type MarkTone = 'live' | 'busy' | 'past';

/** One point on a world map, in game coordinates (centimetres). */
export interface MapMark {
  key: string;
  kind: MarkKind;
  x: number;
  y: number;
  tone: MarkTone;
  /** Accessible name and tooltip. */
  label: string;
  /** Arrived a moment ago: a ripple spreads from it. */
  isNew?: boolean;
}

/**
 * You on a map, in game coordinates, as drawn: never a measurement. A fresh position may be a
 * short estimate between native's fixes; a last known one is a hollow mark that never moves.
 */
export interface MapPlayer {
  x: number;
  y: number;
  /** Last known, too old for distances: hollow and dashed, never predicted. */
  last?: boolean;
  /** Drawn ahead of or easing towards the measured fix, about `uncertainty_m` from it. */
  estimated?: boolean;
  uncertainty_m?: number;
  /** Fresh facing in coordinate degrees (0 = +X, 90 = +Y); null or absent draws no arrow. */
  facing?: number | null;
}

/**
 * Fixed places where a kind of thing may be found (see `spots.ts`): drawn under the marks,
 * grouped with their counts as the view zooms out, never animated. A place is chosen like a
 * mark, by its `spotKey`; a group zooms in on its places.
 */
export interface SpotLayer {
  /** Stable id within the map; part of every place's key. */
  id: string;
  kind: SpotKind;
  places: readonly Place[];
  /** Accessible name and tooltip of one place. */
  label: (place: Place, index: number) => string;
  /**
   * Accessible name and tooltip of a group standing for `count` points, of the places at
   * `members` (indices into `places`).
   */
  groupLabel: (count: number, members: readonly number[]) => string;
  /**
   * This layer's share of a group shared with other layers, standing for `count` points of
   * the places at `members` ("12 possible cube locations"), without the call to zoom in.
   * Omitted, `groupLabel` is used.
   */
  partLabel?: (count: number, members: readonly number[]) => string;
  /** Glyph of one place; omitted, every place wears its kind's own (the original cube). */
  glyph?: (index: number) => SpotGlyph;
  /**
   * Glyphs on a group's tag, most common first; at most `GROUP_GLYPHS` are drawn. Omitted,
   * a tag wears its kind's own.
   */
  groupGlyphs?: (members: readonly number[]) => readonly SpotGlyph[];
  /**
   * Least screen pixels a grouping cell spans (default `CLUSTER_PX`). A tag spans about two
   * cells, so a layer whose tags carry several glyphs groups more widely and its tags
   * never overlap. Layers drawn together group by the widest of theirs.
   */
  clusterPx?: number;
}

/** Glyphs a group tag shows at most, overlapped. */
export const GROUP_GLYPHS = 2;

/** One layer's places within a group: which places they are and the points they stand for. */
interface SpotPart {
  layer: SpotLayer;
  /** Indices into the layer's own places. */
  members: number[];
  count: number;
}

/**
 * The glyphs a group tag shows, at most `GROUP_GLYPHS`: the most common of each layer
 * there first, so a group shared by several kinds always shows each of them (while slots
 * last), then the next most common in layer order. Only tags in view are read.
 */
function tagGlyphs(parts: readonly SpotPart[]): readonly SpotGlyph[] {
  const lists = parts.map((p) =>
    p.layer.groupGlyphs ? p.layer.groupGlyphs(p.members) : [KIND_GLYPH[p.layer.kind]],
  );
  const shown: SpotGlyph[] = [];
  for (let rank = 0; shown.length < GROUP_GLYPHS; rank++) {
    let any = false;
    for (const list of lists) {
      const glyph = list[rank];
      if (!glyph) continue;
      any = true;
      if (shown.length < GROUP_GLYPHS) shown.push(glyph);
    }
    if (!any) break;
  }
  return shown;
}

/** Key of a layer's place, as `selected` and `onSelect` use it. */
export const spotKey = (layer: string, index: number) => `spot:${layer}:${index}`;

/** The layer and place index of a `spotKey`; null for any other key. */
export function parseSpotKey(key: string | null): { layer: string; index: number } | null {
  if (!key?.startsWith('spot:')) return null;
  const cut = key.lastIndexOf(':');
  const index = Number(key.slice(cut + 1));
  return cut > 5 && Number.isInteger(index) && index >= 0
    ? { layer: key.slice(5, cut), index }
    : null;
}

const NO_SPOTS: readonly SpotLayer[] = [];

/** Frame assumed before the first measurement (and in tests). */
const FALLBACK: Frame = { width: 640, height: 400 };
const ZOOM_STEP = 2;
/** Wheel distance, in pixels, that zooms by a factor of two; a mouse notch is about 100. */
const WHEEL_DOUBLING = 300;
const WHEEL_UNITS = [1, 16, 400];
/** Least frame height, in CSS pixels, that holds `count` controls stacked with their gaps. */
const stackHeight = (size: 'sm' | 'md', count: number) =>
  count * (size === 'sm' ? 28 : 32) + (count - 1) * 4 + (size === 'sm' ? 8 : 16);
/** Your facing arrow, in the units of the Pets radar's (its tip 18 from your centre). */
const FACING_PATH = 'M 18 0 L 6 -7 L 8 0 L 6 7 Z';
/** Pointer travel, in CSS pixels, that turns a press into a pan. */
const PAN_THRESHOLD = 4;

const ARROWS: Record<string, [number, number]> = {
  ArrowRight: [1, 0],
  ArrowLeft: [-1, 0],
  ArrowDown: [0, 1],
  ArrowUp: [0, -1],
};

/** Whether focus came from the keyboard; engines without the selector say no. */
const focusVisible = (element: Element) => {
  try {
    return element.matches(':focus-visible');
  } catch {
    return false;
  }
};

function useFrameSize(element: HTMLElement | null) {
  const [size, setSize] = useState(FALLBACK);
  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0)
        setSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return size;
}

/**
 * A world map on its original, calibrated art, north (−Y) up and never rotated, with
 * spots, marks and your position over it. It follows you (else the current marks, else the
 * spots, else the whole map) until you pan or zoom about a point; Follow brings it back.
 * Spots never pull a view that follows you. Marks and spots are one tab stop, a current
 * mark first: arrows move between them, Enter selects (or opens a group), Escape lets the
 * selection go.
 *
 * `interactive` false (a locked overlay) disables pointer pan and wheel zoom; the controls
 * still work and, with `hit`, are marked as native hit regions. A press on the map never
 * reaches the window around it, so panning never moves an unlocked overlay.
 *
 * `follow` keeps the view on you at all times (an in-game minimap): it never pans, the wheel
 * and a selection never move it, and only the zoom controls are offered: they (and opening a
 * group of places) zoom about you.
 */
export function WorldMap({
  map,
  marks,
  spots = NO_SPOTS,
  player,
  selected = null,
  onSelect,
  title,
  interactive = true,
  follow = false,
  hit = false,
  compact = false,
  drawArt = true,
  className,
  children,
}: {
  map: AtlasMap;
  marks: readonly MapMark[];
  /** Fixed places drawn under the marks; keep the array stable between renders. */
  spots?: readonly SpotLayer[];
  /** You on this map (see `MapPlayer`); null draws none. */
  player: MapPlayer | null;
  selected?: string | null;
  onSelect?: (key: string | null) => void;
  /** Accessible title of the drawing. */
  title: string;
  interactive?: boolean;
  /** The view always follows you; nothing pans it (see above). */
  follow?: boolean;
  hit?: boolean;
  /** Smaller controls and marks, for an in-game window. */
  compact?: boolean;
  /** False while off screen: the art is released and drawn again when shown. */
  drawArt?: boolean;
  className?: string | undefined;
  /** Overlays inside the frame (chips, a details card), positioned by the caller. */
  children?: ReactNode;
}) {
  const { t } = useTranslation('common');
  const fmt = useFormat();
  const view = useMemo(() => projection(map), [map]);
  const whole = useMemo(() => wholeBox(map, view), [map, view]);
  // Downloaded on first showing; until then the art's own canvas is drawn as a chart.
  const art = useMapArtDelivery(map.art, drawArt);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const size = useFrameSize(frame);
  const [state, setState] = useState<{ map: string; camera: Camera }>({
    map: map.id,
    camera: FOLLOW,
  });
  const camera =
    state.map === map.id && (!follow || state.camera.mode === 'follow') ? state.camera : FOLLOW;
  const setCamera = (next: Camera) => setState({ map: map.id, camera: next });

  // Current marks frame a followed view; earlier ones never pull it away from you. Spots
  // frame it only with nothing else to show: never around you, never with current marks.
  const current = useMemo(() => marks.filter((m) => m.tone !== 'past'), [marks]);
  const spotCorners = useMemo(() => {
    let [left, top, right, bottom] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const layer of spots)
      for (const p of layer.places) {
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x);
        bottom = Math.max(bottom, p.y);
      }
    return left <= right
      ? [
          { x: left, y: top },
          { x: right, y: bottom },
        ]
      : [];
  }, [spots]);
  const framed = current.length || player ? current : spotCorners;
  const box =
    camera.mode === 'free'
      ? camera.box
      : followBox({
          map,
          view,
          whole,
          frame: size,
          player,
          points: framed,
          zoom: camera.zoom,
        });
  const unit = unitOf(box, size);
  const area = visibleArea(box, size);
  const closest = atClosest(box, size);
  const farthest = atFarthest(box, whole);

  const svg = useRef<SVGSVGElement>(null);
  const pan = useRef<{
    id: number;
    x: number;
    y: number;
    box: Box;
    moved: boolean;
  } | null>(null);
  /** Swallows the click that ends a pan. */
  const suppress = useRef(false);
  const wheel = useRef<(event: globalThis.WheelEvent) => void>(() => undefined);
  const [tabStop, setTabStop] = useState<string | null>(null);
  const [ringed, setRinged] = useState<string | null>(null);

  const zoom = (factor: number, at?: { x: number; y: number }) => {
    if (camera.mode === 'follow' && (!at || follow))
      setCamera({ mode: 'follow', zoom: camera.zoom * factor });
    else setCamera({ mode: 'free', box: zoomBox(box, factor, whole, size, at) });
  };
  const toDrawing = (clientX: number, clientY: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    const s = unitOf(box, rect);
    return {
      x: box.x + box.width / 2 + (clientX - rect.left - rect.width / 2) * s,
      y: box.y + box.height / 2 + (clientY - rect.top - rect.height / 2) * s,
      s,
    };
  };
  useEffect(() => {
    wheel.current = (event) => {
      const at = toDrawing(event.clientX, event.clientY);
      if (!at) return;
      event.preventDefault();
      const distance = event.deltaY * (WHEEL_UNITS[event.deltaMode] ?? 1);
      zoom(Math.min(2, Math.max(0.5, 2 ** (-distance / WHEEL_DOUBLING))), at);
    };
  });
  // Not passive, so zooming the map never scrolls the page.
  useEffect(() => {
    const element = svg.current;
    if (!element || !interactive || follow) return;
    const listener = (event: globalThis.WheelEvent) => wheel.current(event);
    element.addEventListener('wheel', listener, { passive: false });
    return () => element.removeEventListener('wheel', listener);
  }, [interactive, follow]);

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    // The map's own gesture: never a window move.
    event.stopPropagation();
    suppress.current = false;
    if (event.button !== 0) return;
    pan.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      box,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    const start = pan.current;
    if (!start || start.id !== event.pointerId || follow) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < PAN_THRESHOLD) return;
    if (!start.moved) {
      start.moved = true;
      svg.current?.setPointerCapture?.(event.pointerId);
    }
    const s = toDrawing(event.clientX, event.clientY)?.s ?? unit;
    setCamera({
      mode: 'free',
      box: panBox(start.box, -dx * s, -dy * s, whole),
    });
  };
  const endPan = (event: PointerEvent<SVGSVGElement>) => {
    const start = pan.current;
    if (start?.id !== event.pointerId) return;
    if (start.moved) {
      svg.current?.releasePointerCapture?.(event.pointerId);
      suppress.current = true;
    }
    pan.current = null;
  };

  // Drawing-space marks around the view; the rest are culled.
  const near = (x: number, y: number) => {
    const m = Math.max(area.width, area.height) * 0.1;
    return (
      x >= area.x - m &&
      x <= area.x + area.width + m &&
      y >= area.y - m &&
      y <= area.y + area.height + m
    );
  };
  const drawn = marks.flatMap((mark) => {
    const [x, y] = view.project(mark.x, mark.y);
    return near(x, y) || mark.key === selected ? [{ mark, x, y }] : [];
  });

  // Spots: grouped in steps as the view zooms out (not at all at the closest view), the
  // selected place always on its own; only groups around the view are drawn.
  // Every layer is grouped together, so places of different kinds never pile up as tags
  // over one another: a group they share keeps each kind's places and points apart.
  const flat = useMemo(() => {
    const drawn: (readonly [number, number])[] = [];
    const places: Place[] = [];
    const owner: { layer: number; index: number }[] = [];
    const offsets: number[] = [];
    spots.forEach((layer, l) => {
      offsets.push(places.length);
      layer.places.forEach((p, index) => {
        drawn.push(view.project(p.x, p.y));
        places.push(p);
        owner.push({ layer: l, index });
      });
    });
    const clusterPx = Math.max(CLUSTER_PX, ...spots.map((l) => l.clusterPx ?? CLUSTER_PX));
    return { drawn, places, owner, offsets, clusterPx };
  }, [spots, view]);
  const cell = closest ? 0 : clusterCell(unit, flat.clusterPx);
  const chosenSpot = parseSpotKey(selected);
  const clusters = useMemo(() => {
    const keep = parseSpotKey(selected);
    const layer = keep ? spots.findIndex((l) => l.id === keep.layer) : -1;
    const kept =
      keep && layer >= 0 && keep.index < spots[layer]!.places.length
        ? flat.offsets[layer]! + keep.index
        : null;
    return clusterPlaces(flat.drawn, flat.places, cell, kept);
  }, [spots, flat, cell, selected]);
  const spotsDrawn: SpotEntry[] = clusters.flatMap((cluster): SpotEntry[] => {
    const parts: SpotPart[] = [];
    for (const m of cluster.members) {
      const { layer, index } = flat.owner[m]!;
      const into = parts.find((p) => p.layer === spots[layer]);
      const count = flat.places[m]!.count;
      if (into) {
        into.members.push(index);
        into.count += count;
      } else parts.push({ layer: spots[layer]!, members: [index], count });
    }
    // In layer order, so a shared tag reads the same wherever it is.
    parts.sort((a, b) => spots.indexOf(a.layer) - spots.indexOf(b.layer));
    const first = parts[0]!;
    const one = cluster.members.length === 1 ? first.members[0]! : null;
    const key =
      one === null
        ? `spots:${parts.map((p) => p.layer.id).join('+')}:${cluster.key}`
        : spotKey(first.layer.id, one);
    if (!near(cluster.x, cluster.y) && key !== selected) return [];
    const label =
      one !== null
        ? first.layer.label(first.layer.places[one]!, one)
        : parts.length === 1
          ? first.layer.groupLabel(cluster.count, first.members)
          : t(($) => $.map.mixedGroup, {
              list: parts
                .map((p) => (p.layer.partLabel ?? p.layer.groupLabel)(p.count, p.members))
                .join(' · '),
            });
    return [
      {
        key,
        x: cluster.x,
        y: cluster.y,
        layer: first.layer,
        parts,
        cluster,
        group: one === null,
        label,
      },
    ];
  });
  // Earlier marks under current ones, the selected one on top.
  const order = (tone: MarkTone, key: string) =>
    key === selected ? 3 : tone === 'past' ? 0 : tone === 'busy' ? 2 : 1;
  const sorted = [...drawn].sort(
    (a, b) => order(a.mark.tone, a.mark.key) - order(b.mark.tone, b.mark.key),
  );
  const me = player ? view.project(player.x, player.y) : null;
  // Through the projection, so the arrow and the ring hold whatever its axes.
  let facing: number | null = null;
  if (me && player && typeof player.facing === 'number' && Number.isFinite(player.facing)) {
    const rad = (player.facing * Math.PI) / 180;
    const [fx, fy] = view.project(player.x + Math.cos(rad) * 100, player.y + Math.sin(rad) * 100);
    facing = (Math.atan2(fy - me[1], fx - me[0]) * 180) / Math.PI;
  }
  const uncertainty =
    me && player?.estimated && !player.last
      ? Math.abs(view.project(player.x + (player.uncertainty_m ?? 0) * 100, player.y)[0] - me[0])
      : null;

  // A newly selected mark off screen is brought into view; one already in view stays put.
  const [lastSelected, setLastSelected] = useState(selected);
  if (lastSelected !== selected) {
    setLastSelected(selected);
    const found =
      marks.find((m) => m.key === selected) ??
      (chosenSpot && spots.find((l) => l.id === chosenSpot.layer)?.places[chosenSpot.index]);
    if (found) {
      const [x, y] = view.project(found.x, found.y);
      const inView =
        x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
      if (!inView && !follow) setCamera({ mode: 'free', box: centreOn(box, { x, y }, whole) });
    }
  }

  const select = (key: string | null) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    onSelect?.(key);
  };
  /**
   * A group of spots: zoomed in on its places, at least twice as close. A view that follows
   * you zooms in twice as close about you instead, as its zoom control does.
   */
  const open = (entry: SpotEntry) => {
    if (follow) {
      if (!closest) zoom(ZOOM_STEP);
      return;
    }
    const points = entry.cluster.members.flatMap((i) => {
      const p = flat.drawn[i];
      return p ? [p] : [];
    });
    const [xs, ys] = [points.map((p) => p[0]), points.map((p) => p[1])];
    const pad = cell / 2;
    const fit = {
      x: Math.min(...xs) - pad,
      y: Math.min(...ys) - pad,
      width: Math.max(...xs) - Math.min(...xs) + pad * 2,
      height: Math.max(...ys) - Math.min(...ys) + pad * 2,
    };
    const next =
      unitOf(fit, size) <= unit / 2
        ? zoomBox(fit, 1, whole, size)
        : zoomBox(centreOn(box, entry, whole), 2, whole, size, entry);
    setCamera({ mode: 'free', box: next });
  };
  const press = (entry: SpotEntry) => {
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (entry.group) open(entry);
    else onSelect?.(entry.key);
  };
  const onBackgroundClick = (event: MouseEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest('[data-mark-key],[data-spot-key]')) return;
    if (suppress.current) {
      suppress.current = false;
      return;
    }
    if (selected !== null) onSelect?.(null);
  };

  // One tab stop for marks and spots, a current mark before any spot.
  const stops: { key: string; x: number; y: number; spot?: SpotEntry }[] = [
    ...spotsDrawn.map((spot) => ({
      key: spot.key,
      x: spot.x,
      y: spot.y,
      spot,
    })),
    ...sorted.map(({ mark, x, y }) => ({ key: mark.key, x, y })),
  ];
  const isInView = ({ x, y }: { x: number; y: number }) =>
    x >= area.x && x <= area.x + area.width && y >= area.y && y <= area.y + area.height;
  const inView = stops.filter(isInView);
  const stop =
    (tabStop && stops.some((d) => d.key === tabStop) ? tabStop : null) ??
    (selected && stops.some((d) => d.key === selected) ? selected : null) ??
    sorted.find(isInView)?.mark.key ??
    inView[0]?.key ??
    null;
  const onMarkKey = (event: KeyboardEvent<SVGGElement>) => {
    const target = event.target as Element;
    const key = target.getAttribute('data-mark-key') ?? target.getAttribute('data-spot-key');
    const from = stops.find((d) => d.key === key);
    if (!key || !from) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (from.spot?.group) open(from.spot);
      else onSelect?.(key);
      return;
    }
    if (event.key === 'Escape' && selected !== null) {
      event.preventDefault();
      onSelect?.(null);
      return;
    }
    const arrow = ARROWS[event.key];
    if (!arrow) return;
    event.preventDefault();
    const next = nextMark(inView.includes(from) ? inView : stops, from, arrow[0], arrow[1]);
    if (!next) return;
    [...(svg.current?.querySelectorAll<SVGElement>('[data-mark-key],[data-spot-key]') ?? [])]
      .find(
        (el) => (el.getAttribute('data-mark-key') ?? el.getAttribute('data-spot-key')) === next.key,
      )
      ?.focus();
  };

  const r = (compact ? 4.6 : 5.4) * unit;
  const ring = stops.find((d) => d.key === ringed) ?? null;
  const focusProps = (key: string) => ({
    onFocus: (event: { currentTarget: Element }) => {
      setTabStop(key);
      setRinged(focusVisible(event.currentTarget) ? key : null);
    },
    onBlur: () => setRinged(null),
  });
  const hitAttr = hit ? { 'data-hit': '' } : {};
  const controlSize = compact ? 'sm' : 'md';
  const stacked = size.height >= stackHeight(controlSize, follow ? 2 : 4);
  const iconSize = compact ? 12 : 14;
  const control = 'bg-veil backdrop-blur-sm';

  return (
    <div
      ref={setFrame}
      className={cn(
        'world-map relative min-h-0 overflow-hidden border border-line inset-shadow-well',
        art.ready ? 'bg-paper' : 'bg-parchment',
        compact ? 'rounded-md' : 'rounded-lg',
        className,
      )}
      data-map={map.id}
      data-camera={camera.mode}
      data-ground={art.ready ? 'sheet' : 'chart'}
    >
      <svg
        ref={svg}
        className={cn(
          'absolute inset-0 block size-full touch-none select-none',
          interactive && !follow && 'cursor-grab active:cursor-grabbing',
        )}
        viewBox={`${box.x} ${box.y} ${box.width} ${box.height}`}
        preserveAspectRatio="xMidYMid meet"
        {...(interactive && {
          onPointerDown,
          onPointerMove,
          onPointerUp: endPan,
          onPointerCancel: endPan,
          onClick: onBackgroundClick,
        })}
      >
        <title>{title}</title>
        {drawArt &&
          (art.ready ? (
            <MapArt art={map.art} delivery={art} whole={whole} area={area} unit={unit} />
          ) : (
            <MapGraticule whole={whole} unit={unit} fine={whole.width / box.width >= 3} />
          ))}
        <g
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- SVG has no fieldset element
          role="group"
          aria-label={t(($) => $.map.marks)}
          onKeyDown={onMarkKey}
        >
          {/* Spots lie under every mark, the selected one above the other spots. */}
          {[...spotsDrawn]
            .sort((a, b) => Number(a.key === selected) - Number(b.key === selected))
            .map((spot) => {
              const isSelected = spot.key === selected;
              return (
                <g
                  key={spot.key}
                  data-spot-key={spot.key}
                  data-kind={spot.parts.length > 1 ? 'mixed' : spot.layer.kind}
                  data-count={spot.cluster.count}
                  // Each layer's points in a group, by layer id ("cube:12 gathering:30").
                  data-counts={
                    spot.group
                      ? spot.parts.map((p) => `${p.layer.id}:${p.count}`).join(' ')
                      : undefined
                  }
                  data-group={spot.group || undefined}
                  // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG mark cannot be an HTML button
                  role="button"
                  aria-label={spot.label}
                  {...(!spot.group && { 'aria-pressed': isSelected })}
                  tabIndex={interactive && spot.key === stop ? 0 : -1}
                  className={cn('outline-none', interactive && 'cursor-pointer')}
                  transform={`translate(${spot.x} ${spot.y})`}
                  onClick={() => press(spot)}
                  {...focusProps(spot.key)}
                >
                  <title>{spot.label}</title>
                  {isSelected && (
                    <g className="pointer-events-none fill-none" data-ring="selected">
                      <circle
                        className="stroke-ink-inverse/80"
                        r={r * 1.95}
                        strokeWidth={4.2 * unit}
                      />
                      <circle
                        className="stroke-marker-selected"
                        r={r * 1.95}
                        strokeWidth={2.2 * unit}
                      />
                    </g>
                  )}
                  {spot.group ? (
                    <SpotGroup
                      glyphs={tagGlyphs(spot.parts)}
                      text={fmt.compact.format(spot.cluster.count)}
                      unit={unit}
                      compact={compact}
                    />
                  ) : (
                    <SpotShape
                      kind={spot.layer.kind}
                      glyph={spot.layer.glyph?.(spot.parts[0]!.members[0]!) ?? null}
                      r={r}
                      unit={unit}
                    />
                  )}
                </g>
              );
            })}
          {sorted.map(({ mark, x, y }) => {
            const isSelected = mark.key === selected;
            return (
              <g
                key={mark.key}
                data-mark-key={mark.key}
                data-kind={mark.kind}
                data-tone={mark.tone}
                data-new={mark.isNew || undefined}
                // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role -- an SVG mark cannot be an HTML button
                role="button"
                aria-label={mark.label}
                aria-pressed={isSelected}
                tabIndex={interactive && mark.key === stop ? 0 : -1}
                className={cn('outline-none', interactive && 'cursor-pointer')}
                transform={`translate(${x} ${y})`}
                onClick={() => select(mark.key)}
                {...focusProps(mark.key)}
              >
                <title>{mark.label}</title>
                {mark.isNew && (
                  <circle
                    className="pointer-events-none origin-center animate-ripple fill-none stroke-marker-live [transform-box:fill-box]"
                    r={r * 2.2}
                    strokeWidth={2 * unit}
                  />
                )}
                {isSelected && (
                  <g className="pointer-events-none fill-none" data-ring="selected">
                    <circle
                      className="stroke-ink-inverse/80"
                      r={r * 2.2}
                      strokeWidth={4.2 * unit}
                    />
                    <circle
                      className="stroke-marker-selected"
                      r={r * 2.2}
                      strokeWidth={2.2 * unit}
                    />
                  </g>
                )}
                <MarkShape kind={mark.kind} tone={mark.tone} r={r} unit={unit} />
              </g>
            );
          })}
          {me && player && (
            <g
              data-mark="you"
              data-state={player.last ? 'last' : player.estimated ? 'estimated' : 'fresh'}
              className="pointer-events-none"
              transform={`translate(${me[0]} ${me[1]})`}
            >
              <title>
                {player.last
                  ? t(($) => $.map.youLast)
                  : player.estimated
                    ? t(($) => $.map.youEstimated)
                    : t(($) => $.map.you)}
              </title>
              {/* How far the drawn position may be from the last measured one. */}
              {uncertainty !== null && (
                <circle
                  data-mark="you-estimate"
                  className="fill-none stroke-ink-inverse/70"
                  r={Math.max(r * 2.9, uncertainty)}
                  strokeWidth={unit}
                  strokeDasharray={`${3 * unit} ${2 * unit}`}
                />
              )}
              {/* Facing from your last skill, never inferred from movement; as on the radar. */}
              {facing !== null && (
                <g
                  data-mark="you-facing"
                  data-degrees={player.facing ?? undefined}
                  transform={`rotate(${facing}) scale(${r * 0.275})`}
                >
                  <path
                    d={FACING_PATH}
                    className="fill-accent stroke-ink"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                </g>
              )}
              {player.last ? (
                <>
                  <circle
                    className="fill-none stroke-ink-inverse"
                    r={r * 1.65}
                    strokeWidth={r * 0.44}
                    strokeDasharray={`${r * 0.66} ${r * 0.5}`}
                  />
                  <circle className="fill-ink-inverse/60" r={r * 0.55} />
                </>
              ) : (
                <>
                  <circle
                    className="origin-center animate-ripple fill-none stroke-ink-inverse/70 [transform-box:fill-box]"
                    r={r * 2.4}
                    strokeWidth={1.8 * unit}
                  />
                  <circle
                    r={r * 2.4}
                    className="fill-ink-inverse/10 stroke-ink-inverse/60"
                    strokeWidth={1.2 * unit}
                  />
                  <circle
                    r={r * 1.1}
                    className="fill-ink-inverse stroke-ink"
                    strokeWidth={1.6 * unit}
                  />
                </>
              )}
            </g>
          )}
        </g>
        {ring && (
          <g
            className="pointer-events-none fill-none"
            data-mark="focus-ring"
            transform={`translate(${ring.x} ${ring.y})`}
          >
            <circle className="stroke-ink-inverse/70" r={r * 2.6} strokeWidth={4 * unit} />
            <circle className="stroke-focus" r={r * 2.6} strokeWidth={2 * unit} />
          </g>
        )}
      </svg>
      {drawArt && <MapArtNotice delivery={art} compact={compact} hit={hit} />}
      {children}
      <div
        className={cn(
          'absolute flex gap-1',
          compact ? 'top-1 right-1' : 'top-2 right-2',
          // A short frame lays its controls in a row, so all of them stay in view.
          stacked ? 'flex-col' : 'flex-row',
        )}
        data-controls={stacked ? 'column' : 'row'}
      >
        <Button
          {...hitAttr}
          iconOnly
          size={controlSize}
          className={control}
          aria-label={t(($) => $.map.zoomIn)}
          title={closest ? t(($) => $.map.closest) : t(($) => $.map.zoomIn)}
          disabled={closest}
          onClick={() => zoom(ZOOM_STEP)}
        >
          <Icon name="zoomIn" size={iconSize} />
        </Button>
        <Button
          {...hitAttr}
          iconOnly
          size={controlSize}
          className={control}
          aria-label={t(($) => $.map.zoomOut)}
          title={t(($) => $.map.zoomOut)}
          disabled={farthest}
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <Icon name="zoomOut" size={iconSize} />
        </Button>
        {/* A view that always follows you has nowhere else to go. */}
        {!follow && (
          <>
            <Button
              {...hitAttr}
              iconOnly
              size={controlSize}
              className={control}
              aria-label={player ? t(($) => $.map.follow) : t(($) => $.map.fit)}
              title={player ? t(($) => $.map.followTitle) : t(($) => $.map.fitTitle)}
              aria-pressed={camera.mode === 'follow' && camera.zoom === 1}
              onClick={() => setCamera(FOLLOW)}
            >
              <Icon name={player ? 'locate' : 'crosshair'} size={iconSize} />
            </Button>
            <Button
              {...hitAttr}
              iconOnly
              size={controlSize}
              className={control}
              aria-label={t(($) => $.map.whole)}
              title={t(($) => $.map.wholeTitle)}
              onClick={() => setCamera({ mode: 'free', box: zoomBox(whole, 1, whole, size) })}
            >
              <Icon name="fit" size={iconSize} />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

interface ShapeProps {
  tone: MarkTone;
  r: number;
  unit: number;
}

/** A mark's glyph, centred on its point, in drawing units; one per kind. */
function MarkShape({ kind, ...props }: ShapeProps & { kind: MarkKind }) {
  const Shape = SHAPES[kind];
  return <Shape {...props} />;
}

/**
 * The original Hidden Cube artwork, `size` drawing units wide, centred on its point. It is
 * never recoloured: a mark's state is told by the casing under it.
 */
function CubeArt({ size, className }: { size: number; className?: string | undefined }) {
  return (
    <image
      className={className}
      href={cubeArtSrc}
      x={-size / 2}
      y={-size / 2}
      width={size}
      height={size}
      preserveAspectRatio="xMidYMid meet"
    />
  );
}

/**
 * A received cube: the original cube on a diamond casing, lit while it may still be there,
 * a smaller dashed outline under a faded cube once seen earlier.
 */
function Diamond({ tone, r, unit }: ShapeProps) {
  const s = tone === 'past' ? r : r * 1.2;
  return (
    <>
      <rect
        className={cn(
          tone === 'live' && 'fill-marker-live stroke-ink-inverse',
          tone === 'busy' && 'fill-warn stroke-ink-inverse',
          tone === 'past' && 'fill-paper/80 stroke-paper-ink/80',
        )}
        x={-s}
        y={-s}
        width={s * 2}
        height={s * 2}
        rx={0.4 * unit}
        transform="rotate(45)"
        strokeWidth={1.4 * unit}
        strokeDasharray={tone === 'past' ? `${2 * unit} ${1.4 * unit}` : undefined}
      />
      <CubeArt size={s * 2.2} className={tone === 'past' ? 'opacity-60' : undefined} />
    </>
  );
}

const SHAPES: Record<MarkKind, (props: ShapeProps) => ReactNode> = {
  cube: Diamond,
};

/** A spot as drawn: one place, or a group of places shown as one. */
interface SpotEntry {
  key: string;
  x: number;
  y: number;
  /** The layer of its first place; a group may hold places of other layers too. */
  layer: SpotLayer;
  /** Its places by layer, in layer order. */
  parts: readonly SpotPart[];
  cluster: SpotCluster;
  group: boolean;
  label: string;
}

/**
 * A possible location: its glyph (else its kind's) on a dark round plate with a dashed
 * ring, so it never reads as a received cube (a lit diamond) and never ripples. The plate
 * takes the pointer, so a small place is easy to press.
 */
function SpotShape({
  kind,
  glyph,
  r,
  unit,
}: {
  kind: SpotKind;
  glyph: SpotGlyph | null;
  r: number;
  unit: number;
}) {
  return (
    <>
      <circle
        className="fill-ink-inverse/60 stroke-marker-possible"
        r={r * 1.45}
        strokeWidth={1.2 * unit}
        strokeDasharray={`${2 * unit} ${1.2 * unit}`}
      />
      <GlyphArt glyph={glyph ?? KIND_GLYPH[kind]} size={r * 2.9} className="pointer-events-none" />
    </>
  );
}

/**
 * A kind's own glyph: the original cube; a gathering place always names its own resource,
 * so its kind has only a written placeholder.
 */
const KIND_GLYPH: Record<SpotKind, SpotGlyph> = {
  cube: { src: cubeArtSrc },
  gathering: { text: '?' },
};

/**
 * The picture of a place or tag, `size` drawing units wide, centred on its point: original
 * artwork fitted whole and never recoloured, else its short written label.
 */
function GlyphArt({
  glyph,
  size,
  className,
}: {
  glyph: SpotGlyph;
  size: number;
  className?: string | undefined;
}) {
  if ('src' in glyph)
    return (
      <image
        className={className}
        href={glyph.src}
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        preserveAspectRatio="xMidYMid meet"
      />
    );
  return (
    <text
      className={cn('fill-ink font-semibold', className)}
      fontSize={size * (glyph.text.length > 1 ? 0.4 : 0.5)}
      textAnchor="middle"
      dominantBaseline="central"
      data-glyph="text"
    >
      {glyph.text}
    </text>
  );
}

/**
 * Places drawn as one: a dark tag with the glyphs of what is there (the kind's own when the
 * layer names none), overlapped with the most common on top, and how many points it stands
 * for.
 */
function SpotGroup({
  glyphs,
  text,
  unit,
  compact,
}: {
  glyphs: readonly SpotGlyph[];
  text: string;
  unit: number;
  compact: boolean;
}) {
  const font = (compact ? 9 : 10) * unit;
  const icon = font * 1.5;
  const pad = font * 0.3;
  const step = icon * 0.5;
  const textWidth = font * 0.62 * text.length;
  const width = pad + icon + step * (glyphs.length - 1) + font * 0.15 + textWidth + pad * 1.6;
  const height = font * 1.8;
  const left = -width / 2;
  return (
    <>
      <rect
        className="fill-ink-inverse/80 stroke-marker-possible"
        x={left}
        y={-height / 2}
        width={width}
        height={height}
        rx={height * 0.3}
        strokeWidth={1.3 * unit}
      />
      {glyphs
        .map((glyph, i) => (
          <g
            key={i}
            className="pointer-events-none"
            transform={`translate(${left + pad + icon / 2 + step * i} 0)`}
          >
            <GlyphArt glyph={glyph} size={icon} />
          </g>
        ))
        .reverse()}
      <text
        className="pointer-events-none fill-ink font-semibold tabular-nums"
        x={width / 2 - pad * 1.6 - textWidth / 2}
        fontSize={font}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {text}
      </text>
    </>
  );
}

/**
 * The legend's copy of a mark (or, with `spot`, of a place), drawn like the mark itself.
 * A cube is 16 px wide (`className` may resize it), your position 12 px.
 */
export function MarkGlyph({
  kind,
  tone,
  spot = false,
  glyph = null,
  className,
}: {
  /** A gathering place is always a place: it has no received mark. */
  kind: SpotKind | 'you';
  tone?: MarkTone;
  spot?: boolean;
  /** A place's own glyph (a gathering resource's original icon or written label). */
  glyph?: SpotGlyph | null;
  className?: string;
}) {
  return (
    <svg
      viewBox="-6 -6 12 12"
      className={cn('shrink-0 overflow-visible', kind === 'you' ? 'size-3' : 'size-4', className)}
      aria-hidden="true"
    >
      {kind === 'you' ? (
        <>
          <circle className="fill-none stroke-ink-3" r={5} strokeWidth={0.9} />
          <circle className="fill-ink-inverse stroke-ink" r={2.6} strokeWidth={1.1} />
        </>
      ) : spot || kind === 'gathering' ? (
        <SpotShape kind={kind} glyph={glyph} r={3.8} unit={0.55} />
      ) : (
        <MarkShape kind={kind} tone={tone ?? 'live'} r={3.2} unit={0.55} />
      )}
    </svg>
  );
}
