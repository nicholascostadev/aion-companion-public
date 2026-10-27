import { useTranslation } from '../../i18n/provider';
import { WindowSwitch, windowState } from './WindowSwitch';

interface DpsToggleProps {
  visible: boolean;
  /** False until the first native status arrives. */
  known: boolean;
  busy: boolean;
  disabled?: boolean;
  compact?: boolean;
  /** Stacked layout, for a grid of window switches (see `WindowSwitch`). */
  stacked?: boolean;
  /** Shown, but held back by the native side while AION is unfocused. */
  suspended?: boolean;
  /** Global hotkey that toggles the meter, shown in the tooltip. */
  shortcut?: string;
  className?: string;
  onToggle: () => void;
}

/** Show/hide switch for the DPS meter window, driven by the backend's actual visibility. */
export function DpsToggle({
  visible,
  known,
  busy,
  disabled = false,
  compact = false,
  stacked = false,
  suspended = false,
  shortcut = 'Ctrl+Shift+F9',
  className,
  onToggle,
}: DpsToggleProps) {
  const { t } = useTranslation('common');
  const state = windowState({ known, requested: visible, held: suspended });
  const name = t(($) => $.window.dpsMeter);
  return (
    <WindowSwitch
      on={known && visible}
      icon="meter"
      label={compact ? t(($) => $.window.dpsShort) : name}
      state={state}
      busy={busy}
      stacked={stacked}
      aria-label={name}
      className={className}
      disabled={disabled || !known}
      title={t(($) => (visible ? $.window.hideDpsMeter : $.window.showDpsMeter), { shortcut })}
      onClick={onToggle}
    />
  );
}
