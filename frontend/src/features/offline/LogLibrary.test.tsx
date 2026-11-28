import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LogMeta } from '../../types/offline';
import { report } from './fixtures';
import { emptyFilters, logOutcome, toQuery, type LogLibraryView } from './libraryModel';
import { LogLibrary } from './LogLibrary';

afterEach(cleanup);
const log = (id: string, label: string): LogMeta => ({
  id,
  label,
  started_ms: 1_792_200_000_000,
  duration_ms: 61_000,
  damage: 120_000,
  dps: 1967,
  players: 2,
  player_names: [],
  boss: label,
  zone_id: 300,
  run_id: 'run-1',
  end_reason: 'kill',
});

function library(patch: Partial<LogLibraryView> = {}): LogLibraryView {
  return {
    filters: emptyFilters,
    setFilters: vi.fn<LogLibraryView['setFilters']>(),
    offset: 0,
    setOffset: vi.fn<LogLibraryView['setOffset']>(),
    hasMore: false,
    logs: [log('fight-1', 'Tiamat'), log('fight-2', 'Dummy')],
    loading: false,
    error: '',
    notice: null,
    clearNotice: vi.fn<() => void>(),
    selected: [],
    setSelected: vi.fn<LogLibraryView['setSelected']>(),
    fresh: ['fight-2'],
    activeId: null,
    report: null,
    reportLoading: false,
    reportError: '',
    open: vi.fn<LogLibraryView['open']>().mockResolvedValue(),
    rename: vi.fn<LogLibraryView['rename']>().mockResolvedValue(true),
    remove: vi.fn<LogLibraryView['remove']>().mockResolvedValue(),
    exportLogs: vi.fn<LogLibraryView['exportLogs']>().mockResolvedValue(),
    refresh: vi.fn<() => void>(),
    ...patch,
  };
}
const renderLibrary = (
  state: LogLibraryView,
  onCompare = vi.fn<(ids: string[]) => void>(),
  outcomeFilter = false,
) =>
  render(
    <LogLibrary
      library={state}
      settings={SETTINGS_FALLBACK}
      native
      libraryCount={2}
      outcomeFilter={outcomeFilter}
      onCompare={onCompare}
      onCopySummary={() => () => Promise.resolve()}
    />,
  );

