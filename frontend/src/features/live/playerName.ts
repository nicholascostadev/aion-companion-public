import type { Translate } from '../../i18n/provider';
import type { LivePlayer } from '../../types/companion';

export interface PlayerDisplay {
  text: string;
  title: string;
  pending: boolean;
}

/**
 * Display name for a live meter row. Only an explicitly observed identity is
 * shown as a character name; an inferred class is never presented as one.
 * Older payloads without `name_known` keep their backend `label`.
 */
export function playerDisplay(
  player: Pick<LivePlayer, 'entity' | 'label' | 'name' | 'class' | 'is_local' | 'name_known'>,
  t: Translate<'live'>,
): PlayerDisplay {
  const job = player.class?.trim();
  if (player.name_known === false) {
    const id = player.entity;
    const details = [
      job && t(($) => $.names.inferredClass, { className: job }),
      t(($) => $.names.entity, { id }),
    ].filter(Boolean);
    return {
      text: player.is_local
        ? t(($) => $.names.pendingYou, { id })
        : t(($) => $.names.pendingPlayer, { id }),
      title: t(($) => $.names.pendingTitle, { details: details.join(' · ') }),
      pending: true,
    };
  }
  const text = (player.name_known && player.name?.trim()) || player.label;
  const details = [
    job && job !== text && job,
    player.is_local && t(($) => $.names.youDetail),
  ].filter(Boolean);
  return {
    text,
    title: details.length ? `${text} · ${details.join(' · ')}` : text,
    pending: false,
  };
}
