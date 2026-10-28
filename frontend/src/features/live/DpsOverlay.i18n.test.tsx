import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { LivePlayer, LiveStatus, OverlayStatus } from '../../types/companion';
import type { CombatReport, OfflineSettings, OfflineStatus } from '../../types/offline';
import { DpsOverlay } from './DpsOverlay';
import { LiveMeter } from './LiveMeter';
import { aria, bryn, layOutMeterList, manySkills, meterReport } from './meterFixtures';

afterEach(cleanup);

const status: LiveStatus = {
  running: true,
  phase: 'capturing',
  message: 'Collecting damage',
  duration_ms: 10_000,
  events: 6,
  stats: { gaps: 0 },
  players: [],
};
const overlay: OverlayStatus = {
  locked: true,
  ready: true,
  visible: true,
  can_lock: true,
  saved_path: '',
  errors: [],
};
const offline = (report: CombatReport | null, settings: OfflineSettings = SETTINGS_FALLBACK) =>
  ({
    settings,
    report,
    library_count: 0,
    trackers: [],
    alerts: [],
    catalogue: null,
    capabilities: {},
    error: null,
  }) satisfies OfflineStatus;

type Props = Parameters<typeof DpsOverlay>[0];
const props = (extra: Partial<Props> = {}): Props => ({
  status,
  overlay,
  error: '',
  busy: false,
  onReset: vi.fn<() => void>(),
  onHide: vi.fn<() => void>(),
  onQuit: vi.fn<() => void>(),
  ...extra,
});

// Compact numbers keep English notation in pt-BR (74.6K); other figures are localised.
/** Renders in Brazilian Portuguese with a real engine; returns it for language switches. */
function renderPt(ui: ReactNode) {
  const i18n = createTestI18n('pt-BR');
  const view = render(<TranslationProvider i18n={i18n}>{ui}</TranslationProvider>);
  return { i18n, view };
}

const rows = () => within(screen.getByRole('list')).getAllByRole('listitem');
const cells = (row: HTMLElement) =>
  [...row.querySelectorAll('.meter-row > span:not(.meter-bar)')].map((c) => c.textContent);
const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
const stat = (label: string) =>
  screen.getByText(label, { selector: 'dt' }).nextElementSibling?.textContent;