describe('local log library', () => {
  it('lists logs with auto-save state, marks new ones and opens a log', () => {
    const state = library();
    renderLibrary(state);
    expect(screen.getByText('on')).toBeTruthy();
    const list = within(screen.getByRole('list', { name: 'Logs' }));
    expect(list.getAllByText('New')).toHaveLength(1);
    fireEvent.click(list.getByText('Tiamat'));
    expect(state.open).toHaveBeenCalledWith('fight-1');
  });

  it('deletes only after confirmation and compares exactly two', () => {
    const onCompare = vi.fn<(ids: string[]) => void>();
    const state = library({ selected: ['fight-1', 'fight-2'] });
    renderLibrary(state, onCompare);
    fireEvent.click(screen.getByRole('button', { name: 'Delete…' }));
    expect(state.remove).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete 2' }));
    expect(state.remove).toHaveBeenCalledWith(['fight-1', 'fight-2']);
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }));
    expect(onCompare).toHaveBeenCalledWith(['fight-1', 'fight-2']);
  });

  it('renames from the open report', () => {
    const state = library({ activeId: 'fight-1', report: report() });
    renderLibrary(state);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New log name'), { target: { value: 'Tiamat clear' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(state.rename).toHaveBeenCalledWith('fight-1', 'Tiamat clear');
  });

  it('reads in Brazilian Portuguese with pt-BR numbers, plurals and labels verbatim', async () => {
    await act(() => getI18n().changeLanguage('pt-BR'));
    const state = library({
      logs: [
        { ...log('fight-0', 'Tiamat'), players: 0 },
        { ...log('fight-1', 'Dummy'), players: 1 },
        log('fight-2', 'Tiamat clear'),
      ],
      selected: ['fight-1', 'fight-2'],
      notice: { kind: 'deleted', count: 1 },
    });
    renderLibrary(state);
    expect(screen.getByRole('heading', { name: 'Registros salvos' })).toBeTruthy();
    expect(screen.getByText('ativado')).toBeTruthy();
    expect(screen.getByText('2 selecionados')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Excluir…' })).toBeTruthy();
    expect(screen.getByText('1 registro local excluído.')).toBeTruthy();
    const list = within(screen.getByRole('list', { name: 'Registros' }));
    const row = (label: string) => list.getByText(label).closest('li')!.textContent;
    expect(row('Tiamat')).toContain('0 jogadores');
    expect(row('Dummy')).toContain('1 jogador');
    expect(row('Tiamat clear')).toContain('2 jogadores');
    expect(row('Tiamat clear')).toContain('2K DPS · 120K de dano');
    expect(row('Tiamat clear')).toContain('Chefe derrotado');
  });

  it('keeps a rename in progress when the language changes', async () => {
    const state = library({ activeId: 'fight-1', report: report() });
    renderLibrary(state);
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    fireEvent.change(screen.getByLabelText('New log name'), { target: { value: 'Tiamat clear' } });
    await act(() => getI18n().changeLanguage('pt-BR'));
    expect((screen.getByLabelText('Novo nome do registro') as HTMLInputElement).value).toBe(
      'Tiamat clear',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));
    expect(state.rename).toHaveBeenCalledWith('fight-1', 'Tiamat clear');
  });

  it('turns local date filters into an inclusive native query', () => {
    const query = toQuery(
      { ...emptyFilters, from: '2026-10-01', to: '2026-10-01', zone: '300', boss: ' Tiamat ' },
      50,
    );
    expect(query.to_ms! - query.from_ms!).toBe(24 * 3600 * 1000 - 1);
    expect(query).toMatchObject({
      zone_id: 300,
      boss: 'Tiamat',
      offset: 50,
      limit: 51,
      sort: 'newest',
    });
    expect(toQuery({ ...emptyFilters, zone: 'x', from: 'bad' }, 0)).toEqual({
      sort: 'newest',
      limit: 51,
      offset: 0,
    });
  });
});

