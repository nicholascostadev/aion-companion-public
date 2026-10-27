import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classArt } from '../../lib/gameArt';
import type { GroupStatus } from '../../types/companion';
import { GroupPanel } from './GroupPanel';
import type { GroupStatusData } from './model';

afterEach(cleanup);
const status: GroupStatus = {
  capture_id: 10,
  running: true,
  phase: 'capturing',
  message: '',
  roster_seen: false,
  roster_age_ms: null,
  members: [],
  inspections: [
    {
      id: 2,
      name: 'ApplicantOne',
      class: 'Cleric',
      level: 45,
      gear_score: 2400,
      observed_ms: 1792200000000,
    },
    {
      id: 1,
      name: 'ApplicantTwo',
      class: 'Templar',
      level: 45,
      gear_score: 1800,
      observed_ms: 1792200001000,
    },
  ],
};
/** Today's backend shape: a roster with no CP, readiness, leader, lobby or capacity. */
const roster: GroupStatus = {
  ...status,
  roster_seen: true,
  roster_age_ms: 2000,
  members: [
    { name: 'ramtala', server_id: 1001, class: 'Ranger', level: 45 },
    { name: 'Diabolus', server_id: 1001, class: null, level: 45 },
  ],
  inspections: [],
};
/** Every optional field the backend may add later. */
const full: GroupStatusData = {
  ...roster,
  lobby_name: 'Deus Research Base (Transcendence)',
  capacity: 5,
  members: [
    {
      name: 'ramtala',
      server_id: 1001,
      class: 'Ranger',
      level: 45,
      gear_score: 2303,
      combat_power: 109681,
      ready: true,
      leader: true,
    },
    {
      name: 'Diabolus',
      server_id: 1001,
      class: 'Templar',
      level: 45,
      gear_score: 1944,
      combat_power: 85680,
      ready: true,
      leader: false,
    },
    {
      name: 'foxyyyynm',
      server_id: 1001,
      class: 'Cleric',
      level: 45,
      gear_score: 2159,
      combat_power: 93799,
      ready: true,
      leader: false,
    },
  ],
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
function openInspected() {
  fireEvent.click(screen.getByRole('button', { name: /Inspected profiles/ }));
}

describe('Group roster cards', () => {
  it('renders the full card layout when the game reports every field', () => {
    render(<GroupPanel {...props(full)} />);
    expect(screen.getByLabelText('3 of 5 members').textContent).toBe('3/5');
    expect(screen.getByText('3 ready')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: 'Deus Research Base (Transcendence)' }),
    ).toBeTruthy();
    expect(members().getByText('ramtala')).toBeTruthy();
    expect(members().getAllByText('Party leader')).toHaveLength(1);
    expect(members().getByText('GS 2,303 · Lv 45')).toBeTruthy();
    expect(members().getByText('109,681')).toBeTruthy();
    // Legacy rosters carry no observation time, so the ticks are never the fresh fill.
    expect(members().getAllByText('Ready, time not observed')).toHaveLength(3);
    expect(screen.getByText('3 ready').dataset.state).toBe('old');
    expect(members().getAllByText('Open slot')).toHaveLength(2);
    expect(screen.getByText('96,387')).toBeTruthy();
  });

  it('shows dashes, no ticks, no slots and no lobby guess when only the basic roster is known', () => {
    render(<GroupPanel {...props(roster)} />);
    expect(screen.getByLabelText('2 members, group size unknown').textContent).toBe('2');
    expect(screen.queryByText(/ready$/)).toBeNull();
    expect(screen.getByText('Live')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Dungeon unknown' })).toBeTruthy();
    expect(members().getAllByText('GS — · Lv 45')).toHaveLength(2);
    expect(members().getAllByText('—')).toHaveLength(2);
    expect(members().getAllByText('Ready state unknown')).toHaveLength(2);
    expect(members().queryByText('Ready')).toBeNull();
    expect(members().queryByText('Party leader')).toBeNull();
    expect(members().getByText('Class unknown')).toBeTruthy();
    expect(screen.queryByText('Open slot')).toBeNull();
    expect(screen.getByTitle('Average Combat Power').querySelector('b')?.textContent).toBe('—');
  });

  it('leads known classes with their original emblem and keeps unknown ones written', () => {
    render(<GroupPanel {...props(roster)} />);
    const ranger = members().getByText('Ranger');
    expect(ranger.querySelector('img')?.getAttribute('src')).toBe(classArt('Ranger')!.src);
    expect(members().getByText('Class unknown').querySelector('img')).toBeNull();
  });

  it('ignores a capacity smaller than the roster and averages only observed Combat Power', () => {
    const value: GroupStatusData = {
      ...full,
      capacity: 2,
      members: full.members.map((m, i) =>
        i === 2 ? { ...m, combat_power: null, ready: null } : m,
      ),
    };
    render(<GroupPanel {...props(value)} />);
    expect(screen.getByLabelText('3 members, group size unknown')).toBeTruthy();
    expect(screen.queryByText('Open slot')).toBeNull();
    expect(screen.getByText('97,681')).toBeTruthy();
    expect(screen.getByText('(2/3)')).toBeTruthy();
    expect(members().getAllByText('Ready, time not observed')).toHaveLength(2);
    expect(members().getByText('Ready state unknown')).toBeTruthy();
  });

  it('never borrows stats from a same-name inspected profile, even across servers', () => {
    const value: GroupStatusData = {
      ...full,
      members: [
        full.members[0]!,
        full.members[1]!,
        { name: 'Diabolus', server_id: 2002, class: null, level: 45 },
      ],
      inspections: [
        {
          id: 9,
          name: 'Diabolus',
          class: 'Sorcerer',
          level: 50,
          gear_score: 9999,
          combat_power: 999999,
          observed_ms: 1792200002000,
        },
      ],
    };
    render(<GroupPanel {...props(value)} />);
    const cards = members().getAllByRole('listitem');
    expect(within(cards[1]!).getByText('GS 1,944 · Lv 45')).toBeTruthy();
    expect(within(cards[1]!).getByText('85,680')).toBeTruthy();
    expect(within(cards[2]!).getByText('GS — · Lv 45')).toBeTruthy();
    expect(within(cards[2]!).getByText('—')).toBeTruthy();
    expect(within(cards[2]!).getByText('Class unknown')).toBeTruthy();
    expect(members().queryByText('Sorcerer')).toBeNull();
    expect(members().queryByText(/9,999/)).toBeNull();
    expect(members().queryByText('999,999')).toBeNull();
    expect(screen.getByText('97,681')).toBeTruthy();
    expect(screen.getByText('(2/3)')).toBeTruthy();
    openInspected();
    const rows = within(screen.getByRole('list', { name: 'Inspected profiles' }));
    expect(rows.getByText('Diabolus')).toBeTruthy();
    expect(rows.getByText('9,999')).toBeTruthy();
  });

  it('waits for the game without a start control, and hides via the header button', () => {
    const control = props({ ...status, phase: 'waiting_for_game', inspections: [] });
    render(<GroupPanel {...control} />);
    expect(screen.getByText('No group observed yet.')).toBeTruthy();
    expect(screen.getByText('Waiting for game')).toBeTruthy();
    expect(screen.getByText(/Members appear once the game connects/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /start/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hide Group panel' }));
    expect(control.onHide).toHaveBeenCalledOnce();
  });

  it('shows background capture errors', () => {
    render(
      <GroupPanel
        {...props({ ...status, running: false, phase: 'error', message: 'Npcap unavailable' })}
      />,
    );
    expect(screen.getByRole('status', { name: 'Group error' }).textContent).toBe(
      'Npcap unavailable',
    );
    expect(screen.getByText('Capture error')).toBeTruthy();
  });
});

describe('Inspected applicant profiles', () => {
  it('lists inspected applicants before joining, behind the secondary view', () => {
    render(<GroupPanel {...props()} />);
    expect(screen.queryByLabelText('Inspected profiles')).toBeNull();
    openInspected();
    const rows = within(screen.getByRole('list', { name: 'Inspected profiles' }));
    expect(rows.getByText('ApplicantOne')).toBeTruthy();
    expect(rows.getByText('Cleric')).toBeTruthy();
    expect(rows.getByText('2,400')).toBeTruthy();
    expect(screen.queryByText('DPS')).toBeNull();
  });

  it('supports name search and a user-defined gear score comparison', () => {
    render(<GroupPanel {...props()} />);
    openInspected();
    fireEvent.change(screen.getByLabelText('Minimum gear score'), { target: { value: '2000' } });
    expect(screen.getByText('Meets min')).toBeTruthy();
    expect(screen.getByText('Below min')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Compare ApplicantOne'));
    fireEvent.click(screen.getByLabelText('Compare ApplicantTwo'));
    expect(within(screen.getByLabelText('Profile comparison')).getByText('600')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Find inspected character'), {
      target: { value: 'Cleric' },
    });
    const rows = within(screen.getByLabelText('Inspected profiles'));
    expect(rows.queryByText('ApplicantTwo')).toBeNull();
    expect(rows.getByText('ApplicantOne')).toBeTruthy();
  });

  it('clears the old lobby observations while allowing newly inspected profiles', () => {
    const control = props();
    const view = render(<GroupPanel {...control} />);
    openInspected();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByText('No profiles inspected yet.')).toBeTruthy();
    view.rerender(
      <GroupPanel
        {...control}
        status={{
          ...status,
          inspections: [
            ...status.inspections,
            { ...status.inspections[0]!, id: 3, name: 'NewApplicant' },
          ],
        }}
      />,
    );
    expect(screen.getByText('NewApplicant')).toBeTruthy();
    expect(screen.queryByText('ApplicantOne')).toBeNull();
  });
});
