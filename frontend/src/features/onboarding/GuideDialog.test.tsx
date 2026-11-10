import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SETTINGS_FALLBACK } from '../../lib/offlineNormalize';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { FinderPreferencesControl } from '../../lib/finderPreferences';
import { DEFAULT_FINDER_PREFERENCES } from '../../types/finderPreferences';
import type { OfflineSettings } from '../../types/offline';
import type { SetupState } from '../../types/setup';
import { dashboard, NOW, rule } from '../alerts/fixtures';
import { catalogue as petCatalogue, status as petsStatus } from '../pets/fixtures';
import { indexCatalogue } from '../pets/model';
import { setupStatus } from '../setup/fixtures';
import bundled from './deus-demo.json';
import { parseDemo, type DemoFight } from './demo';
import { GuideDialog, type GuideDialogProps, type GuideFacts, type GuidePets } from './GuideDialog';
import type { ChapterId, Decisions } from './model';
import type { SaveSettings } from './steps';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const demo = parseDemo(bundled) as DemoFight;
const settings: OfflineSettings = { ...SETTINGS_FALLBACK, locale: 'en', hide_names: false };

type Alerts = GuideFacts['alerts'];

function alerts(patch: Partial<Alerts> = {}): Alerts {
  return {
    dashboard: null,
    error: '',
    busy: false,
    offsetMs: 0,
    configure: vi.fn<Alerts['configure']>().mockResolvedValue(true),
    action: vi.fn<Alerts['action']>().mockResolvedValue(true),
    test: vi.fn<Alerts['test']>().mockResolvedValue(true),
    now: () => NOW,
    ...patch,
  };
}

function explorePrefs(patch: Partial<FinderPreferencesControl> = {}): FinderPreferencesControl {
  return {
    prefs: DEFAULT_FINDER_PREFERENCES,
    phase: 'ready',
    saving: false,
    error: '',
    update: vi.fn<FinderPreferencesControl['update']>(),
    retry: vi.fn<() => void>(),
    ...patch,
  };
}

function facts(patch: Partial<GuideFacts> = {}): GuideFacts {
  const setup: SetupState = {
    status: setupStatus('missing'),
    error: '',
    checking: false,
    recheck: vi.fn<SetupState['recheck']>().mockResolvedValue(),
    open: vi.fn<SetupState['open']>().mockResolvedValue(''),
  };
  return {
    native: true,
    capture: 'connecting',
    captureError: '',
    adapters: null,
    setup,
    settings,
    savedFights: 4,
    saveSettings: vi.fn<SaveSettings>().mockResolvedValue(true),
    settingsError: '',
    meter: {
      known: true,
      busy: false,
      visible: false,
      suspended: false,
      setVisible: vi.fn<(visible: boolean) => Promise<boolean>>().mockResolvedValue(true),
    },
    alerts: alerts(),
    explore: { prefs: explorePrefs() },
    pets: {
      status: null,
      error: '',
      busy: false,
      index: null,
      catalogueError: '',
      farming: {
        busy: false,
        notice: '',
        start: vi.fn<GuidePets['farming']['start']>().mockResolvedValue(true),
        stop: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
      },
      setPinned: vi.fn<GuidePets['setPinned']>().mockResolvedValue(true),
      radar: {
        status: {
          requested: false,
          visible: false,
          ready: false,
          locked: true,
          game_active: false,
          errors: [],
        },
        known: true,
        busy: false,
        error: '',
        setRequested: vi.fn<(requested: boolean) => Promise<boolean>>().mockResolvedValue(true),
      },
    },
    updates: {
      status: {
        channel: 'stable',
        current_version: '0.7.55',
        latest_version: '0.7.55',
        phase: 'current',
        error: null,
        checked_ms: NOW,
        release_url: null,
        notes: null,
        restart_supported: true,
        repository: '',
      },
      error: '',
      busy: false,
      check: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    },
    ...patch,
  };
}

function props(chapter: ChapterId, patch: Partial<GuideDialogProps> = {}): GuideDialogProps {
  return {
    open: true,
    chapter,
    seen: [chapter],
    decisions: {},
    facts: facts(),
    demo,
    reducedMotion: true,
    pageVisible: true,
    onChapter: vi.fn<(chapter: ChapterId) => void>(),
    onDecide: vi.fn<GuideDialogProps['onDecide']>(),
    onClose: vi.fn<() => void>(),
    onFinish: vi.fn<() => void>(),
    ...patch,
  };
}

