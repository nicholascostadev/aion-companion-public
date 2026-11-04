import type { CSSProperties, HTMLAttributes, Ref } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { Icon } from '../../components/ui/Icon';
import { OverlayCaption, overlayWindow, WindowButton } from '../../components/ui/Overlay';
import { useTranslation } from '../../i18n/provider';
import { captureState } from '../../lib/capture';
import { cn } from '../../lib/cn';
import type { OfflineHotkeys } from '../../types/offline';
import { GroupCount, GroupRoster, GroupState, useGroupClock } from '../group/GroupRoster';
import type { GroupStatusData } from '../group/model';

interface Props {
  group: GroupStatusData | null;
  native: boolean;
  /** The meter's own problem line (capture, overlay or action errors). */
  error: string;
  locked: boolean;
  /** The meter's opacity and scale. */
  style: CSSProperties;
  hitRef?: Ref<HTMLElement> | undefined;
  /** The meter's window-drag handlers. */
  drag: HTMLAttributes<HTMLElement>;
  hotkeys: OfflineHotkeys;
  onHide: () => void;
}

/**
 * The party room on the DPS meter's own sheet while a dungeon group prepares: the meter's
 * caption with the room's size and readiness, then the roster. It is the same window, size,
 * lock and hit regions as the fight, and gives way to the fight only when the run starts;
 * there is no control to switch between them.
 */
export function PreparationView({
  group,
  native,
  error,
  locked,
  style,
  hitRef,
  drag,
  hotkeys,
  onHide,
}: Props) {
  const { t } = useTranslation(['live', 'group']);
  const now = useGroupClock(group);
  const live = captureState(group) === 'capturing';
  return (
    <section
      className={overlayWindow({
        editing: !locked,
        className: 'text-2xs leading-snug',
      })}
      data-glass="deep"
      data-view="room"
      aria-label={t(($) => $.overlay.room.label)}
      style={style}
      ref={hitRef}
      {...drag}
    >
      <OverlayCaption className={cn('relative h-7 gap-1.5 pr-1 pl-2', !locked && 'cursor-move')}>
        <span
          className={cn('inline-flex shrink-0', live ? 'text-accent' : 'text-ink-3')}
          aria-hidden="true"
        >
          <StatusDot live={live} className="size-1.5 text-current" />
        </span>
        {/* Where the fight's timer sits, the room says it is waiting for its run. */}
        <span className="flex min-w-0 shrink-[4] items-baseline gap-1.5">
          <b className="min-w-0 truncate text-xs font-semibold text-ink">
            {t(($) => $.title, { ns: 'group' })}
          </b>
          <GroupCount status={group} />
          <span
            className="shrink-0 text-3xs font-semibold tracking-caps text-ink-3 uppercase"
            title={t(($) => $.overlay.room.preparingTitle)}
          >
            {t(($) => $.overlay.room.preparing)}
          </span>
        </span>
        <span className="ml-auto flex min-w-0 shrink-0 items-center gap-1">
          <GroupState status={group} native={native} now={now} />
        </span>
        {!locked && (
          <span className="flex shrink-0 border-l border-line-soft pl-0.5">
            <WindowButton
              size="2xs"
              onClick={onHide}
              title={
                hotkeys.toggle_overlay
                  ? t(($) => $.overlay.hideHotkey, {
                      hotkey: hotkeys.toggle_overlay,
                    })
                  : t(($) => $.overlay.hideMenu)
              }
              aria-label={t(($) => $.overlay.hide)}
            >
              <Icon name="minus" size={13} />
            </WindowButton>
          </span>
        )}
      </OverlayCaption>
      <GroupRoster status={group} native={native} error={error} now={now} />
    </section>
  );
}
