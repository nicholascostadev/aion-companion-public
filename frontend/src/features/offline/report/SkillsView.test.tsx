import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SETTINGS_FALLBACK } from '../../../lib/offlineNormalize';
import type { CombatReport, TargetMode } from '../../../types/offline';
import { nativeMob, nativeReport, report, scopedFight } from '../fixtures';
import type { ReportRoute } from './context';
import { ReportView } from './ReportView';

afterEach(() => {
  cleanup();
  // The metric choice is remembered on this computer; each test starts from the default.
  localStorage.clear();
});

const [aria, bryn] = nativeReport.players;
const open = (
  patch: Record<string, unknown> = {},
  tab: ReportRoute = 'details',
  settings = SETTINGS_FALLBACK,
) => render(<ReportView report={report(patch)} settings={settings} native initialTab={tab} />);
const list = () => screen.getByRole('list', { name: /skill breakdown/ });
const skills = () => within(list());
/** The skill rows, in the order shown. */
const rows = () => [...list().querySelectorAll<HTMLElement>(':scope > [data-ui="skill-row"]')];
const row = (name: string) => skills().getByRole('button', { name }).closest('li')!;
/** The labels of the metric figures a row prints under its name. */
const figures = (of: HTMLElement) =>
  [...of.querySelectorAll('[data-ui="figure"] > dt')].map((label) => label.textContent);
/** The metric chips, unfolding them from the toolbar first. */
const metrics = () => {
  if (!screen.queryByRole('group', { name: 'Visible metrics' }))
    fireEvent.click(screen.getByRole('button', { name: /^Metrics/ }));
  return within(screen.getByRole('group', { name: 'Visible metrics' }));
};
const players = () => within(screen.getByRole('group', { name: 'Player' }));
/** The queries of a table, as `within` binds them. */
interface Table {
  getAllByRole: (role: string) => HTMLElement[];
}
const headers = (table: Table) =>
  table.getAllByRole('columnheader').map((header) => header.textContent);
const bodyRows = (table: Table) => table.getAllByRole('row').slice(1) as HTMLTableRowElement[];
const DEFAULT_FIGURES = ['DPS', 'Casts', 'Hits', 'Direct', 'Crit', 'Min', 'Avg', 'Max'];
const withStance = {
  players: [
    { ...aria!, skills: [...aria!.skills, { id: 11000900, name: 'Focus Stance', casts: 4 }] },
    bryn!,
  ],
};

