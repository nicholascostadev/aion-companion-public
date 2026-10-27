import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIAL_ACTIVITY_WINDOW } from '../../types/activityWindows';
import { Timers } from './Timers';
import { NOW, timersStatus } from './fixtures';

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
    const status = timersStatus({ rows: [{ ...p.status.rows[2]!, ends_ms: NOW + 120_000 }] });
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
});
