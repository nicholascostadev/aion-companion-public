import { useMemo, type CSSProperties, type ReactNode, type Ref } from 'react';
import { PetPortrait } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import {
  CaptionState,
  CaptionTitle,
  OverlayCaption,
  overlayWindow,
  WindowButton,
} from '../../components/ui/Overlay';
import { useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetsStatus, PetWindowStatus } from '../../types/pets';
import { useWindowDrag } from '../live/windowDrag';
import { LocalMap } from './LocalMap';
import {
  age,
  collectionBrief,
  collectionStates,
  collectionSync,
  groupNearby,
  lastPositionAge,
  liveState,
  mapName,
  mapPets,
  nearbyRows,
  pinnedRows,
  radarMap,
  stateOf,
  type LiveState,
  type NearbyGroup,
  type PetIndex,
  type PetState,
  type PinnedRow,
} from './model';
import { CompactGroup, compactRowClass, CompactPetLine, NearbyList, RadarScope } from './Nearby';

interface Props {
  native: boolean;
  index: PetIndex | null;
  status: PetsStatus | null;
  window: PetWindowStatus;
  error: string;
  busy: boolean;
  onPin: (pet: number, pinned: boolean) => void;
  onLock: (locked: boolean) => void;
  onHide: () => void;
  /** Native window move; only attached while unlocked. */
  onDrag?: () => void;
  /** Native corner resize; only shown while unlocked. */
  onResize?: () => void;
  /** Panel root, measured natively so locked controls stay clickable. */
  hitRef?: Ref<HTMLElement>;
  /** False while the radar has been hidden for a while: its map art is released. */
  drawArt?: boolean;
}

/** Line 1 of a tracked pet that is not near: its name and why no distance shows. */
function TrackedHead({ name, goal, status }: { name: string; goal: boolean; status: ReactNode }) {
  const { t } = useTranslation('pets');
  return (
    <div className="flex h-5 min-w-0 items-center gap-1.5">
      {goal && (
        <span className="inline-flex shrink-0 text-accent" title={t(($) => $.nearby.goal)}>
          <Icon name="target" size={11} />
          <span className="sr-only">{t(($) => $.nearby.goal)}</span>
        </span>
      )}
      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink-2" title={name}>
        {name}
      </span>
      {status}
    </div>
  );
}

const quiet = 'shrink-0 text-2xs text-ink-3';

/**
 * The farming goal while none of its monsters is near (a near one leads the nearby rows):
 * that it is not seen, and where it spawns.
 */
function GoalRow({
  index,
  status,
  states,
  hereMapId,
  isLive,
  hit,
  disabled,
  onPin,
}: {
  index: PetIndex;
  status: PetsStatus;
  states: Map<number, PetState>;
  hereMapId: string | null;
  /** Sightings describe the character playing now. */
  isLive: boolean;
  hit: boolean;
  disabled: boolean;
  onPin: (pet: number, pinned: boolean) => void;
}) {
  const { t } = useTranslation('pets');
  const goal = status.config.farming_goal;
  if (!goal) return null;
  const pet = index.pets.get(goal.pet_id);
  if (!pet) return <p className={note}>{t(($) => $.radar.goalMissing)}</p>;
  const points = index.spawns.get(goal.map_id)?.filter((s) => s.pet === pet.id).length ?? 0;
  const elsewhere = hereMapId !== null && hereMapId !== goal.map_id;
  const goalMap = mapName(index, goal.map_id);
  const where = t(($) => $.radar.pointsOn, { count: points, map: goalMap });
  return (
    <section
      className={cn('pet-goal-row', compactRowClass('goal'))}
      aria-label={t(($) => $.radar.goalLabel, { name: pet.name })}
    >
      <PetPortrait id={pet.id} className="mt-0.5 w-6 rounded-full ring-1 ring-accent-line" />
      <div className="min-w-0">
        <TrackedHead
          name={pet.name}
          goal
          status={
            <span className={quiet} title={where}>
              {isLive ? t(($) => $.radar.notSeen) : t(($) => $.radar.notLive)}
            </span>
          }
        />
        <CompactPetLine
          pet={pet}
          state={stateOf(states, pet.id)}
          pinned={status.config.pinned_ids.includes(pet.id)}
          pinDisabled={disabled}
          hit={hit}
          onPin={onPin}
          named={false}
        >
          <span
            className={cn('min-w-0 truncate', elsewhere && 'text-warn')}
            title={
              elsewhere
                ? t(($) => $.radar.pointsOnElsewhere, {
                    count: points,
                    map: goalMap,
                    here: mapName(index, hereMapId),
                  })
                : where
            }
          >
            ·{' '}
            {elsewhere
              ? t(($) => $.farm.detail.onMap, { map: goalMap })
              : hereMapId
                ? t(($) => $.radar.pointsHere, { count: points })
                : where}
          </span>
        </CompactPetLine>
      </div>
    </section>
  );
}

