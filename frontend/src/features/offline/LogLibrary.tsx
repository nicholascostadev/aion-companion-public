import { useEffect, useRef, useState } from 'react';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { EmptyState, Notice } from '../../components/ui/Feedback';
import { Checkbox, Input, Select } from '../../components/ui/Field';
import { Icon } from '../../components/ui/Icon';
import { Panel } from '../../components/ui/Panel';
import { Pressable, selectableRow } from '../../components/ui/Pressable';
import { clock, UNKNOWN } from '../../i18n/formatters';
import { useFormat, useTranslation, type Translate } from '../../i18n/provider';
import {
  emptyFilters,
  PAGE_SIZE,
  type LibraryFilters,
  type LibraryNotice,
  type LogLibraryView,
} from './libraryModel';
import type { LogMeta, OfflineSettings } from '../../types/offline';
import { endReason } from './report/context';
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

export function LogLibrary({
  library,
  settings,
  native,
  libraryCount,
  onCompare,
  onCopySummary,
}: {
  library: LogLibraryView;
  settings: OfflineSettings | null;
  native: boolean;
  libraryCount: number | null;
  onCompare: (ids: string[]) => void;
  onCopySummary: (id: string) => (multiline: boolean) => Promise<void>;
}) {
  const { t } = useTranslation('reports');
  const fmt = useFormat();
  const { filters, logs, selected, setSelected, activeId, report } = library;
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<LibraryFilters>) => library.setFilters({ ...filters, ...patch });
  const filtered = JSON.stringify({ ...filters, sort: 'newest' }) !== JSON.stringify(emptyFilters);
  const allSelected = logs.length > 0 && logs.every((l) => selected.includes(l.id));
  const toggle = (id: string) =>
    setSelected(selected.includes(id) ? selected.filter((k) => k !== id) : [...selected, id]);
  const active = logs.find((l) => l.id === activeId) ?? null;

  if (!native)
    return (
      <EmptyState title={t(($) => $.library.nativeTitle)} icon={<Icon name="book" size={20} />}>
        {t(($) => $.library.nativeBody)}
      </EmptyState>
    );

  return (
    <div className="grid items-start gap-5 min-[900px]:grid-cols-[20rem_minmax(0,1fr)]">
      <Panel
        as="aside"
        aria-label={t(($) => $.library.title)}
        className="flex max-h-112 flex-col gap-3 min-[900px]:sticky min-[900px]:top-28 min-[900px]:max-h-[calc(100vh-8rem)]"
      >
        <div className="flex items-baseline justify-between gap-2">
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
        <div className="flex flex-col gap-1.5">
          <span className="relative flex">
            <Icon
              name="search"
              size={14}
              className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3"
            />
            <Input
              type="search"
              className="w-full pl-8"
              aria-label={t(($) => $.library.search)}
              placeholder={t(($) => $.library.searchPlaceholder)}
              value={filters.search}
              onChange={(e) => set({ search: e.target.value })}
            />
          </span>
          <div className="grid grid-cols-2 gap-1.5">
            <Input
              size="sm"
              aria-label={t(($) => $.library.bossLabel)}
              placeholder={t(($) => $.library.boss)}
              value={filters.boss}
              onChange={(e) => set({ boss: e.target.value })}
            />
            <Input
              size="sm"
              aria-label={t(($) => $.library.zoneLabel)}
              placeholder={t(($) => $.library.zone)}
              inputMode="numeric"
              value={filters.zone}
              onChange={(e) => set({ zone: e.target.value.replace(/\D/g, '') })}
            />
            <Input
              size="sm"
              aria-label={t(($) => $.library.fromDate)}
              type="date"
              value={filters.from}
              onChange={(e) => set({ from: e.target.value })}
            />
            <Input
              size="sm"
              aria-label={t(($) => $.library.toDate)}
              type="date"
              value={filters.to}
              onChange={(e) => set({ to: e.target.value })}
            />
            <Input
              size="sm"
              aria-label={t(($) => $.library.runLabel)}
              placeholder={t(($) => $.library.run)}
              value={filters.run}
              onChange={(e) => set({ run: e.target.value })}
            />
            <Select
              size="sm"
              aria-label={t(($) => $.library.sort)}
              value={filters.sort}
              onChange={(e) => set({ sort: e.target.value as LibraryFilters['sort'] })}
            >
              <option value="newest">{t(($) => $.library.sortNewest)}</option>
              <option value="damage">{t(($) => $.library.sortDamage)}</option>
              <option value="dps">{t(($) => $.library.sortDps)}</option>
            </Select>
          </div>
          {filtered && (
            <Button
              variant="link"
              className="self-start text-xs"
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
        {library.error && <Notice tone="error">{library.error}</Notice>}
        {library.notice && (
          <Notice tone="good" onDismiss={library.clearNotice}>
            {noticeText(t, library.notice)}
          </Notice>
        )}
        <ul
          className="-mx-1.5 m-0 flex list-none flex-col gap-0.5 overflow-auto p-0 px-1.5 transition-opacity aria-busy:opacity-70"
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
              {renaming === log.id ? (
                <RenameForm
                  log={log}
                  onRename={(label) => library.rename(log.id, label)}
                  onDone={() => setRenaming(null)}
                />
              ) : (
                <Pressable
                  className="flex min-w-0 flex-1 flex-col items-stretch gap-0.5 rounded-sm"
                  aria-current={activeId === log.id}
                  onClick={() => void library.open(log.id)}
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
                  <span className="text-2xs text-ink-3">
                    {fmt.dateTime(log.started_ms)} · {clock(log.duration_ms)}
                    {log.boss && log.boss !== log.label ? ` · ${log.boss}` : ''}
                  </span>
                  <span className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-ink-2 tabular-nums">
                    <b className="font-semibold text-accent">{fmt.maybe(log.dps, fmt.compact)}</b>{' '}
                    DPS ·{' '}
                    {t(($) => $.library.damage, { damage: fmt.maybe(log.damage, fmt.compact) })} ·{' '}
                    {log.players === null
                      ? t(($) => $.library.playersUnknown, { unknown: UNKNOWN })
                      : t(($) => $.library.players, { count: log.players })}
                    <small className="ml-auto text-2xs text-ink-3">
                      {endReason(t, log.end_reason)}
                    </small>
                  </span>
                </Pressable>
              )}
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
          <div className="flex items-center justify-center gap-3 text-xs text-ink-3 tabular-nums">
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
      <Panel padding="lg" className="min-w-0">
        {library.reportError && <Notice tone="error">{library.reportError}</Notice>}
        {report && activeId !== null ? (
          <ReportView
            report={report}
            settings={settings}
            native={native}
            onCopySummary={onCopySummary(activeId)}
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
        ) : library.reportLoading ? (
          <EmptyState
            live
            title={t(($) => $.library.opening)}
            icon={<Icon name="loader" size={20} className="animate-spin" />}
          />
        ) : (
          <EmptyState title={t(($) => $.library.selectTitle)} icon={<Icon name="book" size={20} />}>
            {t(($) => $.library.selectBody)}
          </EmptyState>
        )}
      </Panel>
    </div>
  );
}
