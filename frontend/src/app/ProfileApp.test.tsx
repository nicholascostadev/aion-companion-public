import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import info from '../../../fixtures/profile/info.json';
import equipment from '../../../fixtures/profile/equipment.json';
import { normalizeSheet } from '../lib/profileNormalize';
import * as companion from '../services/companion';
import type * as offline from '../services/offline';
import * as profile from '../services/profile';
import * as shugo from '../services/shugo';
import { INITIAL_PROFILE_WINDOW, type ProfileWindowStatus } from '../types/profile';
import ProfileApp from './ProfileApp';

vi.mock('../services/companion', async (original) => ({
  ...(await original<typeof companion>()),
  isNative: vi.fn<typeof companion.isNative>(),
}));
vi.mock('../services/offline', () => ({ copyTextNative: vi.fn<typeof offline.copyTextNative>() }));
vi.mock('../services/shugo', () => ({
  openShugoProfile: vi.fn<typeof shugo.openShugoProfile>(),
  copyShugoProfileLink: vi.fn<typeof shugo.copyShugoProfileLink>(),
}));
vi.mock('../services/profile', async (original) => ({
  ...(await original<typeof profile>()),
  readProfileWindowStatus: vi.fn<typeof profile.readProfileWindowStatus>(),
  markProfileWindowReady: vi.fn<typeof profile.markProfileWindowReady>(),
  hideProfileWindow: vi.fn<typeof profile.hideProfileWindow>(),
  focusProfileWindow: vi.fn<typeof profile.focusProfileWindow>(),
  readCharacterSheet: vi.fn<typeof profile.readCharacterSheet>(),
  setSavedCharacter: vi.fn<typeof profile.setSavedCharacter>(),
  openProfileWindow: vi.fn<typeof profile.openProfileWindow>(),
}));

