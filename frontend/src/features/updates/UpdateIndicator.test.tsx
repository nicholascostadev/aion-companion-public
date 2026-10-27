import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TranslationProvider } from '../../i18n/provider';
import { createTestI18n } from '../../i18n/testing';
import type { UpdatePhase, UpdateStatus } from '../../types/updates';
import { UpdateIndicator } from './UpdateIndicator';

afterEach(cleanup);

const status = (patch: Partial<UpdateStatus> = {}): UpdateStatus => ({
  channel: 'stable',
  current_version: '0.7.7',
  latest_version: '0.7.8',
  phase: 'available',
  error: null,
  checked_ms: 1_760_000_000_000,
  release_url: null,
  notes: null,
  restart_supported: true,
  repository: 'nicholascostadev/aion-companion-public',
  ...patch,
});

describe('header update indicator', () => {
  it.each([
    ['available', 'Update available v0.7.8', /is available/],
    ['downloading', 'Downloading v0.7.8', /Downloading v0\.7\.8 in the background/],
    ['ready', 'Update ready v0.7.8', /downloaded and verified/],
  ] as const)('names a waiting %s release with its version', (phase, name, title) => {
    const onOpen = vi.fn<() => void>();
    render(<UpdateIndicator status={status({ phase })} onOpen={onOpen} />);
    const pill = screen.getByRole('button', { name });
    expect(pill.title).toMatch(title);
    expect(pill.title).toContain('App updates in Settings');
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it.each<UpdatePhase>(['idle', 'checking', 'current', 'restarting', 'error', 'development'])(
    'stays out of the header in phase %s',
    (phase) => {
      render(<UpdateIndicator status={status({ phase })} onOpen={vi.fn<() => void>()} />);
      expect(screen.queryByRole('button')).toBeNull();
    },
  );

  it('stays out of the header for development builds and unknown status', () => {
    const { rerender } = render(
      <UpdateIndicator status={status({ channel: 'development' })} onOpen={vi.fn<() => void>()} />,
    );
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<UpdateIndicator status={null} onOpen={vi.fn<() => void>()} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it.each([
    ['available', 'Atualização disponível v0.7.8', /está disponível/],
    ['downloading', 'Baixando v0.7.8', /Baixando a v0\.7\.8 em segundo plano/],
    ['ready', 'Atualização pronta v0.7.8', /baixada e verificada/],
  ] as const)('names a waiting %s release in Brazilian Portuguese', (phase, name, title) => {
    const onOpen = vi.fn<() => void>();
    render(
      <TranslationProvider i18n={createTestI18n('pt-BR')}>
        <UpdateIndicator status={status({ phase })} onOpen={onOpen} />
      </TranslationProvider>,
    );
    const pill = screen.getByRole('button', { name });
    expect(pill.title).toMatch(title);
    expect(pill.title).toContain('Atualizações do aplicativo em Configurações');
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalledOnce();
  });
});
