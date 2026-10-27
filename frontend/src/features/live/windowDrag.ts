import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/** Pointer travel, in CSS pixels, that turns a press into a window move instead of a click. */
export const DRAG_THRESHOLD = 4;
/**
 * Presses on these always stay clicks. Table rows (`data-hit="row"`) are buttons too, but
 * moving the pointer past the threshold on a row drags the window instead of opening it.
 */
const CONTROLS =
  'button:not([data-hit="row"]), a, input, select, textarea, [role="menu"], [role^="menuitem"]';

/** True when the press lands on the scrollbar of a scrolling element. */
function onScrollbar(target: Element, x: number, y: number) {
  if (!(target instanceof HTMLElement)) return false;
  const box = target.getBoundingClientRect();
  const vertical =
    target.scrollHeight > target.clientHeight &&
    x >= box.left + target.clientLeft + target.clientWidth;
  const horizontal =
    target.scrollWidth > target.clientWidth &&
    y >= box.top + target.clientTop + target.clientHeight;
  return vertical || horizontal;
}

/**
 * Moves the window from anywhere on a panel. A left press outside controls becomes a
 * native window move once the pointer travels `DRAG_THRESHOLD` pixels; a press that
 * stays put remains an ordinary click, and the click that ends a move never reaches the
 * element under the pointer. Without `onDrag` (e.g. a locked panel) nothing is attached.
 */
export function useWindowDrag(onDrag: (() => void) | undefined) {
  const dragged = useRef(false);
  const release = useRef<(() => void) | null>(null);
  useEffect(() => () => release.current?.(), []);
  if (!onDrag) return {};

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    release.current?.();
    dragged.current = false;
    const target = event.target instanceof Element ? event.target : null;
    if (event.button !== 0 || !event.isPrimary || !target) return;
    if (target.closest(CONTROLS) || onScrollbar(target, event.clientX, event.clientY)) return;
    const { pointerId, clientX, clientY } = event;
    const move = (next: globalThis.PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      // The button came up unseen (e.g. released outside the page): no drag.
      if ((next.buttons & 1) === 0) return end();
      if (Math.hypot(next.clientX - clientX, next.clientY - clientY) < DRAG_THRESHOLD) return;
      end();
      dragged.current = true;
      onDrag();
    };
    const end = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      window.removeEventListener('blur', end);
      release.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', end);
    release.current = end;
  };

  // Swallows the click that may follow a move; keyboard clicks (detail 0) always pass.
  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!dragged.current) return;
    dragged.current = false;
    if (event.detail === 0) return;
    event.preventDefault();
    event.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}
