import { CrashScreen } from '../features/diagnostics/CrashScreen';
import { useDiagnosticsReport } from '../hooks/useDiagnosticsReport';

/** What `main.tsx` renders in place of a workspace that failed to start or crashed. */
export function CrashApp({ native, detail }: { native: boolean; detail: string }) {
  return <CrashScreen native={native} detail={detail} report={useDiagnosticsReport()} />;
}
