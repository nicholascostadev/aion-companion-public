import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { Trans, useTranslation } from '../../i18n/provider';
import type { PolledOfflineStatus } from '../../types/offline';
import { ReportView } from './report/ReportView';

/**
 * The engine's live report with the same breakdowns as a saved log. Only a full report is
 * drawn: a summary (polled while this tab was hidden) has no events or buffs and only HP
 * endpoints, so until the full one arrives the fight shows as loading rather than as a
 * fight without them.
 */
export function LiveAnalysis({
  status,
  error,
  native,
  active,
  onCopySummary,
}: {
  status: PolledOfflineStatus | null;
  error: string;
  native: boolean;
  active: boolean;
  onCopySummary: (multiline: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('reports');
  const report = status?.report ?? null;
  const settings = status?.settings ?? null;
  const full = report?.detail_level === 'full' ? report : null;
  const hasFight =
    !!report &&
    (report.players.length > 0 || (report.event_count ?? 0) > 0 || (full?.events.length ?? 0) > 0);
  return (
    <Card
      title={t(($) => $.liveAnalysis.title)}
      subtitle={
        <>
          {t(($) => $.liveAnalysis.subtitle)}{' '}
          {settings ? (
            settings.auto_save ? (
              <Trans
                t={t}
                i18nKey={($) => $.liveAnalysis.autoSaved}
                components={[<b key="saved" className="font-semibold text-ink-2" />]}
              />
            ) : (
              t(($) => $.liveAnalysis.autoSaveOff)
            )
          ) : null}
        </>
      }
    >
      {error && (
        <Notice tone="error">{t(($) => $.liveAnalysis.engineError, { detail: error })}</Notice>
      )}
      {status?.error && (
        <Notice tone="warn">
          {t(($) => $.liveAnalysis.libraryError, { detail: status.error })}
        </Notice>
      )}
      {!native ? (
        <EmptyState
          title={t(($) => $.liveAnalysis.native)}
          icon={<Icon name="workspace" size={20} />}
        />
      ) : !status ? (
        <EmptyState
          live
          title={t(($) => $.liveAnalysis.connecting)}
          icon={<Icon name="loader" size={20} className="animate-spin" />}
        />
      ) : !hasFight ? (
        <EmptyState
          live
          title={t(($) => $.liveAnalysis.waitingTitle)}
          icon={<Icon name="sprout" size={20} />}
        >
          {t(($) => $.liveAnalysis.waitingBody)}
        </EmptyState>
      ) : !active ? null : !full ? (
        <EmptyState
          live
          title={t(($) => $.liveAnalysis.loading)}
          icon={<Icon name="loader" size={20} className="animate-spin" />}
        />
      ) : (
        <ReportView
          report={full}
          settings={settings}
          native={native}
          live
          onCopySummary={onCopySummary}
        />
      )}
    </Card>
  );
}
