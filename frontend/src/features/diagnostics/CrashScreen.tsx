import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { useTranslation } from '../../i18n/provider';
import type { DiagnosticsReport } from '../../types/diagnostics';
import { ReportActions, ReviewNote } from './DiagnosticsPanel';

/**
 * Shown in place of the workspace when it fails to start or stops on an error React could
 * not recover from, so a bug report can still be downloaded without reaching Settings.
 */
export function CrashScreen({
  native,
  detail,
  report,
}: {
  native: boolean;
  /** The error, already bounded and redacted. */
  detail: string;
  report: DiagnosticsReport;
}) {
  const { t } = useTranslation('diagnostics');
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col justify-center px-6 py-12">
      <Panel padding="lg" as="section" aria-labelledby="crash-title" className="animate-sprout">
        <div className="flex items-start gap-3">
          <Icon name="warning" size={20} className="mt-1 shrink-0 text-danger" />
          <div className="min-w-0">
            <h1 id="crash-title" className="m-0 text-xl font-semibold tracking-tight">
              {t(($) => $.crash.title)}
            </h1>
            <p className="mt-1.5 mb-0 text-sm leading-snug text-ink-2">{t(($) => $.crash.body)}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-col items-start gap-3 border-t border-line-soft pt-5">
          <ReportActions native={native} report={report} primary>
            <Button
              size="sm"
              variant="ghost"
              icon={<Icon name="refresh" />}
              onClick={() => window.location.reload()}
            >
              {t(($) => $.crash.reload)}
            </Button>
          </ReportActions>
          <ReviewNote />
        </div>
        <Disclosure summary={t(($) => $.crash.details)} className="mt-4">
          <pre className="m-0 max-h-60 overflow-auto rounded-lg bg-sunken p-3 font-mono text-xs leading-snug whitespace-pre-wrap text-ink-2 inset-shadow-well">
            {detail}
          </pre>
        </Disclosure>
      </Panel>
    </main>
  );
}
