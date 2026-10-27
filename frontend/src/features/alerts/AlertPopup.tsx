import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { useWindowDrag } from '../live/windowDrag';
import type { AlertDelivery } from '../../types/alerts';
import { CATEGORY, POPUP_TTL_MS, categoryLabel, deliveryName, phaseLabel } from './model';
import { CATEGORY_TONE } from './parts';

/** Cards the popup window is sized for (see alert_window.rs). */
export const VISIBLE_CARDS = 3;

/** Deliveries still worth showing: fresh, newest first, one card per id. */
export function visibleDeliveries(items: AlertDelivery[], nowMs: number) {
  const seen = new Set<string>();
  return [...items]
    .filter((d) => nowMs - d.fired_ms < POPUP_TTL_MS && d.fired_ms - nowMs <= POPUP_TTL_MS)
    .sort((a, b) => b.fired_ms - a.fired_ms)
    .filter((d) => (seen.has(d.id) ? false : (seen.add(d.id), true)));
}

export function AlertPopup({
  items,
  nowMs,
  busy,
  error,
  onDismiss,
  onDrag,
}: {
  items: AlertDelivery[];
  nowMs: number;
  busy: boolean;
  error: string;
  onDismiss: (delivery: AlertDelivery) => void;
  onDrag?: (() => void) | undefined;
}) {
  const { t } = useTranslation('alerts');
  const drag = useWindowDrag(onDrag);
  const list = visibleDeliveries(items, nowMs);
  if (!list.length) return null;
  const shown = list.slice(0, VISIBLE_CARDS);
  return (
    <section
      className="flex cursor-move flex-col gap-1.5 p-1.5 text-ink select-none"
      aria-label={t(($) => $.popup.label)}
      aria-live="polite"
      {...drag}
    >
      {shown.map((d, index) => {
        const name = deliveryName(t, d);
        const nameInLabel = deliveryName(t, d, true);
        return (
          <article
            key={d.id}
            data-category={d.category}
            data-phase={d.phase}
            className={cn(
              // Height is fixed: native sizes the window from the card count (alert_window.rs).
              'relative flex h-14 flex-none animate-alight items-center gap-2 overflow-hidden rounded-xl border pr-2 pl-2.5',
              'bg-shade/92 text-halo inset-shadow-light',
              d.phase === 'start' ? 'border-accent-strong/75' : 'border-accent-line',
            )}
            aria-label={name}
          >
            <span
              className={cn(
                'grid size-7 shrink-0 place-items-center rounded-full ring-1 ring-current/25 ring-inset',
                CATEGORY_TONE[d.category],
              )}
              aria-hidden="true"
            >
              <Icon name={CATEGORY[d.category].icon} size={15} />
            </span>
            <div className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-3xs font-semibold tracking-caps text-ink-3 uppercase">
                {categoryLabel(t, d.category)}
                {' · '}
                {phaseLabel(t, d)}
              </span>
              <b className="truncate text-sm font-semibold">{name}</b>
              {index === 0 && error ? (
                <span className="truncate text-xs text-danger" role="alert">
                  {error}
                </span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.25">
              <Button
                size="xs"
                iconOnly
                aria-label={t(($) => $.popup.dismiss, { name: nameInLabel })}
                title={t(($) => $.actions.dismiss, { ns: 'common' })}
                disabled={busy}
                onClick={() => onDismiss(d)}
              >
                <Icon name="close" size={14} />
              </Button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
