import { useMemo, useState, type ReactNode } from 'react'
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type Row,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Download, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { EmptyState } from '@/components/common/States'
import { cn, downloadBlob, toCSV } from '@/lib/utils'

export interface DataTableProps<T> {
  data: T[]
  columns: ColumnDef<T, unknown>[]
  searchPlaceholder?: string
  pageSize?: number
  onRowClick?: (row: T) => void
  emptyTitle?: string
  emptyDescription?: string
  toolbar?: ReactNode
  exportName?: string
  dense?: boolean
  initialSorting?: SortingState
  rowClassName?: (row: T) => string | undefined
  columnFilters?: { id: string; label: string; options: { value: string; label: string }[] }[]
  stickyHeader?: boolean
  maxHeight?: string
}

export function DataTable<T>({
  data,
  columns,
  searchPlaceholder = 'Search',
  pageSize = 25,
  onRowClick,
  emptyTitle,
  emptyDescription,
  toolbar,
  exportName,
  dense,
  initialSorting = [],
  rowClassName,
  columnFilters: filterDefs,
  stickyHeader = true,
  maxHeight,
}: DataTableProps<T>) {
  const [sorting, setSorting] = useState<SortingState>(initialSorting)
  const [globalFilter, setGlobalFilter] = useState('')
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([])

  const table = useReactTable({
    data,
    columns,
    state: { sorting, globalFilter, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: 'includesString',
    initialState: { pagination: { pageSize } },
    autoResetPageIndex: false,
  })

  const rows = table.getRowModel().rows
  const filteredCount = table.getFilteredRowModel().rows.length
  const pageCount = table.getPageCount()
  const { pageIndex, pageSize: ps } = table.getState().pagination

  const exportCsv = () => {
    const visible = table.getFilteredRowModel().rows.map((r) => {
      const obj: Record<string, unknown> = {}
      r.getAllCells().forEach((c) => {
        const h = typeof c.column.columnDef.header === 'string' ? c.column.columnDef.header : c.column.id
        obj[h] = c.getValue()
      })
      return obj
    })
    downloadBlob(new Blob(['\ufeff' + toCSV(visible)], { type: 'text/csv;charset=utf-8' }), `${exportName ?? 'table'}.csv`)
  }

  const activeColFilters = useMemo(() => columnFilters.filter((f) => f.value), [columnFilters])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input value={globalFilter} onChange={(e) => setGlobalFilter(e.target.value)} placeholder={searchPlaceholder} className="h-9 w-56 pl-8" />
          {globalFilter && (
            <button className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground" onClick={() => setGlobalFilter('')} aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {filterDefs?.map((f) => (
          <NativeSelect
            key={f.id}
            className="h-9 w-auto min-w-[140px]"
            value={(table.getColumn(f.id)?.getFilterValue() as string) ?? ''}
            onChange={(e) => table.getColumn(f.id)?.setFilterValue(e.target.value || undefined)}
          >
            <option value="">{f.label}: all</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        ))}
        {activeColFilters.length > 0 && (
          <Button variant="ghost" size="sm" onClick={() => setColumnFilters([])}>
            <X /> Clear column filters
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          {toolbar}
          <span className="text-xs text-muted-foreground tabular-nums">
            {filteredCount.toLocaleString()} {filteredCount === 1 ? 'row' : 'rows'}
          </span>
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={!filteredCount} title="Export visible rows to CSV">
            <Download /> CSV
          </Button>
        </div>
      </div>

      <div className={cn('overflow-auto rounded-lg border shadow-sm', maxHeight)}>
        <table className="w-full caption-bottom text-sm">
          <thead className={cn('bg-muted/70 backdrop-blur', stickyHeader && 'sticky top-0 z-10')}>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id} className="border-b">
                {hg.headers.map((h) => {
                  const canSort = h.column.getCanSort()
                  const sorted = h.column.getIsSorted()
                  return (
                    <th
                      key={h.id}
                      style={{ width: h.getSize() !== 150 ? h.getSize() : undefined }}
                      className={cn('h-10 px-3 align-middle text-[11px] font-semibold uppercase tracking-wide text-muted-foreground whitespace-nowrap border-b-2 border-border', (h.column.columnDef.meta as { align?: string } | undefined)?.align === 'right' ? 'text-right' : 'text-left', canSort && 'cursor-pointer select-none hover:text-foreground', sorted && 'text-foreground')}
                      onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                    >
                      <span className="inline-flex items-center gap-1">
                        {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                        {canSort && (sorted === 'asc' ? <ArrowUp className="h-3 w-3" /> : sorted === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUpDown className="h-3 w-3 opacity-40" />)}
                      </span>
                    </th>
                  )
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} />
                </td>
              </tr>
            ) : (
              rows.map((row: Row<T>) => (
                <tr
                  key={row.id}
                  className={cn('border-b border-border/60 transition-colors odd:bg-background even:bg-muted/20 hover:bg-primary/[0.06]', onRowClick && 'cursor-pointer', rowClassName?.(row.original))}
                  onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cn('px-3 align-middle', dense ? 'py-2 text-xs' : 'py-2.5 text-sm', (cell.column.columnDef.meta as { align?: string } | undefined)?.align === 'right' && 'text-right')}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {filteredCount > ps && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>Rows per page</span>
            <NativeSelect className="h-7 w-[70px] text-xs" value={ps} onChange={(e) => table.setPageSize(Number(e.target.value))}>
              {[10, 25, 50, 100, 250].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="flex items-center gap-1">
            <span className="mr-2 tabular-nums">
              Page {pageIndex + 1} of {pageCount}
            </span>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.setPageIndex(0)} disabled={!table.getCanPreviousPage()}>
              <ChevronsLeft />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>
              <ChevronRight />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => table.setPageIndex(pageCount - 1)} disabled={!table.getCanNextPage()}>
              <ChevronsRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