describe('reading a saved fight', () => {
  const reading = (patch: Partial<LogLibraryView> = {}) =>
    library({ activeId: 'fight-1', report: report(), ...patch });
  const back = () => screen.getByRole('button', { name: 'Back to logs' });

  it('gives an opened fight the page, on its combat details, with the list put away', () => {
    renderLibrary(reading());
    const view = within(screen.getByRole('region', { name: 'Open log' }));
    expect(view.getByRole('heading', { name: 'Test Boss' })).toBeTruthy();
    expect(view.getByRole('tab', { name: 'Combat details' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(view.getByRole('list', { name: 'Aria skill breakdown' })).toBeTruthy();
    // The library, its filters and its selection tools are out of the way while reading.
    expect(screen.queryByRole('list', { name: 'Logs' })).toBeNull();
    expect(screen.queryByRole('searchbox', { name: 'Search logs' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete…' })).toBeNull();
    // The fight's own figures keep to a line, with their scope still written.
    expect(view.getByText('whole encounter')).toBeTruthy();
    expect(view.getByText('Defeated')).toBeTruthy();
  });

  it('goes back to the list with the fight still open, and returns without reading it again', () => {
    const filters = { ...emptyFilters, search: 'tia', sort: 'dps' as const };
    const state = reading({ filters, selected: ['fight-2'], offset: 50 });
    renderLibrary(state);
    fireEvent.click(back());
    // The list is back as it was left: its filters, its page and its selection.
    const list = within(screen.getByRole('list', { name: 'Logs' }));
    expect((screen.getByRole('searchbox', { name: 'Search logs' }) as HTMLInputElement).value).toBe(
      'tia',
    );
    expect(screen.getByText('1 selected')).toBeTruthy();
    expect(
      (screen.getByRole('checkbox', { name: 'Select Dummy' }) as HTMLElement).getAttribute(
        'aria-checked',
      ),
    ).toBe('true');
    expect(state.setFilters).not.toHaveBeenCalled();
    expect(state.setSelected).not.toHaveBeenCalled();
    expect(state.setOffset).not.toHaveBeenCalled();
    expect(state.open).not.toHaveBeenCalled();
    // The open fight is lit in the list, takes focus back, and is named with the way in.
    const row = list.getByRole('button', { name: /Tiamat/ });
    expect(row.getAttribute('aria-current')).toBe('true');
    expect(document.activeElement).toBe(row);
    expect(screen.getByText('Open fight:')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Open log' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Return to the report' }));
    expect(screen.getByRole('region', { name: 'Open log' })).toBeTruthy();
    expect(document.activeElement).toBe(back());
    // The report was still held: nothing was read again.
    expect(state.open).not.toHaveBeenCalled();
  });

  it('returns to the view the report was left on', () => {
    renderLibrary(reading());
    fireEvent.click(screen.getByRole('tab', { name: 'Rotation' }));
    fireEvent.click(back());
    fireEvent.click(within(screen.getByRole('list', { name: 'Logs' })).getByText('Tiamat'));
    expect(screen.getByRole('tab', { name: 'Rotation' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('opens another fight from the list, and closes the open one on request', () => {
    const state = reading();
    renderLibrary(state);
    fireEvent.click(back());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(state.open).toHaveBeenLastCalledWith(null);
    fireEvent.click(within(screen.getByRole('list', { name: 'Logs' })).getByText('Dummy'));
    expect(state.open).toHaveBeenLastCalledWith('fight-2');
  });

  it('keeps export, compare and copy on the open fight', () => {
    const onCompare = vi.fn<(ids: string[]) => void>();
    const state = reading();
    renderLibrary(state, onCompare);
    fireEvent.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(state.exportLogs).toHaveBeenCalledWith(['fight-1']);
    fireEvent.click(screen.getByRole('button', { name: 'Compare…' }));
    expect(onCompare).toHaveBeenCalledWith(['fight-1']);
    expect(screen.getByRole('button', { name: 'Copy summary' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Multi-line' })).toBeTruthy();
  });

  it('shows what an action on the open fight did, without leaving the report', () => {
    renderLibrary(reading({ notice: { kind: 'exported', paths: ['C:/logs/fight-1.json'] } }));
    const view = within(screen.getByRole('region', { name: 'Open log' }));
    expect(view.getByText('Exported to C:/logs/fight-1.json')).toBeTruthy();
  });

  it('keeps the way back while a fight is opening or could not be read', () => {
    const view = renderLibrary(reading({ report: null, reportLoading: true }));
    expect(screen.getByText('Opening log…')).toBeTruthy();
    expect(back()).toBeTruthy();
    view.unmount();
    renderLibrary(reading({ report: null, reportError: 'log file is unreadable' }));
    expect(screen.getByRole('alert').textContent).toContain('log file is unreadable');
    fireEvent.click(back());
    expect(screen.getByRole('list', { name: 'Logs' })).toBeTruthy();
  });

  it('names the target scope the open fight was read in', () => {
    renderLibrary(reading());
    // The fixture settings count every target; a boss-only reading would say Bosses.
    expect(screen.getByTitle('Targets counted in this report').textContent).toBe('All targets');
  });

  it('lets an owner hold the choice between the list and the report', () => {
    const onBrowsingChange = vi.fn<(browsing: boolean) => void>();
    const view = (browsing: boolean) => (
      <LogLibrary
        library={reading()}
        settings={SETTINGS_FALLBACK}
        native
        libraryCount={2}
        browsing={browsing}
        onBrowsingChange={onBrowsingChange}
        onCompare={() => undefined}
        onCopySummary={() => () => Promise.resolve()}
      />
    );
    const shown = render(view(false));
    fireEvent.click(back());
    expect(onBrowsingChange).toHaveBeenLastCalledWith(true);
    // Until the owner agrees, the report stays.
    expect(screen.getByRole('region', { name: 'Open log' })).toBeTruthy();
    shown.rerender(view(true));
    expect(screen.getByRole('list', { name: 'Logs' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Return to the report' }));
    expect(onBrowsingChange).toHaveBeenLastCalledWith(false);
  });
});

describe('fight result filter', () => {
  const results = () => screen.queryByRole('group', { name: 'Fight result' });

  it('is offered only when the engine filters by result before paging', () => {
    // Filtering the fifty logs of one page here would hide matching fights on the others.
    const view = renderLibrary(library());
    expect(results()).toBeNull();
    view.unmount();
    renderLibrary(library(), undefined, true);
    const group = within(results()!);
    expect(group.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'All',
      'Kills',
      'Attempts',
      'Dummy',
    ]);
    expect(group.getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('true');
    expect(group.getByRole('button', { name: 'Attempts' }).getAttribute('title')).toBe(
      'Fights that ended with a boss reset or a party wipe',
    );
  });

  it('keeps the other filters when a result is chosen, and clears with them', () => {
    const filters = { ...emptyFilters, boss: 'Tiamat', sort: 'dps' as const };
    const state = library({ filters });
    const view = renderLibrary(state, undefined, true);
    fireEvent.click(within(results()!).getByRole('button', { name: 'Kills' }));
    expect(state.setFilters).toHaveBeenLastCalledWith({ ...filters, outcome: 'kill' });
    view.unmount();
    const chosen = library({ filters: { ...emptyFilters, outcome: 'dummy' }, logs: [] });
    renderLibrary(chosen, undefined, true);
    // A result alone is a filter: the empty list says so and it can be cleared.
    expect(screen.getByText('No logs match these filters')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(chosen.setFilters).toHaveBeenLastCalledWith(emptyFilters);
  });

  it('sends the result with the other filters so native pages matching fights only', () => {
    expect(toQuery({ ...emptyFilters, outcome: 'attempt', boss: 'Tiamat' }, 50)).toEqual({
      sort: 'newest',
      limit: 51,
      offset: 50,
      boss: 'Tiamat',
      outcome: 'attempt',
    });
    expect(toQuery(emptyFilters, 0)).not.toHaveProperty('outcome');
  });

  it('groups end reasons as native does, leaving the ambiguous ones out', () => {
    expect(['kill', 'clear'].map(logOutcome)).toEqual(['kill', 'kill']);
    expect(['reset', 'wipe'].map(logOutcome)).toEqual(['attempt', 'attempt']);
    expect(logOutcome('dummy_cap')).toBe('dummy');
    // Neither a kill nor an attempt: how the fight went is not recorded.
    for (const reason of ['idle', 'zone_change', 'manual', 'despawn', 'stopped', 'recovered', null])
      expect(logOutcome(reason)).toBeNull();
  });

  it('words the end reasons the filter groups', async () => {
    const state = library({
      logs: [
        { ...log('fight-1', 'Run'), end_reason: 'clear' },
        { ...log('fight-2', 'Pull'), end_reason: 'wipe' },
      ],
    });
    renderLibrary(state);
    const list = within(screen.getByRole('list', { name: 'Logs' }));
    expect(list.getByText('Dungeon cleared')).toBeTruthy();
    expect(list.getByText('Party wiped')).toBeTruthy();
    await act(() => getI18n().changeLanguage('pt-BR'));
    expect(list.getByText('Masmorra concluída')).toBeTruthy();
    expect(list.getByText('Grupo derrotado')).toBeTruthy();
  });
});
