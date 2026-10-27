import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { SetupState } from '../../types/setup';
import { LinkFailure, useLinkOpener } from './links';
import { captureIssue } from './model';
import { NpcapExplainer } from './NpcapExplainer';

/**
 * Home's "Before you start" band: shown only while the latest probe says live capture cannot
 * run, whether or not the first steps are hidden. It names the problem (not installed,
 * installed but unusable, or not possible here), says what works meanwhile, and offers the
 * one fix: the official download or troubleshooting page, then Check again. While the driver
 * is the problem, What is Npcap? explains it before anyone installs it.
 */
export function SetupBand({ setup, onOpenSetup }: { setup: SetupState; onOpenSetup: () => void }) {
  const { t } = useTranslation('setup');
  const titleId = useId();
  const links = useLinkOpener(setup.open);
  const issue = captureIssue(setup.status);
  if (!issue) return null;
  const fix =
    issue === 'missing'
      ? { link: 'npcap' as const, label: t(($) => $.npcap.install), icon: 'download' as const }
      : issue === 'unavailable'
        ? {
            link: 'npcap_help' as const,
            label: t(($) => $.npcap.troubleshoot),
            icon: 'lifeBuoy' as const,
          }
        : null;
  const detail = setup.status?.npcap.detail;
  return (
    <Panel
      as="section"
      padding="none"
      aria-labelledby={titleId}
      data-home="setup"
      data-state={issue}
      className={cn(
        'mb-5 animate-alight px-5 py-4 max-[760px]:px-4',
        issue === 'unsupported' ? 'border-line' : 'border-warn-line',
      )}
    >
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3.5">
        <span
          className={cn(
            'grid size-9 place-items-center rounded-full',
            issue === 'unsupported' ? 'bg-surface-3 text-ink-2' : 'bg-warn-soft text-warn',
          )}
        >
          <Icon name="network" size={17} />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase">
            {t(($) => $.home.eyebrow)}
          </p>
          <h2 id={titleId} className="mt-0.5 mb-0 text-md font-semibold tracking-tight">
            {t(($) => $.home.title[issue])}
          </h2>
          <p className="mt-1 mb-0 max-w-3xl text-sm leading-snug text-ink-2">
            {t(($) => $.home.body[issue])}
          </p>
          {detail && (
            <p className="mt-1.5 mb-0 max-w-3xl font-mono text-2xs leading-snug text-ink-3 [overflow-wrap:anywhere]">
              {t(($) => $.detail, { detail })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {fix && (
              <Button
                size="sm"
                variant="primary"
                icon={<Icon name={fix.icon} size={14} />}
                loading={links.opening === fix.link}
                onClick={() => void links.open(fix.link)}
              >
                {fix.label}
              </Button>
            )}
            <Button
              size="sm"
              icon={<Icon name="refresh" size={14} />}
              loading={setup.checking}
              onClick={() => void setup.recheck()}
            >
              {setup.checking ? t(($) => $.checking) : t(($) => $.checkAgain)}
            </Button>
            <Button size="sm" variant="ghost" onClick={onOpenSetup}>
              {t(($) => $.home.details)}
            </Button>
          </div>
          <p className="mt-2 mb-0 text-xs text-ink-3">{t(($) => $.home.hint[issue])}</p>
          {issue !== 'unsupported' && <NpcapExplainer open={setup.open} className="mt-1.5" />}
          <LinkFailure error={links.error} />
        </div>
      </div>
    </Panel>
  );
}
