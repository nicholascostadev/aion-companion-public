import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadText } from '../lib/download';
import { exportDiagnostics, fallbackDiagnostics } from '../services/diagnostics';
import { useDiagnosticsReport } from './useDiagnosticsReport';

vi.mock('../lib/download', () => ({ downloadText: vi.fn<typeof downloadText>() }));
vi.mock('../services/diagnostics', () => ({
  diagnosticsFileName: (_at?: Date, partial = false) =>
    partial ? 'report-partial.aion-diagnostics.json' : 'report.aion-diagnostics.json',
  exportDiagnostics: vi.fn<typeof exportDiagnostics>(),
  fallbackDiagnostics: vi.fn<typeof fallbackDiagnostics>(),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/** An export that settles when the test says so. */
function pendingExport() {
  let resolve!: (json: string) => void;
  let reject!: (cause: unknown) => void;
  vi.mocked(exportDiagnostics).mockReturnValue(
    new Promise<string>((done, fail) => {
      resolve = done;
      reject = fail;
    }),
  );
  return { resolve, reject };
}

describe('bug report export', () => {
  it('runs one export at a time and starts the download of native’s file', async () => {
    const native = pendingExport();
    const { result } = renderHook(useDiagnosticsReport);
    act(() => {
      void result.current.download();
      void result.current.download();
    });
    expect(result.current.phase).toBe('exporting');
    expect(exportDiagnostics).toHaveBeenCalledTimes(1);

    await act(async () => native.resolve('{"kind":"aion-companion-diagnostics"}'));
    expect(downloadText).toHaveBeenCalledWith(
      'report.aion-diagnostics.json',
      '{"kind":"aion-companion-diagnostics"}',
    );
    expect(result.current).toMatchObject({
      phase: 'started',
      fileName: 'report.aion-diagnostics.json',
      partial: false,
    });

    act(() => result.current.reset());
    expect(result.current.phase).toBe('idle');
  });

  it('keeps the failure and downloads this window’s log in its place', async () => {
    const native = pendingExport();
    vi.mocked(fallbackDiagnostics).mockReturnValue('{"partial":true}');
    const { result } = renderHook(useDiagnosticsReport);
    act(() => void result.current.download());
    await act(async () => native.reject('Diagnostics journal unavailable'));
    expect(result.current).toMatchObject({
      phase: 'failed',
      error: 'Diagnostics journal unavailable',
    });
    expect(downloadText).not.toHaveBeenCalled();

    act(() => result.current.downloadPartial());
    expect(fallbackDiagnostics).toHaveBeenCalledWith('Diagnostics journal unavailable');
    expect(downloadText).toHaveBeenCalledWith(
      'report-partial.aion-diagnostics.json',
      '{"partial":true}',
    );
    expect(result.current).toMatchObject({ phase: 'started', partial: true, error: '' });
  });

  it('reports a download the webview refused', async () => {
    vi.mocked(exportDiagnostics).mockResolvedValue('{}');
    vi.mocked(downloadText).mockImplementation(() => {
      throw new Error('Downloads blocked');
    });
    const { result } = renderHook(useDiagnosticsReport);
    await act(() => result.current.download());
    expect(result.current.phase).toBe('failed');
    expect(result.current.error).toContain('Downloads blocked');
  });

  it('still hands an asked-for file over after unmount', async () => {
    const native = pendingExport();
    const { result, unmount } = renderHook(useDiagnosticsReport);
    act(() => void result.current.download());
    unmount();
    await act(async () => native.resolve('{}'));
    expect(downloadText).toHaveBeenCalledTimes(1);
  });
});
