import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../../lib/offlineNormalize';
import { nativeReport, report } from '../fixtures';
import { resolveRoute, type ReportRoute, type ReportTab } from './context';
import { ReportView } from './ReportView';

afterEach(() => {
  cleanup();
  // The skill metric choice is remembered on this computer.
  localStorage.clear();
});

const open = (
  route?: ReportRoute,
  patch: Record<string, unknown> = {},
  settings = SETTINGS_FALLBACK,
  onTabChange?: (tab: ReportTab) => void,
) =>
  render(
    <ReportView
      report={report(patch)}
      settings={settings}
      native
      {...(route ? { initialTab: route } : {})}
      {...(onTabChange ? { onTabChange } : {})}
    />,
  );
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));
const place = () => screen.getByRole('tab', { selected: true }).textContent;
const press = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
/** Whether Combat details break down this kind: Damage, Healing or Damage taken. */
const pressed = (name: string) =>
  within(screen.getByRole('group', { name: 'Breakdown kind' }))
    .getByRole('button', { name })
    .getAttribute('aria-pressed') === 'true';
/** The window the clock says is chosen. */
const clock = () => document.querySelector('[data-ui="time-range"]')!.textContent;
const players = () => within(screen.getByRole('group', { name: 'Player' }));
const moments = () => within(screen.getByRole('region', { name: 'Key moments' }));
/** The event the timeline has chosen: its time and its kind. */
const chosenEvent = () => {
  const row = document.querySelector<HTMLTableRowElement>('tr[data-selected]');
  return row ? [row.cells[0]!.textContent, row.cells[1]!.textContent] : null;
};
const [aria, bryn] = nativeReport.players;

