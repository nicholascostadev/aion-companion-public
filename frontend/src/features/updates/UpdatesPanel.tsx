import type { ReactNode } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { KeyValueList } from '../../components/ui/Data';
import { Disclosure } from '../../components/ui/Disclosure';
import { Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { UNKNOWN } from '../../i18n/formatters';
import { Trans, useFormat, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { updateAccessStep } from '../../lib/updateAccess';
import type { SetupDistribution, SetupState } from '../../types/setup';
import type { UpdateAccessState } from '../../types/updateAccess';
import type { UpdatePhase, UpdateStatus, UpdatesState } from '../../types/updates';
import { SettingsGroup, SettingsSection } from '../offline/SettingsLayout';
import { LinkFailure, useLinkOpener } from '../setup/links';
import { ReleaseNotes, releaseNotesCount } from './ReleaseNotes';
import { SAMPLE_RELEASE_NOTES } from './releaseNotesSample';
import { UpdateAccessGuide } from './UpdateAccessGuide';

type T = Translate<'updates'>;

const STATES: Record<UpdatePhase, { icon: IconName; tone?: 'good' | 'accent' | 'bad' }> = {
  development: { icon: 'info' },
  idle: { icon: 'info' },
  checking: { icon: 'loader' },
  current: { icon: 'circleCheck', tone: 'good' },
  available: { icon: 'download', tone: 'accent' },
  downloading: { icon: 'loader' },
  ready: { icon: 'packageCheck', tone: 'accent' },
  restarting: { icon: 'loader' },
  error: { icon: 'warning', tone: 'bad' },
};

const TONES = { good: 'text-success', accent: 'text-accent', bad: 'text-danger' } as const;

const SPINNING: UpdatePhase[] = ['checking', 'downloading', 'restarting'];

/** Phases whose caption takes the place of the GitHub sign-in note. */
const CAPTIONED: UpdatePhase[] = ['available', 'downloading', 'ready', 'restarting'];

/** The App updates surface in Settings, which the header's update pill scrolls to and focuses. */
export const UPDATES_SECTION_ID = 'app-updates';

export const updateVersion = (value: string | null) =>
  !value ? UNKNOWN : /^v/i.test(value) ? value : `v${value}`;

/** A button-sized icon that turns while a step is running. */
function Glyph({ icon, spin = false }: { icon: IconName; spin?: boolean }) {
  return <Icon name={icon} size={14} className={spin ? 'animate-spin' : undefined} />;
}

function Frame({
  repository,
  children,
  development = false,
}: {
  repository: string;
  children: ReactNode;
  development?: boolean;
}) {
  const { t } = useTranslation('updates');
  return (
    <SettingsGroup id={UPDATES_SECTION_ID} tabIndex={-1} className="mt-4 scroll-mt-28">
      <SettingsSection
        title={t(($) => $.title)}
        description={
          development ? t(($) => $.descriptionDevelopment) : t(($) => $.description, { repository })
        }
      >
        {children}
      </SettingsSection>
    </SettingsGroup>
  );
}

/**
 * How releases are read: from the private repository through the GitHub CLI sign-in, which
 * only updates need, or from public releases with no sign-in at all. `guided`: the
 * GitHub access guide above already walks through the sign-in.
 */
function AuthHint({
  distribution,
  guided = false,
}: {
  distribution: SetupDistribution;
  guided?: boolean;
}) {
  const { t } = useTranslation('updates');
  if (distribution === 'public') return t(($) => $.publicHint);
  if (guided) return t(($) => $.guidedHint);
  return (
    <Trans
      t={t}
      i18nKey={($) => $.authHint}
      components={[
        <code key="gh" className="rounded-xs bg-surface-3 px-1 py-px text-2xs text-ink" />,
      ]}
    />
  );
}

function caption(
  s: UpdateStatus,
  restartBlocked: boolean,
  distribution: SetupDistribution,
  guided: boolean,
  t: T,
): ReactNode {
  switch (s.phase) {
    case 'available':
      return t(($) => $.caption.available);
    case 'downloading':
      return t(($) => $.caption.downloading);
    case 'ready':
      if (restartBlocked) return t(($) => $.caption.blocked);
      return t(($) => $.caption.ready, { version: updateVersion(s.latest_version) });
    case 'restarting':
      return t(($) => $.caption.restarting);
    default:
      return <AuthHint distribution={distribution} guided={guided} />;
  }
}

/** A quiet explanatory line under the actions. */
function Hint({ children }: { children: ReactNode }) {
  return <small className="max-w-2xl text-xs leading-snug text-ink-3">{children}</small>;
}

/** Release notes folded under their title, with how many changes they list. */
function NotesDisclosure({
  title,
  notes,
  badge,
  children,
}: {
  title: ReactNode;
  notes: string;
  badge?: ReactNode;
  children?: ReactNode;
}) {
  const { t } = useTranslation('updates');
  const count = releaseNotesCount(notes);
  return (
    <Disclosure
      variant="plain"
      className="self-stretch rounded-lg border border-line-soft bg-surface-2 px-3"
      bodyClassName="pr-2"
      summary={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {title}
          {badge}
          {count > 0 && (
            <span className="text-xs font-normal text-ink-4 tabular-nums">
              {t(($) => $.releaseNotes.count, { count })}
            </span>
          )}
        </span>
      }
    >
      {children}
      <ReleaseNotes notes={notes} />
    </Disclosure>
  );
}

/**
 * `restartBlocked` disables only Restart, e.g. while the Settings draft has unsaved changes
 * that a restart would lose. `distribution` says how releases are read (private until the
 * setup probe says otherwise); `onOpenLink` opens the official release and GitHub CLI pages.
 * `access`, given only to a stable private build, adds the guided GitHub access path; once it
 * confirms access, Check for updates leads if nothing has been read yet or the last step failed.
 *
 * A stable build that cannot restart into an update is a portable copy: it still checks for
 * releases, but offers the installer and replacing the file by hand instead of a download
 * it could never apply.
 */
export function UpdatesPanel({
  native,
  updates,
  restartBlocked = false,
  distribution = 'private',
  onOpenLink,
  access,
}: {
  native: boolean;
  updates: UpdatesState;
  restartBlocked?: boolean;
  distribution?: SetupDistribution;
  onOpenLink?: SetupState['open'] | undefined;
  access?: UpdateAccessState | undefined;
}) {
  const { t } = useTranslation('updates');
  const fmt = useFormat();
  const links = useLinkOpener(native ? onOpenLink : undefined);
  const { status, error, pending, busy } = updates;
  const repository = status?.repository ?? 'nicholascostadev/aion-companion-public';

  if (status?.channel === 'development' || status?.phase === 'development')
    return (
      <Frame repository={repository} development>
        <div className="flex flex-col items-start gap-3">
          <KeyValueList
            items={[{ label: t(($) => $.installed), value: updateVersion(status.current_version) }]}
          />
          <Notice className="m-0 self-stretch">{t(($) => $.developmentNotice)}</Notice>
          <NotesDisclosure
            title={t(($) => $.releaseNotes.sample.summary)}
            notes={SAMPLE_RELEASE_NOTES}
            badge={
              <Badge tone="info" shape="tag">
                {t(($) => $.releaseNotes.sample.badge)}
              </Badge>
            }
          >
            <p className="mt-0 mb-4 max-w-2xl text-xs leading-snug text-ink-3">
              {t(($) => $.releaseNotes.sample.hint)}
            </p>
          </NotesDisclosure>
        </div>
      </Frame>
    );

  if (!native)
    return (
      <Frame repository={repository}>
        <div className="flex flex-col items-start gap-3">
          <Notice className="m-0 self-stretch">{t(($) => $.needsDesktop)}</Notice>
          <Button size="sm" disabled icon={<Glyph icon="refresh" />}>
            {t(($) => $.check)}
          </Button>
        </div>
      </Frame>
    );

  const phase = status?.phase ?? null;
  const state = phase ? STATES[phase] : null;
  const locked = !status || busy;

  // A click turns its button at once rather than waiting for native's next status.
  const downloading = phase === 'downloading' || (phase === 'available' && pending === 'download');
  const restarting = phase === 'restarting' || (phase === 'ready' && pending === 'install');

  // Development returned above, so a status that cannot restart is a portable copy.
  const portable = !!status && !status.restart_supported;
  const checking = phase === 'checking' || pending === 'check';
  const guided = !!access && distribution === 'private';
  const accessReady = guided && updateAccessStep(access.status) === 'ready';
  const checkLeads = accessReady && !portable && (phase === 'idle' || phase === 'error');
  const checkButton = (
    <Button
      size="sm"
      variant={checkLeads ? 'primary' : 'secondary'}
      disabled={locked}
      icon={<Glyph icon={checking ? 'loader' : 'refresh'} spin={checking} />}
      onClick={() => void updates.check()}
    >
      {checking ? t(($) => $.checking) : t(($) => $.check)}
    </Button>
  );

  let actions: ReactNode;
  if (portable) {
    actions = (
      <>
        {links.available && (
          <Button
            size="sm"
            variant="primary"
            icon={<Glyph icon="installer" />}
            loading={links.opening === 'releases'}
            onClick={() => void links.open('releases')}
          >
            {t(($) => $.portable.installer)}
          </Button>
        )}
        {checkButton}
      </>
    );
  } else if (downloading) {
    actions = (
      <Button size="sm" variant="primary" disabled icon={<Glyph icon="loader" spin />}>
        {t(($) => $.downloading)}
      </Button>
    );
  } else if (phase === 'available') {
    actions = (
      <>
        <Button
          size="sm"
          variant="primary"
          disabled={locked}
          icon={<Glyph icon="download" />}
          onClick={() => void updates.download()}
        >
          {t(($) => $.download)}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={locked}
          icon={<Glyph icon="refresh" />}
          onClick={() => void updates.check()}
        >
          {t(($) => $.checkAgain)}
        </Button>
      </>
    );
  } else if (phase === 'ready' || phase === 'restarting') {
    actions = (
      <Button
        size="sm"
        variant="primary"
        disabled={locked || restartBlocked || !status?.restart_supported}
        icon={<Glyph icon={restarting ? 'loader' : 'restart'} spin={restarting} />}
        onClick={() => void updates.install()}
      >
        {restarting ? t(($) => $.restartingButton) : t(($) => $.restart)}
      </Button>
    );
  } else {
    actions = checkButton;
  }

  let hint: ReactNode;
  if (!status) hint = <AuthHint distribution={distribution} guided={guided} />;
  else if (!portable) hint = caption(status, restartBlocked, distribution, guided, t);
  else
    hint = (
      <>
        {status.phase === 'available'
          ? t(($) => $.portable.available, { version: updateVersion(status.latest_version) })
          : t(($) => $.portable.caption)}
        {distribution === 'private' && <> {t(($) => $.portable.signIn)}</>}
      </>
    );
  // The sign-in note: the default caption of an installed copy, and always a line of its own
  // for a portable copy, which still needs it to check.
  const signInNote = portable && distribution === 'private';
  // The guide has its own GitHub CLI step, so the lone link is only for an unguided copy.
  const cliLink =
    !guided &&
    distribution === 'private' &&
    links.available &&
    (!status || portable || !CAPTIONED.includes(status.phase));

  return (
    <Frame repository={repository}>
      <div className="flex flex-col items-start gap-3.5">
        <KeyValueList
          items={[
            {
              label: t(($) => $.installed),
              value: status ? updateVersion(status.current_version) : UNKNOWN,
            },
            {
              label: t(($) => $.latest),
              value: status?.latest_version
                ? updateVersion(status.latest_version)
                : phase === 'checking'
                  ? t(($) => $.checking)
                  : t(($) => $.notKnown),
            },
            {
              label: t(($) => $.lastChecked),
              value: !status
                ? UNKNOWN
                : status.checked_ms === null
                  ? t(($) => $.never)
                  : fmt.dateTime(status.checked_ms),
            },
            portable && { label: t(($) => $.installation), value: t(($) => $.portable.copy) },
          ]}
        />

        <output
          className={cn(
            'flex items-center gap-2 text-left text-sm font-medium text-ink-2',
            state?.tone && TONES[state.tone],
          )}
        >
          {state && status ? (
            <>
              <Glyph icon={state.icon} spin={SPINNING.includes(status.phase)} />
              {t(($) => $.state[status.phase], { version: updateVersion(status.latest_version) })}
            </>
          ) : (
            t(($) => $.reading)
          )}
        </output>

        {status?.phase === 'error' && (
          <Notice tone="error" className="my-0 self-stretch">
            {t(($) => $.failed, { error: status.error ?? t(($) => $.failedUnknown) })}
          </Notice>
        )}
        {error && (
          <Notice tone="error" className="my-0 self-stretch">
            {t(($) => $.unreachable, { error })}
          </Notice>
        )}

        {portable && <Notice className="my-0 self-stretch">{t(($) => $.portable.notice)}</Notice>}

        {guided && access && (
          <UpdateAccessGuide access={access} onOpenLink={native ? onOpenLink : undefined} />
        )}

        <span className="flex flex-wrap gap-2">{actions}</span>
        <Hint>{hint}</Hint>
        {signInNote && (
          <Hint>
            <AuthHint distribution={distribution} guided={guided} />
          </Hint>
        )}
        {cliLink && (
          <Button
            size="xs"
            variant="link"
            icon={<Glyph icon="external" />}
            loading={links.opening === 'github_cli'}
            onClick={() => void links.open('github_cli')}
          >
            {t(($) => $.githubCli)}
          </Button>
        )}
        <LinkFailure error={links.error} className="my-0 self-stretch" />

        {status?.notes && status.latest_version && (
          <NotesDisclosure
            title={t(($) => $.notes, { version: updateVersion(status.latest_version) })}
            notes={status.notes}
          />
        )}
      </div>
    </Frame>
  );
}
