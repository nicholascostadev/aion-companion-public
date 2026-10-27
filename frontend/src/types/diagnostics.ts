export type DiagnosticsPhase = 'idle' | 'exporting' | 'started' | 'failed';

/** A bug-report export, as the Settings chapter and the crash screen show it. */
export interface DiagnosticsReport {
  phase: DiagnosticsPhase;
  /** Name of the file last handed to the webview's download (which does not confirm the write). */
  fileName: string;
  /** The downloaded file holds only this window's log (native could not export). */
  partial: boolean;
  /** Why the last export failed. */
  error: string;
  /** Asks native for the support file and downloads it. */
  download: () => Promise<void>;
  /** After a failed export: downloads this window's log alone. */
  downloadPartial: () => void;
  /** Back to idle, e.g. when a message is dismissed. */
  reset: () => void;
}
