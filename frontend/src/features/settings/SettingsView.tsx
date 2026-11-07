import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { StatusDot } from '../../components/ui/Badge';
import { SearchInput } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { TabList, TabPanel, Tabs } from '../../components/ui/Tabs';
import { useTranslation } from '../../i18n/provider';
import { SettingsPage } from '../offline/SettingsLayout';
import {
  CATEGORY_ICONS,
  FIRST_APP_CATEGORY,
  SETTINGS_CATEGORIES,
  SETTINGS_SECTION_IDS,
  searchSections,
  type CategoryState,
  type SearchHit,
  type SettingsCategory,
} from './categories';
import { useSettingsSearch } from './useSettingsSearch';

/**
 * What a category's rail tab says beside its name: a field to fix, unsaved changes, setup
 * that needs doing, or an update waiting.
 */
export type CategoryMark = CategoryState | 'attention' | 'update';

/** The mark's glyph, with its words for screen readers and as a tooltip. */
function Mark({ mark }: { mark: CategoryMark }) {
  const { t } = useTranslation('settings');
  const words = t(($) => $.nav.marks[mark]);
  return (
    <span className="flex shrink-0 items-center" title={words} data-mark={mark}>
      {mark === 'problem' ? (
        <Icon name="warning" size={13} className="text-danger" />
      ) : mark === 'attention' ? (
        <Icon name="warning" size={13} className="text-warn" />
      ) : (
        <StatusDot tone={mark === 'update' ? 'accent' : 'warn'} />
      )}
      <span className="sr-only">{`, ${words}`}</span>
    </span>
  );
}

/** Settings search: a field over the rail whose matches open their section. */
function Search({
  query,
  onQuery,
  hits,
  categoryLabel,
  onOpen,
}: {
  query: string;
  onQuery: (query: string) => void;
  hits: SearchHit[];
  categoryLabel: (category: SettingsCategory) => string;
  onOpen: (hit: SearchHit) => void;
}) {
  const { t } = useTranslation('settings');
  const results = useId();
  const searching = query.trim() !== '';
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      onQuery('');
    } else if (event.key === 'Enter' && hits[0]) {
      event.preventDefault();
      onOpen(hits[0]);
    }
  };
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <SearchInput
        aria-label={t(($) => $.search.label)}
        placeholder={t(($) => $.search.placeholder)}
        aria-controls={searching ? results : undefined}
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <output className="sr-only">
        {searching
          ? hits.length
            ? t(($) => $.search.count, { count: hits.length })
            : t(($) => $.search.none, { query: query.trim() })
          : ''}
      </output>
      {searching &&
        (hits.length ? (
          <ul
            id={results}
            aria-label={t(($) => $.search.results)}
            className="m-0 flex list-none flex-col gap-0.5 p-0"
          >
            {hits.map((hit) => (
              <li key={hit.key}>
                <Pressable
                  className={selectableRow(false, 'flex w-full min-w-0 flex-col px-3 py-1.5')}
                  onClick={() => onOpen(hit)}
                >
                  <span className="truncate text-sm font-medium text-ink">{hit.title}</span>
                  <span className="truncate text-2xs text-ink-3">
                    {[categoryLabel(hit.category), hit.matched.join(', ')]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </Pressable>
              </li>
            ))}
          </ul>
        ) : (
          <p id={results} aria-hidden="true" className="m-0 px-3 text-sm text-ink-3">
            {t(($) => $.search.none, { query: query.trim() })}
          </p>
        ))}
    </div>
  );
}

/**
 * Settings as places: a rail of categories (a vertical list beside the page on wide
 * windows, a strip across the top on narrow ones) and one category's sections at a time.
 * Search finds a section in any category and opens it through `onOpenSection`, the same way
 * other screens deep-link into Settings.
 */
export function SettingsView({
  category,
  onCategoryChange,
  onOpenSection,
  marks,
  wide,
  pages,
}: {
  category: SettingsCategory;
  onCategoryChange: (category: SettingsCategory) => void;
  /** Shows the category holding this section, then scrolls to and focuses the section. */
  onOpenSection: (id: string) => void;
  marks: Partial<Record<SettingsCategory, CategoryMark>>;
  /** The rail stands beside the page (up and down arrows) rather than across it. */
  wide: boolean;
  pages: Record<SettingsCategory, ReactNode>;
}) {
  const { t } = useTranslation('settings');
  const [query, setQuery] = useState('');
  const entries = useSettingsSearch();
  const categoryLabel = (c: SettingsCategory) => t(($) => $.categories[c]);
  const hits = searchSections(entries, query, categoryLabel);
  const searching = query.trim() !== '';

  // A newly chosen category starts at its top, not wherever the last one was scrolled to.
  const content = useRef<HTMLDivElement>(null);
  const shown = useRef(category);
  useEffect(() => {
    if (shown.current === category) return;
    shown.current = category;
    const page = content.current;
    if (!page) return;
    const margin = Number.parseFloat(getComputedStyle(page).scrollMarginTop) || 0;
    if (page.getBoundingClientRect().top < margin) page.scrollIntoView?.({ block: 'start' });
  }, [category]);

  const items = SETTINGS_CATEGORIES.map((id) => {
    const mark = marks[id];
    return {
      id,
      label: categoryLabel(id),
      icon: <Icon name={CATEGORY_ICONS[id]} size={15} />,
      marker: mark ? <Mark mark={mark} /> : undefined,
      startsGroup: id === FIRST_APP_CATEGORY,
    };
  });

  return (
    <Tabs
      value={category}
      onValueChange={onCategoryChange}
      orientation={wide ? 'vertical' : 'horizontal'}
    >
      <div className="grid items-start gap-x-8 gap-y-4 pb-16 min-[960px]:grid-cols-[13rem_minmax(0,1fr)]">
        <nav
          aria-label={t(($) => $.nav.label)}
          className="flex min-w-0 flex-col gap-3 min-[960px]:sticky min-[960px]:top-[calc(var(--spacing-header)+4rem)]"
        >
          <Search
            query={query}
            onQuery={setQuery}
            hits={hits}
            categoryLabel={categoryLabel}
            onOpen={(hit) => {
              setQuery('');
              onOpenSection(SETTINGS_SECTION_IDS[hit.key]);
            }}
          />
          <div hidden={searching}>
            <TabList variant="rail" label={t(($) => $.nav.categories)} items={items} />
          </div>
        </nav>
        <div ref={content} className="min-w-0 scroll-mt-28">
          {SETTINGS_CATEGORIES.map((id) => (
            <TabPanel key={id} value={id}>
              <SettingsPage title={categoryLabel(id)}>{pages[id]}</SettingsPage>
            </TabPanel>
          ))}
        </div>
      </div>
    </Tabs>
  );
}
