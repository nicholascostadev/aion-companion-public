import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type WheelEvent,
} from 'react';
import { Badge } from '../../components/ui/Badge';
import { Meter } from '../../components/ui/Data';
import { EmptyState } from '../../components/ui/Feedback';
import { Icon } from '../../components/ui/Icon';
import { WindowButton } from '../../components/ui/Overlay';
import { Pressable } from '../../components/ui/Pressable';
import { useFormat, useTranslation } from '../../i18n/provider';
import { cn } from '../../lib/cn';
import type { Board, BoardNode, BoardSummary, Lazy, Skill } from '../../types/profile';
import { boardSkillEffects, gradeStyle, nearestNode } from './model';
import { Facts, GradeWord, OfficialArt, SectionTitle, initial, useEscape } from './parts';
import { ErrorLine } from './states';

const MIN_CELL = 12;
const MAX_CELL = 72;
const ZOOM_STEP = 1.25;

const clampCell = (cell: number) => Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(cell)));

/** One node: a circle for a stat, a diamond for a skill level, a ringed seed for the start. */
function NodeMark({
  node,
  cell,
  selected,
  focusable,
  label,
  onChoose,
  onFocus,
  onKeyDown,
  refFor,
}: {
  node: BoardNode;
  cell: number;
  selected: boolean;
  focusable: boolean;
  label: string;
  onChoose: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  refFor: (el: HTMLButtonElement | null) => void;
}) {
  const style = gradeStyle(node.grade);
  const size = Math.max(8, Math.round(cell * (node.kind === 'skill' ? 0.56 : 0.66)));
  return (
    <Pressable
      ref={refFor}
      tabIndex={focusable ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-node={node.id}
      data-open={node.open || undefined}
      className="flex items-center justify-center rounded-full"
      style={{ gridRow: node.row, gridColumn: node.col, width: cell, height: cell }}
      onClick={onChoose}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <span
        aria-hidden="true"
        className={cn(
          'flex items-center justify-center border-2 transition-transform duration-150 ease-grow',
          node.kind === 'skill' ? 'rotate-45 rounded-xs' : 'rounded-full',
          node.open ? cn(style.fill, 'border-ink/70') : cn(style.edge, 'bg-shade/60 opacity-70'),
          selected && 'scale-125 outline-2 outline-offset-2 outline-accent',
        )}
        style={{ width: size, height: size }}
      >
        {node.kind === 'start' && <span className="size-1/3 rounded-full bg-ink" />}
      </span>
    </Pressable>
  );
}

/** Words for a node: its name, grade, kind and state, for the label and the detail. */
function useNodeWords() {
  const { t } = useTranslation('profile');
  return {
    kind: (node: BoardNode) =>
      node.kind === 'stat' || node.kind === 'skill' || node.kind === 'start'
        ? t(($) => $.daevanion.kinds[node.kind as 'stat'])
        : node.kind,
    label: (node: BoardNode) =>
      t(($) => $.daevanion.nodeLabel, {
        name: node.name || node.effects.join(', '),
        state: node.open ? t(($) => $.daevanion.open) : t(($) => $.daevanion.closed),
        row: node.row,
        col: node.col,
      }),
  };
}

function BoardCanvas({
  board,
  selected,
  onSelect,
  tools,
}: {
  board: Board;
  selected: BoardNode | null;
  onSelect: (node: BoardNode | null) => void;
  /** More toolbar controls, after zoom and fit. */
  tools?: ReactNode;
}) {
  const { t } = useTranslation('profile');
  const words = useNodeWords();
  const frame = useRef<HTMLFieldSetElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  /** A zoom the user chose; null fits the board to the frame. */
  const [zoomed, setZoomed] = useState<number | null>(null);
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );
  /** Set by a pan, so the click that ends it never chooses the node under the pointer. */
  const panned = useRef(false);
  const nodes = board.nodes.filter((n) => n.kind !== 'empty');
  const empty = board.nodes.filter((n) => n.kind === 'empty');
  const start = nodes.find((n) => n.kind === 'start') ?? nodes[0] ?? null;
  const tabStop = focusId ?? selected?.id ?? start?.id ?? null;

  // The frame follows the window; a fitted board refits as it resizes.
  useEffect(() => {
    const el = frame.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      setFrameSize({ width: el.clientWidth, height: el.clientHeight }),
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const fit =
    frameSize && board.cols && board.rows
      ? clampCell(
          Math.min((frameSize.width - 16) / board.cols, (frameSize.height - 16) / board.rows),
        )
      : 28;
  const size = zoomed ?? fit;
  const zoom = (factor: number) => setZoomed(clampCell(size * factor));

  const move = (event: KeyboardEvent, node: BoardNode) => {
    const next = nearestNode(nodes, node, event.key);
    if (!next) return;
    event.preventDefault();
    setFocusId(next.id);
    buttons.current.get(next.id)?.focus();
    buttons.current.get(next.id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onPointerDown = (event: PointerEvent<HTMLFieldSetElement>) => {
    const el = frame.current;
    if (!el || event.button !== 0) return;
    panned.current = false;
    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
      moved: false,
    };
  };
  const onPointerMove = (event: PointerEvent<HTMLFieldSetElement>) => {
    const el = frame.current;
    const d = drag.current;
    if (!el || !d) return;
    const dx = event.clientX - d.x;
    const dy = event.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved) el.setPointerCapture(event.pointerId);
    d.moved = true;
    el.scrollLeft = d.left - dx;
    el.scrollTop = d.top - dy;
  };
  const onPointerUp = (event: PointerEvent<HTMLFieldSetElement>) => {
    panned.current = drag.current?.moved ?? false;
    drag.current = null;
    if (frame.current?.hasPointerCapture(event.pointerId))
      frame.current.releasePointerCapture(event.pointerId);
  };
  const onWheel = (event: WheelEvent<HTMLFieldSetElement>) => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    zoom(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1">
        <WindowButton
          size="xs"
          title={t(($) => $.daevanion.zoomOut)}
          aria-label={t(($) => $.daevanion.zoomOut)}
          disabled={size <= MIN_CELL}
          onClick={() => zoom(1 / ZOOM_STEP)}
        >
          <Icon name="zoomOut" />
        </WindowButton>
        <WindowButton
          size="xs"
          title={t(($) => $.daevanion.zoomIn)}
          aria-label={t(($) => $.daevanion.zoomIn)}
          disabled={size >= MAX_CELL}
          onClick={() => zoom(ZOOM_STEP)}
        >
          <Icon name="zoomIn" />
        </WindowButton>
        <WindowButton
          size="xs"
          title={t(($) => $.daevanion.fit)}
          aria-label={t(($) => $.daevanion.fit)}
          aria-pressed={zoomed === null}
          onClick={() => setZoomed(null)}
        >
          <Icon name="fit" />
        </WindowButton>
        {tools}
        <ul
          className="m-0 ml-auto flex list-none flex-wrap items-center gap-x-2.5 gap-y-0.5 p-0 text-2xs text-ink-3"
          aria-label={t(($) => $.daevanion.legend)}
        >
          <li className="flex items-center gap-1">
            <span className="size-2.5 rounded-full border-2 border-ink-3" aria-hidden="true" />
            {t(($) => $.daevanion.kinds.stat)}
          </li>
          <li className="flex items-center gap-1">
            <span
              className="size-2 rotate-45 rounded-xs border-2 border-ink-3"
              aria-hidden="true"
            />
            {t(($) => $.daevanion.kinds.skill)}
          </li>
          <li className="flex items-center gap-1">
            <span className="size-2.5 rounded-full bg-ink-2" aria-hidden="true" />
            {t(($) => $.daevanion.open)}
          </li>
          <li className="flex items-center gap-1">
            <span
              className="size-2.5 rounded-full border-2 border-ink-4 opacity-70"
              aria-hidden="true"
            />
            {t(($) => $.daevanion.closed)}
          </li>
        </ul>
      </div>
      <fieldset
        ref={frame}
        aria-label={t(($) => $.daevanion.boardLabel)}
        className="relative m-0 min-h-40 min-w-0 flex-1 cursor-grab overflow-auto rounded-sm border border-line-soft bg-sunken active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (drag.current = null)}
        onWheel={onWheel}
        onClickCapture={(event) => {
          if (!panned.current) return;
          panned.current = false;
          event.stopPropagation();
          event.preventDefault();
        }}
      >
        <div
          className="m-auto grid w-max p-2"
          style={{
            gridTemplateColumns: `repeat(${board.cols}, ${size}px)`,
            gridTemplateRows: `repeat(${board.rows}, ${size}px)`,
          }}
        >
          {empty.map((n) => (
            <span
              key={n.id}
              aria-hidden="true"
              className="flex items-center justify-center"
              style={{ gridRow: n.row, gridColumn: n.col }}
            >
              <span className="size-0.5 rounded-full bg-line" />
            </span>
          ))}
          {nodes.map((n) => (
            <NodeMark
              key={n.id}
              node={n}
              cell={size}
              selected={selected?.id === n.id}
              focusable={tabStop === n.id}
              label={words.label(n)}
              onChoose={() => onSelect(selected?.id === n.id ? null : n)}
              onFocus={() => setFocusId(n.id)}
              onKeyDown={(event) => move(event, n)}
              refFor={(el) => {
                if (el) buttons.current.set(n.id, el);
                else buttons.current.delete(n.id);
              }}
            />
          ))}
        </div>
      </fieldset>
      <p className="m-0 text-2xs text-ink-4">{t(($) => $.daevanion.howTo)}</p>
    </div>
  );
}

/** What the chosen node does, or the board's open effects when none is chosen. */
function BoardSide({
  board,
  summary,
  node,
  skills,
  onClear,
}: {
  board: Board;
  summary: BoardSummary;
  node: BoardNode | null;
  skills: readonly Skill[];
  onClear: () => void;
}) {
  const { t } = useTranslation('profile');
  const words = useNodeWords();
  if (node)
    return (
      <article className="flex flex-col gap-2" aria-label={t(($) => $.daevanion.nodeDetail)}>
        <header className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="m-0 text-md leading-tight font-semibold text-ink">
              {node.name || words.kind(node)}
            </h3>
            <p className="m-0 mt-0.5 text-xs text-ink-3">
              <GradeWord grade={node.grade} /> · {words.kind(node)}
            </p>
          </div>
          <WindowButton
            size="2xs"
            close
            title={t(($) => $.actions.closeDetail)}
            aria-label={t(($) => $.actions.closeDetail)}
            onClick={onClear}
          >
            <Icon name="close" size={12} />
          </WindowButton>
        </header>
        <Facts
          rows={[
            [
              t(($) => $.daevanion.state),
              node.open ? t(($) => $.daevanion.open) : t(($) => $.daevanion.closed),
            ],
            [
              t(($) => $.daevanion.position),
              t(($) => $.daevanion.rowCol, { row: node.row, col: node.col }),
            ],
          ]}
        />
        <section>
          <SectionTitle>{t(($) => $.daevanion.effects)}</SectionTitle>
          {node.effects.length ? (
            <ul className="m-0 list-none p-0 text-xs text-ink-2">
              {node.effects.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-xs text-ink-4">{t(($) => $.daevanion.noEffects)}</p>
          )}
        </section>
      </article>
    );
  const split = boardSkillEffects(board, skills);
  const groups = [
    ['activeSkills', split.active],
    ['passiveSkills', split.passive],
    ['otherSkills', split.other],
    ['stats', board.statEffects],
  ] as const;
  return (
    <article className="flex flex-col gap-3" aria-label={t(($) => $.daevanion.activeEffects)}>
      <header>
        <h3 className="m-0 text-md font-semibold text-ink">{summary.name}</h3>
        <p className="m-0 text-xs text-ink-3 figures">
          {t(($) => $.daevanion.openOf, { open: summary.openNodes, total: summary.totalNodes })}
        </p>
      </header>
      {groups
        .filter(([, list]) => list.length > 0)
        .map(([key, list]) => (
          <section key={key}>
            <SectionTitle count={list.length}>
              {t(($) => $.daevanion.effectGroups[key])}
            </SectionTitle>
            <ul className="m-0 list-none p-0 text-xs text-ink-2">
              {list.map((e, i) => (
                <li key={`${e}${i}`} className="border-t border-line-soft py-0.5 first:border-t-0">
                  {e}
                </li>
              ))}
            </ul>
          </section>
        ))}
      {groups.every(([, list]) => list.length === 0) && (
        <p className="m-0 text-xs text-ink-4">{t(($) => $.daevanion.noOpenEffects)}</p>
      )}
    </article>
  );
}

/**
 * The six Daevanion boards: a selector, the chosen board's node grid at the service's own
 * rows and columns (pan, zoom, fit, full size), and what its open nodes add. Node art is not
 * served by the official host, so nodes are drawn by kind with a written legend.
 */
export function DaevanionTab({
  summaries,
  boards,
  skills,
  onLoadBoard,
}: {
  summaries: BoardSummary[];
  boards: Record<number, Lazy<Board>>;
  skills: readonly Skill[];
  onLoadBoard: (id: number, again?: boolean) => void;
}) {
  const { t } = useTranslation('profile');
  const fmt = useFormat();
  const [chosen, setChosen] = useState<number | null>(summaries[0]?.id ?? null);
  const [node, setNode] = useState<BoardNode | null>(null);
  const [full, setFull] = useState(false);
  const summary = summaries.find((s) => s.id === chosen) ?? null;
  const lazy = chosen !== null ? boards[chosen] : undefined;
  const board = lazy?.data ?? null;
  /** The chosen node as the board shown now has it (a Refresh reads the board again). */
  const picked = board && node ? (board.nodes.find((n) => n.id === node.id) ?? null) : null;
  useEscape(picked ? () => setNode(null) : full ? () => setFull(false) : undefined);

  useEffect(() => {
    if (chosen !== null) onLoadBoard(chosen);
  }, [chosen, onLoadBoard]);

  if (!summaries.length)
    return (
      <div className="p-3">
        <EmptyState
          compact
          icon={<Icon name="daevanion" size={16} />}
          title={t(($) => $.daevanion.none)}
        />
      </div>
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      {!full && (
        <fieldset
          aria-label={t(($) => $.daevanion.boards)}
          className="m-0 flex min-w-0 gap-1 overflow-x-auto border-0 p-0 pb-0.5"
        >
          {summaries.map((s) => {
            const on = s.id === chosen;
            return (
              <Pressable
                key={s.id}
                aria-pressed={on}
                aria-label={t(($) => $.daevanion.boardTile, {
                  name: s.name,
                  open: s.openNodes,
                  total: s.totalNodes,
                })}
                className={cn(
                  'flex min-w-28 flex-1 flex-col gap-1 rounded-sm border px-2 py-1.5',
                  on ? 'border-accent-line bg-accent-soft' : 'border-line-soft hover:bg-row-hover',
                )}
                onClick={() => {
                  setChosen(s.id);
                  setNode(null);
                }}
              >
                <span className="flex items-center gap-1.5">
                  <OfficialArt
                    url={s.icon}
                    size={18}
                    fallback={initial(s.name)}
                    className="rounded-xs"
                  />
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
                    {s.name}
                  </span>
                  {!s.open && <Icon name="lock" size={11} className="text-ink-3" />}
                </span>
                <span className="flex items-center gap-1.5">
                  <Meter
                    size="xs"
                    fraction={s.totalNodes ? s.openNodes / s.totalNodes : null}
                    label={t(($) => $.daevanion.progress, { name: s.name })}
                  />
                  <span className="text-3xs text-ink-3 figures">
                    {s.openNodes}/{s.totalNodes}
                  </span>
                </span>
              </Pressable>
            );
          })}
        </fieldset>
      )}

      {summary && !summary.open && (
        <p className="m-0 flex items-center gap-1.5 text-xs text-ink-3">
          <Badge tone="neutral" shape="tag">
            <Icon name="lock" size={10} /> {t(($) => $.daevanion.locked)}
          </Badge>
          {t(($) => $.daevanion.lockedHint, { total: fmt.integer.format(summary.totalNodes) })}
        </p>
      )}
      {lazy?.state === 'error' && chosen !== null && (
        <ErrorLine
          error={lazy.error}
          what={t(($) => $.daevanion.what)}
          onRetry={() => onLoadBoard(chosen, true)}
        />
      )}
      {!board && lazy?.state !== 'error' && (
        <EmptyState
          compact
          icon={<Icon name="loader" size={16} className="animate-spin" />}
          title={t(($) => $.daevanion.loading)}
        />
      )}

      {board && summary && (
        <div
          className={cn(
            'relative grid min-h-0 flex-1 gap-3',
            !full && '@min-[40rem]:grid-cols-[minmax(0,1fr)_16rem]',
          )}
        >
          <div className="flex min-h-0 flex-col">
            <BoardCanvas
              key={`${board.id}-${full}`}
              board={board}
              selected={picked}
              onSelect={setNode}
              tools={
                <WindowButton
                  size="xs"
                  aria-pressed={full}
                  title={full ? t(($) => $.daevanion.exitFull) : t(($) => $.daevanion.full)}
                  aria-label={full ? t(($) => $.daevanion.exitFull) : t(($) => $.daevanion.full)}
                  onClick={() => setFull((f) => !f)}
                >
                  <Icon name={full ? 'exitFullscreen' : 'fullscreen'} />
                </WindowButton>
              }
            />
          </div>
          {!full && (
            <div className="min-h-0 overflow-y-auto rounded-sm border border-line-soft bg-surface-2 p-2.5">
              <BoardSide
                board={board}
                summary={summary}
                node={picked}
                skills={skills}
                onClear={() => setNode(null)}
              />
            </div>
          )}
          {full && picked && (
            <div className="absolute right-4 bottom-4 z-10 w-64 rounded-sm border border-line bg-shade/95 p-2.5 shadow-3">
              <BoardSide
                board={board}
                summary={summary}
                node={picked}
                skills={skills}
                onClear={() => setNode(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
