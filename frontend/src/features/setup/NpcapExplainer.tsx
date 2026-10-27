import { Button } from '../../components/ui/Button';
import { Disclosure } from '../../components/ui/Disclosure';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { SetupState } from '../../types/setup';
import { LinkFailure, useLinkOpener } from './links';

const TOPICS = [
  { key: 'what', icon: 'info' },
  { key: 'why', icon: 'meter' },
  { key: 'source', icon: 'packageCheck' },
  { key: 'risks', icon: 'warning' },
  { key: 'choice', icon: 'circleCheck' },
] as const satisfies readonly { key: string; icon: IconName }[];

/**
 * What Npcap is, why live capture uses it, where to get it, what installing a capture driver
 * means and that it is optional, folded under one quiet summary. Shared by Home's setup band
 * and the Npcap row in Settings, whatever the driver's state; `open` adds the official site
 * and guide when the desktop app can open them.
 */
export function NpcapExplainer({
  open,
  className,
}: {
  open?: SetupState['open'] | undefined;
  className?: string;
}) {
  const { t } = useTranslation('setup');
  const links = useLinkOpener(open);
  return (
    <Disclosure
      variant="plain"
      className={cn('max-w-2xl', className)}
      summaryClassName="py-1.5 text-xs"
      summaryAttributes={{ 'data-setup': 'npcap-about' }}
      bodyClassName="pb-1"
      summary={t(($) => $.npcap.about.summary)}
    >
      <dl className="m-0 flex flex-col gap-2.5 text-xs leading-snug">
        {TOPICS.map(({ key, icon }) => (
          <div key={key} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2">
            <Icon
              name={icon}
              size={13}
              className={cn('mt-px', key === 'risks' ? 'text-warn' : 'text-ink-3')}
            />
            <div className="min-w-0">
              <dt className="font-semibold text-ink">{t(($) => $.npcap.about[key].title)}</dt>
              <dd className="m-0 mt-0.5 text-ink-2">{t(($) => $.npcap.about[key].body)}</dd>
            </div>
          </div>
        ))}
      </dl>
      {links.available && (
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 pl-5">
          <Button
            size="xs"
            variant="link"
            icon={<Icon name="external" size={12} />}
            loading={links.opening === 'npcap'}
            onClick={() => void links.open('npcap')}
          >
            {t(($) => $.npcap.about.site)}
          </Button>
          <Button
            size="xs"
            variant="link"
            icon={<Icon name="book" size={12} />}
            loading={links.opening === 'npcap_help'}
            onClick={() => void links.open('npcap_help')}
          >
            {t(($) => $.npcap.about.guide)}
          </Button>
        </div>
      )}
      <LinkFailure error={links.error} className="mt-2.5 mb-0" />
    </Disclosure>
  );
}
