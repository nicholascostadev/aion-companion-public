import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/*
 * Motion driven from script (the Web Animations API) rather than CSS, for things that must
 * keep moving while React rearranges them. Reordering keyed rows moves their DOM nodes, and
 * WebView2 cancels an element's CSS animations and transitions when it leaves the document:
 * a bar would regrow from nothing and a width change would jump. Script animations survive
 * the move, so live lists animate with these instead.
 */

/** A row sliding to its new place in a reordered list: quick, so live updates keep up. */
const SLIDE_MS = 200;
/** A bar easing between two values, as `duration-300` transitions do elsewhere. */
const FILL_MS = 300;
/** A bar growing out from its root the first time it appears, as `animate-grow` does. */
const GROW_MS = 700;

let easing: string | null = null;

/** The `ease-grow` token (decelerating), read once from the theme; `ease-out` without one. */
function easeGrow(): string {
  if (easing) return easing;
  const token =
    typeof document === 'undefined'
      ? ''
      : getComputedStyle(document.documentElement).getPropertyValue('--ease-grow').trim();
  if (token) easing = token;
  return token || 'ease-out';
}

/**
 * Whether `element` may animate now: the system does not ask for reduced motion and the
 * engine runs script animations (jsdom does not). Read at each change, so turning reduced
 * motion on stops the next animation without a re-render.
 */
function canAnimate(element: Element): boolean {
  if (typeof element.animate !== 'function') return false;
  return !(
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/* ---------- Bars ---------- */

/**
 * How a bar draws its fill: `scale` (a horizontal scale of a full-width bar, from the left;
 * the cheaper choice, for bars with square ends) or `width` (for rounded ends, which a scale
 * would squash).
 */
export type FillProperty = 'scale' | 'width';

/** The style that draws `fraction` at rest; the caller puts it on the bar. */
export const fillStyle = (property: FillProperty, fraction: number) =>
  property === 'scale' ? { scale: `${fraction} 1` } : { width: `${fraction * 100}%` };

/** The fraction a bar draws this instant: its width over its containing block's, or null. */
function drawnFraction(element: HTMLElement): number | null {
  const container = element.offsetParent ?? element.parentElement;
  const whole = container?.getBoundingClientRect().width ?? 0;
  return whole > 0 ? element.getBoundingClientRect().width / whole : null;
}

/**
 * Eases a bar's fill to `fraction` from whatever it draws now, never from nothing: the first
 * time the bar appears it grows from its root once; after that each change runs from the
 * last value, or from mid-way through a change still under way. The bar keeps its motion
 * when React moves its row (see the top of this file). Reduced motion draws each value at once.
 * `fraction` null means no bar is drawn; the next one to appear grows again.
 */
export function useFill<T extends HTMLElement>(fraction: number | null, property: FillProperty) {
  const ref = useRef<T>(null);
  const shown = useRef<number | null>(null);
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    const last = shown.current;
    shown.current = element ? fraction : null;
    if (!element || fraction === null || last === fraction) return;
    const current = running.current;
    const start =
      last === null
        ? 0
        : current?.playState === 'running'
          ? (drawnFraction(element) ?? last)
          : last;
    current?.cancel();
    running.current = null;
    if (!canAnimate(element) || start === fraction) return;
    running.current = element.animate([fillStyle(property, start), fillStyle(property, fraction)], {
      duration: last === null ? GROW_MS : FILL_MS,
      easing: easeGrow(),
    });
  }, [fraction, property]);
  useEffect(() => () => running.current?.cancel(), []);
  return ref;
}

/* ---------- Reordered rows ---------- */

/** The vertical part of a computed `translate` ("none", "0px" or "0px 12.5px"), in px. */
function translateY(element: Element): number {
  const parts = getComputedStyle(element).translate?.split(/\s+/) ?? [];
  return parts.length > 1 ? Number.parseFloat(parts[1]!) || 0 : 0;
}

/**
 * Slides the rows of `list` to their new places when their order changes, instead of
 * letting them jump (FLIP: each row starts where it was drawn and eases to where it now is).
 * Rows are the elements matching `rowSelector`; each row stays put and its first element
 * child is what slides, so the row's own rectangle is always its laid-out place (as
 * `useMeterFit` and hit testing measure it). Rows are told apart by their DOM node, so they
 * need stable keys. A row that moves again mid-slide starts from where it is drawn that
 * instant. New rows simply appear; reduced motion moves rows at once.
 */
export function useFlipReorder(list: RefObject<HTMLElement | null>, rowSelector: string) {
  /** Each row's top in CSS pixels from the list's top, as last laid out. */
  const tops = useRef(new WeakMap<Element, number>());
  const slides = useRef(new WeakMap<Element, Animation>());
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const rows = [...root.querySelectorAll<HTMLElement>(rowSelector)];
    if (!rows.length) return;
    const box = root.getBoundingClientRect();
    // Rectangles are drawn pixels (a scaled meter's included); a slide moves CSS pixels.
    const zoom = root.offsetHeight > 0 && box.height > 0 ? box.height / root.offsetHeight : 1;
    // Every position is read before any slide starts, so the list is laid out once.
    const moves = rows.map((row) => {
      const mover = row.firstElementChild;
      const top = (row.getBoundingClientRect().top - box.top) / zoom;
      const before = tops.current.get(row);
      tops.current.set(row, top);
      const slide = mover && slides.current.get(mover);
      const offset = mover && slide?.playState === 'running' ? translateY(mover) : 0;
      return { mover, top, before, offset };
    });
    const motion = canAnimate(root);
    for (const { mover, top, before, offset } of moves) {
      if (!(mover instanceof HTMLElement) || before === undefined) continue;
      if (Math.abs(before - top) < 0.5) continue;
      slides.current.get(mover)?.cancel();
      slides.current.delete(mover);
      // Where it was drawn (its old place, plus any slide under way), from its new place.
      const from = before + offset - top;
      if (!motion || Math.abs(from) < 0.5) continue;
      slides.current.set(
        mover,
        mover.animate([{ translate: `0 ${from}px` }, { translate: '0 0' }], {
          duration: SLIDE_MS,
          easing: easeGrow(),
        }),
      );
    }
  });
}
