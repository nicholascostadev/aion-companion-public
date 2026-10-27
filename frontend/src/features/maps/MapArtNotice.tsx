import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { Icon } from '../../components/ui/Icon';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { MapArtView } from '../../types/mapArt';

/**
 * Over a map whose original art is not ready yet: what is happening to it, and Retry after
 * a failure (Download when native has not started). Drawn just below the frame's centre, so
 * a followed position (always centred) and the frame's corner tools and notes stay clear;
 * only the pill takes the pointer. Nothing once the art is ready or has nothing to fetch.
 */
export function MapArtNotice({
  delivery,
  compact = false,
  hit = false,
}: {
  delivery: MapArtView;
  /** Smaller, for an in-game window. */
  compact?: boolean;
  /** The button takes clicks in a click-through window (`data-hit`). */
  hit?: boolean;
}) {
  const { t } = useTranslation('common');
  const fmt = useFormat();
  const { phase, progress, error, ready } = delivery;
  if (ready || phase === null) return null;
  const text =
    phase === 'error'
      ? t(($) => $.mapArt.failed)
      : phase === 'missing'
        ? t(($) => $.mapArt.missing)
        : phase === 'downloading'
          ? t(($) => $.mapArt.downloading)
          : t(($) => $.mapArt.checking);
  const action =
    phase === 'error'
      ? t(($) => $.mapArt.retry)
      : phase === 'missing'
        ? t(($) => $.mapArt.download)
        : null;
  const busy = phase === 'downloading' || phase === 'checking';
  const percent = progress === null ? null : fmt.pct(progress, 0);
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-2 top-1/2 flex justify-center',
        compact ? 'mt-3' : 'mt-5',
      )}
      data-map-art={phase}
    >
      <div
        className={cn(
          'pointer-events-auto flex max-w-full min-w-0 items-center rounded-full bg-veil text-ink-2 shadow-1 backdrop-blur-sm',
          compact ? 'gap-1.5 py-0.5 pl-2 text-3xs' : 'gap-2 py-1 pl-3 text-2xs',
          action ? (compact ? 'pr-0.5' : 'pr-1') : compact ? 'pr-2' : 'pr-3',
        )}
      >
        <Icon
          name={phase === 'error' ? 'warning' : phase === 'missing' ? 'download' : 'loader'}
          size={compact ? 11 : 13}
          className={cn('shrink-0', busy && 'animate-spin', phase === 'error' && 'text-warn')}
        />
        <output className="min-w-0 truncate" title={phase === 'error' && error ? error : text}>
          {text}
        </output>
        {phase === 'downloading' && (
          <>
            <Meter
              fraction={progress}
              label={percent ?? text}
              size="xs"
              className={cn('flex-none', compact ? 'w-8 min-w-8' : 'w-14 min-w-14')}
            />
            {percent !== null && (
              <span className="shrink-0 tabular-nums" aria-hidden="true">
                {percent}
              </span>
            )}
          </>
        )}
        {action && (
          <Button
            {...(hit ? { 'data-hit': '' } : {})}
            size={compact ? '2xs' : 'xs'}
            variant="secondary"
            icon={<Icon name={phase === 'error' ? 'refresh' : 'download'} />}
            className="shrink-0"
            onClick={delivery.retry}
          >
            {action}
          </Button>
        )}
      </div>
    </div>
  );
}
