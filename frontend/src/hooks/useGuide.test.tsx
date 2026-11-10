import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY } from '../features/onboarding/model';
import { useGuide } from './useGuide';

afterEach(() => localStorage.clear());

const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as unknown;

describe('useGuide', () => {
  it('opens by itself once on a first run, on the language, then remembers it was shown', async () => {
    const first = renderHook(() => useGuide({ savedFights: 0 }));
    expect(first.result.current.open).toBe(true);
    expect(first.result.current.progress?.chapter).toBe('language');
    await waitFor(() => expect(first.result.current.demo).not.toBeUndefined());
    act(() => first.result.current.close());
    first.unmount();
    expect(stored()).toMatchObject({ version: 2, chapter: 'language', decisions: {} });

    const again = renderHook(() => useGuide({ savedFights: 0 }));
    expect(again.result.current.open).toBe(false);
  });

  it('waits for the library and never interrupts someone with saved fights', () => {
    const { result, rerender } = renderHook(({ saved }) => useGuide({ savedFights: saved }), {
      initialProps: { saved: null as number | null },
    });
    expect(result.current.open).toBe(false);
    rerender({ saved: 12 });
    expect(result.current.open).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('keeps decisions across starts and resumes at the step left', () => {
    const { result, unmount } = renderHook(() => useGuide({ savedFights: 3 }));
    act(() => result.current.show());
    act(() => result.current.decide('language', 'done'));
    act(() => result.current.decide('capture', 'later'));
    act(() => result.current.goTo('alerts'));
    act(() => result.current.close());
    unmount();
    expect(stored()).toMatchObject({
      chapter: 'alerts',
      decisions: { language: 'done', capture: 'later' },
      finished: false,
    });

    const later = renderHook(() => useGuide({ savedFights: 3 }));
    act(() => later.result.current.show());
    expect(later.result.current.progress).toMatchObject({
      chapter: 'alerts',
      decisions: { language: 'done', capture: 'later' },
    });
  });

  it('shows a guide kept from before the language step its language once, losing nothing', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, chapter: 'pets', seen: ['capture', 'meter'], finished: false }),
    );
    const { result } = renderHook(() => useGuide({ savedFights: 0 }));
    // Stored progress never opens by itself.
    expect(result.current.open).toBe(false);
    act(() => result.current.show());
    expect(result.current.progress).toMatchObject({
      chapter: 'language',
      seen: ['language', 'capture', 'meter', 'pets'],
    });
    act(() => result.current.decide('language', 'done'));
    act(() => result.current.close());
    act(() => result.current.goTo('pets'));
    act(() => result.current.show());
    expect(result.current.progress?.chapter).toBe('pets');
  });

  it('never reopens a guide finished before by itself', () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, chapter: 'updates', seen: [], finished: true, quiet: true }),
    );
    const { result } = renderHook(() => useGuide({ savedFights: 0 }));
    expect(result.current.open).toBe(false);
    expect(result.current.progress).toMatchObject({ finished: true, chapter: 'updates' });
  });

  it('finishes, and Not now puts the offer away without starting', () => {
    const { result } = renderHook(() => useGuide({ savedFights: 3 }));
    act(() => result.current.quiet());
    expect(result.current.progress).toMatchObject({ quiet: true, seen: [] });
    act(() => result.current.show('review'));
    act(() => result.current.done());
    expect(result.current.open).toBe(false);
    expect(stored()).toMatchObject({ finished: true, chapter: 'review' });
  });

  it('ignores a Finish that arrives after the reader left the review', () => {
    const { result } = renderHook(() => useGuide({ savedFights: 3 }));
    act(() => result.current.show('review'));
    const late = result.current.done;
    act(() => result.current.goTo('alerts'));
    act(() => late());
    act(() => result.current.done());
    expect(result.current.open).toBe(true);
    expect(result.current.progress).toMatchObject({ finished: false, chapter: 'alerts' });
    act(() => result.current.close());
    act(() => result.current.goTo('review'));
    act(() => result.current.done());
    expect(result.current.progress?.finished).toBe(false);
  });
});
