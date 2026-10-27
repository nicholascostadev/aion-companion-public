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
afterEach(cleanup);
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
    const table = within(screen.getByRole('table', { name: 'Dano por jogador' }));
    expect(table.queryByText('Aria')).toBeNull();
    expect(table.getAllByText('Você').length).toBeGreaterThan(0);
    expect(table.getByText('Cleric 2')).toBeTruthy();
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
    tab('Mortes');
    const deaths = within(screen.getByRole('list', { name: 'Mortes' }));
    expect(deaths.getByText(/1 golpe nos últimos 10 s · 300 de dano/)).toBeTruthy();
  });

  it('keeps the open tab and selection when the language changes', async () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    tab('Skills');
    expect(screen.getByRole('table', { name: /skill breakdown/ })).toBeTruthy();
    await speak('pt-BR');
    expect(screen.getByRole('tab', { name: 'Habilidades' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    const table = within(
      screen.getByRole('table', { name: /Detalhamento de habilidades de Aria/ }),
    );
    expect(table.getByText('Volley')).toBeTruthy();
    expect(table.getByText('Nv 2')).toBeTruthy();
    await speak('en');
    expect(screen.getByRole('tab', { name: 'Skills' }).getAttribute('aria-selected')).toBe('true');
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
