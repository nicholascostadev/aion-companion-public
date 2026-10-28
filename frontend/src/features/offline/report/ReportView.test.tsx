import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { classArt, skillArt } from '../../../lib/gameArt';
import { SETTINGS_FALLBACK } from '../../../lib/offlineNormalize';
import { nativeReport, report } from '../fixtures';
import { ReportView } from './ReportView';

afterEach(cleanup);
const tab = (name: string) => fireEvent.click(screen.getByRole('tab', { name }));

describe('combat report', () => {
  it('summarizes the fight with whole-encounter party DPS and the boss projection', () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    expect(screen.getByRole('heading', { name: 'Test Boss' })).toBeTruthy();
    expect(screen.getByText('whole encounter')).toBeTruthy();
    expect(screen.getByText('Defeated')).toBeTruthy();
    expect(screen.getByText(/Boss killed/)).toBeTruthy();
    // Coverage lists positions as not observed, and native warnings stay visible.
    expect(screen.getByText(/not observed: Positions/)).toBeTruthy();
    expect(screen.getByText('Capture quality: 2 stream gaps.')).toBeTruthy();
  });

  it('ranks players with observed-denominator rates and approximate activity', () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    const table = within(screen.getByRole('table', { name: 'Damage by player' }));
    const aria = table.getByText('Aria').closest('tr')!;
    // Crit 2/4 observed and back 1/2 observed both read 50%, never over all hits.
    expect(within(aria).getAllByText('50.0%')).toHaveLength(2);
    expect(within(aria).getByText('67%').getAttribute('title')).toMatch(/one-second bins/);
    expect(table.getByRole('button', { name: /Active ≈/ })).toBeTruthy();
  });

  it('hides names behind class and rank when privacy is on', () => {
    render(
      <ReportView report={report()} settings={{ ...SETTINGS_FALLBACK, hide_names: true }} native />,
    );
    const table = within(screen.getByRole('table', { name: 'Damage by player' }));
    expect(table.queryByText('Aria')).toBeNull();
    expect(table.getAllByText('You').length).toBeGreaterThan(0);
    expect(table.getByText('Cleric 2')).toBeTruthy();
  });

  it('breaks skills down with unknown rates shown as dashes, and variant choice labels', () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    tab('Skills');
    const table = within(screen.getByRole('table', { name: /skill breakdown/ }));
    const volley = table.getByText('Volley').closest('tr')!;
    expect(within(volley).getAllByText('—').length).toBeGreaterThan(3);
    expect(table.getByText('Variant choice 12')).toBeTruthy();
    expect(table.getByText('Lv 2')).toBeTruthy();
  });

  it('shows original class and skill artwork beside their written names', () => {
    const [aria, bryn] = nativeReport.players;
    const [top, ...rest] = aria!.skills;
    const chanter = report({
      players: [
        {
          ...aria!,
          class: 'Chanter',
          skills: [{ ...top!, id: 18060000, name: 'Impactful Crush' }, ...rest],
        },
        bryn!,
      ],
    });
    render(<ReportView report={chanter} settings={SETTINGS_FALLBACK} native />);
    const players = within(screen.getByRole('table', { name: 'Damage by player' }));
    const ariaRow = players.getByText('Aria').closest('tr')!;
    expect(ariaRow.querySelector('img')?.getAttribute('src')).toBe(classArt('Chanter')!.src);
    expect(ariaRow.textContent).toContain('Chanter');
    tab('Skills');
    const table = within(screen.getByRole('table', { name: /skill breakdown/ }));
    const crush = table.getByText('Impactful Crush').closest('tr')!;
    expect(crush.querySelector('img')?.getAttribute('src')).toBe(skillArt(18060000)!.src);
    expect(table.getByText('Volley').closest('tr')!.querySelector('img')).toBeNull();
  });

  it('separates observed casts from attack-sequence entries and explains a truncated opener', () => {
    render(
      <ReportView
        report={report({ events_truncated: true, event_window_start_ms: 900 })}
        settings={SETTINGS_FALLBACK}
        native
      />,
    );
    expect(screen.getByText(/detailed timeline here starts at 0:00/)).toBeTruthy();
    tab('Rotation');
    expect(screen.getByText(/2 observed casts/)).toBeTruthy();
    expect(screen.getByText(/1 attack-sequence entries/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Opener unavailable' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('row').find((r) => r.textContent?.includes('Volley'))!);
    expect(screen.getByText(/Attack-sequence entry 2 of 3/)).toBeTruthy();
  });

  it('labels buffs whose end was not observed', () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    tab('Buffs');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByTitle(/counted as active through the report end/)).toBeTruthy();
  });

  it('recaps player deaths and jumps to the timeline', () => {
    render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    tab('Deaths');
    const deaths = within(screen.getByRole('list', { name: 'Deaths' }));
    expect(deaths.getAllByRole('listitem')).toHaveLength(1);
    expect(deaths.getByText(/1 hits in the last 10s · 300 damage/)).toBeTruthy();
    fireEvent.click(deaths.getByRole('button', { name: 'Show on timeline' }));
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.getByText(/0:00\.0 – 0:20\.0/)).toBeTruthy();
  });

  it('copies a summary through the provided callback', async () => {
    const copy = vi.fn<(multiline: boolean) => Promise<void>>().mockResolvedValue();
    render(
      <ReportView
        report={report()}
        settings={SETTINGS_FALLBACK}
        native

        onCopySummary={copy}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Multi-line' }));
    await waitFor(() =>
      expect(screen.getByRole('status', { name: 'Copy status' }).textContent).toBe('Copied'),
    );
    expect(copy).toHaveBeenCalledWith(true);
  });
});

describe('ReportView target scope', () => {
  const scope = () => screen.queryByTitle('Targets counted in this report')?.textContent ?? null;
  const trash = {
    id: 51,
    npc_id: 901,
    name: 'Elyos Scout',
    boss: false,
    dummy: false,
    damage: 500,
  };

  it('names the scope the report was read in, and none when it is unknown', () => {
    const view = render(<ReportView report={report()} settings={SETTINGS_FALLBACK} native />);
    expect(scope()).toBeNull();
    view.rerender(<ReportView report={report()} settings={SETTINGS_FALLBACK} native scope="all" />);
    expect(scope()).toBe('All targets');
    view.rerender(
      <ReportView report={report()} settings={SETTINGS_FALLBACK} native scope="boss" />,
    );
    expect(scope()).toBe('Bosses');
  });

  it('reads the Bosses scope as every target for a fight that met no boss or dummy', () => {
    const fight = report({ targets: [trash] });
    render(<ReportView report={fight} settings={SETTINGS_FALLBACK} native scope="boss" />);
    expect(scope()).toBe('All targets');
  });
});
