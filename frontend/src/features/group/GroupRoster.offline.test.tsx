import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_HOTKEYS } from '../../lib/offlineNormalize';
import { PreparationView } from '../live/PreparationView';
import { rosterColumns, type GroupStatusData } from './model';

/** The room as the DPS meter shows it before a run, unlocked so its hide control shows. */
function GroupPanel({
  onHide = () => {},
  ...props
}: {
  status: GroupStatusData | null;
  native: boolean;
  error: string;
  onHide?: () => void;
}) {
  return (
    <PreparationView
      group={props.status}
      native={props.native}
      error={props.error}
      locked={false}
      style={{}}
      drag={{}}
      hotkeys={DEFAULT_HOTKEYS}
      onHide={onHide}
    />
  );
}

const now = Date.now();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  localStorage.clear();
  // Pin the clock so relative ages do not drift while a busy suite runs.
  vi.useFakeTimers({ now, toFake: ['Date'] });
});
const status: GroupStatusData = {
  capture_id: 1,
  running: true,
  phase: 'capturing',
  message: '',
  roster_seen: true,
  roster_age_ms: 1000,
  capacity: 4,
  members: [
    {
      name: 'Second',
      server_id: 1,
      class: 'Cleric',
      level: 45,
      gear_score: 1800,
      combat_power: 70000,
      slot: 2,
      character_id: 'c2',
      ready: false,
      ready_observed_ms: now - 5000,
    },
    {
      name: 'First',
      server_id: 1,
      class: 'Ranger',
      level: 45,
      gear_score: 2300,
      combat_power: 110000,
      slot: 1,
      character_id: 'c1',
      ready: true,
      leader: true,
      ready_observed_ms: now - 5000,
    },
  ],
  inspections: [],
  ready_check: {
    active: null,
    started_ms: null,
    expires_ms: null,
    observed_ms: now - 5000,
    oldest_observed_ms: now - 5000,
    source: 'observed lobby member readiness',
    supported: true,
  },
};
function props(value: GroupStatusData = status) {
  return {
    status: value,
    native: true,
    error: '',
    onHide: vi.fn<() => void>(),
  };
}
const members = () => within(screen.getByRole('list', { name: 'Group members' }));

