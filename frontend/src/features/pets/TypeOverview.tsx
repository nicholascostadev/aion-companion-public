import { PetTypeIcon } from '../../components/ui/GameArt';
import { Icon } from '../../components/ui/Icon';
import { Pressable } from '../../components/ui/Pressable';
import { Trans, useTranslation, type Translate } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { PetFamily } from '../../types/pets';
import { ago, FAMILY_LABEL, levelThree, type CollectionSync, type FamilySummary } from './model';

/** Where the counts come from, in a few words: never more certain than the collection. */
function scopeOf(
  sync: CollectionSync,
  now: number,
  t: Translate<'pets'>,
): { title: string; note: string; warn: boolean } | null {
  switch (sync.kind) {
    case 'none':
      return null;
    case 'empty':
      return {
        title: t(($) => $.overview.scope.empty.title),
        note: t(($) => $.overview.scope.empty.note),
        warn: false,
      };
    case 'current':
      return {
        title: t(($) => $.overview.scope.current.title),
        note: t(($) => $.overview.scope.current.note),
        warn: false,
      };
    case 'waiting':
      return sync.syncedMs === null
        ? {
            title: t(($) => $.overview.scope.notSynced.title),
            note: t(($) => $.overview.scope.notSynced.note),
            warn: true,
          }
        : {
            title: t(($) => $.overview.scope.lastSync.title),
            note: t(($) => $.overview.scope.lastSync.note, { ago: ago(now - sync.syncedMs, t) }),
            warn: true,
          };
    case 'cached':
      return {
        title: t(($) => $.overview.scope.cached.title),
        note: t(($) => $.overview.scope.cached.note),
        warn: true,
      };
    case 'saved':
      return sync.syncedMs === null
        ? {
            title: t(($) => $.overview.scope.savedNever.title),
            note: t(($) => $.overview.scope.savedNever.note),
            warn: false,
          }
        : {
            title: t(($) => $.overview.scope.saved.title),
            note: t(($) => $.overview.scope.saved.note, { ago: ago(now - sync.syncedMs, t) }),
            warn: false,
          };
  }
}

function Tile({
  summary,
  chosen,
  onChoose,
}: {
  summary: FamilySummary;
  chosen: boolean;
  onChoose: () => void;
}) {
  const { t } = useTranslation('pets');
  const { family } = summary;
  const name = family === 'all' ? t(($) => $.overview.allTypes) : FAMILY_LABEL[family];
  const count = levelThree(summary);
  const hint =
    family === 'all'
      ? t(($) => $.overview.showAll)
      : chosen
        ? t(($) => $.overview.showingOnly, { family: name })
        : t(($) => $.overview.showOnly, { family: name });
  const why =
    count.kind === 'unknown'
      ? t(($) => $.overview.unknownTitle)
      : count.kind === 'atLeast'
        ? t(($) => $.overview.atLeastTitle, { count: count.unknown })
        : '';
  return (
    <Pressable
      aria-pressed={chosen}
      data-family={family}
      title={why ? `${hint}\n${why}` : hint}
      className={cn(
        'grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] content-center items-center gap-x-2 rounded-lg border border-line-soft bg-surface-2 py-1.5 pr-2.5 pl-2',
        'transition-[background-color,border-color] duration-150 ease-grow hover:border-line-strong',
        'aria-pressed:border-accent-line aria-pressed:bg-accent-soft',
        // Narrow: the symbol moves beside the name, so the count has the tile's whole width.
        'max-[980px]:grid-cols-[1.125rem_minmax(0,1fr)] max-[980px]:gap-x-1.5 max-[980px]:px-2',
      )}
      onClick={onChoose}
    >
      <span
        aria-hidden="true"
        className="row-span-3 grid size-6 place-items-center text-ink-2 max-[980px]:row-span-1 max-[980px]:size-4.5"
      >
        {family === 'all' ? (
          <Icon name="paw" size={18} className="max-[980px]:size-3.5" />
        ) : (
          <PetTypeIcon family={family} size={24} className="size-6 max-[980px]:size-4.5" />
        )}
      </span>
      <span
        className={cn(
          'min-w-0 truncate text-xs leading-tight font-semibold',
          chosen ? 'text-accent' : 'text-ink-2',
        )}
      >
        {name}
      </span>
      <span className="col-start-2 min-w-0 text-xs leading-snug text-ink-2 max-[980px]:col-span-full max-[980px]:col-start-1">
        {count.kind === 'unknown' ? (
          <span className="font-semibold text-ink-3">{t(($) => $.overview.unknown)}</span>
        ) : (
          <Trans
            t={t}
            i18nKey={($) => (count.kind === 'exact' ? $.overview.count : $.overview.atLeast)}
            values={{ count: count.count }}
            components={[
              <b
                key="n"
                className="text-lg leading-none font-semibold tracking-tight text-ink tabular-nums"
              />,
            ]}
          />
        )}
      </span>
      <span className="col-start-2 min-w-0 truncate text-2xs leading-tight text-ink-3 tabular-nums max-[980px]:col-span-full max-[980px]:col-start-1">
        {count.kind === 'unknown'
          ? t(($) => $.overview.pets, { count: count.total })
          : t(($) => $.overview.of, { count: count.total })}
      </span>
    </Pressable>
  );
}

/**
 * Level 3 by pet type, for the whole collection of the profile shown: one tile for every
 * type and one for all of them. The counts never follow a search or list filter; choosing a
 * tile filters the map and the collection to that type, and choosing it again clears it.
 */
export function TypeOverview({
  summaries,
  sync,
  now,
  family,
  onFamily,
}: {
  summaries: readonly FamilySummary[];
  sync: CollectionSync;
  now: number;
  family: PetFamily | 'all';
  onFamily: (family: PetFamily | 'all') => void;
}) {
  const { t } = useTranslation('pets');
  const scope = scopeOf(sync, now, t);
  return (
    <section
      aria-label={t(($) => $.overview.label)}
      className={cn(
        'grid grid-cols-6 gap-1.5',
        'min-[1180px]:grid-cols-[repeat(6,minmax(0,1fr))_auto]',
        'max-[560px]:grid-cols-3',
      )}
    >
      {summaries.map((summary) => (
        <Tile
          key={summary.family}
          summary={summary}
          chosen={family === summary.family}
          onChoose={() =>
            onFamily(summary.family === family && family !== 'all' ? 'all' : summary.family)
          }
        />
      ))}
      {scope && (
        <p
          className={cn(
            'm-0 flex min-w-0 flex-col justify-center text-2xs leading-snug text-ink-3',
            'min-[1180px]:max-w-36 min-[1180px]:pl-1',
            // Below the wide layout the note leads the tiles on one line.
            'max-[1179px]:order-first max-[1179px]:col-span-full max-[1179px]:flex-row max-[1179px]:flex-wrap max-[1179px]:gap-x-1.5',
          )}
        >
          <b className={cn('font-semibold', scope.warn ? 'text-warn' : 'text-ink-2')}>
            {scope.title}
          </b>
          <span>{scope.note}</span>
        </p>
      )}
    </section>
  );
}