const status = (patch: Partial<ProfileWindowStatus>): ProfileWindowStatus => ({
  ...INITIAL_PROFILE_WINDOW,
  requested: true,
  visible: true,
  ready: true,
  ...patch,
});
const sheet = (name: string) => {
  const s = normalizeSheet({
    identity: { character_id: 'id=', server_id: 2403, region: 'la', name, lang: 'en-US' },
    info,
    equipment,
    fetched_ms: 1,
  });
  return { ...s, info: s.info && { ...s.info, name } };
};
const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(companion.isNative).mockReturnValue(true);
  vi.mocked(profile.markProfileWindowReady).mockResolvedValue();
  vi.mocked(profile.readCharacterSheet).mockImplementation((selection) =>
    Promise.resolve(sheet(selection.name)),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

describe('profile window', () => {
  it('reports ready, reads its character once, and follows each new open', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ selection: { revision: 1, server_id: 2403, name: 'Aria' } }),
    );
    render(<ProfileApp />);
    await tick();
    expect(profile.markProfileWindowReady).toHaveBeenCalledTimes(1);
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Aria' })).toBeTruthy();
    // Status polls hand over the same selection; no new lookup.
    await tick(1600);
    expect(profile.readCharacterSheet).toHaveBeenCalledTimes(1);
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ selection: { revision: 2, server_id: 2403, name: 'Bryn' } }),
    );
    await tick(600);
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Bryn' })).toBeTruthy();
    expect(profile.readCharacterSheet).toHaveBeenCalledTimes(2);
  });

  it('forgets the character when names are hidden', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ hide_names: true, requested: false, selection: null }),
    );
    render(<ProfileApp />);
    await tick();
    expect(screen.getByText('Character names are hidden')).toBeTruthy();
    expect(profile.readCharacterSheet).not.toHaveBeenCalled();
  });

  it('hides from Close and opens the website only on request', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ selection: { revision: 1, server_id: 2403, name: 'Aria' } }),
    );
    vi.mocked(profile.hideProfileWindow).mockResolvedValue(
      status({ requested: false, visible: false }),
    );
    vi.mocked(shugo.openShugoProfile).mockResolvedValue();
    render(<ProfileApp />);
    await tick();
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Aria' })).toBeTruthy();
    expect(shugo.openShugoProfile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open in Shugo.gg' }));
    expect(shugo.openShugoProfile).toHaveBeenCalledWith({ name: 'Aria', serverId: 2403 });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await tick();
    expect(profile.hideProfileWindow).toHaveBeenCalledTimes(1);
  });

  it('offers to take the mouse back only when Windows refused this open the foreground', async () => {
    const refused = { state: 'denied' as const, revision: 1, cursor_released: false };
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ selection: { revision: 1, server_id: 2403, name: 'Aria' }, focus: refused }),
    );
    vi.mocked(profile.focusProfileWindow).mockResolvedValue(
      status({
        selection: { revision: 1, server_id: 2403, name: 'Aria' },
        focus: { ...refused, state: 'granted' },
      }),
    );
    render(<ProfileApp />);
    await tick();
    await tick();
    expect(screen.getByText(/Windows kept the game in front/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Use this window' }));
    await tick();
    expect(profile.focusProfileWindow).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Windows kept the game in front/)).toBeNull();
  });

  it('says nothing about the foreground of an earlier open, or once it was granted', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({
        selection: { revision: 2, server_id: 2403, name: 'Bryn' },
        focus: { state: 'denied', revision: 1, cursor_released: false },
      }),
    );
    render(<ProfileApp />);
    await tick();
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Bryn' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Use this window' })).toBeNull();
    expect(profile.focusProfileWindow).not.toHaveBeenCalled();
  });

  const aria = { revision: 1, server_id: 2403, name: 'Aria' };
  const saved = (name: string, server_id = 2403) => ({
    server_id,
    server_name: server_id === 2403 ? 'Triniel' : 'Kaisinel',
    name,
    saved_ms: 1,
  });

  it('saves through native and shows the list native answers, not a stale poll', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(status({ selection: aria }));
    const answered = status({ selection: aria, favorites: [saved('Aria')] });
    let finish!: (s: ProfileWindowStatus) => void;
    vi.mocked(profile.setSavedCharacter).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<ProfileApp />);
    await tick();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(profile.setSavedCharacter).toHaveBeenCalledWith({ name: 'Aria', serverId: 2403 }, true);
    // Polls wait while the save runs; the old list is never shown over the answer.
    await tick(1200);
    await act(async () => finish(answered));
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-pressed')).toBe('true');
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(answered);
    await tick(600);
    expect(screen.getByRole('button', { name: 'Save' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('explains a refused save in the window’s words', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(status({ selection: aria }));
    vi.mocked(profile.setSavedCharacter).mockRejectedValue(
      'Up to 50 characters can be saved. Remove one first.',
    );
    render(<ProfileApp />);
    await tick();
    await tick();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await tick();
    expect(
      screen.getByText(
        'The saved characters could not be changed: Up to 50 characters can be saved. Remove one first.',
      ),
    ).toBeTruthy();
  });

  it('reopens a saved character through native and follows the new selection', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ selection: aria, favorites: [saved('Aahz', 1304)] }),
    );
    const bryn = status({
      selection: { revision: 2, server_id: 1304, name: 'Aahz' },
      favorites: [saved('Aahz', 1304)],
    });
    vi.mocked(profile.openProfileWindow).mockResolvedValue(bryn);
    render(<ProfileApp />);
    await tick();
    await tick();
    await act(async () =>
      fireEvent.click(screen.getByRole('button', { name: 'Saved characters' })),
    );
    await act(async () => fireEvent.click(screen.getByRole('menuitemradio', { name: /Aahz/ })));
    expect(profile.openProfileWindow).toHaveBeenCalledWith({ name: 'Aahz', serverId: 1304 });
    await tick();
    expect(screen.getByRole('heading', { level: 2, name: 'Aahz' })).toBeTruthy();
  });

  it('copies the profile link natively and explains a failure', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(status({ selection: aria }));
    vi.mocked(shugo.copyShugoProfileLink)
      .mockResolvedValueOnce('https://shugo.gg/character/global/la-triniel/Aria')
      .mockRejectedValueOnce('Clipboard busy');
    render(<ProfileApp />);
    await tick();
    await tick();
    const share = async () => {
      await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Share' })));
      await act(async () =>
        fireEvent.click(screen.getByRole('menuitem', { name: 'Copy profile link' })),
      );
      await tick();
    };
    await share();
    expect(shugo.copyShugoProfileLink).toHaveBeenCalledWith({ name: 'Aria', serverId: 2403 });
    expect(screen.queryByText(/could not be copied/)).toBeNull();
    await share();
    expect(screen.getByText('The profile link could not be copied: Clipboard busy')).toBeTruthy();
  });

  it('keeps saved characters out of sight while names are hidden', async () => {
    vi.mocked(profile.readProfileWindowStatus).mockResolvedValue(
      status({ hide_names: true, requested: false, selection: null, favorites: [] }),
    );
    render(<ProfileApp />);
    await tick();
    expect(screen.queryByRole('button', { name: 'Saved characters' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Open .* on / })).toBeNull();
  });
});
