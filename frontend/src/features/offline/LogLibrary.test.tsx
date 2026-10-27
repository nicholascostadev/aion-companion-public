import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LogMeta } from '../../types/offline';
import { report } from './fixtures';
import { emptyFilters, toQuery, type LogLibraryView } from './libraryModel';
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
const renderLibrary = (state: LogLibraryView, onCompare = vi.fn<(ids: string[]) => void>()) =>
  render(
    <LogLibrary
      library={state}
      settings={SETTINGS_FALLBACK}
      native
      libraryCount={2}
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
