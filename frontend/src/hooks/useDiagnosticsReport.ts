import { useCallback, useEffect, useRef, useState } from 'react';
import { downloadText } from '../lib/download';
import {
  diagnosticsFileName,
  exportDiagnostics,
  fallbackDiagnostics,
} from '../services/diagnostics';
import type { DiagnosticsPhase, DiagnosticsReport } from '../types/diagnostics';

/** One bug-report export at a time; nothing is applied after unmount. */
export function useDiagnosticsReport(): DiagnosticsReport {
  const [phase, setPhase] = useState<DiagnosticsPhase>('idle');
  const [fileName, setFileName] = useState('');
  const [partial, setPartial] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const alive = useRef(false);
  const failure = useRef<unknown>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const download = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPhase('exporting');
    setError('');
    try {
      const json = await exportDiagnostics();
      const name = diagnosticsFileName();
      downloadText(name, json);
      if (!alive.current) return;
      setFileName(name);
      setPartial(false);
      setPhase('started');
    } catch (cause) {
      failure.current = cause;
      if (!alive.current) return;
      // Raw detail only; the panel words a missing one in the interface language.
      setError(String(cause));
      setPhase('failed');
    } finally {
      running.current = false;
    }
  }, []);

  const downloadPartial = useCallback(() => {
    if (running.current) return;
    const name = diagnosticsFileName(new Date(), true);
    try {
      downloadText(name, fallbackDiagnostics(failure.current ?? 'Native export unavailable'));
    } catch (cause) {
      setError(String(cause));
      setPhase('failed');
      return;
    }
    setFileName(name);
    setPartial(true);
    setError('');
    setPhase('started');
  }, []);

  const reset = useCallback(() => {
    if (running.current) return;
    setPhase('idle');
    setError('');
  }, []);

  return { phase, fileName, partial, error, download, downloadPartial, reset };
}
