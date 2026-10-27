import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { copyText } from '../../lib/clipboard';
import { cn } from '../../lib/cn';
import { updateAccessStep } from '../../lib/updateAccess';
import type { SetupState } from '../../types/setup';
import type { UpdateAccessState, UpdateAccessStep } from '../../types/updateAccess';
import { LinkFailure, useLinkOpener } from '../setup/links';

/** The official GitHub CLI browser sign-in, for when native cannot open its window. */
export const GH_LOGIN_COMMAND = 'gh auth login --hostname github.com --web --git-protocol https';

const STEP: Record<UpdateAccessStep, { tone: Tone; icon: IconName; spin?: boolean }> = {
  unknown: { tone: 'neutral', icon: 'info' },
  checking: { tone: 'info', icon: 'loader', spin: true },
  signing_in: { tone: 'info', icon: 'loader', spin: true },
  cli_missing: { tone: 'warn', icon: 'terminal' },
  signed_out: { tone: 'warn', icon: 'signIn' },
  no_access: { tone: 'warn', icon: 'invitation' },
  error: { tone: 'danger', icon: 'warning' },
  ready: { tone: 'success', icon: 'circleCheck' },
};

const NEXT: Record<UpdateAccessStep, 1 | 2 | 3 | null> = {
  unknown: null,
  checking: null,
  signing_in: 2,
  cli_missing: 1,
  signed_out: 2,
  no_access: 3,
  error: null,
  ready: null,
};

type Progress = 'done' | 'next' | 'todo';

/** A numbered step that turns into a check once the probe confirms it. */
function Step({
  index,
  progress,
  title,
  children,
}: {
  index: number;
  progress: Progress;
  title: string;
  children: ReactNode;
}) {
  const { t } = useTranslation('updates');
  return (
    <li
      data-step={index}
      data-progress={progress}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0 last:pb-0"
    >
      <span
        className={cn(
          'mt-px grid size-5 place-items-center rounded-full text-2xs font-semibold tabular-nums',
          progress === 'done' && 'bg-success-soft text-success',
          progress === 'next' && 'bg-accent-soft text-accent ring-1 ring-accent-line',
          progress === 'todo' && 'bg-surface-3 text-ink-3',
        )}
      >
        {progress === 'done' ? <Icon name="check" size={11} /> : index}
      </span>
      <div className="min-w-0">
        <b className={cn('text-sm font-semibold', progress === 'done' ? 'text-ink-2' : 'text-ink')}>
          {title}
          {progress !== 'todo' && (
            <span className="sr-only">
              {' '}
              ({progress === 'done' ? t(($) => $.access.done) : t(($) => $.access.next)})
            </span>
          )}
        </b>
        {children}
      </div>
    </li>
  );
}

/** The sign-in command in a code well, with a copy button that says whether it worked. */
function Command() {
  const { t } = useTranslation('updates');
  const [copied, setCopied] = useState(false);
  const [failure, setFailure] = useState('');
  const alive = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const copy = async () => {
    try {
      await copyText(GH_LOGIN_COMMAND);
      if (!alive.current) return;
      setCopied(true);
      setFailure('');
    } catch (cause) {
      if (!alive.current) return;
      setCopied(false);
      setFailure(String(cause) || 'Error');
    }
  };
  return (
    <>
      <span className="mt-1.5 flex max-w-full items-start gap-1.5">
        <code className="min-w-0 flex-1 rounded-md border border-line-soft bg-surface-3 px-2 py-1 font-mono text-2xs leading-snug text-ink [overflow-wrap:anywhere]">
          {GH_LOGIN_COMMAND}
        </code>
        <Button
          size="xs"
          variant="ghost"
          icon={<Icon name={copied ? 'check' : 'copy'} size={12} />}
          onClick={() => void copy()}
        >
          {copied ? t(($) => $.access.signIn.copied) : t(($) => $.access.signIn.copy)}
        </Button>
      </span>
      {failure && (
        <Notice tone="error" className="mt-2 mb-0">
          {t(($) => $.access.signIn.copyFailed, { error: failure })}
        </Notice>
      )}
    </>
  );
}

