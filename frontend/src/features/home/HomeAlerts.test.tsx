import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { getI18n, setI18n } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { AlertDashboard } from '../../types/alerts';
import type { AlertsController } from '../alerts/AlertsPanel';
import { NOW, dashboard, delivery } from '../alerts/fixtures';
import { NextUpCard, RingingNow } from './HomeAlerts';

/** A Portuguese engine for one provider; the window's shared engine stays as it was. */
function portuguese() {
  const shared = getI18n();
  const i18n = createTestI18n('pt-BR');
  setI18n(shared);
  return i18n;
}

const controller = (value: AlertDashboard | null): AlertsController => ({
  native: true,
  dashboard: value,
  error: '',
  busy: false,
  offsetMs: 0,
  configure: vi.fn<AlertsController['configure']>().mockResolvedValue(true),
  action: vi.fn<AlertsController['action']>().mockResolvedValue(true),
  test: vi.fn<AlertsController['test']>().mockResolvedValue(true),
  now: () => Date.now(),
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('home alerts in Brazilian Portuguese', () => {
  it('answers ringing alerts in Portuguese, with a plural count', () => {
    const onAction = vi.fn<AlertsController['action']>().mockResolvedValue(true);
    const pt = portuguese();
    const view = (active: ReturnType<typeof delivery>[]) => (
      <TranslationProvider i18n={pt}>
        <RingingNow active={active} busy={false} onAction={onAction} />
      </TranslationProvider>
    );
    const { rerender } = render(view([delivery({ id: 'a:1', name: 'Spacetime Rift' })]));
    const ringing = screen.getByRole('region', { name: 'Tocando agora' });
    expect(within(ringing).getByText('1 lembrete')).toBeTruthy();
    expect(within(ringing).getByText(/^5 min antes · começa em 5:00$/)).toBeTruthy();
    fireEvent.click(
      within(ringing).getByRole('button', { name: 'Adiar Spacetime Rift por 5 minutos' }),
    );
    expect(onAction).toHaveBeenLastCalledWith('snooze', 'a:1', 300);

    rerender(
      view([
        delivery({ id: 'a:1', name: 'Spacetime Rift' }),
        delivery({ id: 'b:1', phase: 'start' }),
      ]),
    );
    expect(screen.getByText('2 lembretes')).toBeTruthy();
    expect(screen.getByText(/^Começando agora · começa em 5:00$/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dispensar Shugo Festival' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dispensar todos' })).toBeTruthy();
  });

  it('counts down the next opening in Portuguese', () => {
    render(
      <TranslationProvider i18n={portuguese()}>
        <NextUpCard alerts={controller(dashboard())} onOpenAlerts={() => undefined} />
      </TranslationProvider>,
    );
    expect(screen.getByText('A seguir')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Todos os alertas/ })).toBeTruthy();
    expect(screen.getByLabelText('Tempo até Shugo Festival').textContent).toBe('1:30');
    expect(screen.getByText('Shugo Festival')).toBeTruthy();
  });
});
