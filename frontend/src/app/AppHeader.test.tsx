import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from '../components/layout/AppHeader';
import { useAppBuildInfo } from '../hooks/useAppBuildInfo';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn<typeof invoke>() }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllEnvs();
});

const props = {
  native: true,
  dps: { visible: false, known: true, locked: false },
  onQuit: vi.fn<() => void>(),
};
const build = {
  channel: 'development',
  version: '0.7.0',
  branch: 'feat/dev-workflow',
  revision: 'abcdef123456',
  live_reload: true,
};

function Header(props: ComponentProps<typeof AppHeader>) {
  const buildInfo = useAppBuildInfo(props.native);
  return <AppHeader {...props} buildInfo={buildInfo} />;
}

describe('workspace header actions', () => {
  it('leaves window visibility to Home and keeps only Quit', () => {
    render(<AppHeader {...props} />);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Quit Aion Companion']);
    fireEvent.click(screen.getByRole('button', { name: 'Quit Aion Companion' }));
    expect(props.onQuit).toHaveBeenCalledOnce();
  });
});

describe('workspace development badge', () => {
  it.each([true, false])(
    'reads native metadata and describes live reload=%s',
    async (live_reload) => {
      vi.mocked(invoke).mockResolvedValue({ ...build, live_reload });
      render(<Header {...props} />);
      const badge = await screen.findByText('Dev');
      expect(invoke).toHaveBeenCalledWith('app_build_info');
      expect(badge.title).toBe(
        `Development · feat/dev-workflow · abcdef1 · ${live_reload ? 'Live reload' : 'Standalone'}`,
      );
    },
  );

  it('never flashes Dev while a stable native build resolves, even under Vite dev', async () => {
    vi.stubEnv('DEV', true);
    let resolve!: (value: unknown) => void;
    vi.mocked(invoke).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Header {...props} />);
    expect(screen.queryByText('Dev')).toBeNull();
    await act(async () => {
      resolve({ ...build, channel: 'stable' });
    });
    expect(screen.queryByText('Dev')).toBeNull();
  });

  it('keeps an unavailable native channel unlabelled', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('unavailable'));
    await act(async () => {
      render(<Header {...props} />);
    });
    expect(screen.queryByText('Dev')).toBeNull();
  });

  it('labels browser development previews without invoking native', () => {
    vi.stubEnv('DEV', true);
    render(<Header {...props} native={false} />);
    expect(screen.getByText('Dev').title).toContain('Development preview');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('does not label production browser previews as development', () => {
    vi.stubEnv('DEV', false);
    render(<Header {...props} native={false} />);
    expect(screen.queryByText('Dev')).toBeNull();
  });
});
