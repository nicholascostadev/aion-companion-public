import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { formattersFor } from '../../i18n/formatters';
import { getI18n } from 'react-i18next';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import type { TrackerStatus } from '../../types/offline';
import { TrackerBars, TrackerChips, trackerTime, trackerTitle } from './trackers';

afterEach(cleanup);
// The engine the test setup installs; getFixedT reads a language without switching to it.
const en = getI18n().getFixedT('en', 'trackers');
const pt = getI18n().getFixedT('pt-BR', 'trackers');
const fmt = formattersFor('en');
const time = (t: TrackerStatus) => trackerTime(t, en, fmt);
const title = (t: TrackerStatus) => trackerTitle(t, en, fmt);
const status = (patch: Partial<TrackerStatus>): TrackerStatus => ({
  bar_id: 'b1',
  skill: 1,
  name: 'Burst',
  remaining_ms: 12_000,
  kind: 'cooldown',
  source: 1,
  target: null,
  estimated: false,
  basis: null,
  ...patch,
});

describe('tracker timers', () => {
  it('marks estimates, keeps exact wire zero as ready and open buffs as active', () => {
    expect(time(status({}))).toBe('12s');
    expect(time(status({ estimated: true }))).toBe('~12s');
    expect(time(status({ remaining_ms: 0, basis: 'observed ready (wire zero)' }))).toBe('ready');
    expect(time(status({ remaining_ms: 0, estimated: true }))).toBe('~ready');
    expect(time(status({ remaining_ms: null, kind: 'buff' }))).toBe('active');
    expect(title(status({ estimated: true, basis: 'observed wall-clock calibration' }))).toMatch(
      /Estimated from observed wall-clock calibration/,
    );
  });

  it('draws configured skills without status as unknown, never ready', () => {
    const settings = {
      ...SETTINGS_FALLBACK,
      presets: [
        {
          id: 'p1',
          name: 'Main',
          class: null,
          keybind: null,
          bars: [
            {
              id: 'b1',
              name: 'Burst',
              mode: 'cooldowns' as const,
              skills: [1, 2],
              x: 5,
              y: 6,
              icon_size: 40,
              appearance: 'icons' as const,
              hidden: false,
            },
          ],
        },
      ],
      active_preset: null,
    };
    render(
      <TrackerBars
        settings={settings}
        trackers={[status({ skill: 1, remaining_ms: 0, estimated: true })]}
      />,
    );
    expect(screen.getByTitle(/Skill #2 · no timer observed yet/).dataset.state).toBe('unknown');
    expect(screen.getByText('~ready')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Burst' }).style.left).toBe('5px');
  });

  it('orders fallback chips by time left', () => {
    render(
      <TrackerChips
        trackers={[
          status({ name: 'Slow', remaining_ms: 50_000 }),
          status({ name: 'Fast', remaining_ms: 2000 }),
        ]}
      />,
    );
    const chips = screen.getAllByText(/Slow|Fast/).map((n) => n.textContent);
    expect(chips).toEqual(['Fast', 'Slow']);
  });
});

describe('trackers in Brazilian Portuguese', () => {
  const ptFmt = formattersFor('pt-BR');
  const ptTime = (t: TrackerStatus) => trackerTime(t, pt, ptFmt);
  const settings = {
    ...SETTINGS_FALLBACK,
    presets: [
      {
        id: 'p1',
        name: 'Principal',
        class: null,
        keybind: null,
        bars: [
          {
            id: 'b1',
            name: 'Explosão',
            mode: 'cooldowns' as const,
            skills: [1, 2],
            x: 5,
            y: 6,
            icon_size: 40,
            appearance: 'bars' as const,
            hidden: true,
          },
        ],
      },
    ],
    active_preset: null,
  };

  it('words timer states and decimals the Portuguese way', () => {
    expect(ptTime(status({ remaining_ms: 3_400 }))).toBe('3,4s');
    expect(ptTime(status({ remaining_ms: 3_400, estimated: true }))).toBe('~3,4s');
    expect(ptTime(status({ remaining_ms: 0 }))).toBe('pronto');
    expect(ptTime(status({ remaining_ms: 0, kind: 'buff', estimated: true }))).toBe('~terminando');
    expect(ptTime(status({ remaining_ms: null, kind: 'buff' }))).toBe('ativo');
    expect(
      trackerTitle(
        status({ name: 'Golpe Feroz', estimated: true, basis: 'observed wall-clock calibration' }),
        pt,
        ptFmt,
      ),
    ).toBe(
      'Golpe Feroz · Recarga ~12s\nEstimado a partir de observed wall-clock calibration; o jogo não informa este temporizador em milissegundos.',
    );
  });

  it('draws bars in Portuguese and rewords them in place on a language switch', async () => {
    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    render(
      <TrackerBars
        settings={settings}
        trackers={[status({ skill: 1, name: 'Golpe Feroz', remaining_ms: 3_400 })]}
        onDragStart={() => {}}
      />,
    );
    const bar = screen.getByRole('region', { name: 'Explosão' });
    expect(bar.textContent).toContain('Explosão · 5, 6 · oculta');
    expect(screen.getByText('Golpe Feroz')).toBeTruthy();
    expect(screen.getByText('3,4s')).toBeTruthy();
    expect(screen.getByTitle('Habilidade #2 · nenhum temporizador observado ainda')).toBeTruthy();

    await act(async () => {
      await getI18n().changeLanguage('en');
    });
    expect(screen.getByRole('region', { name: 'Explosão' })).toBe(bar);
    expect(bar.textContent).toContain('Explosão · 5, 6 · hidden');
    expect(screen.getByText('3.4s')).toBeTruthy();
    expect(screen.getByTitle('Skill #2 · no timer observed yet')).toBeTruthy();
  });

  it('labels the overlay chips in Portuguese and keeps skill names verbatim', async () => {
    await act(async () => {
      await getI18n().changeLanguage('pt-BR');
    });
    render(
      <TrackerChips
        trackers={[status({ name: 'Golpe Feroz', remaining_ms: null, kind: 'buff' })]}
      />,
    );
    const chips = screen.getByLabelText('Recargas e buffs rastreados');
    expect(chips.textContent).toBe('Golpe Ferozativo');
    expect(chips.querySelector('[data-kind="buff"]')?.getAttribute('title')).toBe(
      'Golpe Feroz · Buff ativo',
    );
  });
});
