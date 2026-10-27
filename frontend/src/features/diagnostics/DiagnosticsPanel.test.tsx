import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiagnosticsReport } from '../../types/diagnostics';
import { CrashScreen } from './CrashScreen';
import { DiagnosticsPanel } from './DiagnosticsPanel';

afterEach(cleanup);

const fixture = (patch: Partial<DiagnosticsReport> = {}): DiagnosticsReport => ({
  phase: 'idle',
  fileName: '',
  partial: false,
  error: '',
  download: vi.fn<DiagnosticsReport['download']>().mockResolvedValue(undefined),
  downloadPartial: vi.fn<DiagnosticsReport['downloadPartial']>(),
  reset: vi.fn<DiagnosticsReport['reset']>(),
  ...patch,
});

const downloadButton = () =>
  screen.getByRole<HTMLButtonElement>('button', { name: /Download bug report|Preparing report/ });

describe('report a bug', () => {
  it('explains how to report, what is in the file and that it is never uploaded', () => {
    render(<DiagnosticsPanel native report={fixture()} />);
    expect(screen.getByRole('region', { name: 'Report a bug' })).toBeTruthy();
    expect(screen.getByText('Make it happen again')).toBeTruthy();
    expect(screen.getByText(/what you expected and what happened instead/)).toBeTruthy();
    expect(screen.getByText(/never uploaded/)).toBeTruthy();
    expect(screen.getByText(/game character names and IDs/)).toBeTruthy();
    expect(screen.getByText(/best-effort basis/)).toBeTruthy();
    expect(screen.getByText('Not collected')).toBeTruthy();
    expect(screen.getByText('Raw network packets and recordings')).toBeTruthy();
  });

  it('downloads on request', () => {
    const report = fixture();
    render(<DiagnosticsPanel native report={report} />);
    fireEvent.click(downloadButton());
    expect(report.download).toHaveBeenCalledTimes(1);
  });

  it('needs the desktop app and says so', () => {
    const report = fixture();
    render(<DiagnosticsPanel native={false} report={report} />);
    expect(screen.getByText(/Bug reports need the desktop app/)).toBeTruthy();
    expect(downloadButton().disabled).toBe(true);
  });

  it('shows an export in progress without allowing another', () => {
    const report = fixture({ phase: 'exporting' });
    render(<DiagnosticsPanel native report={report} />);
    expect(downloadButton().disabled).toBe(true);
    expect(downloadButton().getAttribute('aria-busy')).toBe('true');
    expect(downloadButton().textContent).toContain('Preparing report…');
    fireEvent.click(downloadButton());
    expect(report.download).not.toHaveBeenCalled();
  });

  it('says the download started, without claiming it was written', () => {
    const report = fixture({
      phase: 'started',
      fileName: 'aion-companion-20261019-140509.aion-diagnostics.json',
    });
    render(<DiagnosticsPanel native report={report} />);
    expect(screen.getByText('Download started:')).toBeTruthy();
    expect(screen.getByText('aion-companion-20261019-140509.aion-diagnostics.json')).toBeTruthy();
    expect(screen.queryByText(/only this window’s log/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(report.reset).toHaveBeenCalledTimes(1);
  });

  it('says when the file holds only this window’s log', () => {
    render(
      <DiagnosticsPanel
        native
        report={fixture({ phase: 'started', partial: true, fileName: 'x.aion-diagnostics.json' })}
      />,
    );
    expect(screen.getByText(/holds only this window’s log/)).toBeTruthy();
  });

  it('reports a failed export and offers this window’s log instead', () => {
    const report = fixture({ phase: 'failed', error: 'Diagnostics journal unavailable' });
    render(<DiagnosticsPanel native report={report} />);
    expect(screen.getByRole('alert').textContent).toContain('Diagnostics journal unavailable');
    fireEvent.click(screen.getByRole('button', { name: /Download window log only/ }));
    expect(report.downloadPartial).toHaveBeenCalledTimes(1);
  });
});

describe('crash screen', () => {
  it('still offers a bug report and a reload, with the error behind a disclosure', () => {
    const report = fixture();
    render(<CrashScreen native detail="TypeError: boom" report={report} />);
    expect(screen.getByRole('heading', { name: 'This window stopped on an error' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Reload window/ })).toBeTruthy();
    expect(screen.getByText('TypeError: boom')).toBeTruthy();
    fireEvent.click(downloadButton());
    expect(report.download).toHaveBeenCalledTimes(1);
  });
});
