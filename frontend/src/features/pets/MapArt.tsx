import { useId } from 'react';
import type { MapArtView } from '../../types/mapArt';
import type { PetMapArt } from '../../types/pets';
import { artLayers, type Box } from './model';

/** Device pixels per CSS pixel; 1 where the engine does not say. */
const pixelRatio = () =>
  typeof window !== 'undefined' && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;

/**
 * Original map art in an SVG drawn in native canvas pixels: the overview over the whole
 * canvas, and the native tiles over it only where the view needs their detail (see
 * `artLayers`). Its edges are feathered into the paper around it so painted sea and paper
 * run on without a seam. The feather is anchored to the whole canvas, never to the tiles
 * drawn, so culling tiles can never fade an inner tile edge.
 *
 * Draw it only once `delivery` is ready (see `features/maps/mapArt.ts`): the files are downloaded on
 * first use. An image that fails to load is reported, so a corrupted cache shows its state.
 */
export function MapArt({
  art,
  delivery,
  whole,
  area,
  unit,
}: {
  art: PetMapArt;
  delivery: Pick<MapArtView, 'src' | 'revision' | 'failed'>;
  /** The whole canvas, in drawing units. */
  whole: Box;
  /** Drawing-space area on screen. */
  area: Box;
  /** Drawing units per CSS pixel. */
  unit: number;
}) {
  const id = useId();
  const { overview, tiles } = artLayers(art, area, unit, pixelRatio());
  const { src, revision, failed } = delivery;
  return (
    <>
      <defs>
        <Feather id={`${id}x`} x1={whole.x} y1={0} x2={whole.x + whole.width} y2={0} />
        <Feather id={`${id}y`} x1={0} y1={whole.y} x2={0} y2={whole.y + whole.height} />
        {(['x', 'y'] as const).map((axis) => (
          <mask
            key={axis}
            id={`${id}m${axis}`}
            className="[mask-type:alpha]"
            maskUnits="userSpaceOnUse"
            x={whole.x}
            y={whole.y}
            width={whole.width}
            height={whole.height}
          >
            <rect {...whole} fill={`url(#${id}${axis})`} />
          </mask>
        ))}
      </defs>
      <g mask={`url(#${id}mx)`}>
        <g
          className="pet-map-tiles"
          mask={`url(#${id}my)`}
          data-overview={overview ? 'drawn' : 'none'}
          data-tiles={tiles.length}
        >
          {overview && (
            <image
              key={`overview:${revision}`}
              href={src(overview.file)}
              onError={failed}
              x={0}
              y={0}
              width={art.width}
              height={art.height}
              preserveAspectRatio="none"
            />
          )}
          {tiles.map((t) => (
            <image
              key={`${t.x}:${t.y}:${revision}`}
              href={src(t.file)}
              onError={failed}
              x={t.x}
              y={t.y}
              width={t.width}
              height={t.height}
              preserveAspectRatio="none"
            />
          ))}
        </g>
      </g>
    </>
  );
}

/**
 * An alpha ramp across the canvas in drawing units: clear at both edges, opaque inside. Stops
 * are opacities only (an alpha mask ignores colour).
 */
function Feather(props: { id: string; x1: number; y1: number; x2: number; y2: number }) {
  return (
    <linearGradient {...props} gradientUnits="userSpaceOnUse">
      <stop offset="0" stopOpacity={0} />
      <stop offset="0.025" stopOpacity={1} />
      <stop offset="0.975" stopOpacity={1} />
      <stop offset="1" stopOpacity={0} />
    </linearGradient>
  );
}

/**
 * The coordinate chart drawn on a map's art canvas while its art is not yet ready: a faint
 * `paper-line` graticule in tenths (and fiftieths once `fine`) inside the canvas neatline.
 * The geometry is the art's own, so marks, pans and zooms do not move when the art arrives.
 */
export function MapGraticule({
  whole,
  unit,
  fine = false,
}: {
  whole: Box;
  /** Drawing units per CSS pixel. */
  unit: number;
  fine?: boolean;
}) {
  const lines: { key: string; x1: number; y1: number; x2: number; y2: number; minor: boolean }[] =
    [];
  const steps = fine ? 50 : 10;
  for (let i = 1; i < steps; i++) {
    const minor = fine && i % 5 !== 0;
    const x = whole.x + (whole.width * i) / steps;
    const y = whole.y + (whole.height * i) / steps;
    lines.push({ key: `v${i}`, x1: x, y1: whole.y, x2: x, y2: whole.y + whole.height, minor });
    lines.push({ key: `h${i}`, x1: whole.x, y1: y, x2: whole.x + whole.width, y2: y, minor });
  }
  return (
    <g className="pointer-events-none fill-none" data-chart="graticule">
      {lines.map((l) => (
        <line
          key={l.key}
          className={l.minor ? 'stroke-paper-line/50' : 'stroke-paper-line'}
          x1={l.x1}
          y1={l.y1}
          x2={l.x2}
          y2={l.y2}
          strokeWidth={unit}
        />
      ))}
      <rect className="stroke-paper-ink/45" {...whole} strokeWidth={1.6 * unit} />
    </g>
  );
}
