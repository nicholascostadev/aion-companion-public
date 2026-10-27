import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { getI18n, setI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOW, dashboard, delivery } from '../features/alerts/fixtures';
import { TranslationProvider } from '../i18n/provider';
import { createTestI18n } from '../i18n/testing';
import * as alertsApi from '../services/alerts';
import * as api from '../services/companion';
import type { AlertDelivery } from '../types/alerts';
import AlertPopupApp from './AlertPopupApp';

vi.mock('../services/companion', () => ({
  isNative: vi.fn<typeof api.isNative>(),
  startWindowDrag: vi.fn<typeof api.startWindowDrag>(),
}));
vi.mock('../services/alerts', () => ({
  markPopupReady: vi.fn<typeof alertsApi.markPopupReady>(),
  onPopupDeliveries: vi.fn<typeof alertsApi.onPopupDeliveries>(),
  readAlertsStatus: vi.fn<typeof alertsApi.readAlertsStatus>(),
  runAlertAction: vi.fn<typeof alertsApi.runAlertAction>(),
  dismissPopup: vi.fn<typeof alertsApi.dismissPopup>(),
}));

let push: (items: AlertDelivery[]) => void = () => undefined;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
  });
  vi.setSystemTime(NOW);
  vi.mocked(api.isNative).mockReturnValue(true);
  vi.mocked(api.startWindowDrag).mockResolvedValue();
  vi.mocked(alertsApi.markPopupReady).mockResolvedValue([]);
  vi.mocked(alertsApi.onPopupDeliveries).mockImplementation((handler) => {
    push = handler;
    return Promise.resolve(() => undefined);
  });
  vi.mocked(alertsApi.readAlertsStatus).mockImplementation(() =>
    Promise.resolve(dashboard({ now_ms: Date.now() })),
  );
  vi.mocked(alertsApi.runAlertAction).mockResolvedValue(dashboard());
  vi.mocked(alertsApi.dismissPopup).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

async function mount(items: AlertDelivery[]) {
  vi.mocked(alertsApi.markPopupReady).mockResolvedValue(items);
  render(<AlertPopupApp />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe('AlertPopupApp', () => {
  it('shows fresh deliveries once, newest first, and none that are stale', async () => {
    await mount([
      delivery({ id: 'a', name: 'Older', fired_ms: NOW - 2000 }),
      delivery({ id: 'b', name: 'Newer', fired_ms: NOW - 1000 }),
      delivery({ id: 'b', name: 'Newer', fired_ms: NOW - 1000 }),
      delivery({ id: 'stale', name: 'Stale', fired_ms: NOW - 20_000 }),
    ]);
    const cards = screen.getAllByRole('article');
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['Newer', 'Older']);
    expect(screen.queryByText('Stale')).toBeNull();
    expect(document.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull();
  });

  it('shows a compact toast without a countdown or snooze and closes after 10 seconds', async () => {
    await mount([delivery({ due_ms: NOW + 65_000 })]);
    expect(screen.queryByText(/Starts in/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Snooze/ })).toBeNull();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText(/Starts in/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('follows native pushes', async () => {
    await mount([]);
    expect(screen.queryByRole('article')).toBeNull();
    act(() => push([delivery({ id: 'n', name: 'World boss soon', category: 'world_boss' })]));
    expect(screen.getByRole('article', { name: 'World boss soon' })).toBeTruthy();
    act(() => push([]));
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('never lets the ready answer replace a newer push', async () => {
    let ready!: (items: AlertDelivery[]) => void;
    vi.mocked(alertsApi.markPopupReady).mockReturnValue(
      new Promise((done) => {
        ready = done;
      }),
    );
    render(<AlertPopupApp />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => push([delivery({ id: 'n', name: 'World boss soon', category: 'world_boss' })]));
    await act(async () => {
      ready([delivery({ id: 'old', name: 'Already dismissed' })]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('article', { name: 'World boss soon' })).toBeTruthy();
    expect(screen.queryByText('Already dismissed')).toBeNull();
  });

  it('dismisses through the engine, then clears the popup', async () => {
    await mount([delivery()]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss Shugo Festival' }));
    });
    expect(alertsApi.runAlertAction).toHaveBeenCalledWith('dismiss', 'r1:1');
    expect(alertsApi.dismissPopup).toHaveBeenCalledWith('r1:1');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('clears the popup even when its delivery was already dismissed in the engine', async () => {
    vi.mocked(alertsApi.runAlertAction).mockRejectedValueOnce(new Error('Alert not found'));
    await mount([delivery()]);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss Shugo Festival' }));
    });
    expect(alertsApi.runAlertAction).toHaveBeenCalledWith('dismiss', 'r1:1');
    expect(alertsApi.dismissPopup).toHaveBeenCalledWith('r1:1');
    expect(screen.queryByRole('article')).toBeNull();
  });

  it('shows only cards and reveals the next queued alert when one is dismissed', async () => {
    await mount([
      delivery({
        id: 't',
        name: 'Preview',
        phase: 'test',
        fired_ms: NOW - 400,
      }),
      delivery({ id: 'a', name: 'Queued alert', fired_ms: NOW - 3000 }),
      delivery({ id: 'b', fired_ms: NOW - 2000 }),
      delivery({ id: 'c', fired_ms: NOW - 1000 }),
    ]);
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(document.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss all' })).toBeNull();
    expect(screen.queryByText('Queued alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Snooze Preview 5 minutes' })).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss Preview' }));
    });
    expect(alertsApi.runAlertAction).toHaveBeenCalledWith('dismiss', 't');
    expect(alertsApi.dismissPopup).toHaveBeenCalledOnce();
    expect(screen.getAllByRole('article')).toHaveLength(3);
    expect(screen.getByRole('article', { name: 'Queued alert' })).toBeTruthy();
  });
});

describe('AlertPopupApp in Brazilian Portuguese', () => {
  it('words the cards and actions in Portuguese, keeping alert names', async () => {
    const shared = getI18n();
    const pt = createTestI18n('pt-BR');
    setI18n(shared);
    vi.mocked(alertsApi.markPopupReady).mockResolvedValue([
      delivery({ id: 'a', due_ms: NOW + 65_000, fired_ms: NOW - 1000 }),
      delivery({ id: 'b', name: 'Siege Bosses', category: 'world_boss', fired_ms: NOW - 2000 }),
    ]);
    render(
      <TranslationProvider i18n={pt}>
        <AlertPopupApp />
      </TranslationProvider>,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole('region', { name: 'Alertas' })).toBeTruthy();
    expect(screen.queryByText(/Começa em/)).toBeNull();
    expect(screen.getAllByText('Evento · 5 min antes')).toHaveLength(1);
    expect(screen.getByText('Chefe mundial · 5 min antes')).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Siege Bosses' })).toBeTruthy();
    expect(document.querySelector('footer')).toBeNull();
    expect(screen.queryByRole('button', { name: /Adiar/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dispensar todos' })).toBeNull();
  });
});
