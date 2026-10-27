import { useId, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Checkbox, SearchInput } from '../../components/ui/Field';
import { useFormat, useLocale, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import {
  categoriesOf,
  categoryKeys,
  categoryShown,
  fold,
  NONE_HIDDEN,
  onlyShown,
  setShown,
  type Hidden,
} from './map';
import { ResourceGlyph } from './parts';
import { gatheringResources, type GatheringSpots, type ResourceSpots } from './spawns';

const groupTitle = 'm-0 text-2xs font-semibold tracking-caps text-ink-3 uppercase';

/**
 * Which resources are marked: a checklist by category with their counts on the shown map,
 * a search over both languages' names, and quick choices (all, none, only one, only the
 * matches). A category or a choice holds on every map; a resource is one gathered item,
 * whatever native resources yield it. Nothing without possible locations on the map.
 */
export function ResourceFilter({
  spots,
  hidden,
  setHidden,
  shown,
}: {
  /** Possible locations on the shown map, every resource. */
  spots: GatheringSpots | null;
  hidden: Hidden;
  setHidden: (next: Hidden) => void;
  /** Resources shown on the map. */
  shown: number;
}) {
  const { t } = useTranslation('gathering');
  const fmt = useFormat();
  const locale = useLocale();
  const id = useId();
  const [query, setQuery] = useState('');
  const all = gatheringResources();
  const categories = categoriesOf(spots);
  const needle = fold(query.trim());
  const matches = (r: ResourceSpots) =>
    !needle ||
    fold(r.resource.name[locale]).includes(needle) ||
    fold(r.resource.name.en).includes(needle) ||
    fold(r.resource.name['pt-BR']).includes(needle) ||
    fold(t(($) => $.categories[r.resource.category])).includes(needle);
  const listed = categories
    .map((c) => ({ ...c, rows: c.resources.filter(matches) }))
    .filter((c) => c.rows.length > 0);
  const total = spots?.resources.length ?? 0;
  if (!spots) return null;
  return (
    <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex items-baseline gap-2">
        <h4 className={groupTitle} id={id}>
          {t(($) => $.filter.label)}
        </h4>
        <span className="ml-auto text-2xs text-ink-3 tabular-nums" aria-live="polite">
          {t(($) => $.filter.shown, { shown, total })}
        </span>
      </div>
      <SearchInput
        size="sm"
        value={query}
        aria-label={t(($) => $.filter.search)}
        placeholder={t(($) => $.filter.searchPlaceholder)}
        onChange={(e) => setQuery(e.target.value)}
        wrapperClassName="mb-2"
      />
      <div className="mb-3 flex flex-wrap gap-1">
        {needle && listed.length > 0 ? (
          <Button
            size="xs"
            variant="secondary"
            title={t(($) => $.filter.matchesTitle)}
            onClick={() =>
              setHidden(
                onlyShown(
                  all,
                  listed.flatMap((c) => c.rows.map((r) => r.resource.key)),
                ),
              )
            }
          >
            {t(($) => $.filter.matches)}
          </Button>
        ) : null}
        <Button
          size="xs"
          variant="ghost"
          title={t(($) => $.filter.allTitle)}
          disabled={hidden.size === 0}
          onClick={() => setHidden(NONE_HIDDEN)}
        >
          {t(($) => $.filter.all)}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          title={t(($) => $.filter.noneTitle)}
          disabled={shown === 0}
          onClick={() => setHidden(onlyShown(all, []))}
        >
          {t(($) => $.filter.none)}
        </Button>
      </div>
      {listed.length === 0 ? (
        <p className="m-0 text-xs text-ink-3">{t(($) => $.filter.noMatches, { query })}</p>
      ) : (
        <ul
          aria-labelledby={id}
          className="-mx-1 my-0 flex list-none flex-col gap-3 px-1 py-0.5 max-[959px]:max-h-80 max-[959px]:overflow-y-auto"
        >
          {listed.map(({ category, rows, points }) => {
            const on = categoryShown(spots, hidden, category);
            return (
              <li key={category} data-category={category}>
                <Checkbox
                  checked={on === 'all'}
                  indeterminate={on === 'some'}
                  onCheckedChange={() =>
                    setHidden(setShown(hidden, categoryKeys(all, category), on !== 'all'))
                  }
                  label={
                    <span className="flex items-baseline gap-2 font-semibold text-ink">
                      {t(($) => $.categories[category])}
                      <span className="text-xs font-normal text-ink-3 tabular-nums">
                        {fmt.integer.format(points)}
                      </span>
                    </span>
                  }
                />
                <ul className="m-0 mt-1 flex list-none flex-col p-0 pl-6">
                  {rows.map((r) => (
                    <ResourceRow
                      key={r.resource.key}
                      spots={r}
                      on={!hidden.has(r.resource.key)}
                      onChange={(next) => setHidden(setShown(hidden, [r.resource.key], next))}
                      onOnly={() => setHidden(onlyShown(all, [r.resource.key]))}
                    />
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** One resource: its checkbox, original icon, name and count here, and Only. */
function ResourceRow({
  spots,
  on,
  onChange,
  onOnly,
}: {
  spots: ResourceSpots;
  on: boolean;
  onChange: (on: boolean) => void;
  onOnly: () => void;
}) {
  const { t } = useTranslation('gathering');
  const fmt = useFormat();
  const locale = useLocale();
  const name = spots.resource.name[locale];
  return (
    <li className="group flex min-h-8 items-center gap-1" data-resource={spots.resource.key}>
      <Checkbox
        checked={on}
        onCheckedChange={onChange}
        className="min-w-0 flex-1 items-center"
        label={
          <span className="flex min-w-0 items-center gap-2">
            <ResourceGlyph resource={spots.resource} size="sm" />
            <span className={cn('min-w-0 flex-1 truncate', on ? 'text-ink' : 'text-ink-3')}>
              {name}
            </span>
            <span
              className="shrink-0 text-xs text-ink-3 tabular-nums"
              title={t(($) => $.filter.points, { count: spots.points })}
            >
              {fmt.integer.format(spots.points)}
            </span>
          </span>
        }
      />
      <Button
        size="2xs"
        variant="ghost"
        className="shrink-0 opacity-70 group-hover:opacity-100 focus-visible:opacity-100"
        title={t(($) => $.filter.onlyTitle, { name })}
        aria-label={t(($) => $.filter.onlyTitle, { name })}
        onClick={onOnly}
      >
        {t(($) => $.filter.only)}
      </Button>
    </li>
  );
}
