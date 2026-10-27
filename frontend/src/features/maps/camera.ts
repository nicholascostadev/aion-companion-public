import {
  FIT_ART_UPSCALE,
  fitPoints,
  keepOnMap,
  limitZoom,
  MAX_ART_UPSCALE,
  type Box,
  type Projection,
} from '../pets/model';
import type { AtlasMap } from './atlas';

/*
 * What a world map shows, in drawing units (native canvas pixels). It follows you (or the
 * current marks) until you pan or zoom about a point, then stays where you left it until
 * you ask it to follow again or pick another map.
 */

export type Frame = { width: number; height: number };

/** Following: re-framed every update; `zoom` > 1 is closer than the automatic frame. */
export type Camera = { mode: 'follow'; zoom: number } | { mode: 'free'; box: Box };

export const FOLLOW: Camera = { mode: 'follow', zoom: 1 };

/** Least area a followed view spans, in world units (centimetres): about 300 m. */
export const FOLLOW_SPAN = 30_000;
/** Room around the farthest framed mark, as a fraction of its offset. */
const PAD = 1.2;
/** Farthest out: the whole map with a margin. */
const MAX_OUT = 1.25;

const scaled = (box: Box, k: number, cx = box.x + box.width / 2, cy = box.y + box.height / 2) => ({
  x: cx - (cx - box.x) * k,
  y: cy - (cy - box.y) * k,
  width: box.width * k,
  height: box.height * k,
});

/** Drawing units per CSS pixel when `box` is fitted into `frame` (SVG `meet`). */
export const unitOf = (box: Box, frame: Frame) =>
  Math.max(box.width / frame.width, box.height / frame.height);

/** True when the view is as close as the art stays sharp. */
export const atClosest = (box: Box, frame: Frame) => unitOf(box, frame) * MAX_ART_UPSCALE <= 1.001;

/** True when the view already shows the whole map with its margin. */
export const atFarthest = (box: Box, whole: Box) =>
  box.width >= whole.width * MAX_OUT * 0.999 && box.height >= whole.height * MAX_OUT * 0.999;

/** `box` kept between the art's sharpness limit and the whole map, and over the map. */
export function clampBox(box: Box, whole: Box, frame: Frame): Box {
  let next = limitZoom(box, frame, MAX_ART_UPSCALE);
  const k = Math.min(
    1,
    (whole.width * MAX_OUT) / next.width,
    (whole.height * MAX_OUT) / next.height,
  );
  if (k < 1) next = scaled(next, k);
  return keepOnMap(next, whole);
}

/**
 * The automatic frame. Around a known position: you at the centre, with every framed mark
 * in view and never less than `FOLLOW_SPAN`. Without one: the framed marks, else the whole
 * map. `zoom` then moves closer (> 1) or farther, within the art's limits.
 */
export function followBox({
  map,
  view,
  whole,
  frame,
  player,
  points,
  zoom,
}: {
  map: AtlasMap;
  view: Projection;
  whole: Box;
  frame: Frame;
  /** Your position in world units. */
  player: { x: number; y: number } | null;
  /** Marks the frame keeps in view, in world units. */
  points: readonly { x: number; y: number }[];
  zoom: number;
}): Box {
  let box: Box;
  if (player) {
    const [cx, cy] = view.project(player.x, player.y);
    const least = Math.abs(view.project(FOLLOW_SPAN, 0)[0] - view.project(0, 0)[0]);
    let [rx, ry] = [least / 2, least / 2];
    for (const p of points) {
      const [px, py] = view.project(p.x, p.y);
      rx = Math.max(rx, Math.abs(px - cx) * PAD);
      ry = Math.max(ry, Math.abs(py - cy) * PAD);
    }
    box = { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 };
  } else if (points.length) {
    box = fitPoints(
      map,
      view,
      points.map((p) => {
        const [x, y] = view.project(p.x, p.y);
        return { x, y };
      }),
    );
  } else box = whole;
  // An automatic frame keeps the land around you crisp; zooming in may go to the limit.
  if (zoom <= 1) box = limitZoom(box, frame, FIT_ART_UPSCALE);
  return clampBox(scaled(box, 1 / zoom), whole, frame);
}

/** `box` zoomed by `factor` (> 1 closer) about a drawing-space point, within limits. */
export function zoomBox(
  box: Box,
  factor: number,
  whole: Box,
  frame: Frame,
  at?: { x: number; y: number },
): Box {
  return clampBox(scaled(box, 1 / factor, at?.x, at?.y), whole, frame);
}

/** `box` moved by a drawing-space offset, never off the map. */
export const panBox = (box: Box, dx: number, dy: number, whole: Box): Box =>
  keepOnMap({ ...box, x: box.x + dx, y: box.y + dy }, whole);

/** `box` moved so `point` (drawing units) is at its centre. */
export const centreOn = (box: Box, point: { x: number; y: number }, whole: Box): Box =>
  keepOnMap({ ...box, x: point.x - box.width / 2, y: point.y - box.height / 2 }, whole);
