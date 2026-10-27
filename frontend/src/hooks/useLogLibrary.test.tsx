import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as api from '../services/offline';
import type { CombatReport, LogMeta } from '../types/offline';
import { useLogLibrary } from './useLogLibrary';
import { HIDDEN_RELEASE_MS } from './useRecentlyShown';

vi.mock('../services/offline', () => ({
  listLogs: vi.fn<typeof api.listLogs>(),
  readLog: vi.fn<typeof api.readLog>(),
  deleteLogs: vi.fn<typeof api.deleteLogs>(),
  exportLog: vi.fn<typeof api.exportLog>(),
  renameLog: vi.fn<typeof api.renameLog>(),
}));

const meta = (id: string): LogMeta => ({
  id,
  label: null,
  started_ms: 1,
  duration_ms: 60_000,
  damage: 1,
  dps: 1,
  players: 1,
  player_names: [],
  boss: null,
  zone_id: null,
  run_id: null,
  end_reason: null,
});
const report = (id: string, label: string | null = null) =>
  ({ id, label, detail_level: 'full', events: [] }) as unknown as CombatReport;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Lets resolved native answers land. */
const settle = () => act(async () => {});

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(api.listLogs).mockResolvedValue([meta('a'), meta('b')]);
  vi.mocked(api.readLog).mockImplementation((id) => Promise.resolve(report(id)));
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

const mount = () =>
  renderHook(({ shown }) => useLogLibrary(true, 2, { shown }), { initialProps: { shown: true } });

describe('useLogLibrary report lifetime', () => {
  it('lets an opened report go while away and reads it again, keeping every choice', async () => {
    const view = mount();
    await settle();
    act(() => view.result.current.setFilters({ ...view.result.current.filters, search: 'boss' }));
    act(() => view.result.current.setSelected(['a', 'b']));
    await act(() => view.result.current.open('a'));
    expect(view.result.current.report?.id).toBe('a');

    view.rerender({ shown: false });
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS - 1));
    expect(view.result.current.report?.id).toBe('a');
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(view.result.current.report).toBeNull();
    expect(view.result.current.activeId).toBe('a');
    expect(view.result.current.reportLoading).toBe(false);
    expect(view.result.current.filters.search).toBe('boss');
    expect(view.result.current.selected).toEqual(['a', 'b']);
    expect(api.readLog).toHaveBeenCalledTimes(1);

    view.rerender({ shown: true });
    await settle();
    expect(api.readLog).toHaveBeenCalledTimes(2);
    expect(api.readLog).toHaveBeenLastCalledWith('a');
    expect(view.result.current.report?.id).toBe('a');
    expect(view.result.current.activeId).toBe('a');
  });

  it('keeps the report through a quick tab switch without reading it again', async () => {
    const view = mount();
    await settle();
    await act(() => view.result.current.open('a'));
    const shown = view.result.current.report;

    view.rerender({ shown: false });
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS / 2));
    view.rerender({ shown: true });
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS));
    expect(view.result.current.report).toBe(shown);
    expect(api.readLog).toHaveBeenCalledTimes(1);
  });

  it('drops a read still in flight when released and reads the log again on return', async () => {
    const slow = deferred<CombatReport>();
    vi.mocked(api.readLog).mockReturnValueOnce(slow.promise);
    const view = mount();
    await settle();
    let opening: Promise<void> = Promise.resolve();
    act(() => {
      opening = view.result.current.open('a');
    });
    expect(view.result.current.reportLoading).toBe(true);

    view.rerender({ shown: false });
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS));
    expect(view.result.current.reportLoading).toBe(false);
    await act(async () => {
      slow.resolve(report('a', 'old answer'));
      await opening;
    });
    expect(view.result.current.report).toBeNull();

    view.rerender({ shown: true });
    await settle();
    expect(view.result.current.report).toEqual(report('a'));
  });

  it('opens the log asked for when it returns, not the released one', async () => {
    const view = mount();
    await settle();
    await act(() => view.result.current.open('a'));
    view.rerender({ shown: false });
    await act(() => vi.advanceTimersByTimeAsync(HIDDEN_RELEASE_MS));
    expect(view.result.current.report).toBeNull();

    // Home opens another fight in Logs: the tab is chosen and that log opened together.
    await act(async () => {
      view.rerender({ shown: true });
      await view.result.current.open('b');
    });
    await settle();
    expect(vi.mocked(api.readLog).mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(view.result.current.report?.id).toBe('b');
  });
});
