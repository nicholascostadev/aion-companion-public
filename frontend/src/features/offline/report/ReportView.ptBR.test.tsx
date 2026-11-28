import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../../lib/offlineNormalize';
import { report } from '../fixtures';
import { ReportView } from './ReportView';

/*
 * The real engine from the test setup, switched to Brazilian Portuguese; the setup returns
 * it to English after each test.
 */
afterEach(() => {
  cleanup();
  // The skill metric choice is remembered on this computer.
  localStorage.clear();
});
const speak = (locale: 'en' | 'pt-BR') => act(() => getI18n().changeLanguage(locale));
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('combat report in Brazilian Portuguese', () => {
  it('words the report in Portuguese, with pt-BR numbers and observed names verbatim', async () => {
    await speak('pt-BR');
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    expect(screen.getByRole('heading', { name: 'Test Boss' })).toBeTruthy();
    expect(screen.getByText('confronto inteiro')).toBeTruthy();
    expect(screen.getByText('Derrotado')).toBeTruthy();
    expect(screen.getByText(/Chefe derrotado/)).toBeTruthy();
    expect(screen.getByText(/não observado: Posições/)).toBeTruthy();
    // Native warnings are shown as native wrote them.
    expect(screen.getByText('Capture quality: 2 stream gaps.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Comparar jogadores' }));
    const table = within(screen.getByRole('table', { name: 'Dano por jogador' }));
    const aria = table.getByText('Aria').closest('tr')!;
    expect(within(aria).getByText('9.000')).toBeTruthy();
    expect(within(aria).getAllByText('50,0%')).toHaveLength(2);
    expect(within(aria).getByText('Ranger')).toBeTruthy();
    expect(table.getByRole('button', { name: /Ativo ≈/ })).toBeTruthy();
  });

  it('hides names behind the observed class in Portuguese', async () => {
    await speak('pt-BR');
    render(
      <ReportView report={report()} settings={{ ...SETTINGS_FALLBACK, hide_names: true }} native />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Comparar jogadores' }));
    const table = within(screen.getByRole('table', { name: 'Dano por jogador' }));
    expect(table.queryByText('Aria')).toBeNull();
    expect(table.getAllByText('Você').length).toBeGreaterThan(0);
    expect(table.getByText('Cleric 2')).toBeTruthy();
  });

  it('words buff uptime as duration-backed in Portuguese, apart from open ends', async () => {
    await speak('pt-BR');
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native initialTab="buffs" />);
    const summary = within(screen.getByRole('table', { name: 'Resumo de tempo ativo dos buffs' }));
    const headers = summary.getAllByRole('columnheader').map((header) => header.textContent);
    expect(headers).toEqual(expect.arrayContaining(['Por duração %', 'Por duração', 'Fim aberto']));
    expect(
      screen.getByText(
        /sem um pacote de remoção, a captura não mostra que o buff durou o tempo todo/,
      ),
    ).toBeTruthy();
    expect(summary.getByTitle('Aplicações sem duração e sem remoção registrada')).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/confirmad|cujo fim foi observado/i);
  });

  it('counts casts, entries and hits with Portuguese plurals', async () => {
    await speak('pt-BR');
    render(
      <ReportView
        report={report({ events_truncated: true, event_window_start_ms: 900 })}
        settings={SETTINGS_FALLBACK}
        native
      />,
    );
    tab('Rotação');
    expect(screen.getByText(/2 usos observados · 1 entrada de sequência de ataque/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Abertura indisponível' })).toBeTruthy();
    tab('Linha do tempo');
    const deaths = within(screen.getByRole('list', { name: 'Mortes' }));
    expect(deaths.getByText(/1 golpe nos últimos 10 s · 300 de dano/)).toBeTruthy();
  });

  it('keeps the open tab and selection when the language changes', async () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    expect(screen.getByRole('list', { name: /skill breakdown/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Metrics/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Timing' }));
    fireEvent.click(screen.getByRole('button', { name: 'Snipe' }));
    await speak('pt-BR');
    expect(
      screen.getByRole('tab', { name: 'Detalhes do combate' }).getAttribute('aria-selected'),
    ).toBe('true');
    // Three places, each named in the reader's language.
    expect(screen.getAllByRole('tab').map((place) => place.textContent)).toEqual([
      'Detalhes do combate',
      'Rotação',
      'Linha do tempo',
    ]);
    const rows = within(screen.getByRole('list', { name: /Detalhamento de habilidades de Aria/ }));
    expect(rows.getByText('Volley')).toBeTruthy();
    expect(rows.getByText('Nv 2')).toBeTruthy();
    // The player tabs, the whole-fight summary and the buffs beside the skills follow too.
    expect(screen.getByRole('group', { name: 'Jogador' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Desempenho de Aria na luta inteira' })).toBeTruthy();
    const buffs = within(screen.getByRole('complementary', { name: 'Buffs em Aria' }));
    expect(buffs.getByText('8,3%')).toBeTruthy();
    // The chosen metrics, the opened skill and the boss activity follow the language.
    expect(screen.getByRole('button', { name: 'Tempo' }).getAttribute('aria-pressed')).toBe('true');
    const detail = within(screen.getByRole('region', { name: 'Detalhe dos golpes de Snipe' }));
    expect(detail.getByText('2 de 3 · 66,7%')).toBeTruthy();
    expect(detail.getByText('2 golpes')).toBeTruthy();
    const activity = within(screen.getByRole('region', { name: 'Atividade de Aria no chefe' }));
    expect(activity.getByText('3,00s de 30,0s')).toBeTruthy();
    await speak('en');
    expect(screen.getByRole('tab', { name: 'Combat details' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('words the copy status at render, so it follows a language change', async () => {
    const copy = vi.fn<(multiline: boolean) => Promise<void>>().mockResolvedValue();
    render(
      <ReportView
        report={report()}
        settings={SETTINGS_FALLBACK}
        native

        onCopySummary={copy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Copy summary' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Copy status' }).textContent).toBe('Copied'),
    );
    await speak('pt-BR');
    expect(screen.getByRole('status', { name: 'Status da cópia' }).textContent).toBe('Copiado');
    expect(screen.getByRole('button', { name: 'Copiar resumo' })).toBeTruthy();
  });
});
