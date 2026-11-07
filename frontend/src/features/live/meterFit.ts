import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Rows the meter grows to show before its list scrolls: a party's worth. */
export const METER_ROWS = 5;

/**
 * Marks the meter's scroll viewport (`[data-meter-viewport]`, the list or the room) and the
 * one element inside it that holds its content (`[data-meter-content]`) at its natural
 * height. Rows inside it are `[data-meter-row]`.
 */
const VIEWPORT = '[data-meter-viewport]';
const CONTENT = '[data-meter-content]';
const ROW = '[data-meter-row]';

/**
 * The height the meter wants to be, in CSS pixels as drawn (its scale included): its caption,
 * strips and footer as they are, and its viewport as tall as its content up to the top of the
 * sixth line of rows, so five lines show and the rest scroll. Rows side by side (a raid's
 * columns) are one line. Measured from rectangles only, so it holds whatever the window's
 * height is: a window too short for it never changes what it asks for. Without a viewport
 * (the compact strip) the meter wants its own height.
 */
export function meterHeight(root: HTMLElement) {
  const box = root.getBoundingClientRect();
  const viewport = root.querySelector<HTMLElement>(VIEWPORT);
  const content = viewport?.querySelector<HTMLElement>(CONTENT);
  if (!viewport || !content) return box.height;
  const inner = content.getBoundingClientRect();
  const lines = [
    ...new Set(
      [...content.querySelectorAll<HTMLElement>(ROW)].map((row) =>
        Math.round(row.getBoundingClientRect().top - inner.top),
      ),
    ),
  ].sort((a, b) => a - b);
  const wanted = Math.min(inner.height, lines[METER_ROWS] ?? inner.height);
  return box.height - viewport.getBoundingClientRect().height + wanted;
}

/**
 * Asks for the meter's height (`meterHeight`, rounded up) whenever it may have changed: after
 * every render (rows, strips, views, the scale) and whenever the meter, its viewport or its
 * content resizes (the window's width rewraps text, fonts load). Equal heights are asked for
 * once. `root` is whichever sheet the meter draws (fight, room or strip).
 */
export function useMeterFit(
  root: RefObject<HTMLElement | null>,
  onFit: ((height: number) => void) | undefined,
) {
  const sent = useRef<number | null>(null);
  const watched = useRef<{
    elements: Element[];
    observer: ResizeObserver;
  } | null>(null);
  const frame = useRef(0);
  const fit = useRef(onFit);
  useLayoutEffect(() => {
    fit.current = onFit;
    const measure = () => {
      frame.current = 0;
      const element = root.current;
      if (!element || !fit.current) return;
      const height = Math.ceil(meterHeight(element));
      if (height <= 0 || height === sent.current) return;
      sent.current = height;
      fit.current(height);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const element = root.current;
    const viewport = element?.querySelector(VIEWPORT);
    const elements = [element, viewport, viewport?.querySelector(CONTENT)].filter(
      (x): x is Element => x instanceof Element,
    );
    const same =
      watched.current?.elements.length === elements.length &&
      elements.every((x, i) => watched.current?.elements[i] === x);
    if (same) return;
    watched.current?.observer.disconnect();
    const observer = new ResizeObserver(() => {
      if (!frame.current) frame.current = requestAnimationFrame(measure);
    });
    for (const x of elements) observer.observe(x);
    watched.current = { elements, observer };
  });
  useEffect(
    () => () => {
      watched.current?.observer.disconnect();
      watched.current = null;
      if (frame.current) cancelAnimationFrame(frame.current);
    },
    [],
  );
}
