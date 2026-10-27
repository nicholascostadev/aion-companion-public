import { mergeProps } from '@base-ui/react/merge-props';
import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { useId, type ButtonHTMLAttributes, type ReactElement } from 'react';
import { useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import { buttonClasses } from './Button';
import { SwitchTrack } from './Field';
import { Icon, type IconName } from './Icon';

/**
 * An in-game window's state: `checking` until the native side has answered, then `hidden`,
 * `shown`, or `autoHidden` when it is asked for but held back (the game is unfocused).
 */
export type WindowState = 'checking' | 'hidden' | 'shown' | 'autoHidden' | 'waitingForRaid';

/** The state of an in-game window; `WindowSwitch` and `useWindowStateLabel` word it. */
export function windowState({
  known,
  requested,
  held = false,
}: {
  known: boolean;
  requested: boolean;
  held?: boolean;
}): WindowState {
  if (!known) return 'checking';
  if (!requested) return 'hidden';
  return held ? 'autoHidden' : 'shown';
}

/** The one word for a window state (Shown, Hidden, Auto-hidden, Checking…). */
export function useWindowStateLabel() {
  const { t } = useTranslation('common');
  return (state: WindowState) => t(($) => $.window.state[state]);
}

/**
 * The stacked look, for a grid of window controls (Home): name over state, the switch at
 * the end. A pressed `Button` that sits in the same grid takes it too.
 */
export const stackedSwitch =
  'h-auto min-h-10 w-full justify-start gap-2.5 px-3 py-1 text-left whitespace-normal';

export interface WindowSwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'role' | 'aria-checked' | 'children' | 'type' | 'value' | 'name' | 'form' | 'onChange'
> {
  /** The window is (or is asked to be) shown. */
  on: boolean;
  /**
   * A Lucide icon, toned with the state; or the window's original game art (e.g.
   * `<CubeIcon />`), which is never recoloured.
   */
  icon: IconName | ReactElement;
  /** Visible name of the window; also the accessible name unless `aria-label` is given. */
  label: string;
  /** The native state, worded by the switch; see `windowState`. */
  state: WindowState;
  busy?: boolean;
  /**
   * Put the state under the name and the switch at the end, so the longest state word fits
   * a half-width grid cell. Inline (the default) is one line for toolbars.
   */
  stacked?: boolean;
}

/**
 * Show/hide switch for an in-game window (the DPS meter, the tracker bars, the pet radar):
 * the window's icon and name, a switch track and the state the native side reports. Lit
 * with the accent when on. Every in-game window is toggled from the workspace with this.
 *
 * It never grows past its container: the state word is never cut, and inline the name gives
 * way first (truncated, still whole in the accessible name); stacked, both wrap instead.
 *
 * Base UI's `Switch` rendered as a native `<button>`: the native side owns the state, so
 * `on` is always controlled and `onClick` asks for the change.
 */
export function WindowSwitch({
  on,
  icon,
  label,
  state,
  busy = false,
  stacked = false,
  className,
  disabled,
  title,
  ...props
}: WindowSwitchProps) {
  const stateId = useId();
  const { t } = useTranslation('common');
  const word = t(($) => $.window.state[state]);
  const autoHidden = state === 'autoHidden';
  const autoHiddenHint = t(($) => $.window.autoHiddenHint);
  const tone = on ? 'text-accent' : 'text-ink-3';
  return (
    <SwitchPrimitive.Root
      nativeButton
      // The caller's button props (onClick, data-hit, aria-*) go on the button itself.
      render={(root) => <button type="button" {...mergeProps<'button'>(root, props)} />}
      data-ui="button"
      checked={on}
      aria-label={label}
      aria-describedby={stateId}
      aria-busy={busy}
      className={buttonClasses({
        variant: 'secondary',
        size: 'sm',
        className: cn(
          'min-w-0 max-w-full gap-2 px-2.5 aria-busy:cursor-progress',
          stacked && stackedSwitch,
          on && 'border-accent-line bg-accent-soft',
          className,
        ),
      })}
      disabled={disabled || busy}
      title={autoHidden ? `${title ?? label} · ${autoHiddenHint}` : (title ?? label)}
    >
      <span id={stateId} className="sr-only">
        {autoHidden ? autoHiddenHint : word}
      </span>
      {typeof icon === 'string' ? (
        <Icon name={icon} size={14} className={cn('shrink-0', tone)} />
      ) : (
        icon
      )}
      {stacked ? (
        <>
          <span className="flex min-w-0 flex-1 flex-col gap-px leading-tight">
            <span className="font-semibold break-words">{label}</span>
            <span
              className={cn('text-xs break-words', tone)}
              aria-hidden="true"
              data-ui="window-state"
            >
              {word}
            </span>
          </span>
          <SwitchTrack on={on} />
        </>
      ) : (
        <>
          <span className="min-w-0 truncate font-semibold">{label}</span>
          <SwitchTrack on={on} />
          <span
            className={cn('min-w-[4.5em] shrink-0 text-left text-xs', tone)}
            aria-hidden="true"
            data-ui="window-state"
          >
            {word}
          </span>
        </>
      )}
    </SwitchPrimitive.Root>
  );
}
