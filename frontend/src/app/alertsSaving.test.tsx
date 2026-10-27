import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAlerts } from '../hooks/useAlerts';
import type * as sound from '../lib/sound';
import * as api from '../services/alerts';
import type { AlertConfig, AlertDashboard } from '../types/alerts';
import { AlertsPanel } from '../features/alerts/AlertsPanel';
import { catalogue, dashboard } from '../features/alerts/fixtures';

vi.mock('../services/alerts', () => ({
  readAlertsStatus: vi.fn<typeof api.readAlertsStatus>(),
  configureAlerts: vi.fn<typeof api.configureAlerts>(),
  runAlertAction: vi.fn<typeof api.runAlertAction>(),
  testAlert: vi.fn<typeof api.testAlert>(),
}));
vi.mock('../lib/sound', () => ({ playSound: vi.fn<typeof sound.playSound>() }));

let backend: AlertDashboard;

/** Like native IPC: the save lands on a later task, long after the DOM event has finished. */
const later = <T,>(value: () => T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value()), 5));

function save(config: AlertConfig) {
  return later(() => {
    if (config.revision !== backend.config.revision) throw new Error('revision changed');
    backend = { ...backend, config: { ...config, revision: config.revision + 1 } };
    return backend;
  });
}

function Harness({ development = false }: { development?: boolean }) {
  const alerts = useAlerts(true, { intervalMs: 60_000 });
  return <AlertsPanel alerts={alerts} active development={development} />;
}

async function open() {
  render(<Harness />);
  await screen.findByRole('switch', { name: 'Notify me about Spacetime Rift' });
}

/** Waits for the queued save to land and the panel to be editable again. */
async function settled(expected: number) {
  await waitFor(() => expect(backend.config.revision).toBe(expected));
  await waitFor(() =>
    expect(
      screen
        .getByRole('switch', { name: 'Notify me about Spacetime Rift' })
        .getAttribute('aria-disabled'),
    ).not.toBe('true'),
  );
}

const switchFor = (name: string) => screen.getByRole('switch', { name: `Notify me about ${name}` });
const isOn = (control: HTMLElement) => control.getAttribute('aria-checked') === 'true';
const preset = (id: string) => backend.config.rules.find((r) => r.preset_id === id);

beforeEach(() => {
  backend = dashboard({ catalogue: catalogue() });
  vi.mocked(api.readAlertsStatus).mockImplementation(() => later(() => backend));
  vi.mocked(api.configureAlerts).mockImplementation(save);
  vi.mocked(api.runAlertAction).mockImplementation(() => later(() => backend));
  vi.mocked(api.testAlert).mockResolvedValue();
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ready-made alerts saved through the native queue', () => {
  it('switches the first entry on in one click and turns alerts on', async () => {
    backend.config = { ...backend.config, enabled: false, rules: [] };
    await open();
    fireEvent.click(switchFor('Spacetime Rift'));
    await settled(4);
    expect(backend.config.enabled).toBe(true);
    expect(backend.config.rules).toEqual([
      expect.objectContaining({
        id: 'preset-event-rift',
        preset_id: 'event-rift',
        name: 'Spacetime Rift',
        enabled: true,
      }),
    ]);
    expect(isOn(switchFor('Spacetime Rift'))).toBe(true);
  });

  it('switches an entry off keeping its settings and the other alerts', async () => {
    const own = backend.config.rules;
    backend.config = {
      ...backend.config,
      rules: [
        ...own,
        { ...catalogue()[0]!.rule, enabled: true, lead_seconds: [600], sound: 'ping' },
      ],
    };
    await open();
    expect(isOn(switchFor('Spacetime Rift'))).toBe(true);
    fireEvent.click(switchFor('Spacetime Rift'));
    await settled(4);
    expect(preset('event-rift')).toMatchObject({
      enabled: false,
      name: 'Spacetime Rift',
      lead_seconds: [600],
      sound: 'ping',
    });
    expect(backend.config.rules.slice(0, own.length)).toEqual(own);
    expect(backend.config.enabled).toBe(true);
    expect(isOn(switchFor('Spacetime Rift'))).toBe(false);
  });

  it('saves the inline reminder, start and sound choices', async () => {
    backend.config = {
      ...backend.config,
      rules: [{ ...catalogue()[0]!.rule, enabled: true }],
    };
    await open();
    fireEvent.change(screen.getByLabelText('Reminder for Spacetime Rift'), {
      target: { value: '600' },
    });
    await settled(4);
    expect(preset('event-rift')?.lead_seconds).toEqual([600, 0]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Also when it starts' }));
    await settled(5);
    expect(preset('event-rift')?.lead_seconds).toEqual([600]);
    fireEvent.change(screen.getByLabelText('Sound for Spacetime Rift'), {
      target: { value: 'ping' },
    });
    await settled(6);
    expect(preset('event-rift')).toMatchObject({ sound: 'ping', name: 'Spacetime Rift' });
  });

  it('saves the chosen faction', async () => {
    await open();
    fireEvent.change(screen.getByLabelText('Faction'), { target: { value: 'asmodian' } });
    await settled(4);
    expect(backend.config.faction).toBe('asmodian');
  });

  it('saves the chosen server and fallback timezone', async () => {
    backend.config = { ...backend.config, region: 'global', timezone: 'UTC' };
    await open();
    fireEvent.change(screen.getByLabelText('Server'), { target: { value: '2001' } });
    await settled(4);
    expect(backend.config.server).toBe('2001');
    fireEvent.change(screen.getByLabelText('Timezone'), {
      target: { value: 'Europe/Berlin' },
    });
    await settled(5);
    expect(backend.config.timezone).toBe('Europe/Berlin');
  });
});

describe('development test toast', () => {
  it('sends a silent popup preview through native without saving the config', async () => {
    render(<Harness development />);
    fireEvent.click(await screen.findByRole('button', { name: 'Test toast' }));
    expect(await screen.findByText(/Test toast sent\./)).toBeTruthy();
    expect(api.testAlert).toHaveBeenCalledWith('none', 0, true);
    expect(api.configureAlerts).not.toHaveBeenCalled();
  });
});