/** Where a pinned pet that is not near spawns: on this map or not. */
function pinnedWhere(row: PinnedRow, t: Translate<'pets'>) {
  if (row.here === null) return null;
  if (!row.here) return t(($) => $.picker.note.offMap);
  return t(($) => $.radar.pointsOnThisMap, { count: row.here });
}

/** A quiet line of guidance inside the radar body. */
const note = 'm-0 px-1 text-2xs leading-snug text-ink-3';

/** Why nothing is live, in a few words; the full reason is the tooltip. */
function statusLine(live: LiveState, t: Translate<'pets'>): string | null {
  switch (live.kind) {
    case 'preview':
      return t(($) => $.radar.line.preview);
    case 'connecting':
      return live.error
        ? t(($) => $.radar.line.error, { error: live.error })
        : t(($) => $.radar.line.connecting);
    case 'identifying':
      return t(($) => $.radar.line.identifying);
    case 'saved':
      return t(($) => $.radar.line.saved);
    case 'live':
      return null;
  }
}

/** Compact in-game pet radar: tracked rows over a map of where to farm. */
export function PetRadar({
  native,
  index,
  status,
  window: win,
  error,
  busy,
  onPin,
  onLock,
  onHide,
  onDrag,
  onResize,
  hitRef,
  drawArt = true,
}: Props) {
  const { t } = useTranslation('pets');
  const locked = win.locked;
  const drag = useWindowDrag(locked ? undefined : onDrag);
  const states = useMemo(
    () => (index ? collectionStates(index.catalogue, status) : new Map<number, PetState>()),
    [index, status],
  );
  const rows = useMemo(
    () => (index ? nearbyRows(index, states, status, native) : []),
    [index, states, status, native],
  );
  const groups = useMemo(() => groupNearby(rows), [rows]);
  const shown = useMemo(
    () => (index ? radarMap(index, status, native) : null),
    [index, status, native],
  );
  const drawn = useMemo(
    () => (index ? mapPets(index, states, status) : new Set<number>()),
    [index, states, status],
  );
  const live = liveState(status, native);
  const config = status?.config;
  const pinnedIds = useMemo(() => new Set(config?.pinned_ids ?? []), [config]);
  const goalId = config?.farming_goal?.pet_id ?? null;
  const isLive = live.kind === 'live';
  const fresh = isLive && live.positionFresh;
  // Where you are (or last were): only a map that came from your own position.
  const hereId = shown?.player ? shown.map.id : null;
  const goalNear = groups.some((g) => g.goal);
  const goalPinned = goalId !== null && pinnedIds.has(goalId);
  // A pin with a near monster is in that monster's row (whichever rows are shown, so a pin
  // can never fall between the two); a pinned goal is in the goal row or its monster's row.
  const nearPins = new Set(
    groups.flatMap((g) => g.pets.flatMap((p) => (p.pinned ? p.pet.id : []))),
  );
  const pinned = index
    ? pinnedRows(index, states, status, native, hereId).filter(
        (row) => !nearPins.has(row.pet.id) && !row.goal,
      )
    : [];
  // Pins always lead, in pin order (newest first), whatever their distance or the goal: near
  // pins in their monster's row, the others with where they spawn. Unpinned rows follow.
  const pinOrder = new Map((config?.pinned_ids ?? []).map((id, i) => [id, i]));
  const pins: ({ pin: number } & (
    | { kind: 'near'; group: NearbyGroup }
    | { kind: 'away'; row: PinnedRow }
  ))[] = [
    ...groups.flatMap((group) =>
      group.pinned ? [{ kind: 'near' as const, pin: group.pin ?? 0, group }] : [],
    ),
    ...pinned.map((row) => ({ kind: 'away' as const, pin: pinOrder.get(row.pet.id) ?? 0, row })),
  ].sort((a, b) => a.pin - b.pin);
  const others = groups.filter((group) => !group.pinned);
  const line = statusLine(live, t);
  // The radar always follows the character playing now; its collection may still be old.
  const unsynced = collectionBrief(collectionSync(status, native), status?.now_ms ?? 0, t);
  const problem = error || status?.error || win.errors[0] || '';
  const posAge = isLive ? lastPositionAge(status) : null;
  const stateLabel =
    live.kind === 'live'
      ? live.positionFresh
        ? t(($) => $.radar.state.live)
        : posAge !== null
          ? t(($) => $.radar.state.lastKnown)
          : t(($) => $.radar.state.noPosition)
      : live.kind === 'saved'
        ? t(($) => $.radar.state.saved)
        : live.kind === 'identifying'
          ? t(($) => $.radar.state.identifying)
          : live.kind === 'preview'
            ? t(($) => $.radar.state.preview)
            : live.error
              ? t(($) => $.radar.state.error)
              : t(($) => $.radar.state.connecting);
  const style = {
    // The user's see-through amount applies to the glass only, never to the text.
    '--pet-alpha': `${(config?.opacity ?? 0.8) * 100}%`,
    zoom: config?.scale ?? 1,
  } as CSSProperties;
  const empty = isLive && groups.length === 0 && !config?.farming_goal && pinned.length === 0;
  const goalRow = status && index && (
    <GoalRow
      index={index}
      status={status}
      states={states}
      hereMapId={hereId}
      isLive={isLive}
      hit={locked}
      disabled={!native || busy}
      onPin={onPin}
    />
  );

  return (
    <section
      ref={hitRef}
      className={overlayWindow({
        glass: 'deep',
        editing: !locked,
        className: 'pet-radar bg-shade/(--pet-alpha)',
      })}
      data-state={locked ? 'locked' : 'editing'}
      aria-label={t(($) => $.radar.label)}
      style={style}
      {...drag}
    >
      <OverlayCaption className="pet-radar-caption h-7 gap-1 pr-1 pl-2.5">
        <CaptionTitle
          icon={<Icon name="paw" size={13} />}
          label={hereId && index ? mapName(index, hereId) : t(($) => $.radar.title)}
        >
          <CaptionState
            tone={isLive ? (live.positionFresh ? 'live' : 'warn') : 'muted'}
            title={isLive && !live.positionFresh ? t(($) => $.radar.staleTitle) : undefined}
          >
            {stateLabel}
          </CaptionState>
          {posAge !== null && (
            <span
              className={cn(
                'pet-age shrink-0 rounded-full bg-surface-3 px-1.5 text-3xs leading-4 tabular-nums',
                fresh ? 'text-accent' : 'text-ink-3',
              )}
              title={fresh ? t(($) => $.radar.ageTitle) : t(($) => $.radar.ageStaleTitle)}
            >
              {age(posAge)}
            </span>
          )}
        </CaptionTitle>
        <WindowButton
          className={cn(
            'aria-pressed:bg-transparent aria-pressed:text-ink-3',
            !locked && 'text-accent',
          )}
          data-hit="lock"
          aria-pressed={locked}
          aria-label={locked ? t(($) => $.radar.unlock) : t(($) => $.radar.lock)}
          title={locked ? t(($) => $.radar.lockedTitle) : t(($) => $.radar.lockTitle)}
          disabled={!native || busy}
          onClick={() => onLock(!locked)}
        >
          <Icon name={locked ? 'lock' : 'unlock'} size={13} />
        </WindowButton>
        <WindowButton
          close
          data-hit="hide"
          aria-label={t(($) => $.radar.hide)}
          title={t(($) => $.radar.hideTitle)}
          disabled={!native || busy}
          onClick={onHide}
        >
          <Icon name="close" size={13} />
        </WindowButton>
      </OverlayCaption>
      {problem && (
        <p
          className="mx-2 mt-1 mb-0 flex min-w-0 items-center gap-1.25 text-2xs text-danger"
          role="alert"
          title={problem}
        >
          <Icon name="warning" size={11} />
          <span className="min-w-0 truncate">{problem}</span>
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5">
        {!index ? (
          <p className={note}>{t(($) => $.radar.loading)}</p>
        ) : (
          <>
            {(line || unsynced) && (
              <p className={cn(note, 'flex min-w-0 flex-none gap-2')}>
                {line && (
                  <span className="min-w-0 truncate" title={line}>
                    {line}
                  </span>
                )}
                {unsynced && (
                  <span className="min-w-0 truncate text-warn" title={unsynced.title}>
                    {unsynced.text}
                  </span>
                )}
              </p>
            )}
            <div
              className="pet-radar-rows min-h-0 flex-[0_1_auto] overflow-y-auto"
              data-hit-clip=""
            >
              {status && !goalNear && goalPinned && goalRow}
              {pins.length > 0 && (
                <ul
                  className="m-0 flex list-none flex-col gap-px p-0"
                  aria-label={t(($) => $.radar.pinnedPets)}
                >
                  {pins.map((entry) => {
                    if (entry.kind === 'near')
                      return (
                        <CompactGroup
                          key={entry.group.key}
                          group={entry.group}
                          now={status?.now_ms ?? 0}
                          onPin={onPin}
                          pinDisabled={!native || busy}
                          hit={locked}
                        />
                      );
                    const { row } = entry;
                    const where = pinnedWhere(row, t);
                    return (
                      <li
                        key={row.pet.id}
                        data-stage={row.state.stage}
                        className={compactRowClass('pinned')}
                      >
                        <PetPortrait
                          id={row.pet.id}
                          className="mt-0.5 w-6 rounded-full ring-1 ring-marker-pinned"
                        />
                        <div className="min-w-0">
                          <TrackedHead
                            name={row.pet.name}
                            goal={false}
                            status={
                              isLive && <span className={quiet}>{t(($) => $.radar.notNearby)}</span>
                            }
                          />
                          <CompactPetLine
                            pet={row.pet}
                            state={row.state}
                            pinned
                            pinDisabled={!native || busy}
                            hit={locked}
                            onPin={onPin}
                            named={false}
                          >
                            {where && (
                              <span className="min-w-0 truncate" title={where}>
                                · {where}
                              </span>
                            )}
                          </CompactPetLine>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {status && !goalNear && !goalPinned && goalRow}
              {others.length > 0 && (
                <NearbyList
                  compact
                  groups={others}
                  now={status?.now_ms ?? 0}
                  onPin={onPin}
                  pinDisabled={!native || busy}
                  hit={locked}
                />
              )}
              {empty && <p className={note}>{t(($) => $.radar.empty)}</p>}
            </div>
            {shown && config ? (
              <LocalMap
                key={status?.active_profile_id ?? ''}
                // The map keeps at least 45% of the body; the rows scroll in the rest.
                className="flex-[1_0_45%]"
                index={index}
                view={shown}
                facing={status?.facing ?? null}
                radius={config.nearby_radius}
                rows={rows}
                pets={drawn}
                goal={config.farming_goal?.map_id === shown.map.id ? goalId : null}
                pinned={pinnedIds}
                now={status?.now_ms ?? 0}
                drawArt={drawArt}
              />
            ) : (
              fresh &&
              config && (
                // No known map for this zone: the coordinate radar alone.
                <div className="flex flex-[1_0_45%] items-center justify-center">
                  <RadarScope rows={rows} radius={config.nearby_radius} size={96} />
                </div>
              )
            )}
          </>
        )}
      </div>
      {!locked && onResize && (
        <WindowButton
          size="2xs"
          className="absolute right-px bottom-px cursor-nwse-resize rounded-md"
          aria-label={t(($) => $.radar.resize)}
          title={t(($) => $.radar.resizeTitle)}
          onPointerDown={(event) => {
            if (event.button === 0) onResize();
          }}
        >
          <Icon name="grip" size={11} />
        </WindowButton>
      )}
    </section>
  );
}
