import React from 'react';
import { ArrowUpDown } from 'lucide-react';

export function DataTable({
  columns,
  data,
  onRowClick,
  emptyMessage = 'No records found',
  sortColumn,
  sortDirection,
  onSort
}) {
  return (
    <div className="w-full overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-900/40">
      <table className="w-full text-left text-xs">
        <thead className="bg-zinc-900/80 border-b border-zinc-800 text-zinc-400 font-medium">
          <tr>
            {columns.map((col, idx) => (
              <th
                key={idx}
                className={`py-2.5 px-3.5 tracking-wide ${col.align === 'right' ? 'text-right' : ''} ${
                  col.sortable ? 'cursor-pointer hover:text-zinc-200 select-none' : ''
                }`}
                onClick={() => col.sortable && onSort && onSort(col.key)}
              >
                <div className={`inline-flex items-center gap-1.5 ${col.align === 'right' ? 'justify-end w-full' : ''}`}>
                  <span>{col.header}</span>
                  {col.sortable && (
                    <ArrowUpDown size={11} className="opacity-60" />
                  )}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60 font-mono">
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="py-8 text-center text-zinc-500 font-sans">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIdx) => (
              <tr
                key={row.id || rowIdx}
                onClick={() => onRowClick && onRowClick(row)}
                className={`transition-colors ${
                  onRowClick ? 'cursor-pointer hover:bg-zinc-850/60' : 'hover:bg-zinc-900/30'
                }`}
              >
                {columns.map((col, colIdx) => (
                  <td
                    key={colIdx}
                    className={`py-3 px-3.5 text-zinc-300 ${col.align === 'right' ? 'text-right' : ''}`}
                  >
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
