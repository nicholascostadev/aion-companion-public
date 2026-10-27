import type { PetPosition } from '../../types/pets';
import type { MapPosition as MotionPosition } from '../maps/motion';

/*
 * The radar's movement is the shared map motion (`../maps/motion`): display-only dead
 * reckoning between measured fixes, the same for every map that draws you.
 */

export type MapPosition = MotionPosition<PetPosition>;

export { canAnimatePosition, confirmedPosition, MapMotion } from '../maps/motion';
