import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Trans, useTranslation } from '../../i18n/provider';
import type { DiagnosticsReport } from '../../types/diagnostics';
import { cn } from '../../lib/cn';
import { SettingsGroup, SettingsSection } from '../offline/SettingsLayout';

const FILE_TYPE = '.aion-diagnostics.json';
const INCLUDED = ['version', 'errors', 'counters', 'windows'] as const;
const EXCLUDED = ['packets', 'logs', 'account', 'files'] as const;

const fileType = (
  <code className="rounded-xs bg-surface-3 px-1 py-px text-2xs whitespace-nowrap text-ink-2" />
);

function Contents({ title, items, icon }: { title: string; items: string[]; icon: IconName }) {
  return (
    <div className="min-w-0">
      <h3 className="m-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase">{title}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {items.map((item) => (
          <li key={item} className="flex items-start gap-2 text-sm leading-snug text-ink-2">
            <Icon
              name={icon}
              size={14}
              className={cn('mt-0.5 shrink-0', icon === 'check' ? 'text-success' : 'text-ink-4')}
            />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The download and what came of it: where the file went, or why it failed with a way to
 * save this window's own log instead. Shared by Settings and the crash screen.
 */
export function ReportActions({
  native,
  report,
  primary = false,
  children,
}: {
  native: boolean;
  report: DiagnosticsReport;
  primary?: boolean;
  /** More actions beside the download. */
  children?: ReactNode;
}) {
  const { t } = useTranslation('diagnostics');
  const exporting = report.phase === 'exporting';
  return (
    <>
      <span className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant={primary ? 'primary' : 'secondary'}
          icon={<Icon name="download" />}
          loading={exporting}
          disabled={!native}
          onClick={() => void report.download()}
        >
          {exporting ? t(($) => $.actions.preparing) : t(($) => $.actions.download)}
        </Button>
        {children}
      </span>

      {report.phase === 'started' && (
        <Notice tone="good" className="my-0 self-stretch" onDismiss={report.reset}>
          <Trans
            t={t}
            i18nKey={($) => (report.partial ? $.actions.startedPartial : $.actions.started)}
            values={{ file: report.fileName }}
            components={[
              <span key="lead" className="font-semibold" />,
              <span key="file" className="break-all" />,
            ]}
          />
        </Notice>
      )}
      {report.phase === 'failed' && (
        <Notice tone="error" className="my-0 self-stretch" onDismiss={report.reset}>
          <span className="block">
            {t(($) => $.actions.failed, {
              error: report.error || t(($) => $.actions.unknownError),
            })}
          </span>
          <span className="mt-1 block">{t(($) => $.actions.partialHint)}</span>
          <Button
            size="xs"
            className="mt-2"
            icon={<Icon name="download" />}
            onClick={report.downloadPartial}
          >
            {t(($) => $.actions.partial)}
          </Button>
        </Notice>
      )}
    </>
  );
}

/** Candid about what the file can hold and how far the clean-up goes. */
export function ReviewNote({ className }: { className?: string }) {
  const { t } = useTranslation('diagnostics');
  return (
    <Notice className={cn('my-0 self-stretch', className)}>
      <Trans
        t={t}
        i18nKey={($) => $.review}
        components={[<span key="lead" className="font-semibold" />]}
      />
    </Notice>
  );
}

/**
 * Settings chapter for bug reports: how to report, one download and what the file holds.
 * Independent of the offline settings, so it works when they never load.
 */
export function DiagnosticsPanel({
  native,
  report,
  className,
}: {
  native: boolean;
  report: DiagnosticsReport;
  className?: string;
}) {
  const { t } = useTranslation('diagnostics');
  const steps = [
    { id: 'reproduce', title: t(($) => $.steps.reproduce), body: t(($) => $.steps.reproduceBody) },
    {
      id: 'download',
      title: t(($) => $.steps.download),
      body: (
        <Trans
          t={t}
          i18nKey={($) => $.steps.downloadBody}
          values={{ file: FILE_TYPE }}
          components={[fileType]}
        />
      ),
    },
    { id: 'send', title: t(($) => $.steps.send), body: t(($) => $.steps.sendBody) },
  ];
  const title = t(($) => $.panel.title);
  return (
    <SettingsGroup className={cn(className)}>
      <SettingsSection
        title={
          <>
            <Icon name="bug" size={17} className="text-accent" />
            {title}
          </>
        }
        label={title}
        description={t(($) => $.panel.description)}
      >
        <div className="flex flex-col gap-5">
          <ol className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(100%,13rem),1fr))] gap-x-6 gap-y-4 p-0">
            {steps.map((step, index) => (
              <li key={step.id} className="flex min-w-0 items-start gap-3">
                <span
                  aria-hidden
                  className="flex size-6 shrink-0 items-center justify-center rounded-full border border-accent-line bg-accent-soft text-xs font-semibold text-accent tabular-nums"
                >
                  {index + 1}
                </span>
                <span className="min-w-0">
                  <strong className="block text-sm font-semibold text-ink">{step.title}</strong>
                  <span className="mt-0.5 block text-xs leading-snug text-ink-3">{step.body}</span>
                </span>
              </li>
            ))}
          </ol>

          <div className="flex flex-col items-start gap-3 border-t border-line-soft pt-5">
            {!native && (
              <Notice className="m-0 self-stretch">{t(($) => $.panel.needsDesktop)}</Notice>
            )}
            <ReportActions native={native} report={report} />
            <ReviewNote />
          </div>

          <Disclosure summary={t(($) => $.panel.contents)} className="-mb-2">
            <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,16rem),1fr))] gap-x-8 gap-y-4">
              <Contents
                title={t(($) => $.included.title)}
                items={INCLUDED.map((id) => t(($) => $.included[id]))}
                icon="check"
              />
              <Contents
                title={t(($) => $.excluded.title)}
                items={EXCLUDED.map((id) => t(($) => $.excluded[id]))}
                icon="minus"
              />
            </div>
          </Disclosure>
        </div>
      </SettingsSection>
    </SettingsGroup>
  );
}
