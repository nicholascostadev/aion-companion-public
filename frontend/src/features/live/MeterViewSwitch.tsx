import { useEffect, useRef } from 'react';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { useTranslation } from '../../i18n/provider';

/** What the meter shows while a dungeon group prepares: its room, or the live DPS meter. */
export type MeterView = 'group' | 'dps';

/**
 * Keyboard focus on the switch, carried across a view change: each view draws its own
 * caption, so the switch the reader pressed unmounts and the other view's takes its place.
 */
let refocus = false;

/**
 * The Group and DPS segments leading the meter's caption while a dungeon group prepares.
 * Both views draw it in the same place, so it never moves under the pointer. Every segment
 * is a hit region, so it stays clickable on the locked meter.
 */
export function MeterViewSwitch({
  view,
  onChange,
}: {
  view: MeterView;
  onChange: (view: MeterView) => void;
}) {
  const { t } = useTranslation('live');
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!refocus) return;
    refocus = false;
    root.current?.querySelector<HTMLElement>('[aria-pressed="true"]')?.focus();
  }, []);
  return (
    <span ref={root} className="contents">
      <SegmentedControl<MeterView>
        size="xs"
        label={t(($) => $.overlay.view.label)}
        value={view}
        options={[
          {
            value: 'group',
            label: t(($) => $.overlay.view.group),
            title: t(($) => $.overlay.view.groupTitle),
          },
          {
            value: 'dps',
            label: t(($) => $.overlay.view.dps),
            title: t(($) => $.overlay.view.dpsTitle),
          },
        ]}
        onChange={(next) => {
          refocus = root.current?.contains(document.activeElement) ?? false;
          onChange(next);
        }}
        segmentAttributes={{ 'data-hit': '' }}
        // A pixel of groove around the 18 px segments keeps the pill inside the 28 px caption.
        className="p-px"
      />
    </span>
  );
}
