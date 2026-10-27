import { Button } from '../../components/ui/Button';
import { Meter } from '../../components/ui/Data';
import { PetTypeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Trans, useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetFamily, PetsStatus } from '../../types/pets';
import {
  axisLabel,
  duration,
  FAMILY_LABEL,
  MAX_LEVEL,
  metres,
  sessionOf,
  soulsLeftLabel,
  stageLabel,
  type PetState,
} from './model';

/*
 * Shared by the workspace Pets tab and the in-game pet radar: everything here is styled
 * with roles and tokens only, so it looks the same in both (glass or solid surfaces).
 */

/** A family's colour on the shared data palette, for marks beside its symbol and name. */
export const FAMILY_FILL: Record<PetFamily, string> = {
  Cognia: 'fill-family-cognia',
  Fera: 'fill-family-fera',
  Natura: 'fill-family-natura',
  Varia: 'fill-family-varia',
  Specia: 'fill-family-specia',
};
export const FAMILY_BG: Record<PetFamily, string> = {
  Cognia: 'bg-family-cognia',
  Fera: 'bg-family-fera',
  Natura: 'bg-family-natura',
  Varia: 'bg-family-varia',
  Specia: 'bg-family-specia',
};
/** CSS value of a family colour, for inline fills (bars). */
export const familyColor = (family: PetFamily | null | undefined) =>
  family ? `var(--color-family-${family.toLowerCase()})` : 'var(--color-family-unknown)';

/**
 * A family's written name led by its original AION 2 symbol; without one only the name
 * shows. `all` is every pet, a generic choice led by a plain paw. `md` suits filter chips,
 * where the symbol has to read at a glance.
 */
export function FamilyLabel({
  family,
  size = 'sm',
  className,
}: {
  family: PetFamily | 'all';
  size?: 'sm' | 'md';
  className?: string;
}) {
  const { t } = useTranslation('pets');
  const md = size === 'md';
  return (
    <span
      className={cn(
        'pet-family inline-flex max-w-full min-w-0 items-center align-bottom',
        md ? 'gap-1.5' : 'gap-1',
        className,
      )}
    >
      {family === 'all' ? (
        <Icon name="paw" size={md ? 16 : 12} className="opacity-80" />
      ) : (
        <PetTypeIcon family={family} size={md ? 22 : 14} className={md ? 'size-5.5' : 'size-3.5'} />
      )}
      <span className="min-w-0 truncate">
        {family === 'all' ? t(($) => $.family.all) : FAMILY_LABEL[family]}
      </span>
    </span>
  );
}

/**
 * Three level pips, like seeds: filled with parchment up to the level, golden once complete
 * (the gold of the data palette, not the accent). An unknown collection shows dashed, empty
 * pips.
 */
export function LevelPips({ state, size = 'md' }: { state: PetState; size?: 'sm' | 'md' }) {
  const { t } = useTranslation('pets');
  const level = state.level ?? 0;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center align-middle',
        size === 'sm' ? 'gap-0.5' : 'gap-[3px]',
      )}
      title={stageLabel(state, t)}
    >
      {Array.from({ length: MAX_LEVEL }, (_, i) => {
        const on = state.stage !== 'unknown' && i < level;
        return (
          <i
            key={i}
            aria-hidden="true"
            className={cn(
              'rounded-full border border-line-strong',
              size === 'sm' ? 'size-1.5' : 'size-2',
              on && (state.stage === 'maxed' ? 'border-pollen bg-pollen' : 'border-ink-2 bg-ink-2'),
              state.stage === 'unknown' && 'border-dashed opacity-60',
            )}
          />
        );
      })}
      <span className="sr-only">
        {state.stage === 'unknown'
          ? t(($) => $.level.unknown)
          : t(($) => $.level.of, { level, max: MAX_LEVEL })}
      </span>
    </span>
  );
}

/** Souls toward the next level, printed beside a small bar that grows in. */
export function SoulProgress({ state, compact = false }: { state: PetState; compact?: boolean }) {
  const { t } = useTranslation('pets');
  const fraction =
    state.stage === 'unknown'
      ? null
      : state.stage === 'maxed'
        ? 1
        : state.needed
          ? (state.progress ?? 0) / state.needed
          : 0;
  const quiet = state.stage === 'unknown' || state.stage === 'maxed';
  return (
    <span
      className={cn(
        'flex min-w-0 items-center tabular-nums',
        compact ? 'gap-1.5 text-2xs' : 'gap-2 text-xs',
        quiet ? 'text-ink-3' : 'text-ink-2',
      )}
    >
      {/* Without a known level a compact bar says nothing; the words get the room. */}
      {!(compact && fraction === null) && (
        <Meter
          size="xs"
          fraction={fraction}
          color={state.stage === 'maxed' ? 'var(--color-pollen)' : undefined}
          label={stageLabel(state, t)}
          className={compact ? 'min-w-4' : 'w-11 flex-none'}
        />
      )}
      <span className={compact ? 'max-w-[70%] flex-none truncate' : 'min-w-0'}>
        {state.stage === 'growing' || state.stage === 'unowned' ? (
          <>
            <b className="font-semibold text-ink">
              {state.estimated ? '~' : ''}
              {state.progress ?? 0}
            </b>
            /{state.needed}
            {!compact && (
              <span className="whitespace-nowrap text-ink-3"> · {soulsLeftLabel(state, t)}</span>
            )}
          </>
        ) : (
          soulsLeftLabel(state, t)
        )}
      </span>
    </span>
  );
}

