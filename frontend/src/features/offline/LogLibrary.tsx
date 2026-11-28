import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Checkbox, Input, SearchInput, Select } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { SegmentedControl } from '../../components/ui/SegmentedControl';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import {
  emptyFilters,
  PAGE_SIZE,
  type LibraryFilters,
  type LibraryNotice,
  type LogLibraryView,
} from './libraryModel';
import { cn } from '../../lib/cn';
import { targetMode } from '../../lib/targetScope';
import type { LogMeta, OfflineSettings } from '../../types/offline';
import type { OpenProfile } from '../live/ProfileLink';
import { endReason, type ReportTab } from './report/context';
import { ReportView } from './report/ReportView';

/** A library notice, worded at render so it follows a language change. */
function noticeText(t: Translate<'reports'>, notice: LibraryNotice) {
  switch (notice.kind) {
    case 'renamed':
      return t(($) => $.library.notice.renamed, { label: notice.label });
    case 'deleted':
      return t(($) => $.library.notice.deleted, { count: notice.count });
    case 'exported':
      return notice.paths.length === 1
        ? t(($) => $.library.notice.exportedOne, { path: notice.paths[0] ?? '' })
        : t(($) => $.library.notice.exported, {
            count: notice.paths.length,
            paths: notice.paths.join(' · '),
          });
    case 'exportedBeforeError':
      return t(($) => $.library.notice.exportedBeforeError, {
        count: notice.paths.length,
        paths: notice.paths.join(' · '),
      });
  }
}

function RenameForm({
  log,
  onRename,
  onDone,
}: {
  log: LogMeta;
  onRename: (label: string) => Promise<boolean>;
  onDone: () => void;
}) {
  const { t } = useTranslation(['reports', 'common']);
  const [label, setLabel] = useState(log.label ?? '');
  const valid = label.trim().length > 0 && new TextEncoder().encode(label.trim()).length <= 200;
  const input = useRef<HTMLInputElement>(null);
  // Focus follows the explicit Rename action that opened this form.
  useEffect(() => input.current?.focus(), []);
  return (
    <form
      className="flex min-w-0 flex-1 items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void onRename(label).then((ok) => ok && onDone());
      }}
    >
      <Input
        ref={input}
        size="sm"
        className="flex-1"
        aria-label={t(($) => $.library.newName)}
        value={label}
        maxLength={200}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onDone()}
      />
      <Button type="submit" variant="primary" size="xs" disabled={!valid}>
        {t(($) => $.actions.save, { ns: 'common' })}
      </Button>
      <Button variant="ghost" size="xs" onClick={onDone}>
        {t(($) => $.actions.cancel, { ns: 'common' })}
      </Button>
    </form>
  );
}

/**
 * Saved fights, one place at a time. The library is a full-width list with its filters; an
 * opened fight takes the page instead, as a focused report with the way back to the list in
 * its title row. Going back keeps the fight open: the list lights its row and offers the
 * way in again, with the filters, page and selection as they were.
 */
