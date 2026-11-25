import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/common/DataTable'
import { cn, fmtDate, fmtNum } from '@/lib/utils'
import type { EmployeeRow } from '@/types'

const right = { meta: { align: 'right' } } as const

const TONE: Record<string, string> = {
  green: 'bg-green-500/10 text-green-700 dark:text-green-400',
  blue: 'bg-blue-500/10 text-blue-700 dark:text-blue-400',
  indigo: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
  purple: 'bg-purple-500/10 text-purple-700 dark:text-purple-400',
  teal: 'bg-teal-500/10 text-teal-700 dark:text-teal-400',
  orange: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
  yellow: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  red: 'bg-red-500/15 text-red-700 dark:text-red-400 font-semibold',
}

function Pill({ value, tone }: { value: number; tone: string }) {
  if (!value) return <span className="inline-block min-w-[2rem] text-center text-muted-foreground/40 tabular-nums">0</span>
  return <span className={cn('inline-block min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs tabular-nums', TONE[tone])}>{value}</span>
}

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

function EmployeeCell({ name, truncate }: { name: string; truncate?: boolean }) {
  return (
    <span className={cn('flex items-center gap-2.5', truncate ? 'min-w-0' : 'whitespace-nowrap')} title={name}>
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white', avatarColor(name))}>{initials(name)}</span>
      <span className={cn('font-medium', truncate && 'truncate')}>{name}</span>
    </span>
  )
}

function pill(key: keyof EmployeeRow, header: string, tone: string): ColumnDef<EmployeeRow, unknown> {
  return { accessorKey: key, header, ...right, cell: ({ getValue }) => <Pill value={getValue() as number} tone={tone} /> }
}

