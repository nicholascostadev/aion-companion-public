import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LogMeta, OfflineSettings, ReportTotals } from '../../types/offline';
import { ComparePanel } from './ComparePanel';
import { nativeReport, report } from './fixtures';

afterEach(cleanup);

const LIVE = 'live';

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

/** The fixture fight again, with Aria's damage skills replaced. */
function rematch(skills: Record<string, unknown>[], patch: Record<string, unknown> = {}) {
  const [aria, ...others] = nativeReport.players;
  return report({ players: [{ ...aria, ...patch, skills }, ...others] });
}

/** Side A is the fixture fight; side B is the same player in a second saved fight. */
async function renderPair(second: ReportTotals, settings: OfflineSettings = SETTINGS_FALLBACK) {
  const reports: Record<string, ReportTotals> = { 'fight-1': report(), 'fight-2': second };
  render(
    <ComparePanel
      live={null}
      logs={[log, { ...log, id: 'fight-2', label: 'Tiamat again' }]}
      settings={settings}
      native
      initial={['fight-1', 'fight-2']}
      loadLog={(id) => Promise.resolve(reports[id]!)}
    />,
  );
  return screen.findByRole('table', { name: 'Skill comparison' });
}

const skillNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((cell) => cell.querySelector('[title]')?.getAttribute('title'));

const headings = (table: HTMLElement) =>
  within(table)
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent);

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
    expect(screen.getByRole('region', { name: 'Player comparison' })).toBeTruthy();

    // Target mode switches to bosses only: the all-target read is no longer side A's fight.
    rerender(panel(readBossOnly));
    expect(readBossOnly).toHaveBeenCalledWith('fight-1');
    expect(screen.queryByText(/^1:30 ·/)).toBeNull();
    expect(screen.queryByRole('region', { name: 'Player comparison' })).toBeNull();
    // The side says it is reading, and the other side keeps what it has.
    expect(screen.getByRole('status').textContent).toBe('Opening log…');
    const fights = screen.getAllByRole<HTMLSelectElement>('combobox', { name: 'Fight' });
    expect(fights.map((fight) => fight.value)).toEqual(['fight-1', LIVE]);

    await act(async () => bossRead.resolve(report({ duration_ms: 30_000 })));
    expect(screen.getAllByText(/^0:30 ·/)).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'Player comparison' })).toBeTruthy();
    expect(readAllTargets).toHaveBeenCalledTimes(1);
  });

  it('judges the sides by DPS and says which way B moved', async () => {
    await renderPair(
      rematch([{ id: 11000101, name: 'Snipe', damage: 12_000 }], { damage: 12_000, edps: 400 }),
    );
    const sides = ['Side A', 'Side B'].map((name) => screen.getByRole('group', { name }));
    expect(sides.map((side) => within(side).getByText('DPS').nextSibling?.textContent)).toEqual([
      '300',
      '400',
    ]);
    // The verdict sits between the sides, outside both.
    const verdict = screen
      .getAllByText('B vs A')
      .find((label) => !label.closest('table'))!.parentElement!;
    const trend = verdict.querySelector('[data-trend]')!;
    expect(trend.getAttribute('data-trend')).toBe('better');
    expect(trend.textContent).toContain('+100');
    expect(trend.textContent).toContain('33%');
  });

  it('compares fight length as time and counts a shorter fight in favour of B', async () => {
    await renderPair(report({ duration_ms: 20_000 }));
    const output = screen.getByRole('table', { name: 'Output' });
    const length = within(output).getByRole('row', { name: /^Fight length/ });
    expect(within(length).getAllByRole('cell')[0]!.textContent).toBe('0:30');
    expect(within(length).getAllByRole('cell')[1]!.textContent).toBe('0:20');
    const trend = length.querySelector('[data-trend]')!;
    expect(trend.getAttribute('data-trend')).toBe('better');
    expect(trend.textContent).toContain('-0:10');
  });

  it('opens on damage and writes each further skill figure under one heading', async () => {
    const table = await renderPair(
      rematch([
        { id: 11000101, name: 'Snipe', damage: 5900, casts: 4 },
        { id: 11000201, name: 'Volley', damage: 100 },
      ]),
    );
    expect(headings(table)).toEqual(['Skill', 'Damage', 'B vs A', 'Share']);
    expect(skillNames(table)).toEqual(['Snipe', 'Volley']);
    const snipe = within(table).getByRole('row', { name: /^Snipe/ });
    // A over B in one cell: each figure names its side.
    expect(within(snipe).getAllByRole('cell')[0]!.textContent).toBe('A 6,000B 5,900');
    expect(snipe.querySelector('[data-trend]')!.getAttribute('data-trend')).toBe('worse');

    fireEvent.click(screen.getByRole('button', { name: 'All figures' }));
    expect(headings(table)).toEqual([
      'Skill',
      'Damage',
      'B vs A',
      'Share',
      'Casts',
      'Crit',
      'Avg',
      'Avg gap',
    ]);
    expect(within(snipe).getAllByRole('cell')[3]!.textContent).toBe('A 2B 4');
  });

  it('orders skills by damage, or by how far they moved between the sides', async () => {
    const table = await renderPair(
      rematch([
        { id: 11000101, name: 'Snipe', damage: 5900 },
        { id: 11000201, name: 'Volley', damage: 100 },
        { id: 11000301, name: 'Burst', damage: 5000 },
      ]),
    );
    expect(skillNames(table)).toEqual(['Snipe', 'Burst', 'Volley']);
    // A skill only one side used has no difference to print, and its missing side is a dash.
    const burst = within(table).getByRole('row', { name: /^Burst/ });
    expect(within(burst).getAllByRole('cell')[0]!.textContent).toBe('A —B 5,000');
    expect(burst.querySelector('[data-trend]')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Biggest change' }));
    expect(skillNames(table)).toEqual(['Burst', 'Volley', 'Snipe']);
  });

  it('keeps your class out of the player list while names are hidden', async () => {
    await renderPair(report(), { ...SETTINGS_FALLBACK, hide_names: true });
    const players = screen.getAllByRole<HTMLSelectElement>('combobox', { name: 'Player' });
    expect(players).toHaveLength(2);
    for (const player of players) {
      const options = [...player.options].map((option) => option.textContent);
      expect(options).toEqual(['You', 'Cleric 2']);
      // The select shows the player the figures belong to.
      expect(player.selectedOptions[0]!.textContent).toBe('You');
    }
  });
});