describe('the three places of a report', () => {
  it('offers Combat details, Rotation and Timeline, and nothing else', () => {
    open();
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((item) => item.textContent)).toEqual([
      'Combat details',
      'Rotation',
      'Timeline',
    ]);
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('tablist', { name: 'Report views' })).toBeTruthy();
  });

  it('opens on the selected player, their skills and their buffs, with the rest folded away', () => {
    open();
    expect(players().getByRole('button', { pressed: true }).textContent).toContain('Aria');
    expect(screen.getByRole('region', { name: 'Aria whole-fight output' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Aria skill breakdown' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Buffs on Aria' })).toBeTruthy();
    expect(pressed('Damage')).toBe(true);
    // Nothing secondary is unfolded above the skill rows until it is asked for.
    expect(screen.queryByRole('region', { name: 'Player comparison' })).toBeNull();
    expect(screen.queryByRole('table', { name: 'Damage by player' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Biggest hit' })).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Compare players' }).getAttribute('aria-expanded'),
    ).toBe('false');
  });

  it('keeps the player, the time window and the breakdown across the three places', () => {
    open();
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    press('Healing');
    press('Zoom in');
    tab('Rotation');
    expect((screen.getByRole('combobox', { name: 'Player' }) as HTMLSelectElement).value).toBe('2');
    tab('Timeline');
    expect(clock()).toContain('0:07.5 – 0:22.5');
    tab('Combat details');
    expect(players().getByRole('button', { name: /Bryn/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(pressed('Healing')).toBe(true);
    expect(clock()).toContain('0:07.5 – 0:22.5');
    expect(screen.getByText('From recorded events')).toBeTruthy();
  });

  it('tells its owner only the three places, whatever led there', () => {
    const moved = vi.fn<(tab: ReportTab) => void>();
    open('damage', {}, SETTINGS_FALLBACK, moved);
    fireEvent.click(moments().getByRole('button', { name: /^Aria died at 0:04\.0/ }));
    tab('Rotation');
    tab('Combat details');
    fireEvent.click(moments().getByRole('button', { name: 'Death recaps' }));
    expect(moved.mock.calls.map(([to]) => to)).toEqual([
      'timeline',
      'rotation',
      'details',
      'timeline',
    ]);
  });
});

describe('what the earlier views held, inside Combat details', () => {
  it('compares the party on damage and chooses a player from a row', () => {
    open();
    press('Compare players');
    const comparison = within(screen.getByRole('region', { name: 'Player comparison' }));
    const table = within(comparison.getByRole('table', { name: 'Damage by player' }));
    // Every column of the party ranking is still there.
    expect(table.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Player',
      'Damage',
      'Share',
      'DPS',
      'eDPS',
      'aDPS',
      'Active ≈',
      'Crit',
      'Back',
      'Perfect',
      'Casts',
      'Deaths',
    ]);
    expect(comparison.getByText(/Whole fight, as the native engine counted it/)).toBeTruthy();
    fireEvent.click(table.getByText('Bryn').closest('tr')!);
    expect(players().getByRole('button', { name: /Bryn/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('list', { name: 'Bryn skill breakdown' })).toBeTruthy();
    // It folds again from the same button.
    press('Compare players');
    expect(screen.queryByRole('region', { name: 'Player comparison' })).toBeNull();
  });

  it('reads healing as a breakdown of its own, with the party and the recipients', () => {
    open();
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    press('Healing');
    const rows = within(screen.getByRole('list', { name: 'Bryn skill breakdown' }));
    expect(rows.getByRole('button', { name: 'Heal' }).closest('li')!.textContent).toContain('500');
    const recipients = within(screen.getByRole('region', { name: 'Healing by recipient' }));
    expect(recipients.getByText('Aria')).toBeTruthy();
    expect(recipients.getByText('Whole fight')).toBeTruthy();
    // The comparison follows the breakdown: one control, never a second set of views.
    press('Compare players');
    const table = within(screen.getByRole('table', { name: 'Healing by player' }));
    expect(table.getAllByRole('row')).toHaveLength(2);
    expect(within(table.getByText('Bryn').closest('tr')!).getByText('16.7')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Damage by player' })).toBeNull();
  });

  it('says that healing was not observed instead of showing an empty party', () => {
    open('healing', {
      players: [aria, { ...bryn!, healing: 0, skills: [], targets: [] }],
      coverage: { ...nativeReport.coverage, healing: false },
    });
    expect(screen.getByText('Heal packets were not observed in this fight.')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Healing by player' })).toBeNull();
  });

  it('lists the damage a player took by source and skill, from the recorded events', () => {
    open();
    press('Damage taken');
    const taken = within(
      screen.getByRole('list', { name: 'Damage Aria took by source and skill' }),
    );
    const claw = taken.getByText('Claw').closest('li')!;
    expect(claw.textContent).toContain('from Test Boss');
    expect(claw.textContent).toContain('300');
    expect(claw.textContent).toContain('100.0%');
    expect(within(claw).getByText('Hits').parentElement!.textContent).toBe('Hits1');
    expect(within(claw).getByText('Biggest').parentElement!.textContent).toBe('Biggest300');
    expect(screen.getByText('1 hit source')).toBeTruthy();
    // Always the events of the window, and labelled so; the skill tools make way.
    expect(screen.getByText('From recorded events')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Metrics/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'Target' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Aria skill breakdown' })).toBeNull();
    press('Compare players');
    const table = within(screen.getByRole('table', { name: 'Damage taken by player' }));
    const row = table.getByText('Aria').closest('tr')!;
    expect(within(row).getByText('300')).toBeTruthy();
    expect(within(row).getByText('120')).toBeTruthy();
  });

  it('searches and orders the damage taken, and follows the time window', () => {
    open('details', {
      events: [
        ...nativeReport.events,
        { at_ms: 3500, kind: 'damage', source: 50, target: 1, skill: 98, amount: 100 },
        { at_ms: 3600, kind: 'damage', source: 50, target: 1, skill: 98, amount: 150 },
      ],
    });
    press('Damage taken');
    const list = () => screen.getByRole('list', { name: 'Damage Aria took by source and skill' });
    const order = () =>
      [...list().children].map((item) => item.querySelector('.wrap-anywhere')!.textContent);
    expect(order()).toEqual(['Claw', 'Skill #98']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'hits' } });
    expect(order()).toEqual(['Skill #98', 'Claw']);
    press('Descending order');
    expect(order()).toEqual(['Claw', 'Skill #98']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: '#98' },
    });
    expect(order()).toEqual(['Skill #98']);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'nothing' },
    });
    expect(screen.getByText('No hit matches this search')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: '' },
    });
    // 7.5 s to 22.5 s holds none of the hits Aria took.
    press('Zoom in');
    expect(screen.getByText('No hits recorded in this window.')).toBeTruthy();
  });

  it('keeps the damage by target beside the skill rows', () => {
    open();
    const targets = within(screen.getByRole('region', { name: 'Damage by target' }));
    expect(targets.getByText('Test Boss')).toBeTruthy();
    expect(targets.getByText('100.0%')).toBeTruthy();
    press('Damage taken');
    expect(screen.queryByRole('region', { name: 'Damage by target' })).toBeNull();
  });
});

