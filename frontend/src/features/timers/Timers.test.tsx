import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_ACTIVITY_WINDOW } from '../../types/activityWindows';
import { Timers } from './Timers';
import { LOWER_RESHANTA, NOW, timer, timersStatus, VERTERON } from './fixtures';

afterEach(cleanup);
const props = () => ({
  native: true,
  status: timersStatus(),
  now: NOW,
  stale: false,
  window: INITIAL_ACTIVITY_WINDOW,
  busy: false,
  error: '',
  onLock: vi.fn<(locked: boolean) => void>(),
  onHide: vi.fn<() => void>(),
  onResize: vi.fn<() => void>(),
});

describe('Timers overlay', () => {
  it('renders server caption, upcoming clocks, observed state and reset footer', () => {
    render(<Timers {...props()} />);
    expect(screen.getByText('Taiwan')).toBeTruthy();
    expect(screen.getByText('13:01')).toBeTruthy();
    expect(screen.getByText('1:00')).toBeTruthy();
    expect(screen.getByText('Live now')).toBeTruthy();
    expect(screen.getByText('Alive')).toBeTruthy();
    expect(screen.getByText('Unknown')).toBeTruthy();
    expect(screen.getByText('Daily reset')).toBeTruthy();
    expect(screen.getByText('Weekly reset')).toBeTruthy();
  });
  it('keeps lock and hide controls hit-testable while the data is click-through', () => {
    const p = props();
    const { container, rerender } = render(
      <Timers {...p} window={{ ...p.window, locked: true }} />,
    );
    const unlock = screen.getByRole('button', { name: 'Unlock Timers' });
    expect(unlock.hasAttribute('data-hit')).toBe(true);
    expect(container.querySelector('tbody [data-hit]')).toBeNull();
    fireEvent.click(unlock);
    expect(p.onLock).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: 'Hide Timers' }));
    expect(p.onHide).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Resize Timers' })).toBeNull();
    rerender(<Timers {...p} window={{ ...p.window, locked: false }} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Resize Timers' }));
    expect(p.onResize).toHaveBeenCalledOnce();
  });
  it('never leaves an expired live status or a negative reset countdown visible', () => {
    render(<Timers {...props()} now={NOW + 50 * 3600_000} />);
    expect(screen.queryByText('Live now')).toBeNull();
    expect(screen.getAllByText('Refreshing…')).toHaveLength(2);
  });
  it('treats a boss evidence expiry as freshness, never as a remaining boss lifetime', () => {
    const p = props();
    const status = timersStatus({
      rows: [{ ...p.status.rows[2]!, ends_ms: NOW + 120_000 }],
    });
    const { rerender } = render(<Timers {...p} status={status} />);
    expect(screen.getByText('Alive')).toBeTruthy();
    expect(screen.queryByText(/left/)).toBeNull();
    rerender(<Timers {...p} status={status} now={NOW + 120_000} />);
    expect(screen.queryByText('Alive')).toBeNull();
    expect(screen.getByText('Unknown')).toBeTruthy();
  });
  it('shows loading, stale, empty and failure states honestly', () => {
    const p = props();
    const { rerender } = render(<Timers {...p} status={null} />);
    expect(screen.getByText('Loading timers…')).toBeTruthy();
    rerender(<Timers {...p} stale />);
    expect(screen.queryByText('Alive')).toBeNull();
    expect(screen.getByText('Refreshing activity state…')).toBeTruthy();
    rerender(<Timers {...p} status={timersStatus({ rows: [] })} error="Native unavailable" />);
    expect(screen.getByText('No activities available.')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('Native unavailable');
  });
  describe('boss map', () => {
    const bar = () => screen.getByRole('group', { name: 'Map for field bosses' });
    const segment = (name: string) => within(bar()).getByRole('button', { name });
    const chosen = () =>
      within(bar())
        .getAllByRole('button')
        .filter((b) => b.getAttribute('aria-pressed') === 'true')
        .map((b) => b.textContent);
    const bossSection = () => document.querySelector<HTMLElement>('tbody[data-boss-map]')!;
    const middle = { id: 22, name: 'Chaotic Middle Reshanta' };

    it('offers Current and every map as segments, and marks the map you are on', () => {
      render(<Timers {...props()} />);
      expect(
        within(bar())
          .getAllByRole('button')
          .map((b) => b.textContent),
      ).toEqual(['Current', 'Verteron', 'Chaotic Lower Reshanta']);
      expect(chosen()).toEqual(['Current']);
      expect(segment('Current').title).toBe('Follow the map you are on: Chaotic Lower Reshanta');
      expect(segment('Chaotic Lower Reshanta').title).toBe('Chaotic Lower Reshanta · You are here');
      expect(segment('Chaotic Lower Reshanta').querySelector('svg')).toBeTruthy();
      expect(segment('Verteron').querySelector('svg')).toBeNull();
    });

    it('follows the current map, and a picked map survives current-map updates', () => {
      const p = props();
      const { rerender } = render(<Timers {...p} />);
      expect(within(bossSection()).getByText('Field bosses · Chaotic Lower Reshanta')).toBeTruthy();
      expect(within(bossSection()).getByText('Argo, the Spirit King')).toBeTruthy();

      // In the Abyss, read Verteron's bosses with one click.
      fireEvent.click(segment('Verteron'));
      expect(chosen()).toEqual(['Verteron']);
      expect(within(bossSection()).getByText('Field bosses · Verteron')).toBeTruthy();
      expect(within(bossSection()).getByText('Eternal Gartua')).toBeTruthy();
      expect(within(bossSection()).getByText('45:00')).toBeTruthy();
      expect(within(bossSection()).queryByText('Argo, the Spirit King')).toBeNull();

      // Moving to another map does not undo the pick; Current names where you are now.
      rerender(<Timers {...p} status={timersStatus({ current_map: middle })} />);
      expect(chosen()).toEqual(['Verteron']);
      expect(within(bossSection()).getByText('Eternal Gartua')).toBeTruthy();
      expect(segment('Current').title).toBe('Follow the map you are on: Chaotic Middle Reshanta');

      // Current follows the map you are on again, as it changes.
      fireEvent.click(segment('Current'));
      expect(chosen()).toEqual(['Current']);
      expect(
        within(bossSection()).getByText('No field bosses are tracked in Chaotic Middle Reshanta.'),
      ).toBeTruthy();
      rerender(<Timers {...p} />);
      expect(within(bossSection()).getByText('Argo, the Spirit King')).toBeTruthy();
    });

    it('keeps the map you are on picked, and drops a map no longer offered', () => {
      const p = props();
      const { rerender } = render(<Timers {...p} />);
      // Picking the map you are on pins it: it stays when you move.
      fireEvent.click(segment('Chaotic Lower Reshanta'));
      expect(chosen()).toEqual(['Chaotic Lower Reshanta']);
      rerender(<Timers {...p} status={timersStatus({ current_map: middle })} />);
      expect(within(bossSection()).getByText('Argo, the Spirit King')).toBeTruthy();
      // Pressing the chosen segment again keeps it.
      fireEvent.click(segment('Chaotic Lower Reshanta'));
      expect(chosen()).toEqual(['Chaotic Lower Reshanta']);
      fireEvent.click(segment('Verteron'));
      rerender(<Timers {...p} status={timersStatus({ maps: [LOWER_RESHANTA] })} />);
      expect(chosen()).toEqual(['Current']);
      expect(within(bossSection()).getByText('Argo, the Spirit King')).toBeTruthy();
      fireEvent.click(segment('Current'));
      rerender(<Timers {...p} />);
      expect(chosen()).toEqual(['Current']);
      expect(within(bossSection()).getByText('Argo, the Spirit King')).toBeTruthy();
    });

    it('lists a boss once, under the map on show', () => {
      const gartua = VERTERON.rows[0]!;
      const status = timersStatus({ rows: [timer(), { ...gartua }] });
      render(<Timers {...props()} status={status} />);
      expect(screen.getAllByText('Eternal Gartua')).toHaveLength(1);
      expect(within(bossSection()).queryByText('Eternal Gartua')).toBeNull();
      fireEvent.click(segment('Verteron'));
      expect(screen.getAllByText('Eternal Gartua')).toHaveLength(1);
      expect(within(bossSection()).getByText('Eternal Gartua')).toBeTruthy();
    });

    it('says so when the current map is unknown, and hides the bar without map data', () => {
      const p = props();
      const { rerender } = render(<Timers {...p} status={timersStatus({ current_map: null })} />);
      expect(segment('Current').title).toBe('Follow the map you are on (not known yet)');
      expect(
        within(bar())
          .getAllByRole('button')
          .some((b) => b.querySelector('svg') && b.textContent !== 'Current'),
      ).toBe(false);
      expect(
        within(bossSection()).getByText(
          'Current map unknown. Choose a map to see its field bosses.',
        ),
      ).toBeTruthy();
      rerender(
        <Timers {...p} status={timersStatus({ current_map: { id: 210001, name: null } })} />,
      );
      expect(segment('Current').title).toBe('Follow the map you are on (no field bosses here)');
      expect(
        within(bossSection()).getByText('No field bosses are tracked in this area.'),
      ).toBeTruthy();
      // A native build without map data keeps the original list.
      const legacy = timersStatus();
      delete legacy.maps;
      delete legacy.current_map;
      rerender(<Timers {...p} status={legacy} />);
      expect(screen.queryByRole('group', { name: 'Map for field bosses' })).toBeNull();
      expect(bossSection()).toBeNull();
      expect(screen.getByText('Shugo Festival')).toBeTruthy();
    });

    it('keeps every map segment clickable, and clipped, while the window is locked', () => {
      const p = props();
      const { container } = render(<Timers {...p} window={{ ...p.window, locked: true }} />);
      const segments = within(bar()).getAllByRole('button');
      expect(segments).toHaveLength(3);
      for (const s of segments) expect(s.hasAttribute('data-hit')).toBe(true);
      // Segments that slide out of a narrow groove leave no clickable region behind.
      expect(bar().hasAttribute('data-hit-clip')).toBe(true);
      fireEvent.click(segment('Verteron'));
      expect(chosen()).toEqual(['Verteron']);
      expect(container.querySelector('tbody [data-hit]')).toBeNull();
    });
  });
});
