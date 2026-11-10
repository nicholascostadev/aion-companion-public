import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GuideOffer } from './GuideOffer';
import { begin, decide, visit } from './model';

afterEach(cleanup);

it('names the step Resume opens on: Language until one is chosen, then where it was left', () => {
  const onOpen = vi.fn<() => void>();
  const onQuiet = vi.fn<() => void>();
  // Left on the DPS meter without a language: Resume opens Language, and the band says so.
  const left = visit(begin(null), 'meter');
  const { rerender } = render(<GuideOffer progress={left} onOpen={onOpen} onQuiet={onQuiet} />);
  expect(screen.getByText(/Continue at Language, step 1 of 10/)).toBeTruthy();
  const chosen = visit(decide(left, 'language', 'done'), 'meter');
  rerender(<GuideOffer progress={chosen} onOpen={onOpen} onQuiet={onQuiet} />);
  expect(screen.getByText(/Continue at DPS meter, step 3 of 10/)).toBeTruthy();
});
