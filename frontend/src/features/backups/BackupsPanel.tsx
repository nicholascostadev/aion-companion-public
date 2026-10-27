import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { KeyValueList } from '../../components/ui/Data';
import { Disclosure } from '../../components/ui/Disclosure';
import { Notice } from '../../components/ui/Feedback';
import { Checkbox } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import type { Formatters } from '../../i18n/formatters';
import { cn } from '../../lib/cn';
import {
  BACKUP_PARTS,
  type BackupLimits,
  type BackupPreview,
  type BackupPreviewFile,
  type BackupRecovery,
  type BackupsState,
} from '../../types/backups';
import { FieldGroup, SettingsGroup, SettingsSection } from '../offline/SettingsLayout';
import { formatBytes, groupFiles, planOverLimit } from './model';

type T = Translate<'backups'>;

/** The Backup and restore surface in Settings. */
export const BACKUPS_SECTION_ID = 'backups';

const channelName = (t: T, channel: string) =>
  channel === 'stable'
    ? t(($) => $.channel.stable)
    : channel === 'development'
      ? t(($) => $.channel.development)
      : channel;

const version = (value: string) => (/^v/i.test(value) ? value : `v${value}`);

/** A quiet explanatory line. */
function Hint({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <small className={cn('block max-w-2xl text-xs leading-snug text-ink-3', className)}>
      {children}
    </small>
  );
}

const RECOVERY_TONES = { restored: 'good', rolled_back: 'warn', failed: 'error' } as const;

/**
 * How the restore staged before this start ended, worded here; native's own message is
 * English diagnostic detail, folded away for whoever needs it.
 */
function LastRecovery({ recovery }: { recovery: BackupRecovery }) {
  const { t } = useTranslation('backups');
  const phase = recovery.phase;
  if (phase !== 'restored' && phase !== 'rolled_back' && phase !== 'failed') return null;
  return (
    <Notice tone={RECOVERY_TONES[phase]} className="mt-5 mb-0">
      <span className="block">{t(($) => $.recovery[phase])}</span>
      {recovery.message && (
        <Disclosure
          variant="plain"
          summary={t(($) => $.recovery.details)}
          summaryClassName="py-1 text-xs text-current"
          bodyClassName="pb-1"
        >
          <code lang="en" className="block font-mono text-xs [overflow-wrap:anywhere]">
            {recovery.message}
          </code>
        </Disclosure>
      )}
    </Notice>
  );
}

function limitsLine(t: T, fmt: Formatters, limits: BackupLimits) {
  return t(($) => $.backup.limits, {
    files: t(($) => $.files, { count: limits.files }),
    total: formatBytes(fmt, limits.total_bytes),
    file: formatBytes(fmt, limits.file_bytes),
  });
}

/* ---------- Back up ---------- */

