import { useEffect, useId, useMemo, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { clock } from '../../i18n/formatters';
import { Trans, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { OfflineHotkeys } from '../../types/offline';
import { DpsOverlay } from '../live/DpsOverlay';
import { useMeter } from '../live/meterState';
import { demoSources, type DemoFight } from './demo';

const SPEEDS = ['1', '4', '8'] as const;
type Speed = (typeof SPEEDS)[number];

export interface DemoMeterProps {
  /** The sample; `undefined` while it loads, null when it could not be read. */
  demo: DemoFight | null | undefined;
  /** The chapter is on screen in a visible window; playback pauses whenever it is not. */
  active: boolean;
  /** The system asks for reduced motion: open on the finished fight and never start alone. */
  reducedMotion: boolean;
  hotkeys: OfflineHotkeys;
}

/**
 * The real DPS meter replaying the bundled Atiel fight: the same `useMeter` and
 * `DpsOverlay` the in-game window runs, fed one recorded two-second sample at a time.
 * Its rows open each player's skills, its strip and hide buttons work, and it is
 * paused, scrubbed and restarted from the controls under it.
 */
export function DemoMeter({ demo, active, reducedMotion, hotkeys }: DemoMeterProps) {
  const { t } = useTranslation('onboarding');
  if (demo === undefined)
    return (
      <EmptyState
        compact
        live
        icon={<Icon name="meter" size={18} />}
        title={t(($) => $.chapters.meter.demo.loading)}
      />
    );
  if (demo === null)
    return (
      <EmptyState
        compact
        icon={<Icon name="meter" size={18} />}
        title={t(($) => $.chapters.meter.demo.unavailable)}
      >
        {t(($) => $.chapters.meter.demo.unavailableHint)}
      </EmptyState>
    );
  return <Playback demo={demo} active={active} reducedMotion={reducedMotion} hotkeys={hotkeys} />;
}

function Playback({
  demo,
  active,
  reducedMotion,
  hotkeys,
}: {
  demo: DemoFight;
  active: boolean;
  reducedMotion: boolean;
  hotkeys: OfflineHotkeys;
}) {
  const { t } = useTranslation('onboarding');
  const scrubId = useId();
  const last = demo.frames.length - 1;
  // Reduced motion opens on the finished fight, readable at once; otherwise from the pull.
  const [index, setIndex] = useState(() => (reducedMotion ? last : 0));
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<Speed>('8');
  const [strip, setStrip] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [startedMs, setStartedMs] = useState(() => Date.now());
  // Starts by itself the first time it is on screen, unless motion is reduced. The step
  // mounts it afresh each time it is opened, so each visit replays from the pull.
  const [autoplayed, setAutoplayed] = useState(false);
  if (active && !autoplayed) {
    setAutoplayed(true);
    if (!reducedMotion) setPlaying(true);
  }
  const ended = index >= last;
  // Holds whenever the chapter is not on screen, and stops at the end of the fight.
  const running = playing && active && !ended;

  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(
      () => setIndex((i) => Math.min(last, i + 1)),
      demo.sampleIntervalMs / Number(speed),
    );
    return () => clearTimeout(timer);
  }, [running, index, last, speed, demo.sampleIntervalMs]);

  const sources = useMemo(
    () => demoSources(demo, index, { startedMs, compactStrip: strip, locked: false }),
    [demo, index, startedMs, strip],
  );
  const meter = useMeter({ ...sources, error: '', busy: true });
  const at = demo.frames[index]!.atMs;

  const restart = () => {
    setStartedMs(Date.now());
    setIndex(0);
    setPlaying(true);
  };
  const toggle = () => {
    if (ended) return restart();
    setPlaying(!running);
  };

  return (
    <div className="flex min-w-0 flex-col gap-3" data-onboarding="demo">
      {/* The stage stands in for the game screen; the meter floats on it as it would. */}
      <div className="grid min-h-72 place-items-center rounded-lg border border-line-soft bg-sunken p-3 inset-shadow-well">
        {hidden ? (
          <div className="flex max-w-60 flex-col items-center gap-2 text-center text-xs text-ink-3">
            <Icon name="meter" size={18} className="text-ink-4" />
            <span>
              <Trans
                t={t}
                i18nKey={($) => $.chapters.meter.demo.hidden}
                values={{ key: hotkeys.toggle_overlay }}
                components={[<kbd key="key" />]}
              />
            </span>
            <Button size="xs" onClick={() => setHidden(false)}>
              {t(($) => $.chapters.meter.demo.showAgain)}
            </Button>
          </div>
        ) : (
          <div className={cn('w-full max-w-84', strip ? 'h-auto' : 'h-68')}>
            <DpsOverlay
              meter={meter}
              onReset={() => undefined}
              onHide={() => setHidden(true)}
              onEnterStrip={() => setStrip(true)}
              onExitStrip={() => setStrip(false)}
            />
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Button
          size="sm"
          variant="primary"
          iconOnly
          aria-label={
            running
              ? t(($) => $.chapters.meter.demo.pause)
              : ended
                ? t(($) => $.chapters.meter.demo.replay)
                : t(($) => $.chapters.meter.demo.play)
          }
          title={
            running
              ? t(($) => $.chapters.meter.demo.pause)
              : ended
                ? t(($) => $.chapters.meter.demo.replay)
                : t(($) => $.chapters.meter.demo.play)
          }
          icon={<Icon name={running ? 'pause' : ended ? 'restart' : 'play'} size={14} />}
          onClick={toggle}
        />
        <label htmlFor={scrubId} className="sr-only">
          {t(($) => $.chapters.meter.demo.position)}
        </label>
        <input
          id={scrubId}
          type="range"
          data-ui="range"
          className="h-8 min-w-32 flex-1 cursor-pointer accent-accent"
          // Scrubs whole samples, so the last one, the finished fight, is always reachable.
          min={0}
          max={last}
          step={1}
          value={index}
          aria-valuetext={t(($) => $.chapters.meter.demo.positionValue, {
            at: clock(at),
            total: clock(demo.durationMs),
          })}
          onChange={(e) => {
            setPlaying(false);
            setIndex(Math.min(last, Math.max(0, Math.round(Number(e.target.value)))));
          }}
        />
        <span className="text-xs text-ink-2 figures" aria-hidden="true">
          {clock(at)} / {clock(demo.durationMs)}
        </span>
        <SegmentedControl
          size="xs"
          label={t(($) => $.chapters.meter.demo.speed)}
          value={speed}
          onChange={setSpeed}
          options={SPEEDS.map((value) => ({
            value,
            label: t(($) => $.chapters.meter.demo.speedValue, { speed: value }),
          }))}
        />
      </div>
      {reducedMotion && !running && ended && (
        <p className="m-0 text-xs text-ink-3">{t(($) => $.chapters.meter.demo.reducedMotion)}</p>
      )}
    </div>
  );
}