export function LogLibrary({
  library,
  settings,
  native,
  libraryCount,
  outcomeFilter = false,
  browsing: heldBrowsing,
  onBrowsingChange,
  onCompare,
  onCopySummary,
  onOpenProfile,
}: {
  library: LogLibraryView;
  settings: OfflineSettings | null;
  native: boolean;
  libraryCount: number | null;
  /**
   * The engine filters saved fights by result before paging (its `log_outcome_filter`
   * capability). Without it the result filter is not offered: filtering one page here
   * would hide matching fights on the other pages.
   */
  outcomeFilter?: boolean;
  /**
   * The list shows although a fight is open: the reader went back to it. Held by the owner
   * so it outlives this tab (and so the page can widen for a report); without an owner the
   * library keeps it itself.
   */
  browsing?: boolean | undefined;
  onBrowsingChange?: ((browsing: boolean) => void) | undefined;
  onCompare: (ids: string[]) => void;
  onCopySummary: (id: string) => (multiline: boolean) => Promise<void>;
  /** Opens a character in the in-game profile window; omit outside the native app. */
  onOpenProfile?: OpenProfile | undefined;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { filters, logs, selected, setSelected, activeId, report } = library;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [ownBrowsing, setOwnBrowsing] = useState(false);
  // The place a report was last read on: the next fight opens on it, the first on its
  // combat details.
  const [reportTab, setReportTab] = useState<ReportTab>('details');
  const browsing = heldBrowsing ?? ownBrowsing;
  const setBrowsing = onBrowsingChange ?? setOwnBrowsing;
  const inspecting = activeId !== null && !browsing;
  const back = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  // Set when the reader moves between the list and a report here, so focus follows them
  // (to the way back, or to the row they came from) and never moves on its own.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    if (inspecting) back.current?.focus();
    else list.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
  }, [inspecting]);

  const set = (patch: Partial<LibraryFilters>) => library.setFilters({ ...filters, ...patch });
  const filtered = JSON.stringify({ ...filters, sort: 'newest' }) !== JSON.stringify(emptyFilters);
  const allSelected = logs.length > 0 && logs.every((l) => selected.includes(l.id));
  const toggle = (id: string) =>
    setSelected(selected.includes(id) ? selected.filter((k) => k !== id) : [...selected, id]);
  const active = logs.find((l) => l.id === activeId) ?? null;
  const openLog = (id: string) => {
    moved.current = true;
    setBrowsing(false);
    // The fight that is already open is shown again as it is, without another read.
    if (id !== activeId || !report) void library.open(id);
  };
  const toList = () => {
    moved.current = true;
    setRenaming(null);
    setBrowsing(true);
  };

  if (!native)
    return (
      <EmptyState title={t(($) => $.library.nativeTitle)} icon={<Icon name="book" size={20} />}>
        {t(($) => $.library.nativeBody)}
      </EmptyState>
    );

  const notices = (
    <>
      {library.error && <Notice tone="error">{library.error}</Notice>}
      {library.notice && (
        <Notice tone="good" onDismiss={library.clearNotice}>
          {noticeText(t, library.notice)}
        </Notice>
      )}
    </>
  );

  if (inspecting) {
    const toLogs = (
      <Button
        ref={back}
        size="sm"
        icon={<Icon name="arrowLeft" size={14} />}
        title={t(($) => $.library.backTitle)}
        onClick={toList}
      >
        {t(($) => $.library.back)}
      </Button>
    );
    return (
      <Panel
        as="section"
        padding="lg"
        data-ui="log-report"
        aria-label={t(($) => $.library.openLog)}
        className="min-w-0"
      >
        {notices}
        {library.reportError && <Notice tone="error">{library.reportError}</Notice>}
        {report ? (
          <ReportView
            report={report}
            settings={settings}
            native={native}
            scope={targetMode(settings)}
            dense
            initialTab={reportTab}
            onTabChange={setReportTab}
            onCopySummary={onCopySummary(activeId)}
            onOpenProfile={onOpenProfile}
            lead={toLogs}
            heading={
              active && renaming === activeId ? (
                <div className="mb-1 flex min-w-0">
                  <RenameForm
                    log={active}
                    onRename={(label) => library.rename(activeId, label)}
                    onDone={() => setRenaming(null)}
                  />
                </div>
              ) : undefined
            }
            actions={
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon name="edit" size={13} />}
                  onClick={() => setRenaming(activeId)}
                  disabled={!active}
                >
                  {t(($) => $.library.rename)}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon name="download" size={13} />}
                  onClick={() => void library.exportLogs([activeId])}
                  disabled={!active}
                >
                  {t(($) => $.library.exportJson)}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Icon name="scale" size={13} />}
                  onClick={() => onCompare([activeId])}
                >
                  {t(($) => $.library.compareWith)}
                </Button>
              </>
            }
          />
        ) : (
          <>
            <div className="mb-2">{toLogs}</div>
            {library.reportLoading ? (
              <EmptyState
                live
                title={t(($) => $.library.opening)}
                icon={<Icon name="loader" size={20} className="animate-spin" />}
              />
            ) : (
              !library.reportError && (
                <EmptyState
                  title={t(($) => $.library.selectTitle)}
                  icon={<Icon name="book" size={20} />}
                >
                  {t(($) => $.library.selectBody)}
                </EmptyState>
              )
            )}
          </>
        )}
      </Panel>
    );
  }

  return (
    <Panel
      as="section"
      padding="lg"
      data-ui="log-library"
      aria-label={t(($) => $.library.title)}
      className="@container flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="m-0">{t(($) => $.library.title)}</h2>
        <span className="text-xs text-ink-3">
          {libraryCount === null
            ? ''
            : t(($) => $.library.total, { total: fmt.integer.format(libraryCount) })}{' '}
          · {t(($) => $.library.autoSave)}{' '}
          {settings?.auto_save ? (
            <b className="font-semibold text-accent">{t(($) => $.library.on)}</b>
          ) : (
            <b className="font-semibold text-ink-2">{t(($) => $.library.off)}</b>
          )}
        </span>
      </div>
      {activeId !== null && (
        // The fight the reader stepped back from stays open, one press away.
        <div
          data-ui="open-log"
          className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-accent-line bg-accent-soft px-3 py-2"
        >
          <Icon name="book" size={15} className="shrink-0 text-accent" />
          <span className="min-w-0 flex-1 text-sm text-ink-2">
            {t(($) => $.library.stillOpen)}{' '}
            <b className="font-semibold wrap-anywhere text-ink">
              {active?.label ?? report?.label ?? active?.boss ?? t(($) => $.library.encounter)}
            </b>
          </span>
          <Button size="sm" variant="primary" onClick={() => openLog(activeId)}>
            {t(($) => $.library.resume)}
            <Icon name="arrowRight" size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            title={t(($) => $.library.closeLogTitle)}
            onClick={() => void library.open(null)}
          >
            {t(($) => $.library.closeLog)}
          </Button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        <SearchInput
          size="sm"
          wrapperClassName="min-w-40 flex-1"
          className="w-full"
          aria-label={t(($) => $.library.search)}
          placeholder={t(($) => $.library.searchPlaceholder)}
          value={filters.search}
          onChange={(e) => set({ search: e.target.value })}
        />
        {outcomeFilter && (
          <SegmentedControl
            size="sm"
            overflow="scroll"
            label={t(($) => $.library.outcome.label)}
            value={filters.outcome}
            onChange={(outcome) => set({ outcome })}
            options={[
              { value: 'all', label: t(($) => $.library.outcome.all) },
              {
                value: 'kill',
                label: t(($) => $.library.outcome.kill),
                title: t(($) => $.library.outcome.killTitle),
              },
              {
                value: 'attempt',
                label: t(($) => $.library.outcome.attempt),
                title: t(($) => $.library.outcome.attemptTitle),
              },
              {
                value: 'dummy',
                label: t(($) => $.library.outcome.dummy),
                title: t(($) => $.library.outcome.dummyTitle),
              },
            ]}
          />
        )}
        <Input
          size="sm"
          className="w-32"
          aria-label={t(($) => $.library.bossLabel)}
          placeholder={t(($) => $.library.boss)}
          value={filters.boss}
          onChange={(e) => set({ boss: e.target.value })}
        />
        <Input
          size="sm"
          className="w-20"
          aria-label={t(($) => $.library.zoneLabel)}
          placeholder={t(($) => $.library.zone)}
          inputMode="numeric"
          value={filters.zone}
          onChange={(e) => set({ zone: e.target.value.replace(/\D/g, '') })}
        />
        <Input
          size="sm"
          className="w-36"
          aria-label={t(($) => $.library.fromDate)}
          type="date"
          value={filters.from}
          onChange={(e) => set({ from: e.target.value })}
        />
        <Input
          size="sm"
          className="w-36"
          aria-label={t(($) => $.library.toDate)}
          type="date"
          value={filters.to}
          onChange={(e) => set({ to: e.target.value })}
        />
        <Input
          size="sm"
          className="w-24"
          aria-label={t(($) => $.library.runLabel)}
          placeholder={t(($) => $.library.run)}
          value={filters.run}
          onChange={(e) => set({ run: e.target.value })}
        />
        <Select
          size="sm"
          wrapperClassName="w-32"
          aria-label={t(($) => $.library.sort)}
          value={filters.sort}
          onChange={(e) => set({ sort: e.target.value as LibraryFilters['sort'] })}
        >
          <option value="newest">{t(($) => $.library.sortNewest)}</option>
          <option value="damage">{t(($) => $.library.sortDamage)}</option>
          <option value="dps">{t(($) => $.library.sortDps)}</option>
        </Select>
        {filtered && (
          <Button
            variant="link"
            className="text-xs"
            onClick={() => library.setFilters({ ...emptyFilters, sort: filters.sort })}
          >
            {t(($) => $.library.clearFilters)}
          </Button>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-1.5 border-y border-line-soft py-2">
        <Checkbox
          aria-label={t(($) => $.library.selectAll)}
          label={
            selected.length
              ? t(($) => $.library.selected, { count: selected.length })
              : t(($) => $.library.select)
          }
          checked={allSelected}
          onCheckedChange={() => setSelected(allSelected ? [] : logs.map((l) => l.id))}
        />
        <span className="flex gap-1">
          <Button
            size="xs"
            disabled={selected.length !== 2}
            title={t(($) => $.library.compareTitle)}
            onClick={() => onCompare(selected)}
          >
            {t(($) => $.library.compare)}
          </Button>
          <Button
            size="xs"
            disabled={!selected.length}
            onClick={() => void library.exportLogs(selected)}
          >
            {t(($) => $.library.export)}
          </Button>
          {confirmDelete ? (
            <>
              <Button
                size="xs"
                variant="danger"
                onClick={() => {
                  setConfirmDelete(false);
                  void library.remove(selected);
                }}
              >
                {t(($) => $.library.deleteCount, { n: fmt.integer.format(selected.length) })}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t(($) => $.library.keep)}
              </Button>
            </>
          ) : (
            <Button
              size="xs"
              variant="danger"
              disabled={!selected.length}
              onClick={() => setConfirmDelete(true)}
            >
              {t(($) => $.library.delete)}
            </Button>
          )}
        </span>
      </div>
      {notices}
      <ul
        ref={list}
        className="-mx-1.5 m-0 flex list-none flex-col gap-0.5 p-0 px-1.5 transition-opacity aria-busy:opacity-70"
        aria-label={t(($) => $.library.list)}
        aria-busy={library.loading}
      >
        {logs.map((log) => (
          <li
            key={log.id}
            data-active={activeId === log.id || undefined}
            // The open log is lit and grows a small stem on its leading edge.
            className={selectableRow(activeId === log.id, 'flex items-start gap-2.5 px-2.5 py-2')}
          >
            <Checkbox
              className="mt-0.5"
              aria-label={t(($) => $.library.selectLog, {
                name: log.label ?? log.boss ?? log.id,
              })}
              checked={selected.includes(log.id)}
              onCheckedChange={() => toggle(log.id)}
            />
            {/* One line of aligned facts on a wide list; the same facts stacked on a narrow one. */}
            <Pressable
              className={cn(
                'grid min-w-0 flex-1 gap-x-5 gap-y-0.5 rounded-sm',
                '@3xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,1.4fr)_minmax(0,0.8fr)] @3xl:items-baseline',
              )}
              aria-current={activeId === log.id}
              onClick={() => openLog(log.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
                <span className="truncate">
                  {log.label ?? log.boss ?? t(($) => $.library.encounter)}
                </span>
                {library.fresh.includes(log.id) && (
                  <Badge shape="tag" tone="accent" dot="live">
                    {t(($) => $.library.new)}
                  </Badge>
                )}
              </span>
              <span className="min-w-0 truncate text-2xs text-ink-3 @3xl:text-xs">
                {fmt.dateTime(log.started_ms)} · {clock(log.duration_ms)}
                {log.boss && log.boss !== (log.label ?? log.boss) ? ` · ${log.boss}` : ''}
              </span>
              <span className="min-w-0 text-xs text-ink-2 figures">
                <b className="font-semibold text-accent">{fmt.maybe(log.dps, fmt.compact)}</b> DPS ·{' '}
                {t(($) => $.library.damage, { damage: fmt.maybe(log.damage, fmt.compact) })} ·{' '}
                {log.players === null
                  ? t(($) => $.library.playersUnknown, { unknown: UNKNOWN })
                  : t(($) => $.library.players, { count: log.players })}
              </span>
              <small className="text-2xs text-ink-3 @3xl:text-right @3xl:text-xs">
                {endReason(t, log.end_reason)}
              </small>
            </Pressable>
          </li>
        ))}
      </ul>
      {!logs.length && !library.loading && (
        <EmptyState
          compact
          title={filtered ? t(($) => $.library.noMatch) : t(($) => $.library.emptyTitle)}
          icon={<Icon name={filtered ? 'binoculars' : 'book'} size={18} />}
        >
          {filtered
            ? t(($) => $.library.noMatchBody)
            : settings?.auto_save
              ? t(($) => $.library.emptyAutoSave)
              : t(($) => $.library.emptyManual)}
        </EmptyState>
      )}
      {(library.offset > 0 || library.hasMore) && (
        <div className="flex items-center justify-center gap-3 text-xs text-ink-3 figures">
          <Button
            size="xs"
            icon={<Icon name="chevronLeft" size={12} />}
            disabled={library.offset === 0}
            onClick={() => library.setOffset(Math.max(0, library.offset - PAGE_SIZE))}
          >
            {t(($) => $.library.newer)}
          </Button>
          <span>
            {fmt.integer.format(library.offset + 1)}–
            {fmt.integer.format(library.offset + logs.length)}
          </span>
          <Button
            size="xs"
            disabled={!library.hasMore}
            onClick={() => library.setOffset(library.offset + PAGE_SIZE)}
          >
            {t(($) => $.library.older)}
            <Icon name="chevronRight" size={12} />
          </Button>
        </div>
      )}
    </Panel>
  );
}
