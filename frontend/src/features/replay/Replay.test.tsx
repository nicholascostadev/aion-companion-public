import { act, cleanup, render, screen } from '@testing-library/react';
import { getI18n } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DamageSummary } from './DamageSummary';
import { ReplayControls } from './ReplayControls';
import { ReplayProgress } from './ReplayProgress';

afterEach(cleanup);

const portuguese = () =>
  act(async () => {
    await getI18n().changeLanguage('pt-BR');
  });

describe('replay in Brazilian Portuguese', () => {
  it('words the controls and formats the time with a decimal comma', async () => {
    await portuguese();
    render(
      <ReplayControls
        source={null}
        durationMs={10_000}
        atMs={1250}
        snapshotMs={1250}
        disabled={false}
        playing={false}
        onToggle={vi.fn<() => void>()}
        onSeek={vi.fn<(time: number) => void>()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeTruthy();
    expect(screen.getByRole('slider', { name: 'Tempo do replay' })).toBeTruthy();
    expect(screen.getByText('1,3 s')).toBeTruthy();
    expect(screen.getByText('Nenhuma gravação')).toBeTruthy();
  });

  it('keeps recorded names and native gaps verbatim around Portuguese text', async () => {
    await portuguese();
    render(
      <>
        <DamageSummary
          players={{
            Aria: { damage: 12_345.5, healing: 0, dps: 1234, skills: { 'Golpe Feroz': 12_345.5 } },
          }}
        />
        <ReplayProgress
          counters={[{ character: 'Aria', key: 'kills', value: 1200, limit: 2000 }]}
          pets={[{ character: 'Aria', pet: 'Lobo', owned: 1, required: 3 }]}
          gaps={['capture paused at 12s']}
        />
      </>,
    );
    expect(screen.getByRole('columnheader', { name: 'Ator' })).toBeTruthy();
    expect(screen.getAllByText('12.345,5')).toHaveLength(2);
    expect(screen.getByText('Aria · Golpe Feroz')).toBeTruthy();
    expect(screen.getByText('Aria · kills: 1.200 / 2.000')).toBeTruthy();
    expect(screen.getByText('Aria · Lobo: 1 / 3 almas')).toBeTruthy();
    expect(screen.getByText('Gravação incompleta: capture paused at 12s')).toBeTruthy();
  });
});
