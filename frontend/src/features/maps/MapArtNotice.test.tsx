import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapArtSnapshot, MapArtSource } from '../../types/mapArt';
import { atlasMap, VERTERON, type AtlasMap } from './atlas';
import { MapArtProvider } from './mapArt';
import { WorldMap } from './WorldMap';

const map = atlasMap(VERTERON) as AtlasMap;

/** A source the test drives by hand, like the app's store would. */
function fakeSource(initial: Partial<MapArtSnapshot>) {
  let snapshot: MapArtSnapshot = {
    phase: null,
    downloaded: 0,
    total: 0,
    error: null,
    revision: 0,
    ...initial,
  };
  const listeners = new Set<() => void>();
  const source = {
    fetches: true,
    owner: (art) => (art === map.art ? VERTERON : null),
    subscribe: (_id: string, onChange: () => void) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    snapshot: () => snapshot,
    watch: vi.fn<MapArtSource['watch']>(() => () => undefined),
    retry: vi.fn<MapArtSource['retry']>(),
    failed: vi.fn<MapArtSource['failed']>(),
    src: (file: string) => `http://map-art.localhost/${file.slice('/pet-map-art/'.length)}`,
  } satisfies MapArtSource;
  const set = (next: Partial<MapArtSnapshot>) =>
    act(() => {
      snapshot = { ...snapshot, ...next };
      for (const listener of listeners) listener();
    });
  return { source, set };
}
const show = (source: MapArtSource, drawArt = true) =>
  render(
    <MapArtProvider value={source}>
      <WorldMap map={map} marks={[]} player={{ x: 0, y: 0 }} title="Verteron" drawArt={drawArt} />
    </MapArtProvider>,
  );

afterEach(cleanup);

describe('map art delivery on a map', () => {
  it('draws the chart and the download state, then the art from the map-art protocol', () => {
    const { source, set } = fakeSource({ phase: 'downloading', downloaded: 25, total: 100 });
    const { container } = show(source);
    const frame = container.querySelector<HTMLElement>('.world-map')!;
    expect(source.watch).toHaveBeenCalledWith(VERTERON);
    expect(frame.dataset.ground).toBe('chart');
    expect(container.querySelector('[data-chart="graticule"]')).not.toBeNull();
    expect(container.querySelector('image')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Downloading map art');
    expect(screen.getByText('25%')).toBeTruthy();
    set({ phase: 'ready', downloaded: 100 });
    expect(frame.dataset.ground).toBe('sheet');
    expect(container.querySelector('[data-map-art]')).toBeNull();
    const image = container.querySelector('image')!;
    expect(image.getAttribute('href')).toMatch(/^http:\/\/map-art\.localhost\/[a-f0-9]{20}\.webp$/);
    // A failed image is reported, so a corrupted cache shows its state.
    fireEvent.error(image);
    expect(source.failed).toHaveBeenCalledWith(VERTERON);
  });

  it('offers Retry after a failure, with the reason on hover, and never shows a broken image', () => {
    const { source } = fakeSource({ phase: 'error', error: 'GitHub could not be reached' });
    const { container } = show(source);
    expect(container.querySelector('image')).toBeNull();
    expect(screen.getByRole('status').getAttribute('title')).toBe('GitHub could not be reached');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.retry).toHaveBeenCalledWith(VERTERON);
  });

  it('offers Download when native has not started one', () => {
    const { source } = fakeSource({ phase: 'missing' });
    show(source);
    expect(screen.getByRole('status').textContent).toBe('Map art not downloaded');
    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(source.retry).toHaveBeenCalledOnce();
  });

  it('asks for nothing while the map is off screen', () => {
    const { source } = fakeSource({});
    const { container } = show(source, false);
    expect(source.watch).not.toHaveBeenCalled();
    expect(container.querySelector('[data-map-art]')).toBeNull();
  });
});
