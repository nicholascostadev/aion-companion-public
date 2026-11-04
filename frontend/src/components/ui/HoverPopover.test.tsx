import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { HoverPopover, placeHoverPopover, useHoverPopover } from './HoverPopover';

const card = { width: 320, height: 1200 };
const inside = (
  at: ReturnType<typeof placeHoverPopover>,
  view: { width: number; height: number },
  height: number,
) => {
  const shown = Math.min(height, at.maxHeight);
  expect(at.left).toBeGreaterThanOrEqual(8);
  expect(at.left + card.width).toBeLessThanOrEqual(view.width - 8);
  expect(at.top).toBeGreaterThanOrEqual(8);
  expect(at.top + shown).toBeLessThanOrEqual(view.height - 8);
};

describe('hover popover placement', () => {
  it('sits beside a slot in the wide window, as tall as the window, scrolling the rest', () => {
    const view = { width: 760, height: 640 };
    const slot = { left: 12, top: 300, width: 200, height: 40 };
    const at = placeHoverPopover(slot, card, view);
    expect(at.side).toBe('right');
    expect(at.left).toBe(220);
    expect(at.maxHeight).toBe(624);
    inside(at, view, card.height);
    // A slot in the right column opens it on the left.
    const right = placeHoverPopover({ ...slot, left: 540 }, card, view);
    expect(right.side).toBe('left');
    inside(right, view, card.height);
  });

  it('goes above or below a full-width slot in the narrowest window, never over it', () => {
    const view = { width: 400, height: 340 };
    const low = { left: 12, top: 240, width: 376, height: 40 };
    const above = placeHoverPopover(low, card, view);
    expect(above.side).toBe('top');
    expect(above.maxHeight).toBe(low.top - 16);
    expect(above.top + Math.min(card.height, above.maxHeight)).toBeLessThanOrEqual(low.top - 8);
    inside(above, view, card.height);
    const high = { ...low, top: 60 };
    const below = placeHoverPopover(high, card, view);
    expect(below.side).toBe('bottom');
    expect(below.top).toBe(high.top + high.height + 8);
    inside(below, view, card.height);
    // A short detail is never stretched.
    expect(placeHoverPopover(high, { width: 320, height: 120 }, view).top).toBe(108);
  });

  it('covers the window when neither side has room, still inside it', () => {
    const view = { width: 400, height: 340 };
    const middle = { left: 12, top: 150, width: 376, height: 40 };
    const at = placeHoverPopover(middle, card, view);
    expect(at.side).toBe('over');
    expect(at.maxHeight).toBe(324);
    inside(at, view, card.height);
  });
});

describe('hover popover on scroll', () => {
  afterEach(cleanup);

  // jsdom lays nothing out and never scrolls a focused element into view: the list and
  // its trigger report the boxes a browser would, before and after its automatic scroll.
  type Box = { left: number; top: number; width: number; height: number };
  const box = (top: number): Box => ({ left: 0, top, width: 200, height: 40 });
  const rect = ({ left, top, width, height }: Box) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  function List() {
    const { trigger, popover } = useHoverPopover({ delay: 0 });
    return (
      <div data-testid="list">
        <button type="button" {...trigger('slot')}>
          Slot
        </button>
        <HoverPopover popover={popover} label="Details of Slot">
          Detail
        </HoverPopover>
      </div>
    );
  }
  const mount = () => {
    render(<List />);
    const list = screen.getByTestId('list');
    const slot = screen.getByRole('button', { name: 'Slot' });
    list.getBoundingClientRect = () => rect({ ...box(0), height: 600 });
    let at = box(900);
    slot.getBoundingClientRect = () => rect(at);
    return { list, slot, move: (top: number) => (at = box(top)) };
  };
  const dialog = () => screen.queryByRole('dialog', { name: 'Details of Slot' });

  it('stays open beside a focused trigger its list scrolls into view, and follows it', () => {
    const { list, slot, move } = mount();
    act(() => slot.focus());
    expect(dialog()).not.toBeNull();
    // The browser scrolls the focused trigger into view on the next frame.
    move(300);
    fireEvent.scroll(list);
    // An empty detail centres on the trigger, beside it.
    expect(dialog()?.style.top).toBe('320px');
    expect(dialog()?.style.left).toBe('208px');
    move(500);
    fireEvent.scroll(list);
    expect(dialog()?.style.top).toBe('520px');
    // Scrolled out of the list, it closes, though its trigger keeps focus.
    move(700);
    fireEvent.scroll(list);
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(slot);
  });

  it('closes a hovered popover when the page outside it scrolls', () => {
    const { list, slot, move } = mount();
    move(300);
    fireEvent.pointerEnter(slot, { pointerType: 'mouse' });
    expect(dialog()).not.toBeNull();
    fireEvent.scroll(list);
    expect(dialog()).toBeNull();
  });

  it('stays open while its own content scrolls', () => {
    const { slot, move } = mount();
    move(300);
    fireEvent.pointerEnter(slot, { pointerType: 'mouse' });
    fireEvent.scroll(dialog()!);
    expect(dialog()).not.toBeNull();
  });
});