function BackupSection({ native, backups }: { native: boolean; backups: BackupsState }) {
  const { t } = useTranslation('backups');
  const fmt = useFormat();
  const { status, options, plan, planning, planError, pending, exported } = backups;
  const locked = !native || pending !== null || backups.restore?.kind === 'staged';
  const chosen = BACKUP_PARTS.some((part) => options[part]);
  const groups = new Map(plan ? groupFiles(plan.files).map((g) => [g.part, g]) : []);
  const over = plan && status ? planOverLimit(plan, status.limits) : null;
  const exporting = pending === 'export';

  const estimate = !native ? null : !chosen ? (
    t(($) => $.backup.nothingChosen)
  ) : planning && !plan ? (
    t(($) => $.backup.estimating)
  ) : plan && plan.files.length === 0 ? (
    t(($) => $.backup.nothingSaved)
  ) : plan ? (
    <span className={cn(planning && 'opacity-60')}>
      {t(($) => $.backup.estimate, {
        size: formatBytes(fmt, plan.total_bytes),
        files: t(($) => $.files, { count: plan.files.length }),
      })}
    </span>
  ) : null;

  return (
    <SettingsSection title={t(($) => $.backup.title)} description={t(($) => $.backup.description)}>
      <div className="flex flex-col items-start gap-4">
        <FieldGroup label={t(($) => $.backup.include)} wide>
          <fieldset
            className="m-0 grid w-full min-w-0 gap-x-6 gap-y-3 border-0 p-0 min-[620px]:grid-cols-2"
            disabled={locked}
          >
            <legend className="sr-only">{t(($) => $.backup.includeLabel)}</legend>
            {BACKUP_PARTS.map((part) => {
              const group = options[part] ? groups.get(part) : undefined;
              return (
                <div key={part} className="flex min-w-0 items-start justify-between gap-3">
                  <Checkbox
                    checked={options[part]}
                    disabled={locked}
                    onCheckedChange={(checked) => backups.setOption(part, checked)}
                    label={t(($) => $.groups[part])}
                    hint={t(($) => $.backup.parts[part])}
                    className="min-w-0"
                  />
                  {group && (
                    <span
                      className="mt-0.5 shrink-0 text-xs text-ink-3 tabular-nums"
                      title={t(($) => $.files, { count: group.files.length })}
                    >
                      {formatBytes(fmt, group.bytes)}
                    </span>
                  )}
                </div>
              );
            })}
          </fieldset>
        </FieldGroup>

        {native && (
          <div className="flex flex-col gap-1">
            <output
              aria-live="polite"
              className="flex items-center gap-2 text-sm font-medium text-ink-2 tabular-nums"
            >
              {planning && <Icon name="loader" size={14} className="animate-spin text-ink-3" />}
              {estimate}
            </output>
            <Hint>{t(($) => $.backup.estimateNote)}</Hint>
            {status && <Hint>{limitsLine(t, fmt, status.limits)}</Hint>}
          </div>
        )}

        {planError && (
          <Notice tone="error" className="my-0 self-stretch">
            {t(($) => $.backup.estimateFailed, { error: planError })}
          </Notice>
        )}
        {over && status && (
          <Notice tone="warn" className="my-0 self-stretch">
            {over.limit === 'files'
              ? t(($) => $.backup.over.files, { files: t(($) => $.files, { count: over.files }) })
              : over.limit === 'total_bytes'
                ? t(($) => $.backup.over.total_bytes, {
                    total: formatBytes(fmt, status.limits.total_bytes),
                  })
                : t(($) => $.backup.over.file_bytes, {
                    name: over.path,
                    file: formatBytes(fmt, status.limits.file_bytes),
                  })}
          </Notice>
        )}

        <Button
          size="sm"
          variant="primary"
          icon={<Icon name="save" />}
          loading={exporting}
          disabled={locked || !chosen || planning || !!over || !!planError}
          onClick={() => void backups.exportBackup()}
        >
          {exporting ? t(($) => $.backup.running) : t(($) => $.backup.action)}
        </Button>

        {exported?.kind === 'saved' && (
          <Notice tone="good" className="my-0 self-stretch" onDismiss={backups.dismissExport}>
            <span className="block">
              {t(($) => $.backup.saved, {
                files: t(($) => $.files, { count: exported.result.files }),
                size: formatBytes(fmt, exported.result.archive_bytes),
              })}
            </span>
            <span className="mt-1 flex flex-wrap items-baseline gap-x-2 text-xs">
              <span className="opacity-85">{t(($) => $.backup.savedTo)}</span>
              <code className="font-mono [overflow-wrap:anywhere]">{exported.result.path}</code>
            </span>
          </Notice>
        )}
        {exported?.kind === 'cancelled' && (
          <Notice className="my-0 self-stretch" onDismiss={backups.dismissExport}>
            {t(($) => $.backup.cancelled)}
          </Notice>
        )}
        {exported?.kind === 'failed' && (
          <Notice tone="error" className="my-0 self-stretch" onDismiss={backups.dismissExport}>
            {t(($) => $.backup.failed, { error: exported.error })}
          </Notice>
        )}

        <Disclosure
          variant="plain"
          className="self-stretch"
          summaryClassName="py-1.5"
          summary={t(($) => $.backup.leftOut.summary)}
        >
          <p className="m-0 max-w-2xl text-sm leading-snug text-ink-3">
            {t(($) => $.backup.leftOut.body)}
          </p>
        </Disclosure>
      </div>
    </SettingsSection>
  );
}