describe('DPS meter in Brazilian Portuguese', () => {
  it('words the meter in Portuguese with pt-BR numbers and observed names verbatim', () => {
    renderPt(
      <DpsOverlay {...props({ offline: offline(meterReport({ players: [aria, bryn] })) })} />,
    );
    expect(screen.getByRole('region', { name: 'Medidor de DPS ao vivo' })).toBeTruthy();
    // Terse captions keep the fixed-size overlay's controls in view at its minimum width.
    expect(screen.getByTitle('Dano causado no escopo de alvos escolhido').textContent).toBe('Dano');
    expect(screen.queryByRole('button', { name: 'Jogadores' })).toBeNull();
    expect(screen.getByRole('list', { name: 'Jogadores por dano' })).toBeTruthy();
    expect(rows().map(cells)).toEqual([
      ['Aria você', '74.6K', '7.5K', '74,6%'],
      ['Bryn', '25.4K', '2.5K', '25,4%'],
    ]);
    // No combined headline: each row carries its own figures.
    expect(screen.queryByText(/DPS atual|DPS médio/)).toBeNull();
    expect(screen.getByText('Training Golem')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Nova luta' })).toBeTruthy();
  });

  it('keeps skill names verbatim and only whole rows', () => {
    // Eight rows fit the meter; the rest stay out of view.
    const layout = layOutMeterList(200);
    onTestFinished(() => layout.restore());
    const list = manySkills(10);
    const damage = list.reduce((sum, s) => sum + s.damage, 0);
    const fight = offline(meterReport({ players: [{ ...aria, damage, skills: list }] }));
    renderPt(<DpsOverlay {...props({ offline: fight })} />);
    // The ranking stays the default for a sole damager; their row opens their skills.
    fireEvent.click(screen.getByRole('button', { name: 'Habilidades de Aria' }));
    expect(screen.getByText('Skill 1')).toBeTruthy();
    expect(rows()).toHaveLength(8);
  });

  it('copies a Portuguese summary with hidden names and pt-BR figures', async () => {
    const onCopyText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
    const settings = { ...SETTINGS_FALLBACK, hide_names: true };
    renderPt(
      <DpsOverlay
        {...props({
          offline: offline(meterReport({ players: [aria, bryn] }), settings),
          onCopyText,
        })}
      />,
    );
    // Hidden names: "you" is worded, the game's class name is kept as observed.
    expect(rows().map((r) => cells(r)[0])).toEqual(['Você', 'Cleric 2']);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copiar resumo' }));
    });
    const text = onCopyText.mock.lastCall?.[0] ?? '';
    expect(text).toMatch(/^Dano causado · Training Golem · 0:10 · 10K\/s/);
    expect(text).toContain('1. Você 74.6K · 7.5K/s (74,6%)');
    expect(text).not.toMatch(/Aria|Bryn/);
    expect(screen.getByRole('button', { name: 'Copiar resumo' }).title).toBe(
      'Resumo copiado para a área de transferência.',
    );
    // The footer's Odyle energy is worded in Portuguese too.
    expect(
      screen.getByTitle('Energia de Odyle · saldo (+ bônus) mais recente informado pelo jogo')
        .textContent,
    ).toBe('—(+—)');
  });

  it('switches language in place without losing the chosen player', async () => {
    const { i18n } = renderPt(
      <DpsOverlay {...props({ offline: offline(meterReport({ players: [aria, bryn] })) })} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Habilidades de Bryn' }));
    expect(pressed('Bryn')).toBe('true');
    expect(stat('Parcela')).toBe('25,4%');
    await act(async () => {
      await i18n.changeLanguage('en');
    });
    // Same component, same choice: only the words and number formats changed.
    expect(pressed('Bryn')).toBe('true');
    expect(screen.getByRole('list', { name: 'Skills of Bryn' })).toBeTruthy();
    expect(stat('Share')).toBe('25.4%');
    expect(rows().map(cells)).toEqual([['Smite', '25.4K', '100.0%']]);
    await act(async () => {
      await i18n.changeLanguage('pt-BR');
    });
    expect(pressed('Bryn')).toBe('true');
    expect(rows().map(cells)).toEqual([['Smite', '25.4K', '100,0%']]);
  });

  it('words capture states from the shared catalog', () => {
    renderPt(
      <DpsOverlay
        {...props({
          status: { ...status, phase: 'waiting_for_game', message: '' },
          offline: offline(null),
        })}
      />,
    );
    expect(screen.getByText('Aguardando o jogo…')).toBeTruthy();
  });
});

describe('workspace live meter in Brazilian Portuguese', () => {
  it('formats totals the pt-BR way and keeps backend labels', () => {
    const player: LivePlayer = {
      entity: 7,
      label: 'Gladiator #7',
      damage: 3000,
      dps: 1500,
      current_dps: 600,
      share: 0.6,
      direct_hits: 4,
      critical_hits: 1,
      ticks: 0,
      skills: { Slash: 3000 },
    };
    renderPt(
      <LiveMeter
        status={{
          ...status,
          duration_ms: 2000,
          players: [player],
          history: [{ id: 1, duration_ms: 4000, events: 9 }],
        }}
        native
        busy={false}
        error=""
        onReset={vi.fn<() => void>()}
        onReplay={vi.fn<(id?: number) => void>()}
        onConfigure={vi.fn<(autoEnd: boolean, partyOnly: boolean) => void>()}
        onComparison={vi.fn<() => void>()}
        comparisonPath=""
      />,
    );
    expect(screen.getByText('DPS ao vivo')).toBeTruthy();
    expect(screen.getByText('Capturando')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Salvar relatório de comparação' })).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', { name: 'Detalhamento de habilidades e da captura' }),
    );
    expect(screen.getByRole('heading', { name: 'Gladiator #7' })).toBeTruthy();
    expect(screen.getAllByText('3.000').length).toBeGreaterThan(0);
    expect(screen.getByText('1.500')).toBeTruthy();
    expect(screen.getByText('60,0%')).toBeTruthy();
    expect(screen.getByText('25,0%')).toBeTruthy();
    fireEvent.click(screen.getByText('Lutas concluídas (1)'));
    expect(screen.getByRole('button', { name: 'Repetir confronto 1 · 4,0 s' })).toBeTruthy();
  });
});