/** Compact executive view: one row per employee with exact counts, a progress bar and highlighted exceptions. */
export function EmployeeSnapshotTable({ rows, onRow, pageSize = 15, variant = 'delivery' }: { rows: EmployeeRow[]; onRow?: (name: string) => void; pageSize?: number; variant?: 'delivery' | 'open' | 'assigned' | 'deploy' | 'flow' | 'status' | 'detail' }) {
  const columns = useMemo<ColumnDef<EmployeeRow, unknown>[]>(() => {
    const employee: ColumnDef<EmployeeRow, unknown> = { accessorKey: 'employee', header: 'Employee', cell: ({ row }) => <EmployeeCell name={row.original.employee} /> }
    if (variant === 'status') {
      return [
        { ...employee, size: 150, cell: ({ row }) => <EmployeeCell name={row.original.employee} truncate /> },
        { accessorKey: 'project', header: 'Project / team', size: 110, cell: ({ getValue }) => <span className="block truncate text-xs text-muted-foreground" title={String(getValue() ?? '')}>{String(getValue() ?? '-')}</span> },
        { accessorKey: 'unique_tickets', header: 'Assigned', size: 96, ...right, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{getValue() as number}</span> },
        { ...pill('completed', 'Completed', 'green'), size: 90 },
        { ...pill('development_tickets', 'Development', 'blue'), size: 106 },
        { ...pill('code_review', 'Review', 'indigo'), size: 80 },
        { ...pill('testing_tickets', 'Testing', 'purple'), size: 80 },
        { ...pill('backlog', 'Backlog', 'orange'), size: 76 },
        { ...pill('on_hold', 'On hold', 'yellow'), size: 76 },
        { accessorKey: 'last_report_date', header: 'Last update', size: 96, cell: ({ getValue }) => <span className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(getValue() as string)}</span> },
      ]
    }
    if (variant === 'detail') {
      return [
        { ...employee, size: 136, cell: ({ row }) => <EmployeeCell name={row.original.employee} truncate /> },
        { accessorKey: 'unique_tickets', header: 'Tickets', size: 76, ...right, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{getValue() as number}</span> },
        { ...pill('completed', 'Completed', 'green'), size: 104 },
        { ...pill('in_progress', 'In progress', 'blue'), size: 94 },
        { ...pill('pending', 'Pending', 'orange'), size: 80 },
        { ...pill('blocked', 'Blocked', 'red'), size: 80 },
        { ...pill('development', 'Dev work', 'indigo'), size: 86 },
        { ...pill('testing', 'Test work', 'purple'), size: 86 },
        { ...pill('dev_deployed', 'Dev deployed', 'teal'), size: 104 },
        { ...pill('production_released', 'Prod deployed', 'purple'), size: 112 },
      ]
    }
    if (variant === 'flow') {
      const maxAssigned = Math.max(1, ...rows.map((r) => r.unique_tickets))
      // Delivery progress: completed tickets count fully, in-progress tickets count half.
      const progress = (r: EmployeeRow) => (r.unique_tickets ? Math.min(100, Math.round((100 * (r.completed + 0.5 * r.in_progress)) / r.unique_tickets)) : 0)
      const flowEmployee: ColumnDef<EmployeeRow, unknown> = { ...employee, size: 130, cell: ({ row }) => <EmployeeCell name={row.original.employee} truncate /> }
      return [
        flowEmployee,
        { accessorKey: 'unique_tickets', header: 'Assigned', size: 90, ...right, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{getValue() as number}</span> },
        { ...pill('completed', 'Completed', 'green'), size: 100 },
        { ...pill('in_progress', 'In progress', 'blue'), size: 100 },
        { ...pill('dev_deployed', 'Dev deployed', 'teal'), size: 100 },
        { ...pill('dev_pending', 'Dev pending', 'orange'), size: 100 },
        { ...pill('production_released', 'Prod deployed', 'purple'), size: 100 },
        {
          id: 'progress',
          accessorFn: progress,
          header: 'Progress',
          size: 110,
          cell: ({ row }) => {
            const r = row.original
            const pct = progress(r)
            const done = r.unique_tickets ? Math.round((100 * r.completed) / r.unique_tickets) : 0
            const prog = r.unique_tickets ? Math.round((100 * r.in_progress) / r.unique_tickets) : 0
            const scale = (100 * r.unique_tickets) / maxAssigned
            return (
              <div className="flex min-w-0 items-center gap-2" title={`${r.completed} completed (100%) + ${r.in_progress} in progress (50%) of ${r.unique_tickets} assigned = ${pct}%`}>
                <div className="h-2.5 flex-1">
                  <div className="flex h-full overflow-hidden rounded-full bg-muted" style={{ width: `${Math.max(scale, 4)}%` }}>
                    <div className="h-full bg-green-500" style={{ width: `${done}%` }} />
                    <div className="h-full bg-blue-400/80" style={{ width: `${prog}%` }} />
                  </div>
                </div>
                <span className={cn('w-10 text-right text-xs font-semibold tabular-nums', pct >= 50 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>{fmtNum(pct, 0)}%</span>
              </div>
            )
          },
        },
      ]
    }
    if (variant === 'assigned') {
      const maxAssigned = Math.max(1, ...rows.map((r) => r.unique_tickets))
      return [
        employee,
        { accessorKey: 'unique_tickets', header: 'Assigned', ...right, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{getValue() as number}</span> },
        pill('completed', 'Completed', 'green'),
        pill('in_progress', 'In progress', 'blue'),
        {
          id: 'remaining',
          accessorFn: (r) => Math.max(0, r.unique_tickets - r.completed - r.in_progress),
          header: 'Not started',
          ...right,
          cell: ({ getValue }) => <Pill value={getValue() as number} tone="orange" />,
        },
        {
          id: 'completion',
          accessorFn: (r) => (r.unique_tickets ? r.completed / r.unique_tickets : 0),
          header: 'Completed vs assigned',
          cell: ({ row }) => {
            const r = row.original
            const done = r.unique_tickets ? Math.round((100 * r.completed) / r.unique_tickets) : 0
            const prog = r.unique_tickets ? Math.round((100 * r.in_progress) / r.unique_tickets) : 0
            const scale = (100 * r.unique_tickets) / maxAssigned
            return (
              <div className="flex min-w-[200px] items-center gap-2" title={`${r.completed} completed, ${r.in_progress} in progress of ${r.unique_tickets} assigned`}>
                <div className="h-2.5 flex-1 rounded-full bg-transparent">
                  <div className="flex h-full overflow-hidden rounded-full bg-muted" style={{ width: `${Math.max(scale, 4)}%` }}>
                    <div className="h-full bg-green-500" style={{ width: `${done}%` }} />
                    <div className="h-full bg-blue-400/80" style={{ width: `${prog}%` }} />
                  </div>
                </div>
                <span className={cn('w-10 text-right text-xs font-semibold tabular-nums', done >= 50 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>{fmtNum(done, 0)}%</span>
              </div>
            )
          },
        },
      ]
    }
    if (variant === 'deploy') {
      const maxTotal = Math.max(1, ...rows.map((r) => r.dev_deployed + r.production_released))
      return [
        employee,
        pill('dev_deployed', 'Dev deployed', 'teal'),
        pill('dev_pending', 'Dev pending', 'orange'),
        pill('production_released', 'Prod released', 'purple'),
        {
          id: 'prod_pending',
          accessorFn: (r) => Math.max(0, r.production_releases - r.production_released),
          header: 'Prod pending',
          ...right,
          cell: ({ getValue }) => <Pill value={getValue() as number} tone="orange" />,
        },
        {
          id: 'deploy_total',
          accessorFn: (r) => r.dev_deployed + r.production_released,
          header: 'Deployed total',
          cell: ({ row }) => {
            const r = row.original
            const total = r.dev_deployed + r.production_released
            return (
              <div className="flex min-w-[180px] items-center gap-2" title={`${r.dev_deployed} dev, ${r.production_released} production`}>
                <div className="h-2.5 flex-1">
                  <div className="flex h-full overflow-hidden rounded-full bg-muted" style={{ width: `${Math.max((100 * total) / maxTotal, total ? 4 : 0)}%` }}>
                    <div className="h-full bg-teal-500" style={{ width: `${total ? (100 * r.dev_deployed) / total : 0}%` }} />
                    <div className="h-full bg-purple-500" style={{ width: `${total ? (100 * r.production_released) / total : 0}%` }} />
                  </div>
                </div>
                <span className="w-7 text-right text-xs font-semibold tabular-nums">{total}</span>
              </div>
            )
          },
        },
      ]
    }
    if (variant === 'open') {
      return [
        employee,
        pill('development_tickets', 'In development', 'blue'),
        pill('code_review', 'Code review', 'indigo'),
        pill('testing_tickets', 'Testing / QA', 'purple'),
        pill('pending', 'Pending', 'orange'),
        pill('on_hold', 'On hold', 'yellow'),
        pill('blocked', 'Blocked', 'red'),
        {
          id: 'open_total',
          accessorFn: (r) => r.in_progress + r.pending + r.blocked,
          header: 'Open total',
          ...right,
          cell: ({ row }) => <span className="font-semibold tabular-nums">{row.original.in_progress + row.original.pending + row.original.blocked}</span>,
        },
      ]
    }
    const maxAssigned = Math.max(1, ...rows.map((r) => r.unique_tickets))
    return [
      employee,
      {
        accessorKey: 'unique_tickets',
        header: 'Assigned',
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <span className="w-7 text-right font-semibold tabular-nums">{row.original.unique_tickets}</span>
            <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-slate-400/80" style={{ width: `${Math.round((100 * row.original.unique_tickets) / maxAssigned)}%` }} />
            </div>
          </div>
        ),
      },
      pill('completed', 'Completed', 'green'),
      pill('in_progress', 'In progress', 'blue'),
      pill('pending', 'Pending', 'orange'),
      pill('blocked', 'Blocked', 'red'),
      {
        id: 'progress',
        accessorFn: (r) => (r.unique_tickets ? r.completed / r.unique_tickets : 0),
        header: 'Progress',
        cell: ({ row }) => {
          const r = row.original
          const pct = r.unique_tickets ? Math.round((100 * r.completed) / r.unique_tickets) : 0
          const inProg = r.unique_tickets ? Math.round((100 * r.in_progress) / r.unique_tickets) : 0
          return (
            <div className="flex min-w-[170px] items-center gap-2" title={`${r.completed} completed and ${r.in_progress} in progress of ${r.unique_tickets} assigned`}>
              <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-green-500" style={{ width: `${pct}%` }} />
                <div className="h-full bg-blue-400/70" style={{ width: `${inProg}%` }} />
              </div>
              <span className={cn('w-10 text-right text-xs font-semibold tabular-nums', pct >= 50 ? 'text-green-700 dark:text-green-400' : 'text-muted-foreground')}>{fmtNum(pct, 0)}%</span>
            </div>
          )
        },
      },
    ]
  }, [rows, variant])
  return (
    <DataTable
      data={rows}
      columns={columns}
      onRowClick={onRow ? (r) => onRow(r.employee) : undefined}
      pageSize={pageSize}
      dense
      compact={variant === 'flow' || variant === 'status' || variant === 'detail'}
      fluid={variant === 'flow' || variant === 'status' || variant === 'detail'}
      exportName={variant === 'open' ? 'employee-open-work' : variant === 'assigned' ? 'employee-assigned-vs-completed' : variant === 'deploy' ? 'employee-deployments' : variant === 'flow' ? 'employee-delivery-and-deployment' : variant === 'status' ? 'employee-ticket-status' : variant === 'detail' ? 'employee-work-detail' : 'employee-snapshot'}
      searchPlaceholder="Search employee"
      initialSorting={[{ id: variant === 'open' ? 'open_total' : variant === 'deploy' ? 'deploy_total' : variant === 'detail' ? 'completed' : 'unique_tickets', desc: true }]}
      rowClassName={(r) => (variant !== 'deploy' && r.blocked > 0 ? 'bg-red-500/[0.05]' : undefined)}
    />
  )
}