/* ---------- Restore ---------- */

function FileRow({ file }: { file: BackupPreviewFile }) {
  const { t } = useTranslation('backups');
  const fmt = useFormat();
  return (
    <li className="flex min-w-0 items-center gap-3 border-t border-line-soft py-1.5 first:border-t-0">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink-2" title={file.path}>
        {file.path}
      </code>
      <span className="shrink-0 text-xs text-ink-3 tabular-nums">
        {formatBytes(fmt, file.bytes)}
      </span>
      {file.will_replace ? (
        <Badge tone="warn" variant="outline" shape="tag" title={t(($) => $.restore.replacesTitle)}>
          {t(($) => $.restore.replaces)}
        </Badge>
      ) : (
        <Badge tone="info" variant="outline" shape="tag" title={t(($) => $.restore.addsTitle)}>
          {t(($) => $.restore.adds)}
        </Badge>
      )}
    </li>
  );
}

/** "2 files replaced, 1 file added", leaving out a side with none. */
function counts(t: T, files: readonly BackupPreviewFile[]) {
  const replaced = files.filter((file) => file.will_replace).length;
  const added = files.length - replaced;
  const replace = t(($) => $.restore.replaceCount, { count: replaced });
  const add = t(($) => $.restore.addCount, { count: added });
  if (!added) return t(($) => $.restore.countsReplace, { replace });
  if (!replaced) return t(($) => $.restore.countsAdd, { add });
  return t(($) => $.restore.counts, { replace, add });
}

/** The files in a checked backup, by part; long lists fold away. */
function Contents({ preview }: { preview: BackupPreview }) {
  const { t } = useTranslation('backups');
  const fmt = useFormat();
  const groups = groupFiles(preview.files);
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <Disclosure
          key={group.part}
          open={group.files.length <= 4}
          summaryClassName="py-2"
          bodyClassName="pb-2"
          className="first:border-t-0"
          summary={
            <span className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
              <span className="font-semibold text-ink">{t(($) => $.groups[group.part])}</span>
              <span className="text-xs font-normal text-ink-3 tabular-nums">
                {t(($) => $.files, { count: group.files.length })} · {formatBytes(fmt, group.bytes)}{' '}
                · {counts(t, group.files)}
              </span>
            </span>
          }
        >
          <ul className="m-0 max-h-56 list-none overflow-y-auto p-0 pr-1">
            {group.files.map((file) => (
              <FileRow key={file.path} file={file} />
            ))}
          </ul>
        </Disclosure>
      ))}
    </div>
  );
}

/**
 * An inline confirmation. It opens with focus on the safe choice, Keep current data; Escape
 * on either button keeps the data too, and focus returns to the button that opened it.
 */