/**
 * The guided path to private release updates for someone who was handed the installer:
 * install GitHub CLI, sign in with the invited account, get and accept the invitation, then
 * check access. Each step is confirmed only by native's probe; one that could not be checked
 * stays open rather than being called refused. Once access is confirmed it shrinks to one
 * line, and Check for updates below works as usual.
 */
export function UpdateAccessGuide({
  access,
  onOpenLink,
}: {
  access: UpdateAccessState;
  onOpenLink?: SetupState['open'] | undefined;
}) {
  const { t } = useTranslation('updates');
  const fmt = useFormat();
  const titleId = useId();
  const links = useLinkOpener(onOpenLink);
  const { status, busy, pending } = access;
  const step = updateAccessStep(status);
  const look = STEP[step];
  const repository = status?.repository ?? 'nicholascostadev/aion-companion-public';
  const ready = step === 'ready';

  const cli = status?.cli_installed ?? null;
  const signedIn = status?.authenticated ?? null;
  const allowed = status?.repository_access ?? null;
  // Only a step the probe found missing is next; an unfinished or pending probe leaves none.
  const next = NEXT[step];
  const progress = (index: number, done: boolean | null): Progress =>
    done === true ? 'done' : next === index ? 'next' : 'todo';

  const checking = status?.phase === 'checking' || pending === 'check';
  const signingIn = status?.phase === 'signing_in' || pending === 'login';
  const loginSupported = status?.login_supported !== false;
  // Check access leads whenever no install or sign-in is the obvious next move.
  const checkLeads = !ready && next !== 1 && next !== 2 && step !== 'checking';

  const checkButton = (
    <Button
      size={ready ? 'xs' : 'sm'}
      variant={ready ? 'ghost' : checkLeads ? 'primary' : 'secondary'}
      disabled={busy}
      icon={
        <Icon
          name={checking ? 'loader' : 'refresh'}
          className={checking ? 'animate-spin' : undefined}
        />
      }
      onClick={() => void access.check()}
    >
      {checking ? t(($) => $.access.checking) : t(($) => $.access.check)}
    </Button>
  );
  const lastChecked = status?.checked_ms ? (
    <small className="text-xs text-ink-3">
      {t(($) => $.access.lastChecked, { time: fmt.dateTime(status.checked_ms) })}
    </small>
  ) : null;

  return (
    <section
      aria-labelledby={titleId}
      data-access={step}
      className="self-stretch rounded-lg border border-line-soft bg-surface-2 p-4 max-[760px]:p-3"
    >
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Icon name="lock" size={14} className="text-ink-3" />
        <h3 id={titleId} className="m-0 text-sm font-semibold text-ink">
          {t(($) => $.access.title)}
        </h3>
        <Badge tone={look.tone} dot>
          {t(($) => $.access.badge[step])}
        </Badge>
      </header>

      <output
        className={cn(
          'mt-2 flex items-start gap-2 text-sm leading-snug',
          ready ? 'text-success' : 'text-ink-2',
        )}
      >
        <Icon
          name={look.icon}
          size={14}
          className={cn('mt-0.5 shrink-0', look.spin && 'animate-spin')}
        />
        <span>{t(($) => $.access.state[step], { repository })}</span>
      </output>

      {status?.error && (
        <Notice tone={step === 'error' ? 'error' : 'warn'} className="mt-2.5 mb-0">
          {status.error}
        </Notice>
      )}
      {access.error && (
        <Notice tone="error" className="mt-2.5 mb-0">
          {t(($) => $.access.unreachable, { error: access.error })}
        </Notice>
      )}

      {ready ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          {checkButton}
          {lastChecked}
        </div>
      ) : (
        <>
          <p className="mt-2 mb-0 max-w-2xl text-xs leading-snug text-ink-3">
            {t(($) => $.access.intro)}
          </p>
          <ol className="mt-3.5 mb-0 flex list-none flex-col p-0">
            <Step index={1} progress={progress(1, cli)} title={t(($) => $.access.cli.title)}>
              <p className="mt-0.5 mb-0 max-w-2xl text-xs leading-snug text-ink-3">
                {t(($) => $.access.cli.body)}
              </p>
              {links.available && cli !== true && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant={next === 1 ? 'primary' : 'secondary'}
                    icon={<Icon name="external" />}
                    loading={links.opening === 'github_cli'}
                    onClick={() => void links.open('github_cli')}
                  >
                    {t(($) => $.access.cli.action)}
                  </Button>
                </div>
              )}
            </Step>

            <Step
              index={2}
              progress={progress(2, signedIn)}
              title={t(($) => $.access.signIn.title)}
            >
              <p className="mt-0.5 mb-0 max-w-2xl text-xs leading-snug text-ink-3">
                {t(($) => $.access.signIn.body)}
              </p>
              {signedIn !== true && (
                <>
                  <Notice className="mt-2 mb-0 max-w-2xl text-xs">
                    {t(($) => $.access.signIn.git)}
                  </Notice>
                  {loginSupported ? (
                    <>
                      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                        <Button
                          size="sm"
                          variant={next === 2 ? 'primary' : 'secondary'}
                          disabled={busy || cli === false}
                          icon={
                            <Icon
                              name={signingIn ? 'loader' : 'signIn'}
                              className={signingIn ? 'animate-spin' : undefined}
                            />
                          }
                          onClick={() => void access.login()}
                        >
                          {signingIn
                            ? t(($) => $.access.signIn.signingIn)
                            : t(($) => $.access.signIn.action)}
                        </Button>
                        {cli === false && (
                          <small className="text-xs text-ink-3">
                            {t(($) => $.access.signIn.needsCli)}
                          </small>
                        )}
                      </div>
                      <Disclosure
                        variant="plain"
                        className="mt-1"
                        summaryClassName="py-1.5 text-xs"
                        bodyClassName="pb-0"
                        summary={t(($) => $.access.signIn.manualSummary)}
                      >
                        <p className="m-0 max-w-2xl text-xs leading-snug text-ink-3">
                          {t(($) => $.access.signIn.manual)}
                        </p>
                        <Command />
                      </Disclosure>
                    </>
                  ) : (
                    <div className="mt-2">
                      <p className="m-0 max-w-2xl text-xs leading-snug text-ink-2">
                        {t(($) => $.access.signIn.unsupported)}
                      </p>
                      <Command />
                    </div>
                  )}
                </>
              )}
            </Step>

            <Step index={3} progress={progress(3, allowed)} title={t(($) => $.access.invite.title)}>
              <p className="mt-0.5 mb-0 max-w-2xl text-xs leading-snug text-ink-3">
                {t(($) => $.access.invite.body, { repository })}
              </p>
              {links.available && (
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                  <Button
                    size="xs"
                    variant="link"
                    icon={<Icon name="invitation" size={12} />}
                    loading={links.opening === 'github_invitations'}
                    onClick={() => void links.open('github_invitations')}
                  >
                    {t(($) => $.access.invite.invitations)}
                  </Button>
                  <Button
                    size="xs"
                    variant="link"
                    icon={<Icon name="external" size={12} />}
                    loading={links.opening === 'repository'}
                    onClick={() => void links.open('repository')}
                  >
                    {t(($) => $.access.invite.repository)}
                  </Button>
                </div>
              )}
            </Step>
          </ol>
          <div className="mt-3.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line-soft pt-3.5">
            {checkButton}
            {lastChecked ?? (
              <small className="text-xs text-ink-3">{t(($) => $.access.checkHint)}</small>
            )}
          </div>
        </>
      )}
      <LinkFailure error={links.error} className="mt-2.5 mb-0" />
    </section>
  );
}
