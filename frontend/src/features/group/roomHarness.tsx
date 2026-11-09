import { GroupCount, GroupRoster, GroupState, useGroupClock } from './GroupRoster';
import type { GroupStatus } from '../../types/companion';
import { groupRoom } from './model';

/**
 * The party room's own pieces as the meter's room sheet composes them: the caption's count and
 * readiness over the roster, all reading one `groupRoom`. For render tests of their DOM, words
 * and accessibility; the room's rules are tested at `groupRoom`, and the sheet around these
 * pieces (the Group and DPS switch, Hide) with the meter.
 */
export function GroupRoom({
  status,
  native,
  error,
}: {
  status: GroupStatus | null;
  native: boolean;
  error: string;
}) {
  const now = useGroupClock(status);
  const room = groupRoom(status, native, now);
  return (
    <>
      <GroupCount room={room} />
      <GroupState room={room} />
      <GroupRoster status={status} room={room} native={native} error={error} now={now} />
    </>
  );
}
