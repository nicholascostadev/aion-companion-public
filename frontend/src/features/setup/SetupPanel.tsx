import type { ReactNode } from 'react';
import { Badge, type Tone } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Notice } from '../../components/ui/Feedback';
import { Icon, type IconName } from '../../components/ui/Icon';
import { Trans, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { NpcapState, SetupDistribution, SetupState } from '../../types/setup';
import { SettingsGroup, SettingsSection } from '../offline/SettingsLayout';
import { LinkFailure, useLinkOpener } from './links';
import { SETUP_SECTION_ID } from './model';
import { NpcapExplainer } from './NpcapExplainer';

const SEED: Record<Tone, string> = {
  neutral: 'bg-surface-3 text-ink-2',
  accent: 'bg-accent-soft text-accent',
  success: 'bg-success-soft text-success',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  info: 'bg-info-soft text-info',
};

const NPCAP_TONE: Record<NpcapState, Tone> = {
  ready: 'success',
  missing: 'warn',
  unavailable: 'danger',
  unsupported: 'neutral',
};

/** One requirement: its glyph in a tinted seed, its name and state, why it matters, and what to do. */
function Requirement({
  icon,
  name,
  state,
  tone,
  hint,
  children,
}: {
  icon: IconName;
  name: string;
  state: string;
  tone: Tone;
  hint: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      data-requirement={icon}
      data-tone={tone}
      className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-line-soft py-3 first:border-t-0 first:pt-0"
    >
      <span className={cn('grid size-8 place-items-center rounded-full', SEED[tone])}>
        <Icon name={icon} size={15} />
      </span>
      <div className="min-w-0">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <b className="text-sm font-semibold text-ink">{name}</b>
          <Badge tone={tone} dot>
            {state}
          </Badge>
        </span>
        <p className="mt-0.5 mb-0 text-xs leading-snug text-ink-3">{hint}</p>
        {children}
      </div>
    </li>
  );
}

/**
 * Setup in Settings: what this PC has for the app and for live capture, what to install or
 * fix, and what works meanwhile. Check again only probes again; capture retries by itself.
 */
export function SetupPanel({
  native,
  setup,
  distribution,
  className,
}: {
  native: boolean;
  setup: SetupState;
  /** How releases are read, when the updater knows better than the setup probe. */
  distribution?: SetupDistribution | undefined;
  className?: string;
}) {
  const { t } = useTranslation('setup');
  const links = useLinkOpener(native ? setup.open : undefined);
  const { status, error, checking } = setup;

  const link = (target: Parameters<typeof links.open>[0], label: string, icon: IconName) => (
    <Button
      size="xs"
      variant="ghost"
      icon={<Icon name={icon} size={12} />}
      loading={links.opening === target}
      onClick={() => void links.open(target)}
    >
      {label}
    </Button>
  );

  let body: ReactNode;
  if (!native) {
    body = <Notice className="m-0">{t(($) => $.needsDesktop)}</Notice>;
  } else if (!status) {
    body = error ? null : (
      <output className="flex items-center gap-2 text-sm text-ink-2">
        <Icon name="loader" size={14} className="animate-spin" />
        {t(($) => $.reading)}
      </output>
    );
  } else {
    const npcap = status.platform_supported ? status.npcap.state : 'unsupported';
    const npcapTone = NPCAP_TONE[npcap];
    body = (
      <ul className="m-0 flex list-none flex-col p-0">
        <Requirement
          icon="monitor"
          name={t(($) => $.windows.name)}
          state={
            status.platform_supported ? t(($) => $.badge.supported) : t(($) => $.badge.notSupported)
          }
          tone={status.platform_supported ? 'success' : 'neutral'}
          hint={t(($) => $.windows.hint)}
        />
        <Requirement
          icon="appWindow"
          name={t(($) => $.webview2.name)}
          state={status.webview2_ready ? t(($) => $.badge.ready) : t(($) => $.badge.missing)}
          tone={status.webview2_ready ? 'success' : 'warn'}
          hint={t(($) => $.webview2.hint)}
        >
          {!status.webview2_ready && (
            <div className="mt-2 flex flex-wrap gap-2">
              {link(
                'webview2',
                t(($) => $.webview2.action),
                'external',
              )}
            </div>
          )}
        </Requirement>
        <Requirement
          icon="network"
          name={t(($) => $.npcap.name)}
          state={t(($) => $.badge[npcap])}
          tone={npcapTone}
          hint={t(($) => $.npcap.hint)}
        >
          {npcap !== 'ready' && (
            <p className="mt-2 mb-0 max-w-2xl text-sm leading-snug text-ink-2">
              {t(($) => $.npcap.why[npcap])}
            </p>
          )}
          {npcap !== 'ready' && status.npcap.detail && (
            <p className="mt-1.5 mb-0 font-mono text-2xs leading-snug text-ink-3 [overflow-wrap:anywhere]">
              {t(($) => $.detail, { detail: status.npcap.detail })}
            </p>
          )}
          {npcap === 'missing' && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<Icon name="download" size={14} />}
                loading={links.opening === 'npcap'}
                onClick={() => void links.open('npcap')}
              >
                {t(($) => $.npcap.install)}
              </Button>
              {link(
                'npcap_help',
                t(($) => $.npcap.help),
                'lifeBuoy',
              )}
            </div>
          )}
          {npcap === 'unavailable' && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="primary"
                icon={<Icon name="lifeBuoy" size={14} />}
                loading={links.opening === 'npcap_help'}
                onClick={() => void links.open('npcap_help')}
              >
                {t(($) => $.npcap.troubleshoot)}
              </Button>
            </div>
          )}
          <NpcapExplainer open={setup.open} className="mt-1.5" />
        </Requirement>
        {(distribution ?? status.distribution) === 'private' && (
          <Requirement
            icon="terminal"
            name={t(($) => $.githubCli.name)}
            state={t(($) => $.badge.optional)}
            tone="neutral"
            hint={t(($) => $.githubCli.hint)}
          >
            <div className="mt-2 flex flex-wrap gap-2">
              {link(
                'github_cli',
                t(($) => $.githubCli.action),
                'external',
              )}
            </div>
          </Requirement>
        )}
      </ul>
    );
  }

  return (
    <SettingsGroup id={SETUP_SECTION_ID} tabIndex={-1} className={cn('scroll-mt-28', className)}>
      <SettingsSection title={t(($) => $.title)} description={t(($) => $.description)}>
        <div className="flex flex-col gap-4" data-setup={status ? 'known' : 'unknown'}>
          {body}
          {error && (
            <Notice tone="error" className="m-0">
              {t(($) => $.readFailed, { error })}
            </Notice>
          )}
          <LinkFailure error={links.error} className="m-0" />
          <div className="flex flex-col gap-1.5 border-t border-line-soft pt-4 text-xs leading-snug text-ink-3">
            <p className="m-0 flex items-start gap-2">
              <Icon name="live" size={13} className="mt-px text-accent" />
              <span>
                <Trans
                  t={t}
                  i18nKey={($) => $.features.live}
                  components={[<b key="label" className="font-semibold text-ink-2" />]}
                />
              </span>
            </p>
            <p className="m-0 flex items-start gap-2">
              <Icon name="circleCheck" size={13} className="mt-px text-success" />
              <span>
                <Trans
                  t={t}
                  i18nKey={($) => $.features.offline}
                  components={[<b key="label" className="font-semibold text-ink-2" />]}
                />
              </span>
            </p>
          </div>
          {native && (
            <div className="flex flex-col items-start gap-1.5">
              <Button
                size="sm"
                icon={<Icon name="refresh" size={14} />}
                loading={checking}
                onClick={() => void setup.recheck()}
              >
                {checking ? t(($) => $.checking) : t(($) => $.checkAgain)}
              </Button>
              <small className="max-w-2xl text-xs leading-snug text-ink-3">
                {t(($) => $.checkHint)}
              </small>
            </div>
          )}
        </div>
      </SettingsSection>
    </SettingsGroup>
  );
}