const dialog = () => screen.getByRole('dialog', { name: 'Getting started' });
const button = (name: string | RegExp) => within(dialog()).getByRole('button', { name });

/** Runs the change a step asked to save against `from`, as native's newest settings. */
const applied = (save: GuideFacts['saveSettings'], from: OfflineSettings, call = 0) =>
  vi.mocked(save).mock.calls[call]![0](from);

describe('language step', () => {
  it('asks in both languages, each language written in its own', () => {
    render(<GuideDialog {...props('language')} />);
    const heading = dialog().querySelector('[data-onboarding="heading"]')!;
    expect(heading.textContent).toContain('Choose your language');
    expect(heading.textContent).toContain('Escolha o seu idioma');
    const pt = button(/Português \(Brasil\)/);
    expect(pt.getAttribute('lang')).toBe('pt-BR');
    expect(pt.textContent).toContain('Continuar em português');
    expect(button(/English/).textContent).toContain('Continue in English');
    // The first step needs no reading: the way on is a language, not Next.
    expect(within(dialog()).queryByRole('button', { name: /^Next/ })).toBeNull();
  });

  it('saves only the language, and moves on once the save succeeds', async () => {
    let resolve!: (ok: boolean) => void;
    const save = vi.fn<SaveSettings>(() => new Promise((r) => (resolve = r)));
    const p = props('language', { facts: facts({ saveSettings: save }) });
    render(<GuideDialog {...p} />);
    fireEvent.click(button(/Português/));
    expect(applied(save, settings)).toEqual({ ...settings, locale: 'pt-BR' });
    expect(button(/Português/).textContent).toContain('Salvando…');
    expect(p.onDecide).not.toHaveBeenCalled();
    await act(async () => resolve(true));
    expect(p.onDecide).toHaveBeenCalledWith('language', 'done');
  });

  it('saves nothing when the language chosen is already the saved one', () => {
    const p = props('language');
    render(<GuideDialog {...p} />);
    fireEvent.click(button(/English/));
    expect(applied(p.facts.saveSettings, settings)).toBeNull();
    expect(applied(p.facts.saveSettings, { ...settings, locale: 'pt' })).toEqual({
      ...settings,
      locale: 'en',
    });
  });

  it('says a failed save in the chosen language and tries again from there', async () => {
    const save = vi.fn<SaveSettings>().mockResolvedValue(false);
    const p = props('language', { facts: facts({ saveSettings: save }) });
    render(<GuideDialog {...p} />);
    await act(async () => fireEvent.click(button(/Português/)));
    expect(within(dialog()).getByText(/O idioma não foi salvo/)).toBeTruthy();
    expect(p.onDecide).not.toHaveBeenCalled();
    save.mockResolvedValue(true);
    await act(async () => fireEvent.click(button('Tentar de novo')));
    expect(save).toHaveBeenCalledTimes(2);
    expect(p.onDecide).toHaveBeenCalledWith('language', 'done');
  });
});