function ConfirmRestore({
  preview,
  applying,
  blocked,
  locked,
  onApply,
  onKeep,
}: {
  preview: BackupPreview;
  applying: boolean;
  blocked: boolean;
  locked: boolean;
  onApply: () => void;
  onKeep: () => void;
}) {
  const { t } = useTranslation('backups');
  const bodyId = useId();
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => keep.current?.focus(), []);
  const escape = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'Escape' || applying) return;
    event.stopPropagation();
    onKeep();
  };
  return (
    <fieldset
      aria-describedby={bodyId}
      data-state="confirm"
      className="m-0 flex min-w-0 animate-sprout flex-col gap-3 rounded-lg border border-warn-line bg-warn-soft p-4"
    >
      <legend className="float-left m-0 flex items-center gap-2 p-0 font-semibold text-warn-strong">
        <Icon name="warning" size={15} className="shrink-0" />
        {t(($) => $.restore.confirm.title)}
      </legend>
      <p id={bodyId} className="clear-left m-0 max-w-2xl text-sm leading-snug text-ink-2">
        {t(($) => $.restore.confirm.body)}{' '}
        <span className="text-ink tabular-nums">{counts(t, preview.files)}</span>
      </p>
      {blocked && (
        <p className="m-0 text-sm text-warn-strong">{t(($) => $.restore.confirm.unsaved)}</p>
      )}
      <span className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="danger"
          icon={<Icon name="restart" />}
          loading={applying}
          disabled={locked || blocked}
          onClick={onApply}
          onKeyDown={escape}
        >
          {applying ? t(($) => $.restore.confirm.applying) : t(($) => $.restore.confirm.apply)}
        </Button>
        <Button
          ref={keep}
          size="sm"
          variant="ghost"
          disabled={applying}
          onClick={onKeep}
          onKeyDown={escape}
        >
          {t(($) => $.restore.confirm.keep)}
        </Button>
      </span>
    </fieldset>
  );
}

