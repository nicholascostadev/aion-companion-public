import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/** Space between the anchor and the popover. */
const GAP = 8;
/** Space the popover keeps from the edges of the window. */
const EDGE = 8;
/** Below this height above or below the anchor, the popover covers the window instead. */
const MIN_HEIGHT = 160;

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(Math.max(min, max), value));

/**
 * Where a popover of `card` size (its whole content's height) goes beside `anchor` in a
 * `view`, and how tall it may be: beside the anchor (`side`, then the opposite side) when
 * its width fits there, as tall as the window allows; else above or below, as tall as the
 * room there; else, in a small window, over it at its full height. It is always inside the
 * window and scrolls what does not fit.
 */
export function placeHoverPopover(
  anchor: Rect,
  card: { width: number; height: number },
  view: { width: number; height: number },
  side: 'left' | 'right' = 'right',
) {
  const room = {
    top: anchor.top - GAP - EDGE,
    bottom: view.height - (anchor.top + anchor.height) - GAP - EDGE,
    left: anchor.left - GAP - EDGE,
    right: view.width - (anchor.left + anchor.width) - GAP - EDGE,
  };
  const full = Math.max(0, view.height - 2 * EDGE);
  const maxLeft = view.width - EDGE - card.width;
  const beside = ([side, side === 'right' ? 'left' : 'right'] as const).find(
    (s) => card.width <= room[s],
  );
  if (beside) {
    const height = Math.min(card.height, full);
    const top = clamp(
      anchor.top + anchor.height / 2 - height / 2,
      EDGE,
      view.height - EDGE - height,
    );
    const left =
      beside === 'right' ? anchor.left + anchor.width + GAP : anchor.left - GAP - card.width;
    return { side: beside, left: clamp(left, EDGE, maxLeft), top, maxHeight: full };
  }
  const left = clamp(anchor.left + anchor.width / 2 - card.width / 2, EDGE, maxLeft);
  const vertical =
    (['bottom', 'top'] as const).find((s) => card.height <= room[s]) ??
    (room.bottom >= room.top ? 'bottom' : 'top');
  const space = room[vertical];
  if (space >= Math.min(card.height, MIN_HEIGHT)) {
    const height = Math.min(card.height, space);
    const top =
      vertical === 'bottom' ? anchor.top + anchor.height + GAP : anchor.top - GAP - height;
    return { side: vertical, left, top, maxHeight: space };
  }
  const height = Math.min(card.height, full);
  return {
    side: 'over',
    left,
    top: clamp(anchor.top + anchor.height / 2 - height / 2, EDGE, view.height - EDGE - height),
    maxHeight: full,
  };
}

export interface HoverPopoverOptions {
  /** Milliseconds the pointer rests on a trigger before its popover opens. */
  delay?: number;
  /** Milliseconds it rests on another trigger, while one is open, before it swaps. */
  switchDelay?: number;
  /** Milliseconds a popover waits after the pointer leaves, so it can cross the gap. */
  closeDelay?: number;
}

type Shown = { key: string; anchor: Element };

/**
 * One interactive popover shared by many triggers (the slots of a list). It opens after
 * the pointer rests on a trigger and at once on keyboard focus; it stays open while the
 * pointer crosses the gap into it, so its content can be scrolled and its buttons used;
 * moving to another trigger swaps it after a short rest (a quick sweep opens nothing on
 * the way). It closes when the pointer leaves both, when focus leaves both, on Escape,
 * when the page outside it scrolls and when its trigger leaves the page. Escape (and
 * `hide({ dismiss: true })`, for a trigger's own click) keeps it closed until the pointer
 * or focus moves to another trigger. Touch never opens it: a tap is the trigger's click.
 */
