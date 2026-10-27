import type { ReactNode } from 'react';
import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { Icon } from '../../components/ui/Icon';
import { Card } from '../../components/ui/Panel';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Step, StepId } from './model';

export interface StepDetail {
  hint: ReactNode;
  action?: { label: string; onClick: () => void; disabled?: boolean };
}

/**
 * The first steps with the app, each ticked off by what the app actually observes (capture
 * connected, the meter shown, a fight saved …), never by a click on the list itself.
 */
export function GettingStarted({
  steps,
  details,
  onHide,
  className,
}: {
  steps: Step[];
  details: Record<StepId, StepDetail>;
  onHide: () => void;
  className?: string;
}) {
  const { t } = useTranslation('home');
  const done = steps.filter((s) => s.done).length;
  const progress = { done, total: steps.length };
  const next = steps.find((s) => !s.done)?.id ?? null;
  return (
    <Card
      title={t(($) => $.steps.title)}
      className={cn('mb-0', className)}
      subtitle={
        <span className="flex items-center gap-2 tabular-nums">
          {t(($) => $.steps.progress, progress)}
          <Meter
            size="xs"
            fraction={done / steps.length}
            label={t(($) => $.steps.progressLabel, progress)}
            className="max-w-24"
          />
        </span>
      }
      actions={
        <Button
          variant="ghost"
          size="xs"
          iconOnly
          aria-label={t(($) => $.steps.hide)}
          title={t(($) => $.steps.hideTitle)}
          onClick={onHide}
        >
          <Icon name="close" size={12} />
        </Button>
      }
    >
      <ol className="m-0 flex list-none flex-col p-0" aria-label={t(($) => $.steps.list)}>
        {steps.map((step) => {
          const detail = details[step.id];
          const current = step.id === next;
          return (
            <li
              key={step.id}
              data-step={step.id}
              data-state={step.done ? 'done' : current ? 'next' : 'todo'}
              className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 border-t border-line-soft py-2.5 first:border-t-0"
            >
              <span
                className={cn(
                  'mt-px grid size-5 place-items-center rounded-full',
                  step.done
                    ? 'bg-success-soft text-success'
                    : current
                      ? 'border border-accent-line text-accent shadow-glow'
                      : 'border border-line-strong text-ink-4',
                )}
              >
                {step.done && <Icon name="check" size={12} strokeWidth={2.4} />}
              </span>
              <div className="min-w-0">
                <span
                  className={cn(
                    'block text-sm font-semibold',
                    step.done ? 'text-ink-3 line-through decoration-line-strong' : 'text-ink',
                  )}
                >
                  {t(($) => $.steps[step.id])}
                  <span className="sr-only">
                    {step.done ? t(($) => $.steps.done) : t(($) => $.steps.todo)}
                  </span>
                </span>
                {!step.done && (
                  <>
                    <span className="mt-0.5 block text-xs text-ink-3">{detail.hint}</span>
                    {detail.action && (
                      <Button
                        size="xs"
                        variant={current ? 'primary' : 'secondary'}
                        className="mt-2"
                        disabled={detail.action.disabled}
                        onClick={detail.action.onClick}
                      >
                        {detail.action.label}
                      </Button>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}
