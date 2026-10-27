import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/companion';
import { HIT_SELECTOR, MAX_REGIONS, measureRegions, useHitRegions } from './useHitRegions';

vi.mock('../services/companion', () => ({
  setRowRegions: vi.fn<typeof api.setRowRegions>(),
}));

function box(left: number, top: number, width: number, height: number) {
  return { left, top, right: left + width, bottom: top + height, width, height } as DOMRect;
}
const place = (element: Element | null, rect: DOMRect) => {
  (element as HTMLElement).getBoundingClientRect = () => rect;
};

/**
 * A 360×300 meter: a toolbar button at the top, a footer button at the bottom and a
 * row list scrolled so that its first row is half above the list, its second fully
 * visible and its third below the list, over the footer.
 */
function layout(root: HTMLElement) {
  place(root, box(0, 0, 360, 300));
  place(root.querySelector('[data-hit="tool"]'), box(250, 30, 40, 18));
  place(root.querySelector('[data-hit-clip]'), box(6, 120, 348, 44));
  const [first, second, third] = root.querySelectorAll('[data-hit="row"]');
  place(first!, box(6, 110, 348, 21));
  place(second!, box(6, 133, 348, 21));
  place(third!, box(6, 270, 348, 21));
  place(root.querySelector('footer button'), box(280, 280, 70, 18));
  place(root.querySelector('button:disabled'), box(300, 30, 22, 18));
}

function Meter({ enabled }: { enabled: boolean }) {
  const root = useRef<HTMLElement>(null);
  useHitRegions(root, HIT_SELECTOR, enabled);
  return (
    <section
      ref={(element) => {
        root.current = element;
        if (element) layout(element);
      }}
    >
      <button type="button" data-hit="tool">
        History
      </button>
      <button type="button" data-hit disabled>
        New fight
      </button>
      <ol data-hit-clip>
        {['A', 'B', 'C'].map((name) => (
          <li key={name}>
            <button type="button" data-hit="row">
              {name}
            </button>
          </li>
        ))}
      </ol>
      <footer>
        <button type="button" data-hit>
          Full details
        </button>
      </footer>
    </section>
  );
}

beforeEach(() => {
  vi.mocked(api.setRowRegions).mockResolvedValue(2);
  Object.defineProperty(window, 'innerWidth', { value: 360, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 300, configurable: true });
  Object.defineProperty(window, 'devicePixelRatio', { value: 1.5, configurable: true });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('locked meter hit regions', () => {
  it('clips rows to their scroll viewport so scrolled rows never cover the footer', () => {
    const { container } = render(<Meter enabled={false} />);
    const root = container.querySelector('section')!;
    expect(measureRegions(root, HIT_SELECTOR, 1.5)).toEqual([
      // Controls come first: toolbar, then footer. The disabled button takes no clicks.
      [375, 45, 60, 27],
      [420, 420, 105, 27],
      // Rows: the first clipped to the top of the list, the second whole; the third,
      // scrolled below the list, is not registered over the footer.
      [9, 180, 522, 16],
      [9, 200, 522, 31],
    ]);
  });

  it('never registers more regions than native accepts', () => {
    const root = document.createElement('section');
    place(root, box(0, 0, 360, 300));
    for (let i = 0; i < MAX_REGIONS + 8; i++) {
      const row = document.createElement('button');
      row.dataset.hit = 'row';
      place(row, box(0, i * 6, 100, 5));
      root.append(row);
    }
    expect(measureRegions(root, HIT_SELECTOR, 1)).toHaveLength(MAX_REGIONS);
  });

  it('registers controls while enabled and clears them when disabled or unmounted', async () => {
    const view = render(<Meter enabled />);
    await vi.waitFor(() => expect(vi.mocked(api.setRowRegions).mock.lastCall?.[0]).toHaveLength(4));
    expect(vi.mocked(api.setRowRegions).mock.lastCall?.[1]).toBe(1.5);
    view.rerender(<Meter enabled={false} />);
    await vi.waitFor(() => expect(api.setRowRegions).toHaveBeenLastCalledWith([], 1.5));
    view.rerender(<Meter enabled />);
    await vi.waitFor(() => expect(vi.mocked(api.setRowRegions).mock.lastCall?.[0]).toHaveLength(4));
    view.unmount();
    await vi.waitFor(() => expect(api.setRowRegions).toHaveBeenLastCalledWith([], 1.5));
  });

  it('never registers anything while the meter is interactive', async () => {
    render(<Meter enabled={false} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.setRowRegions).not.toHaveBeenCalled();
  });
});