export function useHoverPopover({
  delay = 250,
  switchDelay = 150,
  closeDelay = 200,
}: HoverPopoverOptions = {}) {
  const id = useId();
  const [shown, setShownState] = useState<Shown | null>(null);
  const current = useRef<Shown | null>(null);
  const popover = useRef<HTMLDialogElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dismissed = useRef<string | null>(null);

  const set = useCallback((next: Shown | null) => {
    current.current = next;
    setShownState(next);
  }, []);

  const show = useCallback(
    (key: string, anchor: Element, { immediate = false }: { immediate?: boolean } = {}) => {
      clearTimeout(timer.current);
      if (dismissed.current === key) return;
      dismissed.current = null;
      const open = current.current;
      if (open?.key === key && open.anchor === anchor) return;
      const wait = immediate ? 0 : open ? switchDelay : delay;
      if (wait === 0) set({ key, anchor });
      else timer.current = setTimeout(() => set({ key, anchor }), wait);
    },
    [delay, switchDelay, set],
  );

  const hide = useCallback(
    ({ immediate = false, dismiss = false }: { immediate?: boolean; dismiss?: boolean } = {}) => {
      clearTimeout(timer.current);
      const open = current.current;
      if (!open) return;
      if (dismiss) dismissed.current = open.key;
      // Focus inside the popover goes back to its trigger, which stays closed.
      const inside = popover.current?.contains(document.activeElement) ?? false;
      const close = () => {
        set(null);
        if (inside && open.anchor instanceof HTMLElement) {
          dismissed.current = open.key;
          open.anchor.focus();
        }
      };
      if (immediate) close();
      else timer.current = setTimeout(close, closeDelay);
    },
    [closeDelay, set],
  );

  /** The pointer reached the popover (or stays on its trigger): it stays open. */
  const keep = useCallback(() => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!shown) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Handled here, so it closes the popover only, not a pinned detail or the window.
      event.preventDefault();
      hide({ immediate: true, dismiss: true });
    };
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && popover.current?.contains(event.target)) return;
      hide({ immediate: true });
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, [shown, hide]);
  // A popover whose trigger left the page (a refresh replaced the list) closes too.
  useEffect(() => {
    if (shown && !shown.anchor.isConnected) hide({ immediate: true });
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  const within = (target: EventTarget | null, anchor?: Element) =>
    target instanceof Node &&
    ((popover.current?.contains(target) ?? false) || (anchor?.contains(target) ?? false));

  const trigger = (key: string) => ({
    'aria-controls': shown?.key === key ? id : undefined,
    'aria-expanded': shown?.key === key,
    onPointerEnter: (event: PointerEvent<Element>) => {
      if (event.pointerType !== 'touch') show(key, event.currentTarget);
    },
    onPointerLeave: (event: PointerEvent<Element>) => {
      if (dismissed.current === key) dismissed.current = null;
      if (event.pointerType === 'touch') return;
      if (!popover.current?.contains(document.activeElement)) hide();
    },
    onFocus: (event: FocusEvent<Element>) => show(key, event.currentTarget, { immediate: true }),
    onBlur: (event: FocusEvent<Element>) => {
      if (dismissed.current === key) dismissed.current = null;
      if (!within(event.relatedTarget)) hide({ immediate: true });
    },
  });

  /** Props for `HoverPopover`. */
  const popoverProps = {
    id,
    anchor: shown?.anchor ?? null,
    ref: popover,
    onPointerEnter: keep,
    onPointerLeave: () => {
      if (!popover.current?.contains(document.activeElement)) hide();
    },
    onBlur: (event: FocusEvent<HTMLDialogElement>) => {
      if (!within(event.relatedTarget, current.current?.anchor)) hide({ immediate: true });
    },
  };

  return { id, shown, show, hide, trigger, popover: popoverProps };
}

export interface HoverPopoverProps {
  /** `useHoverPopover().popover`. */
  popover: ReturnType<typeof useHoverPopover>['popover'];
  /** What the popover is, for assistive technology ("Details of …"). */
  label: string;
  /** Preferred side of the trigger; it goes above or below when the side has no room. */
  side?: 'left' | 'right';
  className?: string;
  children: ReactNode;
}

/**
 * The floating panel of `useHoverPopover`: full details of the trigger under the pointer
 * or focus, which the pointer can enter, scroll and click (a retry, a reload). Portalled
 * over everything and kept inside the window: beside its trigger when it fits, else above
 * or below, as tall as the room allows, scrolling the rest. It follows its trigger while
 * open and re-measures as its content loads.
 */
export function HoverPopover({
  popover,
  label,
  side = 'right',
  className,
  children,
}: HoverPopoverProps) {
  const { anchor, ref, id, ...handlers } = popover;
  const content = useRef<HTMLDivElement>(null);

  const place = useCallback(() => {
    const element = ref.current;
    if (!element || !anchor) return;
    const chrome = element.offsetHeight - element.clientHeight;
    const at = placeHoverPopover(
      anchor.getBoundingClientRect(),
      { width: element.offsetWidth, height: element.scrollHeight + chrome },
      { width: window.innerWidth, height: window.innerHeight },
      side,
    );
    element.style.maxHeight = `${Math.round(at.maxHeight)}px`;
    element.style.left = `${Math.round(at.left)}px`;
    element.style.top = `${Math.round(at.top)}px`;
    element.dataset.side = at.side;
  }, [anchor, ref, side]);

  useLayoutEffect(() => place());

  useEffect(() => {
    if (!anchor) return;
    window.addEventListener('resize', place);
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (content.current) observer?.observe(content.current);
    return () => {
      window.removeEventListener('resize', place);
      observer?.disconnect();
    };
  }, [anchor, place]);

  if (!anchor || typeof document === 'undefined') return null;
  // A non-modal `dialog`: it never takes focus or blocks the page around it.
  return createPortal(
    <dialog
      open
      ref={ref}
      id={id}
      aria-label={label}
      // Focusable, so a click on its text keeps it open and the keyboard can scroll it.
      tabIndex={-1}
      data-ui="hover-popover"
      className={cn(
        'fixed top-0 right-auto left-0 z-50 m-0 w-80 max-w-[calc(100vw-1rem)] animate-sprout overflow-y-auto overscroll-contain',
        'rounded-lg border border-line bg-shade/95 p-0 text-xs text-ink-2 shadow-3 outline-none',
        className,
      )}
      {...handlers}
    >
      <div ref={content} className="p-3">
        {children}
      </div>
    </dialog>,
    document.body,
  );
}