describe('setup steps', () => {
  it('lets capture be set up later without claiming it works', () => {
    const p = props('capture');
    render(<GuideDialog {...p} />);
    expect(within(dialog()).getByText('Npcap: Not installed')).toBeTruthy();
    expect(within(dialog()).getByText(/Finish waits until capture works/)).toBeTruthy();
    expect(within(dialog()).queryByRole('button', { name: /^Next/ })).toBeNull();
    fireEvent.click(button('Get Npcap'));
    expect(p.facts.setup.open).toHaveBeenCalledWith('npcap');
    fireEvent.click(button('Set up later'));
    expect(p.onDecide).toHaveBeenCalledWith('capture', 'later');
  });

  it('moves on from capture once Npcap works and capture waits for the game', () => {
    const f = facts({ capture: 'waiting' });
    f.setup = { ...f.setup, status: setupStatus('ready') };
    const p = props('capture', { facts: f });
    render(<GuideDialog {...p} />);
    expect(within(dialog()).getByText(/Capture works/)).toBeTruthy();
    fireEvent.click(button(/Next: DPS meter/));
    expect(p.onDecide).toHaveBeenCalledWith('capture', 'done');
  });

  it('saves auto-save in place, keeping every other setting, and reports a failure', async () => {
    const save = vi.fn<SaveSettings>().mockResolvedValue(false);
    const p = props('inspect', {
      facts: facts({ saveSettings: save, settingsError: 'disk full' }),
    });
    render(<GuideDialog {...p} />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: /Auto-save/ })),
    );
    expect(applied(save, { ...settings, region: 'twkr' })).toEqual({
      ...settings,
      region: 'twkr',
      auto_save: !settings.auto_save,
    });
    expect(within(dialog()).getByText('That change was not saved: disk full')).toBeTruthy();
    fireEvent.click(button('Looks good, continue'));
    expect(p.onDecide).toHaveBeenCalledWith('inspect', 'done');
  });

  it('offers reminders only once they are on, and skipping changes nothing', () => {
    const off = dashboard();
    off.config.rules = [rule({ enabled: false })];
    const p = props('alerts', { facts: facts({ alerts: alerts({ dashboard: off }) }) });
    const { rerender } = render(<GuideDialog {...p} />);
    expect((button('Use these reminders') as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).getByText(/at least one alert/)).toBeTruthy();
    fireEvent.click(button('Skip reminders'));
    expect(p.onDecide).toHaveBeenLastCalledWith('alerts', 'skipped');
    expect(p.facts.alerts.configure).not.toHaveBeenCalled();
    rerender(<GuideDialog {...p} facts={facts({ alerts: alerts({ dashboard: dashboard() }) })} />);
    fireEvent.click(button('Use these reminders'));
    expect(p.onDecide).toHaveBeenLastCalledWith('alerts', 'done');
  });

  it('switches Explore layers through the saved choices', () => {
    const prefs = explorePrefs();
    render(<GuideDialog {...props('explore', { facts: facts({ explore: { prefs } }) })} />);
    fireEvent.click(within(dialog()).getByRole('switch', { name: /Hidden cubes/ }));
    expect(prefs.update).toHaveBeenCalledWith({ visibility: { cubes: false } });
  });

  it('shows the farming goal and lets pet farming be skipped or continued', () => {
    const withGoal = petsStatus();
    withGoal.config = { ...withGoal.config, farming_goal: { pet_id: 2, map_id: 'm' } };
    const f = facts();
    f.pets = { ...f.pets, status: withGoal };
    const p = props('pets', { facts: f });
    render(<GuideDialog {...p} />);
    expect(within(dialog()).getByText(/Farming #2 on m/)).toBeTruthy();
    fireEvent.click(button('Use pet farming'));
    expect(p.onDecide).toHaveBeenCalledWith('pets', 'done');
  });

  it('pins a pet to the radar in place, and counts a pin as using pet farming', async () => {
    const f = facts();
    const index = indexCatalogue(petCatalogue(), createTestI18n('en').getFixedT('en', 'pets'));
    f.pets = { ...f.pets, status: petsStatus(), index };
    const p = props('pets', { facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    expect((button('Use pet farming') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(dialog()).getByRole('searchbox', { name: 'Find a pet' }), {
      target: { value: 'barn' },
    });
    fireEvent.click(button(/Barn Owl/));
    // Farming opens the radar too, and says so before it is pressed.
    expect(within(dialog()).getByText(/then opens the pet radar over the game/)).toBeTruthy();
    await act(async () => fireEvent.click(button('Pin to the radar')));
    expect(f.pets.setPinned).toHaveBeenCalledWith(2, true);
    expect(f.pets.farming.start).not.toHaveBeenCalled();
    expect(f.pets.radar.setRequested).not.toHaveBeenCalled();
    const pinned = petsStatus();
    pinned.config = { ...pinned.config, pinned_ids: [2] };
    rerender(<GuideDialog {...p} facts={{ ...f, pets: { ...f.pets, status: pinned } }} />);
    expect(within(dialog()).getByText('1 pet pinned')).toBeTruthy();
    fireEvent.click(button('Use pet farming'));
    expect(p.onDecide).toHaveBeenCalledWith('pets', 'done');
  });

  it('sets the server clock, mute and quiet hours inside the alerts step', async () => {
    const unknown = dashboard({ clock_estimated: true });
    unknown.config = { ...unknown.config, region: 'global' };
    const a = alerts({ dashboard: unknown });
    render(<GuideDialog {...props('alerts', { facts: facts({ alerts: a }) })} />);
    expect(within(dialog()).getByText('Your server is not known yet')).toBeTruthy();
    const settings = within(dialog().querySelector('[data-onboarding="alert-settings"]')!);
    await act(async () =>
      fireEvent.change(settings.getByRole('combobox', { name: /Region/ }), {
        target: { value: 'eu' },
      }),
    );
    const change = vi.mocked(a.configure).mock.calls[0]![0];
    expect(change(unknown.config)).toMatchObject({ region: 'eu', timezone: 'Europe/Berlin' });
    await act(async () => fireEvent.click(settings.getByRole('switch', { name: /Quiet hours/ })));
    expect(vi.mocked(a.configure).mock.calls[1]![0](unknown.config).quiet_hours).toEqual({
      start: '23:00',
      end: '07:00',
    });
    expect(settings.getByRole('switch', { name: /background/i })).toBeTruthy();
    await act(async () =>
      fireEvent.change(within(dialog()).getByRole('combobox', { name: 'Mute alerts for' }), {
        target: { value: '3600' },
      }),
    );
    expect(a.action).toHaveBeenCalledWith('mute', null, 3600);
  });

  it('chooses gathering resources in place, saved to the shared Explore choices', () => {
    const prefs = explorePrefs();
    render(<GuideDialog {...props('explore', { facts: facts({ explore: { prefs } }) })} />);
    fireEvent.click(button('Gathering resources'));
    const filter = within(dialog().querySelector('[data-onboarding="gathering-filter"]')!);
    const map = filter.getByRole('combobox', { name: 'Map' }) as HTMLSelectElement;
    expect(map.options.length).toBeGreaterThan(0);
    fireEvent.click(filter.getByRole('checkbox', { name: /^Ore/ }));
    const patch = vi.mocked(prefs.update).mock.calls[0]![0];
    expect(Object.keys(patch)).toEqual(['hidden_resources']);
    expect(patch.hidden_resources!.length).toBeGreaterThan(0);
    expect(patch.hidden_resources!.every((key) => /^item:\d+$/.test(key))).toBe(true);
    // The map only chooses what is listed: it is never saved as Explore's map.
    const other = map.options[map.options.length - 1]!.value;
    fireEvent.change(map, { target: { value: other } });
    expect(map.value).toBe(other);
    expect(vi.mocked(prefs.update).mock.calls.some(([p]) => 'chosen_map' in p)).toBe(false);
  });
});

describe('changes made on a step', () => {
  it('keeps a failed save on its own step, with a retry there', async () => {
    const save = vi.fn<SaveSettings>().mockResolvedValue(false);
    const f = facts({ saveSettings: save, settingsError: 'disk full' });
    const p = props('inspect', { facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: /Auto-save/ })),
    );
    expect(within(dialog()).getByText(/That change was not saved: disk full/)).toBeTruthy();
    // Elsewhere the failure is not shown, but the rail and the review still name its step.
    rerender(<GuideDialog {...p} chapter="profiles" />);
    expect(dialog().querySelector('[data-onboarding="step-failed"]')).toBeNull();
    const rail = within(dialog()).getByRole('navigation', { name: 'Setup steps' });
    expect(within(rail).getByRole('button', { name: /Saved fights/ }).dataset.state).toBe(
      'problem',
    );
    rerender(<GuideDialog {...p} chapter="review" />);
    const block = dialog().querySelector('[data-block="problem"]') as HTMLElement;
    expect(within(block).getByRole('button', { name: 'Saved fights' })).toBeTruthy();
    rerender(<GuideDialog {...p} chapter="inspect" />);
    save.mockResolvedValue(true);
    await act(async () => fireEvent.click(button('Try again')));
    expect(save).toHaveBeenCalledTimes(2);
    expect(vi.mocked(save).mock.calls[1]![0]).toBe(vi.mocked(save).mock.calls[0]![0]);
    expect(dialog().querySelector('[data-onboarding="step-failed"]')).toBeNull();
  });

  it('reports a meter window that did not change on the meter step', async () => {
    const f = facts();
    vi.mocked(f.meter.setVisible).mockResolvedValue(false);
    render(<GuideDialog {...props('meter', { facts: f })} />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: 'DPS meter' })),
    );
    expect(f.meter.setVisible).toHaveBeenCalledExactlyOnceWith(true);
    expect(within(dialog()).getByText('That change was not saved. Try again.')).toBeTruthy();
  });

  it('leaves locking the meter to the game, teaching its shortcut instead', () => {
    render(<GuideDialog {...props('meter')} />);
    expect(within(dialog()).getByRole('switch', { name: 'DPS meter' })).toBeTruthy();
    expect(within(dialog()).queryByRole('button', { name: /locked|unlocked/i })).toBeNull();
    expect(dialog().textContent).toMatch(/Place the meter first/);
  });
});

