import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALTGARD, atlasMap, RESHANTA, VERTERON } from '../features/maps/atlas';
import { MapArtProvider, useMapArtDelivery } from '../features/maps/mapArt';
import * as api from '../services/mapArt';
import type { MapArtPhase, MapArtStatus } from '../types/mapArt';
import type { PetMapArt } from '../types/pets';
import { MAP_ART_POLL_MS, nativeMapArt, resetMapArtStore } from './mapArtStore';

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: vi.fn<() => Promise<unknown>>(),
  convertFileSrc: (file: string, protocol: string) => `http://${protocol}.localhost/${file}`,
}));
vi.mock('../services/mapArt', async (importActual) => ({
  ...(await importActual<typeof api>()),
  readMapArtStatus: vi.fn<typeof api.readMapArtStatus>(),
  ensureMapArt: vi.fn<typeof api.ensureMapArt>(),
}));

const verteron = atlasMap(VERTERON)!.art;
const altgard = atlasMap(ALTGARD)!.art;
const status = (map_id: string, phase: MapArtPhase, done = 0, total = 0): MapArtStatus => ({
  map_id,
  phase,
  downloaded_bytes: done,
  total_bytes: total,
  error: phase === 'error' ? 'network unreachable' : null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const step = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const wrapper = ({ children }: { children: ReactNode }) => (
  <MapArtProvider value={nativeMapArt}>{children}</MapArtProvider>
);
const render = (art: PetMapArt | null, shown = true) =>
  renderHook(({ art, shown }) => useMapArtDelivery(art, shown), {
    initialProps: { art, shown },
    wrapper,
  });

beforeEach(() => {
  vi.useFakeTimers();
  resetMapArtStore();
  vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'downloading', 0, 100));
  vi.mocked(api.readMapArtStatus).mockImplementation(async (id) => status(id, 'ready', 100, 100));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('map art ownership and URLs', () => {
  it('fetches an instance layer through the map that owns its art, and nothing unknown', () => {
    expect(api.mapArtOwner(verteron)).toBe(VERTERON);
    expect(api.mapArtOwner(atlasMap(RESHANTA)!.art)).toBe(RESHANTA);
    expect(api.mapArtOwner(null)).toBeNull();
    const unknown = {
      ...verteron,
      tiles: [{ ...verteron.tiles[0]!, file: '/pet-map-art/x.webp' }],
    };
    expect(api.mapArtOwner(unknown)).toBeNull();
    // Files of two maps never pass as one map's art.
    expect(api.mapArtOwner({ ...verteron, overview: altgard.overview })).toBeNull();
  });

  it('serves a delivered file by its hash name over the map-art protocol, never a path', () => {
    const file = verteron.tiles[0]!.file;
    expect(api.mapArtUrl(file)).toBe(
      `http://map-art.localhost/${file.slice('/pet-map-art/'.length)}`,
    );
    expect(api.mapArtUrl('/pet-map-art/../secret.webp')).toBe('/pet-map-art/../secret.webp');
  });
});

describe('native map art store', () => {
  it('ensures once when first shown, follows the download and polls rarely once ready', async () => {
    let done = 0;
    vi.mocked(api.readMapArtStatus).mockImplementation(async (id) =>
      (done += 50) >= 100 ? status(id, 'ready', 100, 100) : status(id, 'downloading', done, 100),
    );
    const { result } = render(verteron);
    expect(result.current).toMatchObject({ ready: false, phase: 'checking' });
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledExactlyOnceWith(VERTERON);
    expect(result.current).toMatchObject({ phase: 'downloading', progress: 0 });
    await step(MAP_ART_POLL_MS.downloading);
    expect(result.current.progress).toBe(0.5);
    await step(MAP_ART_POLL_MS.downloading);
    expect(result.current).toMatchObject({ ready: true, phase: 'ready', progress: null });
    const reads = vi.mocked(api.readMapArtStatus).mock.calls.length;
    await step(MAP_ART_POLL_MS.ready - 1);
    expect(api.readMapArtStatus).toHaveBeenCalledTimes(reads);
    await step(1);
    expect(api.readMapArtStatus).toHaveBeenCalledTimes(reads + 1);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
  });

  it('never starts anything while hidden or without art, and stops when hidden', async () => {
    const { rerender } = render(verteron, false);
    await step(5000);
    expect(api.ensureMapArt).not.toHaveBeenCalled();
    expect(api.readMapArtStatus).not.toHaveBeenCalled();
    rerender({ art: verteron, shown: true });
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
    rerender({ art: verteron, shown: false });
    await step(60_000);
    expect(api.readMapArtStatus).not.toHaveBeenCalled();
    const none = render(null);
    await step(1000);
    expect(none.result.current).toMatchObject({ ready: false, phase: null });
  });

  it('shares one schedule and one ensure between views of the same map', async () => {
    render(verteron);
    render(verteron);
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
    await step(MAP_ART_POLL_MS.downloading);
    expect(api.readMapArtStatus).toHaveBeenCalledOnce();
  });

  it('keeps a slow ensure from overwriting a newer status, and a map switch from mixing maps', async () => {
    const slow = deferred<MapArtStatus>();
    vi.mocked(api.ensureMapArt).mockReturnValueOnce(slow.promise);
    const { result, rerender } = render(verteron);
    await step(0);
    act(() => result.current.retry());
    await step(0);
    expect(result.current.phase).toBe('downloading');
    rerender({ art: altgard, shown: true });
    await step(0);
    expect(api.ensureMapArt).toHaveBeenLastCalledWith(ALTGARD);
    await act(async () => slow.resolve(status(VERTERON, 'missing')));
    expect(result.current.phase).toBe('downloading');
  });

  it('shows a failure, retries on request and draws once ready', async () => {
    vi.mocked(api.ensureMapArt).mockImplementationOnce(async (id) => status(id, 'error'));
    const { result } = render(verteron);
    await step(0);
    expect(result.current).toMatchObject({ phase: 'error', error: 'network unreachable' });
    vi.mocked(api.readMapArtStatus).mockImplementation(async (id) => status(id, 'error'));
    await step(MAP_ART_POLL_MS.error);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
    vi.mocked(api.readMapArtStatus).mockImplementation(async (id) => status(id, 'ready', 9, 9));
    act(() => result.current.retry());
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(2);
    await step(MAP_ART_POLL_MS.downloading);
    expect(result.current.ready).toBe(true);
  });

  it('reads a failed command as a failure with its reason', async () => {
    vi.mocked(api.ensureMapArt).mockRejectedValueOnce(new Error('command map_art_ensure failed'));
    const { result } = render(verteron);
    await step(0);
    expect(result.current).toMatchObject({ ready: false, phase: 'error' });
    expect(result.current.error).toContain('map_art_ensure');
  });

  it('turns images that keep failing on a ready map into a visible failure until Retry', async () => {
    vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'ready', 9, 9));
    const { result } = render(verteron);
    await step(0);
    expect(result.current.ready).toBe(true);
    const first = result.current.revision;
    for (let i = 1; i <= 2; i++) {
      act(() => result.current.failed());
      await step(0);
      expect(result.current).toMatchObject({ ready: true, revision: first + i });
    }
    act(() => result.current.failed());
    await step(0);
    expect(result.current).toMatchObject({ ready: false, phase: 'error' });
    // Polls still saying ready keep it failed here.
    await step(MAP_ART_POLL_MS.error);
    expect(result.current.ready).toBe(false);
    act(() => result.current.retry());
    await step(0);
    expect(result.current.ready).toBe(true);
    // The bounded image retries start over after Retry.
    act(() => result.current.failed());
    await step(0);
    expect(result.current.ready).toBe(true);
  });

  it('never starts a download from a stale Retry once hidden or unmounted', async () => {
    vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'error'));
    const { result, rerender, unmount } = render(verteron);
    await step(0);
    const retry = result.current.retry;
    rerender({ art: verteron, shown: false });
    act(() => retry());
    unmount();
    act(() => retry());
    await step(10_000);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
  });

  it('fetches art that went missing while shown again, once each time it is lost', async () => {
    vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'ready', 9, 9));
    const { rerender } = render(verteron);
    await step(0);
    vi.mocked(api.readMapArtStatus).mockImplementation(async (id) => status(id, 'missing'));
    vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'missing'));
    await step(MAP_ART_POLL_MS.ready);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(2);
    await step(MAP_ART_POLL_MS.missing * 5);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(2);
    rerender({ art: verteron, shown: false });
    rerender({ art: verteron, shown: true });
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(3);
  });

  it('reads nothing while the page is hidden and wakes when it shows again', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get');
    render(verteron);
    await step(0);
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    const reads = vi.mocked(api.readMapArtStatus).mock.calls.length;
    await step(60_000);
    expect(api.readMapArtStatus).toHaveBeenCalledTimes(reads);
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(2);
    state.mockRestore();
  });

  it('never starts a download from a hidden page: a late reply, Retry or a failed image', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get');
    vi.mocked(api.ensureMapArt).mockImplementation(async (id) => status(id, 'ready', 9, 9));
    const { result } = render(verteron);
    await step(0);
    // A status read in flight when the page hides answers that the art went missing.
    const late = deferred<MapArtStatus>();
    vi.mocked(api.readMapArtStatus).mockReturnValueOnce(late.promise);
    await step(MAP_ART_POLL_MS.ready);
    state.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    await act(async () => late.resolve(status(VERTERON, 'missing')));
    act(() => result.current.retry());
    act(() => result.current.failed());
    await step(60_000);
    expect(api.ensureMapArt).toHaveBeenCalledOnce();
    expect(api.readMapArtStatus).toHaveBeenCalledOnce();
    // Shown again, the missing art is ensured.
    state.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await step(0);
    expect(api.ensureMapArt).toHaveBeenCalledTimes(2);
    state.mockRestore();
  });

  it('draws at once and asks nothing without the desktop app', async () => {
    const { result } = renderHook(() => useMapArtDelivery(verteron, true));
    await step(1000);
    expect(result.current).toMatchObject({ ready: true, phase: null });
    expect(result.current.src(verteron.tiles[0]!.file)).toBe(verteron.tiles[0]!.file);
    expect(api.ensureMapArt).not.toHaveBeenCalled();
  });
});