describe('deaths and highlights in the summary', () => {
  it('names each death and each highlight leader on one line', () => {
    open();
    const deaths = moments().getAllByRole('button', { name: /died at/ });
    expect(deaths.map((death) => death.textContent)).toEqual(['Aria0:04.0']);
    // The boss's own death is not a player's: it is no key moment.
    expect(moments().queryByText(/Test Boss/)).toBeNull();
    expect(
      moments().getByRole('button', {
        name: 'Biggest hit: 5,000, Aria, at 0:06.1. Show on timeline',
      }),
    ).toBeTruthy();
    // The first hit is itself a moment: its time is its figure, written once.
    const first = moments().getByRole('button', {
      name: 'First hit: Aria, at 0:01.1. Show on timeline',
    });
    expect(first.textContent).toBe('First hit0:01.1Aria');
  });

  it('opens the timeline on the exact moment of a death', () => {
    open();
    fireEvent.click(moments().getByRole('button', { name: /^Aria died at 0:04\.0/ }));
    expect(place()).toBe('Timeline');
    // A 20 s window around the moment, and the event itself chosen in the log.
    expect(clock()).toContain('0:00.0 – 0:20.0');
    expect(chosenEvent()).toEqual(['0:04.0', 'Death']);
  });

  it('opens the timeline on the exact moment of a highlight', () => {
    open();
    fireEvent.click(moments().getByRole('button', { name: /^Biggest hit: 5,000/ }));
    expect(place()).toBe('Timeline');
    expect(chosenEvent()).toEqual(['0:06.1', 'Damage']);
  });

  it('unfolds every highlight with its runners-up, in place', () => {
    open('details', {
      highlights: [
        ...nativeReport.highlights,
        { kind: 'healing', player: 2, value: 500, at_ms: null },
        { kind: 'healing', player: 1, value: 20, at_ms: null },
      ],
    });
    // A total over the fight is no moment: it waits with the rest, one press away.
    expect(moments().queryByText('Healing done')).toBeNull();
    const toggle = moments().getByRole('button', { name: /^All highlights/ });
    expect(toggle.textContent).toBe('All highlights3');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const healing = within(moments().getByRole('region', { name: 'Healing done' }));
    expect(healing.getByText('500')).toBeTruthy();
    expect(healing.getByRole('listitem').textContent).toBe('2Aria20');
    expect(place()).toBe('Combat details');
    fireEvent.click(
      within(moments().getByRole('region', { name: 'Biggest hit' })).getByRole('button', {
        name: 'Show on timeline',
      }),
    );
    expect(place()).toBe('Timeline');
    expect(chosenEvent()).toEqual(['0:06.1', 'Damage']);
  });

  it('leads to the death recaps on the timeline, and from a recap to its moment', () => {
    open();
    fireEvent.click(moments().getByRole('button', { name: 'Death recaps' }));
    expect(place()).toBe('Timeline');
    const deaths = within(screen.getByRole('list', { name: 'Deaths' }));
    expect(deaths.getByText(/1 hits in the last 10s · 300 damage/)).toBeTruthy();
    expect(deaths.getByText('Revived after 3.0s')).toBeTruthy();
    fireEvent.click(deaths.getByRole('button', { name: 'Show on timeline' }));
    expect(place()).toBe('Timeline');
    expect(chosenEvent()).toEqual(['0:04.0', 'Death']);
  });

  it('shows no key moments for a fight that has none', () => {
    open('details', {
      highlights: [],
      events: nativeReport.events.filter((event) => event.kind !== 'death'),
    });
    expect(screen.queryByRole('region', { name: 'Key moments' })).toBeNull();
    tab('Timeline');
    expect(screen.getByText('No deaths in this fight.')).toBeTruthy();
  });

  it('says so when deaths were not observed', () => {
    open('timeline', {
      events: nativeReport.events.filter((event) => event.kind !== 'death'),
      coverage: { ...nativeReport.coverage, deaths: false },
    });
    expect(screen.getByText(/Deaths are derived from observed HP updates/)).toBeTruthy();
  });

  it('folds a long list of recaps until it is asked for', () => {
    const wipe = {
      events: [
        ...nativeReport.events,
        ...[8000, 9000, 10_000].map((at_ms) => ({ at_ms, kind: 'death', source: 0, target: 1 })),
      ],
    };
    open('timeline', wipe);
    // Four recaps start folded, so the event log stays within reach.
    expect(screen.queryByRole('list', { name: 'Deaths' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Deaths 4/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
    cleanup();
    open('details', wipe);
    expect(moments().getAllByRole('button', { name: /died at/ })).toHaveLength(4);
    fireEvent.click(moments().getByRole('button', { name: 'Death recaps' }));
    expect(
      within(screen.getByRole('list', { name: 'Deaths' })).getAllByText(/^died at/),
    ).toHaveLength(4);
  });
});

describe('an earlier view named as the way in', () => {
  it('sends every earlier view to where its content lives now', () => {
    expect(resolveRoute('skills')).toEqual({ tab: 'details' });
    expect(resolveRoute('damage')).toEqual({
      tab: 'details',
      details: { kind: 'damage', party: true },
    });
    expect(resolveRoute('healing')).toEqual({
      tab: 'details',
      details: { kind: 'heal', party: true },
    });
    expect(resolveRoute('taken')).toEqual({
      tab: 'details',
      details: { kind: 'taken', party: true },
    });
    expect(resolveRoute('highlights')).toEqual({ tab: 'details', details: { highlights: true } });
    expect(resolveRoute('buffs')).toEqual({ tab: 'details', details: { buffs: true } });
    expect(resolveRoute('deaths')).toEqual({ tab: 'timeline', deaths: true });
    for (const tabName of ['details', 'rotation', 'timeline'] as const)
      expect(resolveRoute(tabName)).toEqual({ tab: tabName });
    // A name this build does not know, or one inherited from Object, opens Combat details.
    expect(resolveRoute('nonsense')).toEqual({ tab: 'details' });
    expect(resolveRoute('toString')).toEqual({ tab: 'details' });
  });

  it('opens Combat details on the skill rows for "skills"', () => {
    open('skills');
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('list', { name: 'Aria skill breakdown' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Player comparison' })).toBeNull();
  });

  it('opens the party comparison for "damage", "healing" and "taken"', () => {
    open('damage');
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('table', { name: 'Damage by player' })).toBeTruthy();
    expect(pressed('Damage')).toBe(true);
    cleanup();
    open('healing');
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('table', { name: 'Healing by player' })).toBeTruthy();
    expect(pressed('Healing')).toBe(true);
    cleanup();
    open('taken');
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('table', { name: 'Damage taken by player' })).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Damage Aria took by source and skill' })).toBeTruthy();
  });

  it('opens the highlights for "highlights" and the death recaps for "deaths"', () => {
    open('highlights');
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('region', { name: 'Biggest hit' })).toBeTruthy();
    cleanup();
    open('deaths');
    expect(place()).toBe('Timeline');
    expect(screen.getByRole('list', { name: 'Deaths' })).toBeTruthy();
  });

  it('opens the buff analysis over Combat details for "buffs"', () => {
    open('buffs');
    const analysis = within(screen.getByRole('dialog', { name: 'Buff analysis · Aria' }));
    expect(analysis.getByRole('table', { name: 'Buff uptime summary' })).toBeTruthy();
    fireEvent.click(analysis.getByRole('button', { name: 'Close' }));
    expect(place()).toBe('Combat details');
    expect(screen.getByRole('list', { name: 'Aria skill breakdown' })).toBeTruthy();
  });

  it('keeps the selected player the report was opened on', () => {
    render(
      <ReportView
        report={report()}
        settings={SETTINGS_FALLBACK}
        native
        initialTab="taken"
        initialPlayer="2"
      />,
    );
    expect(players().getByRole('button', { name: /Bryn/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    // Bryn took nothing in the recorded events: said, never borrowed from another player.
    expect(screen.getByText('No hits recorded.')).toBeTruthy();
    expect(screen.queryByText('Claw')).toBeNull();
  });
});

describe('links between the places', () => {
  it('goes from a skill to its first cast in the rotation, on the same player', () => {
    open();
    fireEvent.click(players().getByRole('button', { name: /Aria/ }));
    const rows = within(screen.getByRole('list', { name: 'Aria skill breakdown' }));
    fireEvent.click(rows.getByRole('button', { name: 'Snipe' }));
    const detail = within(screen.getByRole('region', { name: 'Snipe hit detail' }));
    fireEvent.click(detail.getByRole('button', { name: 'Rotation' }));
    expect(place()).toBe('Rotation');
    expect((screen.getByRole('combobox', { name: 'Player' }) as HTMLSelectElement).value).toBe('1');
    // The 20 s window around the first recorded Snipe hit at 1.1 s.
    expect(clock()).toContain('0:00.0 – 0:20.0');
  });

  it('goes from the longest boss gap to its middle on the timeline', () => {
    open();
    press('Show the longest gap on the timeline');
    expect(place()).toBe('Timeline');
    // The gap runs from 7 s to 30 s: a 20 s window around 18.5 s.
    expect(clock()).toContain('0:08.5 – 0:28.5');
  });

  it('searches the event log by who, on whom and with which skill', () => {
    open('timeline');
    const events = () => within(screen.getByRole('table', { name: 'Events' })).getAllByRole('row');
    const all = events().length;
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), {
      target: { value: 'volley' },
    });
    expect(events()).toHaveLength(3);
    expect(screen.getByText('2 events in this window')).toBeTruthy();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search events' }), {
      target: { value: '' },
    });
    expect(events()).toHaveLength(all);
  });
});

