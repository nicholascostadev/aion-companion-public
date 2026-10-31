import type { CubesStatus } from './cubes';

/**
 * Your own validated position as native's capture owns it (`world_motion_status` and the
 * `world-motion-updated` event): the context, position, last position and facing of a cube
 * status, without its cubes or totals. `session_id` and `revision` are the cube status's own,
 * so the two are ordered against each other. Nothing in it is predicted.
 */
export type WorldMotionStatus = Pick<
  CubesStatus,
  | 'running'
  | 'phase'
  | 'message'
  | 'session_id'
  | 'revision'
  | 'zone_id'
  | 'map_id'
  | 'now_ms'
  | 'position'
  | 'position_age_ms'
  | 'last_position'
  | 'facing'
>;
