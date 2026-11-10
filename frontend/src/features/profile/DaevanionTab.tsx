import {
  useEffect,
  useLayoutEffect,
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
import { DaevanionNodeIcon } from '../../components/ui/GameArt';
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
/**
 * The cell a board opens at when fitting it whole would draw it smaller: the art comes out at
 * about 31 px, close to the node detail's 36, so every node reads without zooming, while the
 * default 760 × 640 window still shows about a dozen cells across. A board that fits at this
 * size or larger opens fitted.
 */
const START_CELL = 36;
/** The board grid's padding (`p-2`), around the cells. */
const BOARD_PAD = 8;

/** The grades NCSOFT's character page draws node art for, in the game's order. */
const LEGEND_GRADES = ['common', 'rare', 'unique', 'legend'] as const;

const clampCell = (cell: number) => Math.min(MAX_CELL, Math.max(MIN_CELL, Math.round(cell)));

/** Closed nodes recede as on the official page (half opacity); the start node never does. */
const dimmed = (node: BoardNode) => !node.open && node.kind !== 'start';

/** A node's original art, or its grade-edged initial when art is missing or fails to load. */
function NodeArt({
  node,
  playerClass,
  size,
  mark,
  className,
}: {
  node: BoardNode;
  playerClass: string | null;
  size: number;
  /** The written stand-in: one letter of the node's name or kind. */
  mark: string;
  className?: string;
}) {
  const style = gradeStyle(node.grade);
  return (
    <DaevanionNodeIcon
      node={node}
      playerClass={playerClass}
      size={size}
      className={cn(dimmed(node) && 'opacity-50', className)}
      fallback={
        <span
          aria-hidden="true"
          data-art="label"
          className={cn(
            'inline-grid shrink-0 place-items-center rounded-xs border-2 leading-none font-semibold',
            size >= 28 ? 'text-xs' : 'text-4xs',
            node.open || node.kind === 'start'
              ? cn(style.edge, 'bg-surface-2 text-ink')
              : cn(style.edge, 'bg-shade/60 text-ink-3 opacity-70'),
            className,
          )}
          style={{ width: size, height: size }}
        >
          {mark}
        </span>
      }
    />
  );
}

/**
 * One node, drawn with the official art for its grade and state (the class's own art for the
 * start). The chosen node lights an accent ring inside its own cell, so it never covers a
 * neighbour.
 */
function NodeMark({
  node,
  playerClass,
  cell,
  selected,
  focusable,
  label,
  mark,
  onChoose,
  onFocus,
  onKeyDown,
  refFor,
}: {
  node: BoardNode;
  playerClass: string | null;
  cell: number;
  selected: boolean;
  focusable: boolean;
  label: string;
  mark: string;
  onChoose: () => void;
  onFocus: () => void;
  onKeyDown: (event: KeyboardEvent) => void;
  refFor: (el: HTMLButtonElement | null) => void;
}) {
  // Leave 3 px around the art for the 2 px ring and a hairline of air.
  const size = Math.max(6, Math.min(Math.round(cell * 0.86), cell - 6));
  return (
    <Pressable
      ref={refFor}
      tabIndex={focusable ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-node={node.id}
      data-open={node.open || undefined}
      className={cn(
        'flex items-center justify-center rounded-sm transition-colors duration-150 ease-grow',
        selected ? 'bg-accent-soft ring-2 ring-accent ring-inset' : 'hover:bg-row-hover',
      )}
      style={{ gridRow: node.row, gridColumn: node.col, width: cell, height: cell }}
      onClick={onChoose}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      <NodeArt node={node} playerClass={playerClass} size={size} mark={mark} />
    </Pressable>
  );
}

/** Words for a node: its name, grade, kind and state, for the label and the detail. */
function useNodeWords() {
  const { t } = useTranslation('profile');
  const kind = (node: BoardNode) =>
    node.kind === 'stat' || node.kind === 'skill' || node.kind === 'start'
      ? t(($) => $.daevanion.kinds[node.kind as 'stat'])
      : node.kind;
  return {
    kind,
    /** One letter written in place of missing art. */
    mark: (node: BoardNode) => initial(node.name || kind(node)),
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
  playerClass,
  selected,
  onSelect,
  tools,
}: {
  board: Board;
  playerClass: string | null;
  selected: BoardNode | null;
  onSelect: (node: BoardNode | null) => void;
  /** More toolbar controls, after zoom and fit. */
  tools?: ReactNode;
}) {
  const { t } = useTranslation('profile');
  const words = useNodeWords();
  const frame = useRef<HTMLFieldSetElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  /**
   * The zoom: 'start' opens at a readable size (fitted when the whole board is that large),
   * 'fit' shows the whole board, and a number is a cell size the user chose.
   */
  const [zoomed, setZoomed] = useState<'start' | 'fit' | number>('start');
  const [frameSize, setFrameSize] = useState<{ width: number; height: number } | null>(null);
  const [focusId, setFocusId] = useState<number | null>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(
    null,
  );
  /** Set by a pan, so the click that ends it never chooses the node under the pointer. */
  const panned = useRef(false);
  /** The board point, in cells, to keep at the frame's centre through a zoom. */
  const anchor = useRef<{ x: number; y: number } | null>(null);
  /**
   * Set once the user takes the view (pointer, wheel, zoom, fit or keys); until then the board
   * stays centred on home while the frame settles into the window.
   */
  const settled = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  const nodes = board.nodes.filter((n) => n.kind !== 'empty');
  const empty = board.nodes.filter((n) => n.kind === 'empty');
  const start = nodes.find((n) => n.kind === 'start') ?? nodes[0] ?? null;
  const tabStop = focusId ?? selected?.id ?? start?.id ?? null;
  /** The grades this board uses, in the game's order, for the key. */
  const grades = LEGEND_GRADES.filter((g) => nodes.some((n) => n.grade.toLowerCase() === g));
  const startNode = nodes.find((n) => n.kind === 'start');
  /** The cell point the board opens on: the node chosen when it opened, or the start. */
  const [home] = useState(() => {
    const node = selected ?? start;
    return node ? { x: node.col - 0.5, y: node.row - 0.5 } : null;
  });

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
  // Rounded down, so a fitted board never overflows its frame by a pixel and grows scroll bars.
  const fit =
    frameSize && board.cols && board.rows
      ? clampCell(
          Math.floor(
            Math.min(
              (frameSize.width - 2 * BOARD_PAD) / board.cols,
              (frameSize.height - 2 * BOARD_PAD) / board.rows,
            ),
          ),
        )
      : 28;
  const size = zoomed === 'fit' ? fit : zoomed === 'start' ? Math.max(fit, START_CELL) : zoomed;
  /** Whether the whole board is in view, which the Fit button shows. */
  const fitted = size <= fit;

  /** The cell point at the frame's centre, from where the board is laid out and scrolled. */
  const centrePoint = (el: HTMLElement) => ({
    x: (el.scrollLeft + el.clientWidth / 2 - (grid.current?.offsetLeft ?? 0) - BOARD_PAD) / size,
    y: (el.scrollTop + el.clientHeight / 2 - (grid.current?.offsetTop ?? 0) - BOARD_PAD) / size,
  });
  const zoom = (factor: number) => {
    const next = clampCell(size * factor);
    if (next === size) return;
    if (frame.current) anchor.current = centrePoint(frame.current);
    settled.current = true;
    setZoomed(next);
  };
  const fitBoard = () => {
    settled.current = true;
    setZoomed('fit');
  };

  // Scroll a board larger than the frame so a point sits at its centre: home while the board
  // opens (the frame can still be settling into the window), and the point that was centred
  // before a zoom.
  useLayoutEffect(() => {
    const el = frame.current;
    if (!el || !frameSize) return;
    const point = anchor.current ?? (settled.current ? null : home);
    anchor.current = null;
    if (!point) return;
    const at = (cells: number, offset: number, view: number) =>
      Math.max(0, Math.round(offset + BOARD_PAD + cells * size - view / 2));
    el.scrollLeft = at(point.x, grid.current?.offsetLeft ?? 0, el.clientWidth);
    el.scrollTop = at(point.y, grid.current?.offsetTop ?? 0, el.clientHeight);
  }, [size, frameSize, home]);

  const move = (event: KeyboardEvent, node: BoardNode) => {
    const next = nearestNode(nodes, node, event.key);
    if (!next) return;
    event.preventDefault();
    settled.current = true;
    setFocusId(next.id);
    buttons.current.get(next.id)?.focus();
    buttons.current.get(next.id)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };

  const onPointerDown = (event: PointerEvent<HTMLFieldSetElement>) => {
    const el = frame.current;
    if (!el || event.button !== 0) return;
    settled.current = true;
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
    settled.current = true;
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
          aria-pressed={fitted}
          onClick={fitBoard}
        >
          <Icon name="fit" />
        </WindowButton>
        {tools}
        <ul
          className="m-0 ml-auto flex min-w-0 list-none flex-wrap items-center gap-x-2.5 gap-y-0.5 p-0 text-2xs text-ink-3"
          aria-label={t(($) => $.daevanion.legend)}
        >
          {grades.map((g) => (
            <li key={g} className="flex items-center gap-1 whitespace-nowrap">
              <DaevanionNodeIcon
                node={{ kind: 'stat', grade: g, open: true }}
                playerClass={playerClass}
                size={14}
              />
              <GradeWord grade={g} className="font-normal" />
            </li>
          ))}
          {startNode && (
            <li className="flex items-center gap-1 whitespace-nowrap">
              <DaevanionNodeIcon node={startNode} playerClass={playerClass} size={14} />
              {t(($) => $.daevanion.kinds.start)}
            </li>
          )}
          <li className="flex items-center gap-1 whitespace-nowrap">
            <DaevanionNodeIcon
              node={{ kind: 'stat', grade: grades[0] ?? 'common', open: true }}
              playerClass={playerClass}
              size={14}
            />
            {t(($) => $.daevanion.open)}
          </li>
          <li className="flex items-center gap-1 whitespace-nowrap">
            <DaevanionNodeIcon
              node={{ kind: 'stat', grade: grades[0] ?? 'common', open: false }}
              playerClass={playerClass}
              size={14}
              className="opacity-50"
            />
            {t(($) => $.daevanion.closed)}
          </li>
        </ul>
      </div>
      <fieldset
        ref={frame}
        aria-label={t(($) => $.daevanion.boardLabel)}
        className="relative m-0 min-h-48 min-w-0 flex-1 cursor-grab overflow-auto rounded-sm border border-line-soft bg-sunken active:cursor-grabbing"
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
          ref={grid}
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
              playerClass={playerClass}
              cell={size}
              selected={selected?.id === n.id}
              focusable={tabStop === n.id}
              label={words.label(n)}
              mark={words.mark(n)}
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
  playerClass,
  summary,
  node,
  skills,
  onClear,
}: {
  board: Board;
  playerClass: string | null;
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
        <header className="flex items-start gap-2">
          <NodeArt
            node={node}
            playerClass={playerClass}
            size={36}
            mark={words.mark(node)}
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
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
 * rows and columns (pan, zoom, fit, full size), and what its open nodes add. Nodes use the
 * original art NCSOFT's character page draws (bundled, see docs/GAME_ARTWORK.md): each grade
 * closed or open, and the class's own start node, with a key naming the grades shown.
 */
export function DaevanionTab({
  summaries,
  boards,
  playerClass,
  skills,
  onLoadBoard,
}: {
  summaries: BoardSummary[];
  /** The character's class, which picks the start node's art. */
  playerClass: string | null;
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
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
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

      {/* Narrow, the board takes the height and the detail below it keeps to its own scroll;
          wide, the detail is a column beside the board. */}
      {board && summary && (
        <div
          className={cn(
            'relative flex min-h-0 flex-1 flex-col gap-3',
            !full &&
              '@min-[40rem]:grid @min-[40rem]:grid-cols-[minmax(0,1fr)_16rem] @min-[40rem]:grid-rows-[minmax(0,1fr)]',
          )}
        >
          <div className="flex min-h-64 min-w-0 flex-1 flex-col @min-[40rem]:min-h-0">
            <BoardCanvas
              key={`${board.id}-${full}`}
              board={board}
              playerClass={playerClass}
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
            <div className="max-h-44 min-h-20 min-w-0 overflow-y-auto rounded-sm border border-line-soft bg-surface-2 p-2.5 @min-[40rem]:max-h-none @min-[40rem]:min-h-0">
              <BoardSide
                board={board}
                playerClass={playerClass}
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
                playerClass={playerClass}
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