describe('shortcuts on the meter step', () => {
  const allDone: Decisions = {
    language: 'done',
    capture: 'done',
    meter: 'done',
    inspect: 'done',
    profiles: 'done',
    alerts: 'skipped',
    pets: 'skipped',
    explore: 'skipped',
    updates: 'done',
  };
  const readyFacts = (patch: Partial<GuideFacts> = {}) => {
    const f = facts({ capture: 'capturing', ...patch });
    f.setup = { ...f.setup, status: setupStatus('ready') };
    return f;
  };
  const shortcut = (label: string) =>
    within(dialog()).getByRole('textbox', { name: label }) as HTMLInputElement;
  const press = (label: string, code: string, mods: { ctrlKey?: boolean; shiftKey?: boolean }) => {
    const input = shortcut(label);
    fireEvent.focus(input);
    fireEvent.keyDown(input, { key: code, code, ...mods });
  };
  const openShortcuts = () => fireEvent.click(button('Shortcuts'));
  const rail = (step: string) =>
    within(within(dialog()).getByRole('navigation', { name: 'Setup steps' })).getByRole('button', {
      name: new RegExp(step),
    });

  it('cancels recording with Escape and keeps the guide open; Escape elsewhere closes it', () => {
    const p = props('meter');
    render(<GuideDialog {...p} />);
    openShortcuts();
    const input = shortcut('Copy summary');
    fireEvent.focus(input);
    expect(input.dataset.recording).toBe('true');
    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' });
    expect(input.dataset.recording).toBeUndefined();
    expect(p.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog().querySelector('[data-onboarding="heading"]')!, {
      key: 'Escape',
      code: 'Escape',
    });
    expect(p.onClose).toHaveBeenCalledOnce();
  });

  it('keeps an invalid shortcut, holding the step and Finish back until it is put back', () => {
    const p = props('meter', { decisions: allDone, facts: readyFacts() });
    const { rerender } = render(<GuideDialog {...p} />);
    openShortcuts();
    // The lock's key, set for New fight: refused here, never saved.
    press('New fight (reset)', 'F8', { ctrlKey: true, shiftKey: true });
    expect(shortcut('New fight (reset)').value).toBe('Ctrl+Shift+F8');
    expect(within(dialog()).getByText(/Already used by “Lock \/ unlock/)).toBeTruthy();
    expect(p.facts.saveSettings).not.toHaveBeenCalled();
    expect((button(/Looks good/) as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).getByText('Save or put back your shortcuts first.')).toBeTruthy();
    expect(rail('DPS meter').dataset.state).toBe('problem');

    // Leaving the step and coming back keeps the key, open and marked.
    rerender(<GuideDialog {...p} chapter="inspect" />);
    rerender(<GuideDialog {...p} chapter="review" />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    const block = dialog().querySelector('[data-block="problem"]') as HTMLElement;
    expect(within(block).getByRole('button', { name: 'DPS meter' })).toBeTruthy();
    rerender(<GuideDialog {...p} chapter="meter" />);
    expect(shortcut('New fight (reset)').value).toBe('Ctrl+Shift+F8');
    expect(within(dialog()).getByText(/Already used by “Lock \/ unlock/)).toBeTruthy();

    fireEvent.click(button('Put back the saved shortcuts'));
    expect(shortcut('New fight (reset)').value).toBe(settings.hotkeys.reset);
    expect((button(/Looks good/) as HTMLButtonElement).disabled).toBe(false);
    rerender(<GuideDialog {...p} chapter="review" />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(false);
  });

  it('keeps a key whose save failed, and checks the newest settings again on retry', async () => {
    // Native's settings as saved now; another window takes the key before the retry.
    let fresh = settings;
    const save = vi.fn<SaveSettings>(async (change) => {
      const next = change(fresh);
      if (save.mock.calls.length === 1) return false;
      if (next) fresh = next;
      return true;
    });
    const p = props('meter', {
      decisions: allDone,
      facts: readyFacts({ saveSettings: save, settingsError: 'disk full' }),
    });
    const { rerender } = render(<GuideDialog {...p} />);
    openShortcuts();
    await act(async () => press('Copy summary', 'F2', { ctrlKey: true }));
    expect(save).toHaveBeenCalledOnce();
    expect(within(dialog()).getByText('That change was not saved: disk full')).toBeTruthy();
    expect(shortcut('Copy summary').value).toBe('Ctrl+F2');
    expect(within(dialog()).getByText('Not saved yet')).toBeTruthy();
    rerender(<GuideDialog {...p} chapter="profiles" />);
    rerender(<GuideDialog {...p} chapter="meter" />);
    expect(shortcut('Copy summary').value).toBe('Ctrl+F2');

    fresh = { ...settings, hotkeys: { ...settings.hotkeys, compact_strip: 'Ctrl+F2' } };
    await act(async () => fireEvent.click(button('Try again')));
    expect(save).toHaveBeenCalledTimes(2);
    // Refused against the newest settings: nothing saved, the key kept with the reason.
    expect(fresh.hotkeys.copy_summary).toBe(settings.hotkeys.copy_summary);
    expect(shortcut('Copy summary').value).toBe('Ctrl+F2');
    expect(within(dialog()).getByText(/Already used by “Toggle compact strip”/)).toBeTruthy();
    expect(dialog().querySelector('[data-onboarding="step-failed"]')).toBeNull();
    expect((button(/Looks good/) as HTMLButtonElement).disabled).toBe(true);

    // A free key is saved, and the step is clear again.
    await act(async () => press('Copy summary', 'F3', { ctrlKey: true }));
    expect(fresh.hotkeys.copy_summary).toBe('Ctrl+F3');
    expect(dialog().querySelector('[data-onboarding="shortcuts-unsaved"]')).toBeNull();
    expect((button(/Looks good/) as HTMLButtonElement).disabled).toBe(false);
  });

  it('puts a failed save back, clearing its failure without saving it', async () => {
    const save = vi.fn<SaveSettings>().mockResolvedValue(false);
    const p = props('meter', { facts: facts({ saveSettings: save }) });
    render(<GuideDialog {...p} />);
    openShortcuts();
    await act(async () => press('Copy summary', 'F2', { ctrlKey: true }));
    expect(dialog().querySelector('[data-onboarding="step-failed"]')).toBeTruthy();
    fireEvent.click(button('Put back the saved shortcuts'));
    expect(dialog().querySelector('[data-onboarding="step-failed"]')).toBeNull();
    expect(shortcut('Copy summary').value).toBe(settings.hotkeys.copy_summary);
    expect(save).toHaveBeenCalledOnce();
  });
});

describe('in-game windows from the guide', () => {
  it('retries the state asked for, never the opposite of what shows now', async () => {
    const f = facts();
    vi.mocked(f.meter.setVisible).mockResolvedValueOnce(false);
    const p = props('meter', { facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: 'DPS meter' })),
    );
    expect(f.meter.setVisible).toHaveBeenLastCalledWith(true);
    // The meter was shown meanwhile (a hotkey): the retry still asks for it shown.
    rerender(<GuideDialog {...p} facts={{ ...f, meter: { ...f.meter, visible: true } }} />);
    await act(async () => fireEvent.click(button('Try again')));
    expect(vi.mocked(f.meter.setVisible).mock.calls).toEqual([[true], [true]]);
  });

  it('shows or hides the Explore window and the pet radar as asked, on retry too', async () => {
    const win = {
      requested: true,
      visible: true,
      known: true,
      busy: false,
      error: '',
      setRequested: vi.fn<(requested: boolean) => Promise<boolean>>().mockResolvedValueOnce(false),
    };
    const f = facts({ explore: { prefs: explorePrefs(), window: win } });
    const p = props('explore', { facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: 'Explore over the game' })),
    );
    const hidden = { ...win, requested: false };
    rerender(<GuideDialog {...p} facts={{ ...f, explore: { ...f.explore, window: hidden } }} />);
    await act(async () => fireEvent.click(button('Try again')));
    expect(win.setRequested.mock.calls).toEqual([[false], [false]]);

    vi.mocked(f.pets.radar.setRequested).mockResolvedValueOnce(false);
    rerender(<GuideDialog {...p} chapter="pets" />);
    await act(async () =>
      fireEvent.click(within(dialog()).getByRole('switch', { name: 'Pet radar over the game' })),
    );
    await act(async () => fireEvent.click(button('Try again')));
    expect(vi.mocked(f.pets.radar.setRequested).mock.calls).toEqual([[true], [true]]);
  });
});

