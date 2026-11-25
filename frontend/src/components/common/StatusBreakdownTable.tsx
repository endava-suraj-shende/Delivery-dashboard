import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/common/DataTable'
import type { StackSeries } from '@/components/charts'
import { cn, colorFor } from '@/lib/utils'
import type { GroupedRow } from '@/types'

const right = { meta: { align: 'right' } } as const

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

const AVATAR = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500']
function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR[h % AVATAR.length]
}

function Pill({ value, color, strong }: { value: number; color: string; strong?: boolean }) {
  if (!value) return <span className="inline-block min-w-[2rem] text-center tabular-nums text-muted-foreground/40">0</span>
  return (
    <span className={cn('inline-block min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs tabular-nums', strong && 'font-semibold')} style={{ background: `${color}1a`, color }}>
      {value}
    </span>
  )
}

/**
 * One row per entity (employee / project) with a colour-coded count per status and a total with share bar.
 * Status columns come from `series`; empty columns are hidden.
 */
export function StatusBreakdownTable({ rows, series, entityLabel = 'Employee', onRow, pageSize = 10, exportName = 'status-breakdown', avatars = true, strongKeys = ['blocked', 'failed'] }: { rows: GroupedRow[]; series: StackSeries[]; entityLabel?: string; onRow?: (name: string) => void; pageSize?: number; exportName?: string; avatars?: boolean; strongKeys?: string[] }) {
  const active = useMemo(() => series.filter((s) => rows.some((r) => Number(r[s.key] ?? 0) > 0)), [rows, series])
  type Row = GroupedRow & { __total: number }
  const data = useMemo<Row[]>(() => rows.map((r) => ({ ...r, __total: active.reduce((t, s) => t + Number(r[s.key] ?? 0), 0) })), [rows, active])
  const maxTotal = Math.max(1, ...data.map((r) => r.__total))
  const columns = useMemo<ColumnDef<Row, unknown>[]>(() => {
    const entity: ColumnDef<Row, unknown> = {
      accessorKey: 'name',
      header: entityLabel,
      cell: ({ row }) => {
        const name = String(row.original.name)
        return (
          <span className="flex items-center gap-2.5 whitespace-nowrap">
            {avatars && <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white', avatarColor(name))}>{initials(name)}</span>}
            <span className="font-medium">{name}</span>
          </span>
        )
      },
    }
    const statusCols: ColumnDef<Row, unknown>[] = active.map((s, i) => {
      const color = colorFor(s.color, i)
      return {
        accessorKey: s.key,
        header: () => <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: color }} />{s.label}</span>,
        ...right,
        cell: ({ getValue }) => <Pill value={Number(getValue() ?? 0)} color={color} strong={strongKeys.includes(s.key)} />,
      }
    })
    const total: ColumnDef<Row, unknown> = {
      accessorKey: '__total',
      header: 'Total',
      cell: ({ row }) => {
        const r = row.original
        const segs = active.map((s, i) => ({ v: Number(r[s.key] ?? 0), c: colorFor(s.color, i) })).filter((x) => x.v > 0)
        return (
          <div className="flex min-w-[160px] items-center gap-2" title={active.map((s) => `${s.label}: ${r[s.key] ?? 0}`).join(', ')}>
            <span className="w-8 text-right font-semibold tabular-nums">{r.__total}</span>
            <div className="h-2 flex-1">
              <div className="flex h-full overflow-hidden rounded-full bg-muted" style={{ width: `${Math.max((100 * r.__total) / maxTotal, r.__total ? 3 : 0)}%` }}>
                {segs.map((x, i) => (
                  <span key={i} className="h-full" style={{ width: `${(100 * x.v) / r.__total}%`, background: x.c }} />
                ))}
              </div>
            </div>
          </div>
        )
      },
    }
    return [entity, ...statusCols, total]
  }, [active, avatars, entityLabel, maxTotal, strongKeys])
  return (
    <DataTable
      data={data}
      columns={columns}
      onRowClick={onRow ? (r) => onRow(String(r.name)) : undefined}
      pageSize={pageSize}
      dense
      exportName={exportName}
      searchPlaceholder={`Search ${entityLabel.toLowerCase()}`}
      initialSorting={[{ id: '__total', desc: true }]}
      rowClassName={(r) => (strongKeys.some((k) => Number(r[k] ?? 0) > 0) ? 'bg-red-500/[0.04]' : undefined)}
    />
  )
}
