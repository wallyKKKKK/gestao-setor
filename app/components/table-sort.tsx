'use client';

import { useState, type ReactNode, type ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { nextReallocationSort, sortReallocationRows, type ReallocationSortRule } from '@/lib/reallocation-table-sort';

export function useColumnSort() {
  const [rules, setRules] = useState<ReallocationSortRule<string>[]>([]);
  return {
    rules,
    toggle: (column: string, direction?: 'asc' | 'desc') => setRules(current => nextReallocationSort(current, column, direction)),
    clear: () => setRules([]),
    sortRows: <Row,>(rows: Row[], getValue: (row: Row, column: string) => string | number | null | undefined) =>
      sortReallocationRows(rows, rules, (row, column) => getValue(row, column) ?? ''),
    sortRowsBy: <Row,>(rows: Row[], values: (row: Row) => Record<string, string | number | null | undefined>) =>
      rules.length ? sortReallocationRows(rows.map(row => ({ row, values: values(row) })), rules,
        (entry, column) => entry.values[column] ?? '').map(entry => entry.row) : rows,
  };
}

export type ColumnSort = ReturnType<typeof useColumnSort>;

export function columnSortDescription(sort: ColumnSort, column: string) {
  const index = sort.rules.findIndex(rule => rule.key === column);
  return index < 0 ? '' : `Prioridade ${index + 1}: ordem ${sort.rules[index].direction === 'asc' ? 'crescente' : 'decrescente'}.`;
}

export function columnSortHeaderProps(sort: ColumnSort, column: string): ThHTMLAttributes<HTMLTableCellElement> {
  const primary = sort.rules[0];
  return {
    scope: 'col',
    tabIndex: 0,
    'aria-sort': primary?.key === column ? primary.direction === 'asc' ? 'ascending' : 'descending' : undefined,
    title: `${columnSortDescription(sort, column)} Duplo clique para ordenar. Esc para limpar.`.trim(),
    onDoubleClick: () => sort.toggle(column),
    onKeyDown: event => {
      if (event.target !== event.currentTarget) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        sort.toggle(column);
      } else if (event.key === 'Escape' && sort.rules.length) {
        event.preventDefault();
        event.stopPropagation();
        sort.clear();
      }
    },
  };
}

export function TableSortIndicator({ sort, column }: { sort: ColumnSort; column: string }) {
  const index = sort.rules.findIndex(rule => rule.key === column);
  if (index < 0) return null;
  const Arrow = sort.rules[index].direction === 'asc' ? ArrowUp : ArrowDown;
  return <>
    <span aria-hidden="true" className="ml-1 inline-flex items-center gap-0.5 align-middle tabular-nums text-blue-700">
      <Arrow size={11} /><span>{index + 1}</span>
    </span>
    <span className="sr-only">{columnSortDescription(sort, column)}</span>
  </>;
}

export function SortableTableHeader({ sort, column, children, className, ...rest }: ThHTMLAttributes<HTMLTableCellElement> & {
  sort: ColumnSort; column: string; children?: ReactNode;
}) {
  return <th {...rest} {...columnSortHeaderProps(sort, column)} className={`select-none ${className ?? ''}`}>
    {children ?? column}<TableSortIndicator sort={sort} column={column} />
  </th>;
}

export function SortableGridHeader({ sort, column, label, className }: {
  sort: ColumnSort; column: string; label: string; className?: string;
}) {
  const description = columnSortDescription(sort, column);
  return <button type="button" className={className}
    title={`${description} Duplo clique para ordenar. Esc para limpar.`.trim()}
    aria-label={`${label}${description ? `. ${description}` : ''}`}
    onDoubleClick={() => sort.toggle(column)}
    onClick={event => { if (event.detail === 0) sort.toggle(column); }}
    onKeyDown={event => {
      if (event.key !== 'Escape' || !sort.rules.length) return;
      event.preventDefault();
      event.stopPropagation();
      sort.clear();
    }}>
    <span className="truncate">{label}</span><TableSortIndicator sort={sort} column={column} />
  </button>;
}
