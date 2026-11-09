import type { Translate } from '../../i18n/provider';
import type { LiveWords } from '../../lib/playerRow';

/** The live namespace's words for player rows (`lib/playerRow`): the meter's and live totals'. */
export function liveWords(t: Translate<'live'>): LiveWords {
  return {
    you: t(($) => $.names.you),
    youDetail: t(($) => $.names.youDetail),
    classRank: (className, rank) => t(($) => $.names.classRank, { className, rank }),
    playerRank: (rank) => t(($) => $.names.playerRank, { rank }),
    playerId: (id) => t(($) => $.names.playerId, { id }),
    pendingYou: (id) => t(($) => $.names.pendingYou, { id }),
    pendingPlayer: (id) => t(($) => $.names.pendingPlayer, { id }),
    pendingTitle: (details) => t(($) => $.names.pendingTitle, { details }),
    inferredClass: (className) => t(($) => $.names.inferredClass, { className }),
    entity: (id) => t(($) => $.names.entity, { id }),
  };
}
