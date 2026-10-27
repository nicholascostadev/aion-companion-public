import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_FINDER_PREFERENCES, type FinderPreferences } from '../types/finderPreferences';
import { useFinderPreferences } from './useFinderPreferences';

const native = vi.hoisted(() => ({
  read: vi.fn<() => Promise<FinderPreferences>>(),
  update: vi.fn<(patch: unknown) => Promise<FinderPreferences>>(),
  emit: (_prefs: FinderPreferences) => undefined as void,
  listening: 0,
}));
vi.mock('../services/finderPreferences', () => ({
  nativeFinderBackend: {
    read: () => native.read(),
    update: (patch: unknown) => native.update(patch),
    subscribe: (handler: (prefs: FinderPreferences) => void) => {
      native.emit = handler;
      native.listening++;
      return Promise.resolve(() => {
        native.listening--;
      });
    },
  },
}));

const saved = (over: Partial<FinderPreferences> = {}): FinderPreferences => ({
  ...DEFAULT_FINDER_PREFERENCES,
  revision: 1,
  ...over,
});

const setVisibility = (state: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  native.read.mockResolvedValue(saved({ visibility: { cubes: false, gathering: true } }));
  native.update.mockImplementation(() => Promise.resolve(saved({ revision: 2 })));
  native.listening = 0;
});
afterEach(() => {
  cleanup();
  setVisibility('visible');
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('saved Explore choices in a window', () => {
  it('reads once, then follows change events from other windows without polling', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { result } = renderHook(() => useFinderPreferences(true));
    expect(result.current.phase).toBe('loading');
    expect(result.current.prefs).toBeNull();
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    expect(result.current.prefs?.visibility).toEqual({ cubes: false, gathering: true });
    expect(native.listening).toBe(1);
    act(() => native.emit(saved({ revision: 5, chosen_map: 'World/World_D/World_D_A' })));
    expect(result.current.prefs?.chosen_map).toBe('World/World_D/World_D_A');
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(native.read).toHaveBeenCalledOnce();
  });

  it('reads again as the hidden window shows, in case it slept through an event', async () => {
    const { result } = renderHook(() => useFinderPreferences(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    act(() => setVisibility('hidden'));
    native.read.mockResolvedValue(
      saved({ revision: 9, visibility: { cubes: true, gathering: false } }),
    );
    act(() => setVisibility('visible'));
    await waitFor(() => expect(result.current.prefs?.revision).toBe(9));
    expect(native.read).toHaveBeenCalledTimes(2);
  });

  it('stops listening when its window part goes away', async () => {
    const { result, unmount } = renderHook(() => useFinderPreferences(true));
    await waitFor(() => expect(result.current.phase).toBe('ready'));
    unmount();
    expect(native.listening).toBe(0);
  });

  it('keeps choices in the window only without the desktop app, every layer shown', () => {
    const { result } = renderHook(() => useFinderPreferences(false));
    expect(result.current.phase).toBe('ready');
    expect(result.current.prefs).toEqual(DEFAULT_FINDER_PREFERENCES);
    act(() => result.current.update({ visibility: { cubes: false } }));
    expect(result.current.prefs?.visibility.cubes).toBe(false);
    expect(native.read).not.toHaveBeenCalled();
    expect(native.update).not.toHaveBeenCalled();
  });
});
