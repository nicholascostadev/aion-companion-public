import { useId } from 'react';
import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { useTranslation } from '../../i18n/provider';
import { CHAPTERS, resumeAt, SETUP_STEPS, type GuideProgress } from './model';

/**
 * Home's quiet offer of the guide: to start it when it was never opened, or to pick it up
 * at the step it opens on (`resumeAt`: Language until one is chosen, then the step the
 * reader left), saying when live capture was set up later. Put away, it stays
 * away; the header's Guide button still opens the guide at any time.
 */
export function GuideOffer({
  progress,
  onOpen,
  onQuiet,
}: {
  progress: GuideProgress | null;
  onOpen: () => void;
  onQuiet: () => void;
}) {
  const { t } = useTranslation('onboarding');
  const titleId = useId();
  const started = progress !== null;
  // The same step Resume opens on, so the band never names a step the guide skips past.
  const resume = resumeAt(progress);
  const at = CHAPTERS.indexOf(resume) + 1;
  const decided = progress
    ? SETUP_STEPS.filter((s) => progress.decisions[s] !== undefined).length
    : 0;
  const deferred = progress?.decisions.capture === 'later';
  return (
    <Panel
      as="section"
      padding="none"
      aria-labelledby={titleId}
      data-home="guide"
      data-state={started ? 'resume' : 'start'}
      className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 max-[760px]:px-4"
    >
      <span className="grid size-9 shrink-0 place-items-center rounded-leaf border border-accent-line bg-accent-soft text-accent">
        <Icon name="guide" size={17} />
      </span>
      <div className="min-w-0 flex-1 basis-72">
        <h2 id={titleId} className="m-0 text-md font-semibold tracking-tight">
          {started ? t(($) => $.offer.resumeTitle) : t(($) => $.offer.startTitle)}
        </h2>
        <p className="mt-0.5 mb-0 text-sm leading-snug text-ink-3">
          {started
            ? t(($) => $.offer.resumeBody, {
                chapter: t(($) => $.chapters[resume].short),
                at,
                total: CHAPTERS.length,
              })
            : t(($) => $.offer.startBody)}
          {deferred && <> {t(($) => $.offer.deferred)}</>}
        </p>
      </div>
      {started && (
        <Meter
          size="xs"
          fraction={decided / SETUP_STEPS.length}
          label={t(($) => $.offer.decided, { count: decided, total: SETUP_STEPS.length })}
          className="w-24 max-[760px]:hidden"
        />
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="primary" onClick={onOpen}>
          {started ? t(($) => $.offer.resume) : t(($) => $.offer.start)}
        </Button>
        <Button size="sm" variant="ghost" onClick={onQuiet} title={t(($) => $.offer.notNowTitle)}>
          {t(($) => $.offer.notNow)}
        </Button>
      </div>
    </Panel>
  );
}
