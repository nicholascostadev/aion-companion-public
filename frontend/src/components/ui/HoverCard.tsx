import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/** Space between the anchor and the card. */
const GAP = 8;
/** Space the card keeps from the edges of the window. */
const EDGE = 8;

export type HoverCardSide = 'top' | 'bottom' | 'left' | 'right';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), value));

/**
 * Where a card of `card` size goes beside `anchor` inside a `view` (all in window pixels):
 * on the preferred side when it fits, else the opposite side, else beside it, else the side
 * with the most room; then shifted along that side so it never leaves the view. `tip` is the
 * anchor's centre along the card's edge, for the caret.
 */
export function placeHoverCard(
  anchor: Rect,
  card: { width: number; height: number },
  view: { width: number; height: number },
  side: HoverCardSide = 'top',
) {
  const room: Record<HoverCardSide, number> = {
    top: anchor.top - GAP - EDGE,
    bottom: view.height - (anchor.top + anchor.height) - GAP - EDGE,
    left: anchor.left - GAP - EDGE,
    right: view.width - (anchor.left + anchor.width) - GAP - EDGE,
  };
  const need = (s: HoverCardSide) => (s === 'top' || s === 'bottom' ? card.height : card.width);
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const;
  const order: HoverCardSide[] =
    side === 'top' || side === 'bottom'
      ? [side, opposite[side], 'right', 'left']
      : [side, opposite[side], 'top', 'bottom'];
  const placed =
    order.find((s) => need(s) <= room[s]) ??
    order.reduce((best, s) => (room[s] - need(s) > room[best] - need(best) ? s : best));
  const cx = anchor.left + anchor.width / 2;
  const cy = anchor.top + anchor.height / 2;
  const maxLeft = view.width - EDGE - card.width;
  const maxTop = view.height - EDGE - card.height;
  if (placed === 'top' || placed === 'bottom') {
    const left = clamp(cx - card.width / 2, EDGE, maxLeft);
    const top =
      placed === 'top' ? anchor.top - GAP - card.height : anchor.top + anchor.height + GAP;
    return { side: placed, left, top: clamp(top, EDGE, maxTop), tip: cx - left };
  }
  const top = clamp(cy - card.height / 2, EDGE, maxTop);
  const left =
    placed === 'left' ? anchor.left - GAP - card.width : anchor.left + anchor.width + GAP;
  return { side: placed, left: clamp(left, EDGE, maxLeft), top, tip: cy - top };
}

export interface HoverCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** The element the card describes; null hides the card. */
  anchor: Element | null;
  /** The card hides while the anchor's centre is outside this element (a map frame). */
  boundary?: Element | null;
  /** Preferred side of the anchor; the card flips and shifts to stay in the window. */
  side?: HoverCardSide;
  children: ReactNode;
}

/**
 * A small floating card of facts about the thing under the pointer or focus: a mark on a
 * map, a point on a chart. It is informational only: it never takes the pointer (marks
 * beside it stay hoverable) and holds nothing to click. Rendered over everything in a portal
 * and kept inside the window; it follows its anchor on every render, so a map that zooms or
 * pans carries it along. Pair it with `useHoverCard` for the delays, Escape and the
 * trigger props.
 */
