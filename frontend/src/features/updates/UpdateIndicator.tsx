import { Button } from '../../components/ui/Button';
import { Icon, type IconName } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { UpdatePhase, UpdateStatus } from '../../types/updates';
import { updateVersion } from './UpdatesPanel';

/** Collapses to visually hidden (still announced) below the header's middle width. */
const mid = 'max-[1020px]:sr-only';

/** The phases worth a word in the header; every other phase leaves it out. */
type Shown = Extract<UpdatePhase, 'available' | 'downloading' | 'ready'>;

const STATES: Record<Shown, { icon: IconName; spin?: boolean }> = {
  available: { icon: 'download' },
  downloading: { icon: 'loader', spin: true },
  ready: { icon: 'packageCheck' },
};

const shown = (phase: UpdatePhase): phase is Shown => Object.hasOwn(STATES, phase);

/**
 * Workspace header pill for a stable release waiting to be taken: available, downloading or
 * ready. It only opens App updates in Settings; it never downloads or installs by itself.
 */
export function UpdateIndicator({
  status,
  onOpen,
}: {
  status: UpdateStatus | null;
  onOpen: () => void;
}) {
  const { t } = useTranslation('updates');
  if (!status || status.channel !== 'stable' || !shown(status.phase)) return null;
  const phase = status.phase;
  const state = STATES[phase];
  const version = updateVersion(status.latest_version);
  const more = phase === 'available' ? t(($) => $.indicator.available.more) : null;
  return (
    <Button
      size="sm"
      data-update={phase}
      title={t(($) => $.indicator[phase].title, { version })}
      icon={<Icon name={state.icon} size={14} className={cn(state.spin && 'animate-spin')} />}
      className={cn(
        'border-accent-line bg-accent-soft text-accent shadow-glow',
        'enabled:hover:border-accent enabled:hover:bg-accent-soft enabled:hover:text-accent-strong',
      )}
      onClick={onOpen}
    >
      <span>
        {t(($) => $.indicator[phase].word)}
        {more && (
          <>
            {' '}
            <span className={mid}>{more}</span>
          </>
        )}
      </span>{' '}
      <span className="font-semibold tabular-nums">{version}</span>
    </Button>
  );
}