export function PinButton({
  pinned,
  name,
  disabled = false,
  hit = false,
  size = 'sm',
  className,
  onChange,
}: {
  pinned: boolean;
  name: string;
  disabled?: boolean;
  /** Clickable while the radar window is locked. */
  hit?: boolean;
  /** `2xs` is for the in-game radar's dense rows only. */
  size?: '2xs' | 'xs' | 'sm';
  className?: string;
  onChange: (pinned: boolean) => void;
}) {
  const { t } = useTranslation('pets');
  return (
    <Button
      variant="ghost"
      size={size}
      iconOnly
      className={cn(
        'text-ink-3',
        // Pinned: a lit pebble in the pinned colour around a filled pin, never a faint outline.
        'aria-pressed:bg-marker-pinned/15 aria-pressed:text-marker-pinned aria-pressed:ring-1 aria-pressed:ring-marker-pinned/45',
        'aria-pressed:enabled:hover:bg-marker-pinned/25 aria-pressed:enabled:hover:text-marker-pinned',
        '[&[aria-pressed=true]_svg]:fill-marker-pinned/70',
        className,
      )}
      aria-pressed={pinned}
      aria-label={pinned ? t(($) => $.pin.unpin, { name }) : t(($) => $.pin.pin, { name })}
      title={pinned ? t(($) => $.pin.pinnedTitle) : t(($) => $.pin.pinTitle)}
      disabled={disabled}
      data-hit={hit ? 'pin' : undefined}
      onClick={(event) => {
        // The row may be selectable; a pin click never selects it.
        event.stopPropagation();
        onChange(!pinned);
      }}
    >
      <Icon name="pin" size={size === '2xs' ? 11 : 13} />
    </Button>
  );
}

/**
 * Distance and coordinate direction of a sighting; unknown without a fresh own position.
 * `compact` keeps the axis words for the tooltip and screen readers only.
 */
export function Bearing({
  distance,
  bearing,
  compact = false,
}: {
  distance: number | null;
  bearing: number | null;
  compact?: boolean;
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  if (distance === null)
    return (
      <span
        className="inline-flex shrink-0 text-xs text-ink-3 tabular-nums"
        title={t(($) => $.bearing.unknown)}
      >
        — m
      </span>
    );
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 text-xs text-ink-2 tabular-nums"
      title={
        bearing === null
          ? t(($) => $.bearing.here)
          : t(($) => $.bearing.title, {
              degrees: Math.round(bearing),
              axis: axisLabel(bearing),
              hint: t(($) => $.bearing.compassHint),
            })
      }
    >
      {bearing !== null && (
        <span
          className="inline-flex text-accent transition-transform duration-300 ease-grow"
          style={{ transform: `rotate(${bearing}deg)` }}
          aria-hidden="true"
        >
          <Icon name="heading" size={12} strokeWidth={2.2} />
        </span>
      )}
      <b className="font-semibold text-ink">{metres(distance, fmt)}</b>
      {bearing !== null && (
        <span className={compact ? 'sr-only' : 'min-w-10 text-2xs text-ink-3'}>
          {axisLabel(bearing)}
        </span>
      )}
    </span>
  );
}

/**
 * Pickups of this capture session for the profile shown; nothing when no session belongs to
 * it. Counts come from native as observed, never estimated.
 */
export function SessionSummary({
  status,
  compact = false,
}: {
  status: PetsStatus | null;
  compact?: boolean;
}) {
  const { t } = useTranslation('pets');
  const fmt = useFormat();
  const session = sessionOf(status);
  if (!status || !session || session.started_ms === null) return null;
  const bold = [<b key="n" className="font-semibold text-ink" />];
  return (
    <span
      className={cn(
        'pet-session inline-flex flex-wrap text-ink-3 tabular-nums',
        compact ? 'gap-x-2 gap-y-0.5' : 'gap-x-2.5 gap-y-0.5 border-l border-line pl-2.5',
      )}
      title={t(($) => $.session.title, { time: fmt.timeOfDay(session.started_ms) })}
    >
      {!compact && (
        <span className="text-ink-2">
          {t(($) => $.session.label, { duration: duration(status.now_ms - session.started_ms) })}
        </span>
      )}
      <span>
        <Trans
          t={t}
          i18nKey={($) => $.session.souls}
          count={session.souls_gained}
          components={bold}
        />
      </span>
      <span>
        {compact ? (
          <Trans
            t={t}
            i18nKey={($) => $.session.levelUpsShort}
            count={session.level_ups}
            components={bold}
          />
        ) : (
          <Trans
            t={t}
            i18nKey={($) => $.session.levelUps}
            count={session.level_ups}
            components={bold}
          />
        )}
      </span>
      <span>
        {compact ? (
          <Trans
            t={t}
            i18nKey={($) => $.session.obtainedShort}
            count={session.obtained}
            components={bold}
          />
        ) : (
          <Trans
            t={t}
            i18nKey={($) => $.session.obtained}
            count={session.obtained}
            components={bold}
          />
        )}
      </span>
    </span>
  );
}