export function HoverCard({
  anchor,
  boundary,
  side = 'top',
  className,
  children,
  ...props
}: HoverCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const caret = useRef<HTMLSpanElement>(null);

  const place = useCallback(() => {
    const element = card.current;
    if (!element || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const cx = a.left + a.width / 2;
    const cy = a.top + a.height / 2;
    const b = boundary?.getBoundingClientRect();
    const outside = !!b && (cx < b.left || cx > b.right || cy < b.top || cy > b.bottom);
    element.style.visibility = outside || !anchor.isConnected ? 'hidden' : '';
    const at = placeHoverCard(
      a,
      { width: element.offsetWidth, height: element.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
      side,
    );
    element.style.left = `${Math.round(at.left)}px`;
    element.style.top = `${Math.round(at.top)}px`;
    element.dataset.side = at.side;
    if (caret.current) {
      const along = at.side === 'top' || at.side === 'bottom' ? 'left' : 'top';
      const length = along === 'left' ? element.offsetWidth : element.offsetHeight;
      // The caret stays on the card's straight edge, clear of the rounded corners.
      caret.current.style.left = '';
      caret.current.style.top = '';
      caret.current.style[along] = `${Math.round(clamp(at.tip, 14, length - 14))}px`;
    }
  }, [anchor, boundary, side]);

  // Every render: the anchor may have moved with the content around it (a zoom).
  useLayoutEffect(() => place());

  useEffect(() => {
    if (!anchor) return;
    const element = card.current;
    window.addEventListener('scroll', place, { capture: true, passive: true });
    window.addEventListener('resize', place);
    const observer =
      element && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (element) observer?.observe(element);
    return () => {
      window.removeEventListener('scroll', place, { capture: true });
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [anchor, place]);

  if (!anchor || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={card}
      role="tooltip"
      data-ui="hover-card"
      className={cn(
        'group/hover-card pointer-events-none fixed top-0 left-0 z-50 w-max max-w-72 animate-sprout',
        'rounded-lg border border-line bg-shade/95 p-3 text-xs text-ink-2 shadow-3',
        className,
      )}
      {...props}
    >
      {children}
      {/* A small leaf tip pointing at the anchor, on whichever side the card landed. */}
      <span
        ref={caret}
        aria-hidden="true"
        data-ui="hover-card-tip"
        className={cn(
          'absolute size-2.5 rotate-45 border-line bg-shade/95',
          'group-data-[side=top]/hover-card:-bottom-1.25 group-data-[side=top]/hover-card:-ml-1.25 group-data-[side=top]/hover-card:border-r group-data-[side=top]/hover-card:border-b',
          'group-data-[side=bottom]/hover-card:-top-1.25 group-data-[side=bottom]/hover-card:-ml-1.25 group-data-[side=bottom]/hover-card:border-t group-data-[side=bottom]/hover-card:border-l',
          'group-data-[side=left]/hover-card:-right-1.25 group-data-[side=left]/hover-card:-mt-1.25 group-data-[side=left]/hover-card:border-t group-data-[side=left]/hover-card:border-r',
          'group-data-[side=right]/hover-card:-left-1.25 group-data-[side=right]/hover-card:-mt-1.25 group-data-[side=right]/hover-card:border-b group-data-[side=right]/hover-card:border-l',
        )}
      />
    </div>,
    document.body,
  );
}

export interface HoverCardOptions {
  /** Milliseconds the pointer rests before a card opens. */
  delay?: number;
  /** Milliseconds a card lingers after the pointer leaves, so moving to a neighbour never flickers. */
  closeDelay?: number;
  /** Milliseconds after a card closes during which the next one opens at once. */
  warm?: number;
}

/**
 * State for one `HoverCard` shared by many triggers (the marks of a map). A card opens after
 * a short rest of the pointer, at once on keyboard focus, and at once while another card is
 * open or has just closed, so moving along neighbouring marks swaps the content without a
 * flicker. Escape dismisses it until the pointer or focus moves to another trigger. Touch
 * never opens it: a tap is a click. `trigger(key)` returns the props for a trigger element.
 */
export function useHoverCard({ delay = 120, closeDelay = 90, warm = 400 }: HoverCardOptions = {}) {
  const id = useId();
  const [shown, setShown] = useState<{ key: string; anchor: Element } | null>(null);
  const open = useRef(false);
  const closedAt = useRef(-Infinity);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const clear = () => clearTimeout(timer.current);

  const show = useCallback(
    (key: string, anchor: Element, { immediate = false }: { immediate?: boolean } = {}) => {
      clearTimeout(timer.current);
      const now = () => {
        open.current = true;
        setShown((current) =>
          current?.key === key && current.anchor === anchor ? current : { key, anchor },
        );
      };
      if (immediate || open.current || performance.now() - closedAt.current < warm) now();
      else timer.current = setTimeout(now, delay);
    },
    [delay, warm],
  );

  const hide = useCallback(
    ({ immediate = false }: { immediate?: boolean } = {}) => {
      clearTimeout(timer.current);
      const close = () => {
        if (open.current) closedAt.current = performance.now();
        open.current = false;
        setShown(null);
      };
      if (immediate || !open.current) close();
      else timer.current = setTimeout(close, closeDelay);
    },
    [closeDelay],
  );

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide({ immediate: true });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shown, hide]);
  // A card whose anchor left the page (a filter removed its mark) closes too.
  useEffect(() => {
    if (shown && !shown.anchor.isConnected) hide({ immediate: true });
  });
  useEffect(() => clear, []);

  const trigger = (key: string) => ({
    'aria-describedby': shown?.key === key ? id : undefined,
    onPointerEnter: (event: PointerEvent<Element>) => {
      if (event.pointerType !== 'touch') show(key, event.currentTarget);
    },
    onPointerLeave: () => hide(),
    onFocus: (event: FocusEvent<Element>) => show(key, event.currentTarget, { immediate: true }),
    onBlur: () => hide({ immediate: true }),
  });

  return { id, shown, show, hide, trigger };
}
