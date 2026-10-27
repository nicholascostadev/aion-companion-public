import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LivePlayer, LiveStatus } from '../../types/companion';
import { LiveMeter } from './LiveMeter';

afterEach(cleanup);
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
function renderMeter(players: LivePlayer[], patch: Partial<LiveStatus> = {}) {
  const status: LiveStatus = {
    running: true,
    phase: 'capturing',
    message: 'Collecting damage',
    duration_ms: 2000,
    events: 3,
    stats: {},
    players,
    ...patch,
  };
  render(
    <LiveMeter
      status={status}
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
}

/** Unfolds the per-player breakdown, where every player has a heading. */
const openBreakdown = () =>
  fireEvent.click(screen.getByRole('button', { name: 'Skill breakdown and capture details' }));

describe('Live meter names', () => {
  it('keeps the backend label for payloads without identity fields', () => {
    renderMeter([player]);
    openBreakdown();
    expect(screen.getByRole('heading', { name: 'Gladiator #7' })).toBeTruthy();
  });
  it('separates observed names from pending identities', () => {
    renderMeter([
      { ...player, name: 'Aria', class: 'Chanter', name_known: true },
      { ...player, entity: 9, label: 'Chanter #9', class: 'Chanter', name_known: false },
    ]);
    openBreakdown();
    expect(screen.getByRole('heading', { name: 'Aria' }).title).toBe('Aria · Chanter');
    const pending = screen.getByRole('heading', { name: 'Player #9' });
    expect(pending.title).toBe('Name not received yet · Chanter (inferred) · entity #9');
    expect(screen.queryByText(/^Chanter #9$/)).toBeNull();
  });
});

describe('Automatic live capture', () => {
  it('has no start, stop or port controls and can save a report while capturing', () => {
    renderMeter([player], { history: [{ id: 1, duration_ms: 4000, events: 9 }] });
    expect(screen.getByText('Capturing')).toBeTruthy();
    for (const name of [/start/i, /stop/i])
      expect(screen.queryByRole('button', { name })).toBeNull();
    expect(screen.queryByLabelText(/server port/i)).toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Save comparison report' }).disabled,
    ).toBe(false);
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Reset live totals' }).disabled,
    ).toBe(false);
  });
  it('reports waiting, connecting and errors honestly', () => {
    renderMeter([], { phase: 'waiting_for_game', message: 'Waiting for the game connection.' });
    expect(screen.getByText('Waiting for game')).toBeTruthy();
    cleanup();
    renderMeter([], { running: false, phase: 'starting', message: 'Starting capture…' });
    expect(screen.getByText('Connecting')).toBeTruthy();
    cleanup();
    renderMeter([], { running: false, phase: 'error', message: 'Npcap is not installed.' });
    expect(screen.getByText('Capture error')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Live capture status' }).textContent).toBe(
      'Npcap is not installed.',
    );
  });
});
