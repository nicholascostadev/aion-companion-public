import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { useFormat, useTranslation } from '../../i18n/provider';

interface ReplayControlsProps {
  /** The open recording's source; null when none is open. */
  source: string | null;
  durationMs: number;
  atMs: number;
  snapshotMs: number;
  disabled: boolean;
  playing: boolean;
  onToggle: () => void;
  onSeek: (time: number) => void;
}

export function ReplayControls({
  source,
  durationMs,
  atMs,
  snapshotMs,
  disabled,
  playing,
  onToggle,
  onSeek,
}: ReplayControlsProps) {
  const { t } = useTranslation('recordings');
  const fmt = useFormat();
  const headingId = useId();
  return (
    <Panel as="section" padding="lg" className="mb-4" aria-labelledby={headingId}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={headingId} className="m-0 text-lg font-semibold tracking-tight">
          {t(($) => $.controls.title)}
        </h3>
        <span className="min-w-0 truncate text-xs text-accent">
          {source ?? t(($) => $.controls.noRecording)}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <Button
          variant={playing ? 'secondary' : 'primary'}
          className="w-24"
          icon={<Icon name={playing ? 'pause' : 'play'} size={14} />}
          disabled={disabled}
          onClick={onToggle}
        >
          {playing ? t(($) => $.controls.pause) : t(($) => $.controls.play)}
        </Button>
        <input
          data-ui="range"
          aria-label={t(($) => $.controls.time)}
          type="range"
          className="h-8 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default disabled:opacity-50"
          min="0"
          max={durationMs}
          value={atMs}
          step="1"
          disabled={disabled}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <output className="min-w-16 text-right text-lg font-semibold text-ink tabular-nums">
          {t(($) => $.controls.seconds, {
            value: fmt
              .numberWith({ minimumFractionDigits: 1, maximumFractionDigits: 1 })
              .format(snapshotMs / 1000),
          })}
        </output>
      </div>
      <p className="mt-3 mb-0 text-xs text-ink-3">{t(($) => $.controls.hint)}</p>
    </Panel>
  );
}