function PreviewBlock({
  preview,
  backups,
  locked,
  restartBlocked,
}: {
  preview: BackupPreview;
  backups: BackupsState;
  locked: boolean;
  restartBlocked: boolean;
}) {
  const { t } = useTranslation('backups');
  const fmt = useFormat();
  // A new preview (another file) always starts unconfirmed.
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmOpen = confirming === preview.token;
  const review = useRef<HTMLButtonElement>(null);
  const keep = () => {
    setConfirming(null);
    requestAnimationFrame(() => review.current?.focus());
  };
  const applying = backups.pending === 'restore';
  return (
    <Panel
      variant="flat"
      padding="none"
      as="article"
      aria-label={t(($) => $.restore.previewTitle, { date: fmt.dateTime(preview.created_ms) })}
      className="flex flex-col gap-4 self-stretch p-4 max-[760px]:p-3"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 flex min-w-0 items-center gap-2 text-md font-semibold tracking-tight">
          <Icon name="packageCheck" size={16} className="shrink-0 text-accent" />
          {t(($) => $.restore.previewTitle, { date: fmt.dateTime(preview.created_ms) })}
        </h3>
        <Badge
          tone="success"
          icon={<Icon name="check" size={12} />}
          title={t(($) => $.restore.verifiedTitle)}
        >
          {t(($) => $.restore.verified)}
        </Badge>
      </header>
      <KeyValueList
        items={[
          { label: t(($) => $.restore.made), value: fmt.dateTime(preview.created_ms) },
          { label: t(($) => $.restore.version), value: version(preview.app_version) },
          { label: t(($) => $.restore.channelLabel), value: channelName(t, preview.channel) },
          {
            label: t(($) => $.restore.contents),
            value: `${t(($) => $.files, { count: preview.files.length })} · ${formatBytes(fmt, preview.total_bytes)}`,
          },
        ]}
      />
      <div className="border-t border-line-soft">
        <Contents preview={preview} />
      </div>
      <p className="m-0 flex max-w-2xl items-start gap-2 text-sm leading-snug text-warn-strong">
        <Icon name="history" size={14} className="mt-0.5 shrink-0" />
        {t(($) => $.restore.snapshot, { date: fmt.dateTime(preview.created_ms) })}
      </p>
      <Hint>{t(($) => $.restore.scope)}</Hint>
      {confirmOpen ? (
        <ConfirmRestore
          preview={preview}
          applying={applying}
          blocked={restartBlocked}
          locked={locked && !applying}
          onApply={() => void backups.applyRestore(preview.token)}
          onKeep={keep}
        />
      ) : (
        <span className="flex flex-wrap gap-2">
          <Button
            ref={review}
            size="sm"
            variant="danger"
            icon={<Icon name="restart" />}
            disabled={locked}
            onClick={() => setConfirming(preview.token)}
          >
            {t(($) => $.restore.review)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={<Icon name="close" />}
            title={t(($) => $.restore.discardTitle)}
            disabled={locked}
            onClick={() => void backups.discardPreview()}
          >
            {t(($) => $.restore.discard)}
          </Button>
        </span>
      )}
    </Panel>
  );
}

function RestoreSection({
  native,
  backups,
  restartBlocked,
}: {
  native: boolean;
  backups: BackupsState;
  restartBlocked: boolean;
}) {
  const { t } = useTranslation('backups');
  const { status, pending, preview, restore } = backups;
  const staged = restore?.kind === 'staged';
  const waiting = !!status?.pending_restore;
  const locked = !native || pending !== null || staged || waiting;
  const checking = pending === 'preview';
  return (
    <SettingsSection
      title={t(($) => $.restore.title)}
      description={t(($) => $.restore.description, {
        channel: channelName(t, status?.channel ?? 'stable'),
      })}
    >
      <div className="flex flex-col items-start gap-4">
        {staged ? (
          <Notice tone="good" className="my-0 self-stretch">
            {t(($) => $.restore.staged)}
          </Notice>
        ) : (
          waiting && <Notice className="my-0 self-stretch">{t(($) => $.restore.pending)}</Notice>
        )}

        {!staged && (
          <Button
            size="sm"
            icon={<Icon name="fileUp" />}
            loading={checking}
            disabled={locked}
            onClick={() => void backups.choosePreview()}
          >
            {checking
              ? t(($) => $.restore.checking)
              : preview
                ? t(($) => $.restore.chooseAnother)
                : t(($) => $.restore.choose)}
          </Button>
        )}

        {restore?.kind === 'cancelled' && (
          <Hint className="text-sm">{t(($) => $.restore.cancelled)}</Hint>
        )}
        {restore?.kind === 'failed' && (
          <Notice tone="error" className="my-0 self-stretch" onDismiss={backups.dismissRestore}>
            {restore.step === 'restore'
              ? t(($) => $.restore.stageFailed, { error: restore.error })
              : t(($) => $.restore.failed, { error: restore.error })}
          </Notice>
        )}

        {preview && !staged && (
          <PreviewBlock
            key={preview.token}
            preview={preview}
            backups={backups}
            locked={locked}
            restartBlocked={restartBlocked}
          />
        )}
      </div>
    </SettingsSection>
  );
}

/**
 * `restartBlocked` holds only Apply and restart, e.g. while the Settings draft has unsaved
 * changes that the restart would lose.
 */
export function BackupsPanel({
  native,
  backups,
  restartBlocked = false,
  className,
}: {
  native: boolean;
  backups: BackupsState;
  restartBlocked?: boolean;
  className?: string;
}) {
  const { t } = useTranslation('backups');
  const { status, statusError } = backups;
  return (
    <SettingsGroup
      id={BACKUPS_SECTION_ID}
      tabIndex={-1}
      label={t(($) => $.title)}
      className={cn('scroll-mt-28', className)}
    >
      {!native ? (
        <Notice className="mt-5 mb-0">{t(($) => $.needsDesktop)}</Notice>
      ) : statusError ? (
        <Notice tone="error" className="mt-5 mb-0">
          {t(($) => $.unreachable, { error: statusError })}
        </Notice>
      ) : !status ? (
        <Hint className="mt-5 text-sm">{t(($) => $.reading)}</Hint>
      ) : (
        status.last_recovery && <LastRecovery recovery={status.last_recovery} />
      )}
      <BackupSection native={native} backups={backups} />
      <RestoreSection native={native} backups={backups} restartBlocked={restartBlocked} />
    </SettingsGroup>
  );
}