describe('skill rows', () => {
  it('reads as rows, never as a table that scrolls sideways', () => {
    const { container } = open();
    expect(screen.queryByRole('table', { name: /skill breakdown/ })).toBeNull();
    expect(container.querySelector('[data-ui="skill-rows"] [data-ui="table-scroll"]')).toBeNull();
    // The skill, its value and its share lead every row.
    expect(rows().map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      'Snipe',
      'Volley',
    ]);
    expect(row('Snipe').textContent).toContain('6,000');
    expect(row('Snipe').textContent).toContain('66.7%');
    expect(screen.getByText('2 skills')).toBeTruthy();
  });

  it('writes a long skill name in full, with no specialty tags beside it', () => {
    const long = 'Wrathful Judgment of the Abyssal Empyrean Lord: Awakened Thunder';
    const [snipe, ...rest] = aria!.skills;
    open({
      players: [
        {
          ...aria!,
          skills: [
            {
              ...snipe!,
              name: long,
              specialties: [
                { slot: 3, choice: 3 },
                { slot: 4, choice: 4 },
                { slot: 5, name: 'Rending Edge', description: 'Adds a bleed.', uses: 7 },
              ],
            },
            ...rest,
          ],
        },
        bryn!,
      ],
    });
    const name = skills().getByRole('button', { name: long });
    expect(name.textContent).toBe(long);
    // Nothing clips the name, and no specialty shares its line.
    expect(name.className).not.toMatch(/truncate|line-clamp|whitespace-nowrap/);
    expect(skills().queryByText(/Variant choice/)).toBeNull();
    expect(skills().queryByText('Rending Edge')).toBeNull();
    // The specialties native reported are in the opened detail, as reported.
    fireEvent.click(name);
    const detail = within(screen.getByRole('region', { name: `${long} hit detail` }));
    expect(detail.getByText('Specialties')).toBeTruthy();
    expect(detail.getByText('S3')).toBeTruthy();
    expect(detail.getByText('Variant choice 3')).toBeTruthy();
    expect(detail.getByText('Variant choice 4')).toBeTruthy();
    expect(detail.getByText('Rending Edge')).toBeTruthy();
    expect(detail.getByText('Adds a bleed.')).toBeTruthy();
    expect(detail.getByText('7 uses')).toBeTruthy();
  });

  it('opens with the default metrics and shows a group only when it is chosen', () => {
    open();
    const first = () => figures(rows()[0]!);
    expect(first()).toEqual(DEFAULT_FIGURES);
    // The chips stay folded away until they are asked for.
    expect(screen.queryByRole('group', { name: 'Visible metrics' })).toBeNull();
    fireEvent.click(metrics().getByRole('button', { name: 'Position' }));
    expect(first()).toEqual([
      ...DEFAULT_FIGURES.slice(0, 5),
      'Back',
      'Front',
      ...DEFAULT_FIGURES.slice(5),
    ]);
    fireEvent.click(metrics().getByRole('button', { name: 'All' }));
    expect(first()).toHaveLength(16);
    expect(skills().getByText('Lv 2')).toBeTruthy();
    fireEvent.click(metrics().getByRole('button', { name: 'Default' }));
    expect(first()).toEqual(DEFAULT_FIGURES);
    // Every optional group can go: the skill, its value and its share always stay.
    for (const group of ['Per second', 'Uses', 'Crit', 'Hit size'])
      fireEvent.click(metrics().getByRole('button', { name: group }));
    expect(first()).toEqual([]);
    expect(row('Snipe').textContent).toContain('6,000');
    expect(row('Snipe').textContent).toContain('66.7%');
  });

  it('remembers the chosen metrics for the next report', () => {
    open();
    fireEvent.click(metrics().getByRole('button', { name: 'Timing' }));
    cleanup();
    open();
    expect(figures(rows()[0]!)).toEqual([...DEFAULT_FIGURES, 'Avg gap', 'Charge']);
    expect(metrics().getByRole('button', { name: 'Timing' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('orders the rows by a shown figure, either way, and by name', () => {
    open();
    const order = () => screen.getByRole('combobox', { name: 'Sort' }) as HTMLSelectElement;
    const first = () => rows()[0]!.textContent;
    // Only figures that show can order the rows.
    expect(
      within(order())
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Damage', 'Name', ...DEFAULT_FIGURES.slice(1)]);
    fireEvent.change(order(), { target: { value: 'avg' } });
    expect(first()).toContain('Snipe');
    fireEvent.click(screen.getByRole('button', { name: 'Descending order' }));
    expect(first()).toContain('Volley');
    expect(screen.getByRole('button', { name: 'Ascending order' })).toBeTruthy();
    // Hiding the figure the rows are ordered by falls back to the ranking by damage.
    fireEvent.click(metrics().getByRole('button', { name: 'Hit size' }));
    expect(order().value).toBe('value');
    expect(first()).toContain('Snipe');
    fireEvent.change(order(), { target: { value: 'name' } });
    expect(first()).toContain('Snipe');
    fireEvent.click(screen.getByRole('button', { name: 'Ascending order' }));
    expect(first()).toContain('Volley');
  });

  it('says that hit flags were not observed only beside the metrics that need them', () => {
    const [snipe, volley] = aria!.skills;
    const unflagged = {
      players: [
        {
          ...aria!,
          flags_observed: null,
          back: null,
          skills: [{ ...snipe!, flags_observed: null, back: null }, volley!],
        },
        bryn!,
      ],
    };
    open(unflagged);
    expect(screen.queryByText(/flags were not observed in this capture/)).toBeNull();
    fireEvent.click(metrics().getByRole('button', { name: 'Position' }));
    expect(screen.getByText(/flags were not observed in this capture/)).toBeTruthy();
  });
});

describe('skill search and cast-only skills', () => {
  it('lists cast-only skills only on request', () => {
    open(withStance);
    const chip = screen.getByRole('button', { name: /Cast-only/ });
    expect(chip.textContent).toBe('Cast-only1');
    expect(skills().queryByText('Focus Stance')).toBeNull();
    fireEvent.click(chip);
    const stance = row('Focus Stance');
    // Cast but never hit: its casts are known, its hit figures are not zero but unknown.
    expect(within(stance).getByText('4')).toBeTruthy();
    expect(within(stance).getAllByText('—').length).toBeGreaterThan(3);
  });

  it('has nothing to offer when no skill was only cast', () => {
    open();
    const chip = screen.getByRole('button', { name: /Cast-only/ }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
  });

  it('searches skills by name and says when none match', () => {
    open(withStance);
    const search = screen.getByRole('searchbox', { name: 'Search skills' });
    fireEvent.change(search, { target: { value: 'vol' } });
    expect(rows()).toHaveLength(1);
    expect(skills().getByText('Volley')).toBeTruthy();
    // A hidden cast-only skill is not found until cast-only skills are listed.
    fireEvent.change(search, { target: { value: 'stance' } });
    expect(screen.getByText('No skill matches this search')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Cast-only/ }));
    expect(skills().getByText('Focus Stance')).toBeTruthy();
  });
});

describe('player tabs and whole-fight summary', () => {
  const summary = (name = 'Aria') =>
    within(screen.getByRole('region', { name: `${name} whole-fight output` }));
  const figure = (of: ReturnType<typeof summary>, label: string) =>
    of.getByText(label, { selector: 'dt' }).parentElement!.querySelector('dd')!.textContent;

  it('offers every player with their share of the party damage', () => {
    open();
    const tabs = players().getAllByRole('button');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['AriaYou90.0%', 'Bryn10.0%']);
    expect(tabs.map((tab) => tab.getAttribute('aria-pressed'))).toEqual(['true', 'false']);
    expect(tabs[1]!.getAttribute('title')).toBe('Bryn · 10.0% of the party’s damage');
  });

  it('changes whose breakdown shows in one press', () => {
    open();
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    expect(players().getByRole('button', { name: /Bryn/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('list', { name: 'Bryn skill breakdown' })).toBeTruthy();
    expect(figure(summary('Bryn'), 'Damage')).toBe('1,000');
    expect(screen.getByRole('complementary', { name: 'Buffs on Bryn' })).toBeTruthy();
    // Bryn only healed with a skill: the healing breakdown is one press away.
    expect(screen.getByText('No skills in this selection')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Healing' }));
    expect(skills().getByRole('button', { name: 'Heal' })).toBeTruthy();
  });

  it('gives the selected player’s output as native counted it over the whole fight', () => {
    open();
    expect(summary().getByText('Whole fight')).toBeTruthy();
    expect(figure(summary(), 'Damage')).toBe('9,000');
    expect(figure(summary(), 'DPS')).toBe('300');
    expect(figure(summary(), 'Party share')).toBe('90.0%');
    expect(figure(summary(), 'Hits')).toBe('5');
    // Crit 2 of 4 observed and back 1 of 2 observed, never over all hits.
    expect(figure(summary(), 'Crit')).toBe('50.0%');
    expect(figure(summary(), 'Back')).toBe('50.0%');
    expect(figure(summary(), 'Deaths')).toBe('1');
    expect(figure(summary(), 'Active ≈')).toBe('67%');
  });

  it('keeps unknown figures as dashes, never zeros', () => {
    open({ coverage: { ...nativeReport.coverage, healing: false } });
    // Heal packets were not observed: no healing per second is claimed for Aria.
    expect(figure(summary(), 'HPS')).toBe('—');
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    // Native reported no hit counters for Bryn; her recorded healing still gives a rate.
    for (const label of ['Hits', 'Crit', 'Back', 'Front', 'Casts', 'Deaths', 'Active ≈'])
      expect(figure(summary('Bryn'), label)).toBe('—');
    expect(figure(summary('Bryn'), 'HPS')).toBe('16.7');
  });

  it('never passes the fight totals off as figures of a time window', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    // The rows now come from the recorded events of 7.5 s to 22.5 s; the summary does not.
    expect(screen.getByText('From recorded events')).toBeTruthy();
    expect(summary().getByText('Whole fight')).toBeTruthy();
    expect(figure(summary(), 'Damage')).toBe('9,000');
    expect(figure(summary(), 'Hits')).toBe('5');
  });

  it('keeps your class private in the tabs and the summary while names are hidden', () => {
    open({}, 'skills', { ...SETTINGS_FALLBACK, hide_names: true });
    const tabs = players().getAllByRole('button');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['You90.0%', 'Cleric 210.0%']);
    // No emblem and no class word on your own tab; Aria is never named.
    expect(tabs[0]!.querySelector('img')).toBeNull();
    expect(players().queryByText(/Ranger/)).toBeNull();
    expect(screen.queryByText('Aria')).toBeNull();
    expect(screen.getByRole('region', { name: 'You whole-fight output' })).toBeTruthy();
    expect(screen.getByRole('complementary', { name: 'Buffs on You' })).toBeTruthy();
  });
});

describe('skill hit detail', () => {
  const detail = (name = 'Snipe') =>
    within(screen.getByRole('region', { name: `${name} hit detail` }));
  const hits = (name = 'Snipe') => within(screen.getByRole('table', { name: `${name} hits` }));
  const openSkill = (name: string) => fireEvent.click(skills().getByRole('button', { name }));

  it('unfolds under its row, with the recorded hits apart from the fight totals', () => {
    open();
    expect(screen.queryByRole('region', { name: /hit detail/ })).toBeNull();
    openSkill('Snipe');
    expect(skills().getByRole('button', { name: 'Snipe' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
    expect(row('Snipe').contains(screen.getByRole('region', { name: 'Snipe hit detail' }))).toBe(
      true,
    );
    // Native counted 3 hits and 2 crits over 3 observed; the report holds 2 hits in detail.
    expect(detail().getByText('2 of 3 · 66.7%')).toBeTruthy();
    expect(detail().getAllByText('1 of 2 · 50.0%')).toHaveLength(2);
    // Front, perfect, double and parry were decoded on both hits and never set.
    expect(detail().getAllByText('0 of 2 · 0.0%')).toHaveLength(4);
    expect(
      detail().getByText(/2 of this skill’s 3 fight hits are recorded in detail here/),
    ).toBeTruthy();
    // The variant choice native reported is here, not on the row.
    expect(detail().getByText('Variant choice 12')).toBeTruthy();
    const list = bodyRows(hits());
    expect(list.map((hit) => hit.cells[0]!.textContent)).toEqual(['0:01.1', '0:06.1']);
    expect(list.map((hit) => hit.cells[1]!.textContent)).toEqual(['Test Boss', 'Test Boss']);
    expect(list.map((hit) => hit.cells[2]!.textContent)).toEqual(['1,000', '5,000']);
    expect(list.map((hit) => hit.cells[3]!.textContent)).toEqual(['Back', 'Crit']);
  });

  it('opens from anywhere on the row and closes from the same place', () => {
    open();
    fireEvent.click(within(row('Volley')).getByText('Avg'));
    expect(screen.getByRole('region', { name: 'Volley hit detail' })).toBeTruthy();
    // Only one skill is open at a time.
    openSkill('Snipe');
    expect(screen.queryByRole('region', { name: 'Volley hit detail' })).toBeNull();
    expect(screen.getByRole('region', { name: 'Snipe hit detail' })).toBeTruthy();
    // Using the detail never folds it.
    fireEvent.click(detail().getByRole('button', { name: 'Largest first' }));
    expect(screen.getByRole('region', { name: 'Snipe hit detail' })).toBeTruthy();
    openSkill('Snipe');
    expect(screen.queryByRole('region', { name: /hit detail/ })).toBeNull();
  });

  it('marks ticks and leaves undecoded results unnamed', () => {
    open();
    openSkill('Volley');
    // No crit flag was decoded on Volley, in the fight totals or in the recorded hits.
    expect(detail('Volley').queryByText(/ of .* · /)).toBeNull();
    expect(detail('Volley').getByText('2 · 1 direct · 1 periodic')).toBeTruthy();
    // Native reported no specialty for Volley, so none is listed.
    expect(detail('Volley').queryByText('Specialties')).toBeNull();
    expect(bodyRows(hits('Volley')).map((hit) => hit.cells[3]!.textContent)).toEqual(['', 'Tick']);
    // Only results that occur can be chosen: no "Critical" or "Not critical" here.
    const options = within(detail('Volley').getByRole('combobox', { name: 'Result' }))
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(options).toEqual(['All hits', 'Periodic ticks (1)']);
  });

  it('narrows the list by result and orders it by size', () => {
    open();
    openSkill('Snipe');
    fireEvent.click(detail().getByRole('button', { name: 'Largest first' }));
    expect(bodyRows(hits()).map((hit) => hit.cells[2]!.textContent)).toEqual(['5,000', '1,000']);
    fireEvent.change(detail().getByRole('combobox', { name: 'Result' }), {
      target: { value: 'normal' },
    });
    expect(bodyRows(hits()).map((hit) => hit.cells[0]!.textContent)).toEqual(['0:01.1']);
    expect(detail().getByText('1 hit')).toBeTruthy();
  });

  it('follows the chosen target and time window', () => {
    open();
    openSkill('Snipe');
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    // The middle half of a 30 s fight: 7.5 s to 22.5 s holds no Snipe hit.
    expect(screen.getByText('From recorded events')).toBeTruthy();
    expect(detail().getByText('No recorded hits in this selection')).toBeTruthy();
    // The skill keeps a row that says so, without figures from another scope.
    expect(skills().getByText(/Nothing recorded for this skill/)).toBeTruthy();
    const header = list().querySelector('[data-ui="skill-row"][data-open] > div')!;
    expect(header.textContent).toContain('Snipe');
    expect(header.textContent).not.toContain('6,000');
    // The fight totals are still the whole fight's.
    expect(detail().getByText('2 of 3 · 66.7%')).toBeTruthy();
    expect(detail().queryByText(/fight hits are recorded in detail/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Whole fight' }));
    expect(bodyRows(hits())).toHaveLength(2);
    expect(row('Snipe').textContent).toContain('6,000');
  });

  it('keeps the opened skill and its hit filters through a search and a new order', () => {
    open();
    openSkill('Snipe');
    fireEvent.change(detail().getByRole('combobox', { name: 'Result' }), {
      target: { value: 'critical' },
    });
    expect(bodyRows(hits())).toHaveLength(1);
    // A search that does not match the open skill keeps its row, so the detail has a home.
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search skills' }), {
      target: { value: 'vol' },
    });
    expect(rows().map((r) => within(r).getAllByRole('button')[0]!.textContent)).toEqual([
      'Volley',
      'Snipe',
    ]);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort' }), { target: { value: 'hits' } });
    fireEvent.click(metrics().getByRole('button', { name: 'Timing' }));
    expect((detail().getByRole('combobox', { name: 'Result' }) as HTMLSelectElement).value).toBe(
      'critical',
    );
    expect(bodyRows(hits()).map((hit) => hit.cells[2]!.textContent)).toEqual(['5,000']);
  });

  it('says where a truncated live report starts instead of comparing counts', () => {
    open({ events_truncated: true, event_window_start_ms: 5200 });
    openSkill('Snipe');
    expect(detail().getByText(/the hit list starts at 0:05\.2/)).toBeTruthy();
    expect(detail().queryByText(/fight hits are recorded in detail/)).toBeNull();
  });

  it('jumps from a hit to the timeline', () => {
    open();
    openSkill('Snipe');
    fireEvent.click(hits().getByRole('button', { name: 'Show 0:06.1 on the timeline' }));
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('closes on request and when another player is chosen', () => {
    open();
    openSkill('Snipe');
    fireEvent.click(detail().getByRole('button', { name: 'Close hit detail' }));
    expect(screen.queryByRole('region', { name: /hit detail/ })).toBeNull();
    openSkill('Snipe');
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    expect(screen.queryByRole('region', { name: /hit detail/ })).toBeNull();
  });

  it('pages a long hit list', () => {
    const many = Array.from({ length: 120 }, (_, index) => ({
      at_ms: 8000 + index * 100,
      kind: 'damage',
      source: 1,
      target: 50,
      skill: 11000101,
      amount: 100 + index,
    }));
    open({ events: [...nativeReport.events, ...many] });
    openSkill('Snipe');
    expect(bodyRows(hits())).toHaveLength(50);
    expect(detail().getByText('122 hits · page 1 of 3')).toBeTruthy();
    fireEvent.click(detail().getByRole('button', { name: 'Next' }));
    fireEvent.click(detail().getByRole('button', { name: 'Next' }));
    expect(bodyRows(hits())).toHaveLength(22);
    // A filter returns to the first page.
    fireEvent.change(detail().getByRole('combobox', { name: 'Result' }), {
      target: { value: 'critical' },
    });
    expect(bodyRows(hits())).toHaveLength(1);
  });
});

describe('target scope of the recomputed breakdown', () => {
  const view = (scope: TargetMode, fight: CombatReport = scopedFight()) =>
    render(<ReportView report={fight} settings={SETTINGS_FALLBACK} native scope={scope} />);
  const hits = () => bodyRows(within(screen.getByRole('table', { name: 'Snipe hits' })));
  const listed = () => hits().map((hit) => [hit.cells[1]!.textContent, hit.cells[2]!.textContent]);
  const figure = (name: string) => within(row('Snipe')).getByText(name).parentElement!.textContent;
  const zoom = () => fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
  const kind = (name: string) =>
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Breakdown kind' })).getByRole('button', { name }),
    );

  it('keeps a zoomed breakdown and its hit list on bosses in a Bosses read', () => {
    view('boss');
    expect(screen.getByTitle('Targets counted in this report').textContent).toBe('Bosses');
    expect(row('Snipe').textContent).toContain('3,000');
    // 7.5 s to 22.5 s also holds Snipe's hit and cast on an ordinary monster.
    zoom();
    expect(screen.getByText('From recorded events')).toBeTruthy();
    expect(row('Snipe').textContent).toContain('3,000');
    expect(row('Snipe').textContent).not.toContain('3,700');
    expect(figure('Hits')).toBe('Hits2');
    expect(figure('Casts')).toBe('Casts1');
    fireEvent.click(skills().getByRole('button', { name: 'Snipe' }));
    const boss = [
      ['Test Boss', '1,000'],
      ['Test Boss', '2,000'],
    ];
    expect(listed()).toEqual(boss);
    expect(screen.queryByText(/fight hits are recorded in detail/)).toBeNull();
    // The whole fight lists the same hits, beside native's totals of the same scope.
    fireEvent.click(screen.getByRole('button', { name: 'Whole fight' }));
    expect(listed()).toEqual(boss);
    expect(row('Snipe').textContent).not.toContain('Elyos Scout');
  });

  it('counts every target in an All targets read', () => {
    view('all');
    zoom();
    expect(row('Snipe').textContent).toContain('3,700');
    expect(figure('Hits')).toBe('Hits3');
    fireEvent.click(skills().getByRole('button', { name: 'Snipe' }));
    expect(listed().map(([target]) => target)).toEqual(['Test Boss', 'Elyos Scout', 'Test Boss']);
  });

  it('leaves healing and damage taken on every target in a Bosses read', () => {
    view('boss');
    zoom();
    kind('Damage taken');
    const taken = screen.getByRole('list', { name: 'Damage Aria took by source and skill' });
    expect(taken.textContent).toContain('from Test Boss');
    expect(taken.textContent).toContain('from Elyos Scout');
    expect(screen.getByText('2 hit sources')).toBeTruthy();
    // Bryn's heal landed on a player, which is no boss either.
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    kind('Healing');
    expect(row('Heal').textContent).toContain('500');
    fireEvent.click(skills().getByRole('button', { name: 'Heal' }));
    expect(bodyRows(within(screen.getByRole('table', { name: 'Heal hits' })))).toHaveLength(1);
  });

  it('counts every target when a Bosses read met no boss or dummy', () => {
    view('boss', scopedFight([{ ...nativeReport.targets[0]!, boss: false }, nativeMob]));
    expect(screen.getByTitle('Targets counted in this report').textContent).toBe('All targets');
    zoom();
    expect(row('Snipe').textContent).toContain('3,700');
    fireEvent.click(skills().getByRole('button', { name: 'Snipe' }));
    expect(listed()).toHaveLength(3);
  });

  it('keeps every recorded event on the timeline', () => {
    view('boss');
    fireEvent.click(screen.getByRole('tab', { name: 'Timeline' }));
    const events = within(screen.getByRole('table', { name: 'Events' }));
    // The hit and the cast on the ordinary monster, and its hit on Aria.
    expect(events.getAllByText('Elyos Scout')).toHaveLength(3);
  });
});

describe('boss hit activity', () => {
  const activity = (name = 'Aria') =>
    within(screen.getByRole('region', { name: `${name} boss hit activity` }));
  const how = () => activity().getByRole('button', { name: 'How boss hit activity is measured' });

  it('shows the active share and gaps on one band, with the method a press away', () => {
    const { container } = open();
    // Hits on the boss at 1.1 s, 2.0 s, 2.3 s and 6.1 s: three active seconds of thirty.
    const fact = { selector: 'dd' };
    expect(activity().getByText('10.0%', fact)).toBeTruthy();
    expect(activity().getByText('3.00s of 30.0s', fact)).toBeTruthy();
    expect(activity().getByText('27.0s', fact)).toBeTruthy();
    expect(activity().getByText(/^23\.0s/, fact)).toBeTruthy();
    const band = container.querySelector('[data-ui="activity-band"]')!;
    expect(band.querySelectorAll('[data-state="active"]')).toHaveLength(2);
    expect(band.querySelectorAll('[data-state="gap"]')).toHaveLength(3);
    expect(band.querySelector('[data-state="unrecorded"]')).toBeNull();
    // The method never crowds the skills: it unfolds from its button, and folds again.
    expect(activity().queryByText(/cut into one-second bins/)).toBeNull();
    expect(screen.queryByRole('table', { name: 'Boss hit activity by player' })).toBeNull();
    expect(how().getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(how());
    expect(how().getAttribute('aria-expanded')).toBe('true');
    expect(activity().getByText(/cut into one-second bins/)).toBeTruthy();
    expect(activity().getByText(/hits on other targets never count/)).toBeTruthy();
    fireEvent.click(how());
    expect(activity().queryByText(/cut into one-second bins/)).toBeNull();
  });

  it('follows the selected window', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(activity().getByText('0.0%', { selector: 'dd' })).toBeTruthy();
    expect(activity().getByText('0.00s of 15.0s')).toBeTruthy();
  });

  it('compares the party and switches player from a row', () => {
    open();
    fireEvent.click(activity().getByRole('button', { name: 'Party comparison' }));
    const party = within(screen.getByRole('table', { name: 'Boss hit activity by player' }));
    const brynRow = party.getByText('Bryn').closest('tr')!;
    // A tenth of the party's damage, and never on the boss in the recorded events.
    expect(within(brynRow).getByText('10.0%')).toBeTruthy();
    expect(within(brynRow).getByText('0.0%')).toBeTruthy();
    fireEvent.click(brynRow);
    expect(activity('Bryn').getByText('0.00s of 30.0s')).toBeTruthy();
    expect(players().getByRole('button', { name: /Bryn/ }).getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('marks the part of a truncated live report it cannot measure', () => {
    const { container } = open({ events_truncated: true, event_window_start_ms: 5200 });
    // Said without asking: what was not recorded is never left to read as a gap.
    expect(activity().getByText('Not in this report')).toBeTruthy();
    expect(activity().getByText(/activity is measured from 0:05\.2/)).toBeTruthy();
    expect(activity().getByText('1.00s of 24.8s')).toBeTruthy();
    expect(container.querySelector('[data-state="unrecorded"]')).toBeTruthy();
  });

  it('is unavailable in a fight without a boss or training dummy', () => {
    open({ targets: [{ ...nativeReport.targets[0]!, boss: false, dummy: false }] });
    expect(screen.getByText(/needs a target the catalogue knows as a boss/)).toBeTruthy();
    expect(screen.queryByRole('region', { name: /boss hit activity$/ })).toBeNull();
  });
});

describe('buff uptime beside the skills', () => {
  const side = (name = 'Aria') =>
    within(screen.getByRole('complementary', { name: `Buffs on ${name}` }));
  const onAria = (patch: Record<string, unknown>) => ({
    buffs: [...nativeReport.buffs, { source: 2, target: 1, skill: 700, instance: 9, ...patch }],
  });

  it('words a timed application with no removal as duration-backed, never as an observed end', () => {
    // As native sends it: applied at 8 s for 12 s, with no removal packet.
    open(onAria({ start_ms: 8000, end_ms: 20_000 }));
    const buff = side().getByText('Skill #700').closest('li')!;
    expect(within(buff).getByText('40.0%').title).toBe('Timed uptime ÷ the window');
    expect(within(buff).getByText('12.0s').title).toMatch(
      /for the duration the game applied, or up to an earlier recorded removal\. Not proof/,
    );
    expect(within(buff).getByTitle('Skill #700 timed uptime')).toBeTruthy();
    // Backed by its duration, so no upper bound is offered for it.
    expect(buff.textContent).not.toContain('≤');
    expect(document.body.innerHTML).not.toMatch(/confirmed|end was observed/i);
  });

  it('gives the selected player’s timed uptime as figures on the skills view', () => {
    open();
    // The skills and the buffs are read together, without opening the buff analysis.
    expect(list()).toBeTruthy();
    const buff = side().getByText('Skill #500').closest('li')!;
    expect(within(buff).getByText('8.3%')).toBeTruthy();
    expect(within(buff).getByText('2.50s')).toBeTruthy();
    expect(within(buff).getByText('1×')).toBeTruthy();
    // Only what Aria carried: the mark she put on the boss belongs to the buff analysis.
    expect(side().queryByText('Skill #600')).toBeNull();
    expect(side().getByText(/On Aria · Whole fight/)).toBeTruthy();
  });

  it('never counts an open-ended application as timed uptime', () => {
    open(onAria({ start_ms: 5500, end_ms: null }));
    const buff = side().getByText('Skill #700').closest('li')!;
    expect(within(buff).getByText('0.0%')).toBeTruthy();
    expect(within(buff).getByText('0.00s')).toBeTruthy();
    expect(buff.textContent).toContain('≤ 81.7%');
    expect(within(buff).getByTitle(/counted as active through the report end/)).toBeTruthy();
    expect(within(buff).getByText(/≤ 81\.7%/).title).toMatch(/the most this buff can have been up/);
    // A timed buff never shows an upper bound.
    expect(side().getByText('Skill #500').closest('li')!.textContent).not.toContain('≤');
  });

  it('ranks by timed uptime and follows the selected window', () => {
    open(onAria({ start_ms: 8000, end_ms: 20_000 }));
    const names = () =>
      side()
        .getAllByRole('listitem')
        .map((item) => item.querySelector('.font-medium')!.textContent);
    expect(names()).toEqual(['Skill #700', 'Skill #500']);
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    // 7.5 s to 22.5 s: #500 ended at 2.5 s; #700 covers 12 of the 15 seconds.
    expect(names()).toEqual(['Skill #700']);
    expect(side().getByText('80.0%')).toBeTruthy();
    expect(side().getByText(/On Aria · 0:07\.5 – 0:22\.5/)).toBeTruthy();
  });

  it('says so when the player carried no buff, or buffs were not observed', () => {
    open();
    fireEvent.click(players().getByRole('button', { name: /Bryn/ }));
    expect(side('Bryn').getByText('No buffs on this player in this window.')).toBeTruthy();
    cleanup();
    open({ buffs: [], coverage: { ...nativeReport.coverage, buffs: false } });
    expect(side().getByText('Buff packets were not observed in this capture.')).toBeTruthy();
  });

  it('opens the full buff analysis over the skills, and returns to them', () => {
    open();
    fireEvent.click(skills().getByRole('button', { name: 'Snipe' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(side().getByRole('button', { name: 'Buff analysis' }));
    // A sheet named for what it is and whose it is; no fourth place appears.
    const analysis = within(screen.getByRole('dialog', { name: 'Buff analysis · Aria' }));
    expect(analysis.getByRole('table', { name: 'Buff uptime summary' })).toBeTruthy();
    expect(analysis.getByRole('region', { name: 'Buff timeline' })).toBeTruthy();
    expect(analysis.getByRole('region', { name: 'Buffs per skill' })).toBeTruthy();
    expect(screen.queryAllByRole('tab', { hidden: true })).toHaveLength(3);
    fireEvent.click(analysis.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    // Combat details are as they were left: the same place, with the opened skill.
    expect(screen.getByRole('tab', { name: 'Combat details' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByRole('region', { name: 'Snipe hit detail' })).toBeTruthy();
  });

  it('shares the player and the window with the analysis', () => {
    open();
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    fireEvent.click(side().getByRole('button', { name: 'Buff analysis' }));
    const analysis = within(screen.getByRole('dialog', { name: 'Buff analysis · Aria' }));
    // 7.5 s to 22.5 s, as chosen beneath: #500 ended at 2.5 s, so nothing is on Aria here.
    expect(analysis.getByText(/0:07\.5 – 0:22\.5/)).toBeTruthy();
    expect(analysis.getByText('No buffs in this scope and window')).toBeTruthy();
    fireEvent.change(analysis.getByRole('combobox', { name: 'Player' }), {
      target: { value: '2' },
    });
    expect(screen.getByRole('dialog', { name: 'Buff analysis · Bryn' })).toBeTruthy();
  });
});

describe('buff uptime summary', () => {
  const summary = () => within(screen.getByRole('table', { name: 'Buff uptime summary' }));

  it('heads the figures as timed, and says a duration is not an observed end', () => {
    open({}, 'buffs');
    expect(headers(summary())).toEqual([
      'Buff',
      'Applied',
      'Timed %',
      'Timed',
      'Avg length',
      'Open ends',
      'Open-end',
      'At most',
    ]);
    expect(
      screen.getByText(
        /Timed uptime counts each application for the duration the game applied, or up to an earlier recorded removal/,
      ).textContent,
    ).toMatch(
      /without a removal packet, the capture does not show that the buff lasted its full duration\. Open-end time comes from applications with no duration and no recorded removal.*an upper bound, not a measurement/,
    );
    expect(summary().getByTitle(/Not proof that the buff lasted that long/)).toBeTruthy();
    expect(
      summary().getByTitle('Applications with no duration and no recorded removal'),
    ).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/confirmed|end was observed/i);
  });

  it('gives timed uptime as figures for the buffs on the player', () => {
    open({}, 'buffs');
    expect(headers(summary())).not.toContain('On');
    const buff = summary().getByText('Skill #500').closest('tr')!;
    expect(within(buff).getByText('8.3%')).toBeTruthy();
    expect(within(buff).getAllByText('2.50s')).toHaveLength(2);
    // It has an end (a duration or a removal): nothing is open, so no upper bound is offered.
    expect(within(buff).getAllByText('—')).toHaveLength(3);
  });

  it('keeps an open-ended application out of timed uptime, as an upper bound', () => {
    open({}, 'buffs');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(headers(summary())).toContain('On');
    const buff = summary().getByText('Skill #600').closest('tr')!;
    expect(within(buff).getByText('Test Boss')).toBeTruthy();
    expect(within(buff).getByText('0.0%')).toBeTruthy();
    expect(within(buff).getByText('0.00s')).toBeTruthy();
    expect(buff.textContent).toContain('+ 24.5s');
    expect(within(buff).getByText('≤ 81.7%')).toBeTruthy();
  });

  it('sorts by a figure, searches, and narrows to the buffs the player applied', () => {
    open({}, 'buffs');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    const first = () => bodyRows(summary())[0]!.textContent;
    expect(first()).toContain('Skill #500');
    fireEvent.click(summary().getByRole('button', { name: 'At most' }));
    expect(first()).toContain('Skill #600');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search buffs' }), {
      target: { value: '#500' },
    });
    expect(bodyRows(summary())).toHaveLength(1);
    expect(first()).toContain('Skill #500');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search buffs' }), {
      target: { value: 'nothing' },
    });
    expect(screen.getByText('No buff matches this search')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Buff uptime summary' })).toBeNull();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search buffs' }), {
      target: { value: '' },
    });
    // Bryn applied #500; only #600 on the boss is Aria's.
    fireEvent.click(screen.getByRole('button', { name: 'Applied by Aria' }));
    expect(bodyRows(summary())).toHaveLength(1);
    expect(first()).toContain('Skill #600');
  });
});
