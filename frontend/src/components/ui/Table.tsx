import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { Icon } from './Icon';

/*
 * Cell look shared by every data table: caps headers, hairline rows, tabular figures.
 * Text columns align left, numbers right.
 */
export const tableCell = 'border-b border-line px-2.5 py-2 whitespace-nowrap';
export const tableHead = cn(
  tableCell,
  'sticky top-0 z-[1] bg-surface-2 text-2xs font-semibold tracking-caps text-ink-3 uppercase',
);
export const tableSticky = 'sticky left-0 z-[2] bg-surface';
/** Scrolling frame of a table; the classes above are exported for hand-built tables. */
export const tableScroll = 'max-w-full overflow-x-auto rounded-lg border border-line';
/** Row wash on hover for hand-built tables. */
export const tableRow = 'transition-colors duration-100 last:[&>td]:border-b-0 hover:bg-row-hover';

export interface Column<Row> {
  key: string;
  label: string;
  title?: string | undefined;
  /** Text-aligned (left) column; numbers are right aligned. */
  text?: boolean;
  sticky?: boolean;
  render: (row: Row) => ReactNode;
  /** Sort value; omit for unsortable columns. Nulls always sort last. */
  sort?: (row: Row) => number | string | null;
}

/** Scrollable, sortable data table with optional row selection. */
export function SortTable<Row>({
  columns,
  rows,
  rowKey,
  label,
  initialSort,
  selected,
  onSelect,
  empty,
  dense = false,
  className,
}: {
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  label: string;
  initialSort?: { key: string; desc: boolean };
  selected?: string | null;
  onSelect?: (row: Row) => void;
  empty?: ReactNode;
  dense?: boolean;
  className?: string;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    const column = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !column?.sort) return rows;
    const by = column.sort;
    return [...rows].sort((a, b) => {
      const x = by(a);
      const y = by(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      const order =
        typeof x === 'string' || typeof y === 'string' ? String(x).localeCompare(String(y)) : x - y;
      return sort.desc ? -order : order;
    });
  }, [rows, columns, sort]);
  const pad = dense ? 'px-2 py-1.5' : undefined;
  return (
    <div data-ui="table-scroll" className={cn(tableScroll, className)}>
      <table
        data-ui="table"
        className="w-full border-collapse text-sm tabular-nums"
        aria-label={label}
      >
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              return (
                <th
                  key={column.key}
                  scope="col"
                  title={column.title}
                  className={cn(
                    tableHead,
                    pad,
                    column.text ? 'text-left' : 'text-right',
                    column.sticky && 'left-0 z-[3]',
                  )}
                  aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : undefined}
                >
                  {column.sort ? (
                    <ButtonPrimitive
                      type="button"
                      data-ui="sort"
                      className={cn(
                        'inline-flex cursor-pointer items-center gap-1 uppercase transition-colors hover:text-ink',
                        active && 'text-ink',
                        'focus-visible:outline-2 focus-visible:outline-focus',
                      )}
                      onClick={() =>
                        setSort({ key: column.key, desc: active ? !sort.desc : !column.text })
                      }
                    >
                      {column.label}
                      <span aria-hidden="true" className="inline-block w-2.5 text-accent">
                        {active && (
                          <Icon
                            name={sort.desc ? 'chevronDown' : 'chevronUp'}
                            size={10}
                            strokeWidth={2.4}
                          />
                        )}
                      </span>
                    </ButtonPrimitive>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const k = rowKey(row);
            const isSelected = selected === k;
            return (
              <tr
                key={k}
                data-selected={isSelected || undefined}
                className={cn(
                  'group/row transition-colors duration-100 last:[&>td]:border-b-0 hover:bg-row-hover',
                  onSelect && 'cursor-pointer',
                  isSelected && 'bg-row-selected',
                )}
                aria-selected={onSelect ? isSelected : undefined}
                onClick={onSelect ? () => onSelect(row) : undefined}
              >
                {columns.map((column, index) => (
                  <td
                    key={column.key}
                    className={cn(
                      tableCell,
                      pad,
                      column.text ? 'text-left' : 'text-right',
                      column.sticky && tableSticky,
                      column.sticky && 'group-data-selected/row:bg-row-selected-solid',
                      index === 0 && isSelected && 'shadow-[inset_2px_0_0_var(--color-accent)]',
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {!rows.length && empty}
    </div>
  );
}

/** Plain, unsorted table: first column text, the rest numbers. */
export function DataTable({
  headings,
  rows,
  className,
}: {
  headings: string[];
  rows: { key: string; cells: ReactNode[] }[];
  className?: string;
}) {
  return (
    <table data-ui="table" className={cn('w-full border-collapse text-sm tabular-nums', className)}>
      <thead>
        <tr>
          {headings.map((heading, index) => (
            <th
              key={heading}
              scope="col"
              className={cn(tableHead, 'static bg-transparent', index ? 'text-right' : 'text-left')}
            >
              {heading}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="last:[&>td]:border-b-0 hover:bg-row-hover">
            {row.cells.map((cellContent, column) => (
              <td
                key={headings[column]}
                className={cn(tableCell, column ? 'text-right' : 'text-left')}
              >
                {cellContent}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
