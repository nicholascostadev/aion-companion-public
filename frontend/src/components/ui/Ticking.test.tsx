import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Ticking } from './Ticking';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Ticking', () => {
  it('re-renders only its own figures, on one shared timer that stops when unused', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(10_000);
    const rendered = vi.fn<() => void>();
    function Page() {
      rendered();
      return (
        <>
          <Ticking>{(now) => <span data-testid="a">{Math.round(now / 1000)}</span>}</Ticking>
          <Ticking offset={60_000}>
            {(now) => <span data-testid="b">{Math.round(now / 1000)}</span>}
          </Ticking>
        </>
      );
    }
    const { unmount } = render(<Page />);
    expect(screen.getByTestId('a').textContent).toBe('10');
    expect(screen.getByTestId('b').textContent).toBe('70');
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByTestId('a').textContent).toBe('13');
    expect(screen.getByTestId('b').textContent).toBe('73');
    expect(rendered).toHaveBeenCalledOnce();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
