import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HoverCard, placeHoverCard, useHoverCard } from './HoverCard';

afterEach(cleanup);

describe('hover card placement', () => {
  const view = { width: 800, height: 600 };
  const card = { width: 200, height: 120 };
  const at = (left: number, top: number) => ({ left, top, width: 10, height: 10 });

  it('sits centred above its anchor when there is room', () => {
    expect(placeHoverCard(at(395, 300), card, view)).toEqual({
      side: 'top',
      left: 300,
      top: 172,
      tip: 100,
    });
  });

  it('flips below an anchor near the top edge', () => {
    const placed = placeHoverCard(at(395, 40), card, view);
    expect(placed.side).toBe('bottom');
    expect(placed.top).toBe(58);
  });

  it('shifts along its side to stay in the window, the tip still on the anchor', () => {
    const left = placeHoverCard(at(2, 300), card, view);
    expect(left).toMatchObject({ side: 'top', left: 8, tip: -1 });
    const right = placeHoverCard(at(788, 300), card, view);
    expect(right).toMatchObject({ side: 'top', left: 592, tip: 201 });
  });

  it('goes beside the anchor when neither above nor below has room', () => {
    const placed = placeHoverCard(at(100, 110), card, { width: 800, height: 250 });
    expect(placed.side).toBe('right');
    expect(placed.left).toBe(118);
    expect(placed.top).toBeGreaterThanOrEqual(8);
    expect(placed.top + card.height).toBeLessThanOrEqual(242);
  });
});

function Marks({ onSelect = () => undefined }: { onSelect?: (key: string) => void }) {
  const hover = useHoverCard();
  return (
    <div>
      {['a', 'b'].map((key) => (
        // A plain button stands in for a focusable SVG mark.
        <button
          key={key}
          type="button"
          aria-label={`Mark ${key}`}
          onClick={() => onSelect(key)}
          {...hover.trigger(key)}
        />
      ))}
      <HoverCard id={hover.id} anchor={hover.shown?.anchor ?? null}>
        Details of {hover.shown?.key}
      </HoverCard>
    </div>
  );
}

const mark = (key: string) => screen.getByRole('button', { name: `Mark ${key}` });
const card = () => screen.queryByRole('tooltip');

describe('hover card', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('opens after a short rest of the pointer and describes its trigger', () => {
    render(<Marks />);
    fireEvent.pointerEnter(mark('a'), { pointerType: 'mouse' });
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(130);
    });
    const tip = card()!;
    expect(tip.textContent).toBe('Details of a');
    expect(tip.getAttribute('data-ui')).toBe('hover-card');
    expect(tip.className).toContain('pointer-events-none');
    // Rendered over everything, in a portal.
    expect(tip.parentElement).toBe(document.body);
    expect(mark('a').getAttribute('aria-describedby')).toBe(tip.id);
    expect(mark('b').getAttribute('aria-describedby')).toBeNull();
  });

  it('never opens for a pointer that only passes by', () => {
    render(<Marks />);
    fireEvent.pointerEnter(mark('a'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(60);
    });
    fireEvent.pointerLeave(mark('a'));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(card()).toBeNull();
  });

  it('swaps to a neighbour at once, without closing in between', () => {
    render(<Marks />);
    fireEvent.pointerEnter(mark('a'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(130);
    });
    const tip = card();
    fireEvent.pointerLeave(mark('a'));
    fireEvent.pointerEnter(mark('b'), { pointerType: 'mouse' });
    expect(card()).toBe(tip);
    expect(card()!.textContent).toBe('Details of b');
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(card()!.textContent).toBe('Details of b');
  });

  it('lingers briefly after the pointer leaves, then closes', () => {
    render(<Marks />);
    fireEvent.pointerEnter(mark('a'), { pointerType: 'mouse' });
    act(() => {
      vi.advanceTimersByTime(130);
    });
    fireEvent.pointerLeave(mark('a'));
    expect(card()).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(card()).toBeNull();
  });

  it('opens at once on focus, closes on blur, and Escape dismisses it', () => {
    render(<Marks />);
    act(() => {
      mark('b').focus();
    });
    expect(card()!.textContent).toBe('Details of b');
    fireEvent.keyDown(mark('b'), { key: 'Escape' });
    expect(card()).toBeNull();
    // Still focused, it stays dismissed until focus moves on.
    expect(document.activeElement).toBe(mark('b'));
    act(() => {
      mark('a').focus();
    });
    expect(card()!.textContent).toBe('Details of a');
    act(() => {
      mark('a').blur();
    });
    expect(card()).toBeNull();
  });

  it('never opens for touch, where a tap is a click', () => {
    const onSelect = vi.fn<(key: string) => void>();
    render(<Marks onSelect={onSelect} />);
    fireEvent.pointerEnter(mark('a'), { pointerType: 'touch' });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(card()).toBeNull();
    fireEvent.click(mark('a'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });
});
