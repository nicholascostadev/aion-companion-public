import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LogMeta, ReportTotals } from '../../types/offline';
import { ComparePanel } from './ComparePanel';
import { report } from './fixtures';

afterEach(cleanup);

const log: LogMeta = {
  id: 'fight-1',
  label: 'Tiamat',
  started_ms: 1_792_200_000_000,
  duration_ms: 90_000,
  damage: 120_000,
  dps: 1333,
  players: 2,
  player_names: [],
  boss: 'Tiamat',
  zone_id: 300,
  run_id: 'run-1',
  end_reason: 'kill',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('ComparePanel', () => {
  it('drops a saved fight read in the old target scope while the new scope loads', async () => {
    const readAllTargets = vi.fn<(id: string) => Promise<ReportTotals>>(() =>
      Promise.resolve(report({ duration_ms: 90_000 })),
    );
    const bossRead = deferred<ReportTotals>();
    const readBossOnly = vi.fn<(id: string) => Promise<ReportTotals>>(() => bossRead.promise);
    const panel = (loadLog: (id: string) => Promise<ReportTotals>) => (
      <ComparePanel
        live={report()}
        logs={[log]}
        settings={SETTINGS_FALLBACK}
        native
        initial={['fight-1', LIVE]}
        loadLog={loadLog}
      />
    );
    const { rerender } = render(panel(readAllTargets));
    expect(await screen.findByText(/^1:30 ·/)).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Player comparison' })).toBeTruthy();

    // Target mode switches to bosses only: the all-target read is no longer side A's fight.
    rerender(panel(readBossOnly));
    expect(readBossOnly).toHaveBeenCalledWith('fight-1');
    expect(screen.queryByText(/^1:30 ·/)).toBeNull();
    expect(screen.queryByRole('table', { name: 'Player comparison' })).toBeNull();
    const fights = screen.getAllByRole<HTMLSelectElement>('combobox', { name: 'Fight' });
    expect(fights.map((fight) => fight.value)).toEqual(['fight-1', LIVE]);

    await act(async () => bossRead.resolve(report({ duration_ms: 30_000 })));
    expect(screen.getAllByText(/^0:30 ·/)).toHaveLength(2);
    expect(screen.getByRole('table', { name: 'Player comparison' })).toBeTruthy();
    expect(readAllTargets).toHaveBeenCalledTimes(1);
  });
});

const LIVE = 'live';