describe('review', () => {
  const withPin = () => {
    const s = petsStatus();
    s.config = { ...s.config, pinned_ids: [1] };
    return s;
  };
  const ready = (): GuideFacts => {
    const f = facts({
      capture: 'capturing',
      alerts: alerts({ dashboard: dashboard() }),
    });
    f.setup = { ...f.setup, status: setupStatus('ready') };
    return f;
  };
  const decided: Decisions = {
    language: 'done',
    capture: 'done',
    meter: 'done',
    inspect: 'done',
    profiles: 'done',
    alerts: 'done',
    pets: 'skipped',
    explore: 'skipped',
    updates: 'done',
  };

  it('finishes once every step is ready or skipped', () => {
    const p = props('review', { decisions: decided, facts: ready() });
    render(<GuideDialog {...p} />);
    expect(within(dialog()).getByText(/Everything is set/)).toBeTruthy();
    fireEvent.click(button('Finish'));
    expect(p.onFinish).toHaveBeenCalledOnce();
  });

  it('keeps the guide unfinished while capture is set up later', () => {
    const f = ready();
    f.capture = 'error';
    const p = props('review', { decisions: { ...decided, capture: 'later' }, facts: f });
    render(<GuideDialog {...p} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    expect(within(dialog()).getByText(/set up later, so the guide stays unfinished/)).toBeTruthy();
    const row = dialog().querySelector('[data-step="capture"]')!;
    expect(row.getAttribute('data-state')).toBe('deferred');
    fireEvent.click(
      within(row as HTMLElement).getByRole('button', { name: /Change Live capture/ }),
    );
    expect(p.onChapter).toHaveBeenCalledWith('capture');
  });

  it('waits for undecided steps, naming each one', () => {
    const undecided: Decisions = { ...decided };
    delete undecided.meter;
    const p = props('review', { decisions: undecided, facts: ready() });
    render(<GuideDialog {...p} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    const block = dialog().querySelector('[data-block="undecided"]') as HTMLElement;
    expect(block.textContent).toMatch(/still need a decision/);
    fireEvent.click(within(block).getByRole('button', { name: 'DPS meter' }));
    expect(p.onChapter).toHaveBeenCalledWith('meter');
  });

  it('never lets a skipped feature’s background errors hold the guide back', () => {
    const f = ready();
    f.pets = { ...f.pets, error: 'pets unavailable' };
    f.explore = { prefs: explorePrefs({ error: 'explore read failed' }) };
    const p = props('review', { decisions: decided, facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(false);
    // The same error on a feature in use blocks, on that step.
    f.pets = { ...f.pets, status: withPin() };
    rerender(<GuideDialog {...p} facts={f} decisions={{ ...decided, pets: 'done' }} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    const block = dialog().querySelector('[data-block="problem"]') as HTMLElement;
    expect(within(block).getByRole('button', { name: 'Pet farming' })).toBeTruthy();
    expect(within(block).queryByRole('button', { name: 'Cubes & gathering' })).toBeNull();
  });

  it('waits for a save in flight, even on a step skipped meanwhile', async () => {
    let resolve!: (ok: boolean) => void;
    const configure = vi.fn<Alerts['configure']>(() => new Promise((r) => (resolve = r)));
    const f = ready();
    f.alerts = alerts({ dashboard: dashboard(), configure });
    const p = props('alerts', { decisions: decided, facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    fireEvent.click(within(dialog()).getByRole('switch', { name: /while the game is closed/i }));
    // The decision on the step waits for it; skipping is allowed but settles nothing.
    expect((button('Use these reminders') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button('Skip reminders'));
    expect(p.onDecide).toHaveBeenLastCalledWith('alerts', 'skipped');
    rerender(<GuideDialog {...p} chapter="review" decisions={{ ...decided, alerts: 'skipped' }} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    const block = dialog().querySelector('[data-block="saving"]') as HTMLElement;
    expect(within(block).getByRole('button', { name: 'Alerts' })).toBeTruthy();
    await act(async () => resolve(true));
    fireEvent.click(button('Finish'));
    expect(p.onFinish).toHaveBeenCalledOnce();
  });

  it('waits while an in-game window, a meter change or an update check is busy', () => {
    const f = ready();
    f.updates = { ...f.updates, busy: true };
    const p = props('review', { decisions: decided, facts: f });
    const { rerender } = render(<GuideDialog {...p} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    rerender(<GuideDialog {...p} facts={{ ...ready(), meter: { ...f.meter, busy: true } }} />);
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    const win = {
      requested: true,
      visible: true,
      known: true,
      busy: true,
      error: '',
      setRequested: vi.fn<(requested: boolean) => Promise<boolean>>().mockResolvedValue(true),
    };
    rerender(
      <GuideDialog
        {...p}
        facts={{ ...ready(), explore: { prefs: explorePrefs(), window: win } }}
      />,
    );
    expect((button('Finish') as HTMLButtonElement).disabled).toBe(true);
    rerender(<GuideDialog {...p} facts={ready()} />);
    fireEvent.click(button('Finish'));
    expect(p.onFinish).toHaveBeenCalledOnce();
  });
});

describe('the sample on the meter', () => {
  it('shows the real meter on the sample, with each player’s skills a click away', () => {
    render(<GuideDialog {...props('meter')} />);
    const meter = within(dialog()).getByRole('region', { name: 'Live DPS overlay' });
    // Reduced motion opens on the finished fight: only the owner keeps a name.
    const names = [...meter.querySelectorAll('.meter-row [data-cell="name"] [title]')].map(
      (n) => n.textContent,
    );
    expect(names.sort()).toEqual(['Player 2', 'Player 3', 'Player 4', 'Player 5', 'foxyyyynm']);
    expect(within(dialog()).getByText(/reduced motion/)).toBeTruthy();
    expect(within(meter).queryByText('Piercing Strike')).toBeNull();
    fireEvent.click(within(meter).getByRole('button', { name: /foxyyyynm/ }));
    expect(within(meter).getByText('Piercing Strike')).toBeTruthy();
  });

  it('replays the fight by itself unless motion is reduced, and pauses on request', () => {
    vi.useFakeTimers();
    render(<GuideDialog {...props('meter', { reducedMotion: false })} />);
    const scrub = within(dialog()).getByRole('slider', { name: 'Sample fight time' });
    expect((scrub as HTMLInputElement).value).toBe('0');
    act(() => {
      vi.advanceTimersByTime(demo.sampleIntervalMs);
    });
    expect(Number((scrub as HTMLInputElement).value)).toBeGreaterThan(0);
    fireEvent.click(button('Pause the sample fight'));
    const held = (scrub as HTMLInputElement).value;
    act(() => {
      vi.advanceTimersByTime(demo.sampleIntervalMs * 4);
    });
    expect((scrub as HTMLInputElement).value).toBe(held);
  });

  it('scrubs to the very end of the fight, where the recorded totals are exact', () => {
    const meter = () => within(dialog()).getByRole('region', { name: 'Live DPS overlay' });
    render(<GuideDialog {...props('meter')} />);
    const finished = meter().textContent;
    cleanup();
    render(<GuideDialog {...props('meter', { reducedMotion: false })} />);
    const scrub = within(dialog()).getByRole('slider', {
      name: 'Sample fight time',
    }) as HTMLInputElement;
    expect(meter().textContent).not.toBe(finished);
    fireEvent.change(scrub, { target: { value: scrub.max } });
    expect(Number(scrub.max)).toBe(demo.frames.length - 1);
    expect(scrub.value).toBe(scrub.max);
    expect(scrub.getAttribute('aria-valuetext')).toBe('2:40 of 2:40');
    expect(meter().textContent).toBe(finished);
  });

  it('pauses the sample while the window is hidden', () => {
    vi.useFakeTimers();
    const p = props('meter', { reducedMotion: false });
    const { rerender } = render(<GuideDialog {...p} />);
    const scrub = () => within(dialog()).getByRole('slider', { name: 'Sample fight time' });
    rerender(<GuideDialog {...p} pageVisible={false} />);
    const held = (scrub() as HTMLInputElement).value;
    act(() => {
      vi.advanceTimersByTime(demo.sampleIntervalMs * 4);
    });
    expect((scrub() as HTMLInputElement).value).toBe(held);
  });
});

it('lists every step in the rail, language first, and moves between them', () => {
  const p = props('meter', { decisions: { language: 'done', capture: 'later' } });
  render(<GuideDialog {...p} />);
  const rail = within(dialog()).getByRole('navigation', { name: 'Setup steps' });
  const steps = within(rail).getAllByRole('button');
  expect(steps[0]!.textContent).toContain('Language');
  expect(steps[1]!.getAttribute('data-state')).toBe('deferred');
  fireEvent.click(within(rail).getByRole('button', { name: /Alerts/ }));
  expect(p.onChapter).toHaveBeenLastCalledWith('alerts');
  fireEvent.click(button('Finish later'));
  expect(p.onClose).toHaveBeenCalledOnce();
});

it('speaks Brazilian Portuguese', async () => {
  const i18n = createTestI18n('pt-BR');
  render(
    <TranslationProvider i18n={i18n}>
      <GuideDialog {...props('inspect')} />
    </TranslationProvider>,
  );
  await act(async () => {});
  expect(screen.getByRole('dialog', { name: 'Primeiros passos' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Guarde as suas lutas' })).toBeTruthy();
  expect(screen.getByText('4 lutas salvas')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tudo certo, continuar' })).toBeTruthy();
});