describe('privacy in the three places', () => {
  const hidden = { ...SETTINGS_FALLBACK, hide_names: true };

  it('never names a hidden player in the summary, the comparison or the damage taken', () => {
    open('taken', {}, hidden);
    expect(moments().getAllByRole('button', { name: /died at/ })[0]!.textContent).toBe('You0:04.0');
    expect(
      moments().getByRole('button', { name: /^Biggest hit: 5,000, You, at 0:06\.1/ }),
    ).toBeTruthy();
    expect(screen.getByRole('list', { name: 'Damage You took by source and skill' })).toBeTruthy();
    const table = within(screen.getByRole('table', { name: 'Damage taken by player' }));
    expect(table.getAllByText('You').length).toBeGreaterThan(0);
    // Your own class stays private: no emblem and no class word on your row.
    expect(table.queryByText('Ranger')).toBeNull();
    expect(screen.queryByText(/Aria/)).toBeNull();
    expect(screen.queryByText(/Bryn/)).toBeNull();
  });

  it('never names a hidden player in the death recaps or the buff analysis', () => {
    open('deaths', {}, hidden);
    const deaths = within(screen.getByRole('list', { name: 'Deaths' }));
    expect(deaths.getByText('You')).toBeTruthy();
    expect(screen.queryByText(/Aria/)).toBeNull();
    cleanup();
    open('buffs', {}, hidden);
    expect(screen.getByRole('dialog', { name: 'Buff analysis · You' })).toBeTruthy();
    expect(screen.queryByText(/Aria/)).toBeNull();
  });
});