describe('Party room readiness and roster tools', () => {
  it('orders by 1-based slot and shows the raw slot', () => {
    render(<GroupPanel {...props()} />);
    const cards = members().getAllByRole('listitem');
    expect(within(cards[0]!).getByText('First')).toBeTruthy();
    expect(cards[0]!.title).toMatch(/slot 1$/);
  });

  it('reports observed readiness without claiming a ready-check round', () => {
    render(<GroupPanel {...props()} />);
    expect(screen.queryByText('Ready check')).toBeNull();
    expect(screen.getByText(/Readiness observed 5s ago/)).toBeTruthy();
    expect(screen.getByText('1 ready')).toBeTruthy();
    expect(members().getByText('Not ready')).toBeTruthy();
  });

  it('never shows old readiness as a fresh all-ready group', () => {
    const old = now - 20 * 60_000;
    const value: GroupStatusData = {
      ...status,
      members: status.members.map((m) => ({ ...m, ready: true })),
      ready_check: { ...status.ready_check, observed_ms: now - 1000, oldest_observed_ms: old },
    };
    render(<GroupPanel {...props(value)} />);
    const summary = screen.getByText('2 ready');
    expect(summary.dataset.state).toBe('old');
    expect(summary.dataset.state).not.toBe('all');
    expect(summary.title).toMatch(/oldest observation 20m ago/);
  });

  it('shows a ready-check banner only for an explicit active round', () => {
    const value: GroupStatusData = {
      ...status,
      ready_check: { ...status.ready_check, active: true, started_ms: now - 3000 },
    };
    render(<GroupPanel {...props(value)} />);
    expect(screen.getByText('Ready check')).toBeTruthy();
    expect(screen.getByText(/started 3s ago/)).toBeTruthy();
  });

  it('finds, sorts, flags minimums and compares members', () => {
    render(<GroupPanel {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Find & compare' }));
    fireEvent.change(screen.getByLabelText('Member minimum combat power'), {
      target: { value: '100000' },
    });
    expect(members().getAllByText('Below min')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Sort members'), { target: { value: 'name' } });
    expect(within(members().getAllByRole('listitem')[0]!).getByText('First')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Compare First'));
    fireEvent.click(screen.getByLabelText('Compare Second'));
    const comparison = within(screen.getByLabelText('Member comparison'));
    expect(comparison.getByText('500')).toBeTruthy();
    expect(comparison.getByText('40,000')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find group member'), { target: { value: 'cleric' } });
    expect(members().queryByText('First')).toBeNull();
  });
});

describe('Party room per-member readiness age', () => {
  it('keeps an old observation in its state but never as the fresh fill', () => {
    const value: GroupStatusData = {
      ...status,
      members: status.members.map((m) =>
        // Slot 1 ("First") leads the roster.
        m.slot === 1 ? { ...m, ready: true, ready_observed_ms: now - 20 * 60_000 } : m,
      ),
    };
    render(<GroupPanel {...props(value)} />);
    const cards = members().getAllByRole('listitem');
    const old = within(cards[0]!).getByText('Ready, observed 20m ago').parentElement!;
    expect(old.dataset.state).toBe('ready');
    expect(old.dataset.tone).toBe('old');
    expect(old.title).toContain('(20m ago, may have changed)');
    const fresh = within(cards[1]!).getByText('Not ready').parentElement!;
    expect(fresh.dataset.state).toBe('waiting');
    expect(fresh.dataset.tone).toBeUndefined();
  });

  it('treats a known state without an observation time as unconfirmed, not unknown', () => {
    const value: GroupStatusData = {
      ...status,
      members: status.members.map((m) => ({ ...m, ready: true, ready_observed_ms: null })),
      ready_check: null,
    };
    render(<GroupPanel {...props(value)} />);
    const marks = members().getAllByText('Ready, time not observed');
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.parentElement!.dataset.state === 'ready')).toBe(true);
    expect(members().queryByText('Ready state unknown')).toBeNull();
    const summary = screen.getByText('2 ready');
    expect(summary.dataset.state).toBe('old');
    expect(summary.title).toMatch(/observation time unknown for 2/);
  });
});

describe('Raid rooms in the meter', () => {
  const raid: GroupStatusData = {
    ...status,
    capacity: 12,
    members: Array.from({ length: 12 }, (_, i) => ({
      ...status.members[1]!,
      name: `Member${i + 1}`,
      character_id: `m${i + 1}`,
      slot: i + 1,
    })),
  };

  it('takes a second column only for more than one party', () => {
    expect(rosterColumns(6)).toBe(1);
    expect(rosterColumns(7)).toBe(2);
    expect(rosterColumns(12)).toBe(2);
  });

  it('lays a raid out as two parties of six once the meter is wide enough, scrolling otherwise', () => {
    render(<GroupPanel {...props(raid)} />);
    const list = screen.getByRole('list', { name: 'Group members' });
    expect(list.getAttribute('style')).toMatch(/--group-rows: repeat\(6,/);
    expect(list.className).toContain('@min-[34rem]:grid-flow-col');
    expect(within(list).getAllByRole('listitem')).toHaveLength(12);
    // The roster scrolls inside the meter, clipping its rows' click regions.
    expect(list.closest('[data-hit-clip]')?.className).toMatch(/overflow-y-auto/);
  });

  it('keeps a small party in one column', () => {
    render(<GroupPanel {...props()} />);
    expect(screen.getByRole('list', { name: 'Group members' }).className).not.toMatch(
      /grid-flow-col/,
    );
  });
});
