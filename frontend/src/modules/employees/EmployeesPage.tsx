import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, AlertOctagon, CheckCircle2, Hourglass, Ticket, Users, UserX } from 'lucide-react'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { ChartCard, DonutChart, StackedBarChart, type StackSeries } from '@/components/charts'
import { WeeklyTimeline } from '@/components/common/WeeklyTimeline'
import { HelpTip } from '@/components/ui/primitives'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/hooks/useFilters'
import { dashboardApi, employeeApi } from '@/services/api'
import { cn, fmtDate, fmtNum } from '@/lib/utils'
import { FEATURES } from '@/lib/features'
import type { EmployeeRow } from '@/types'

export function employeeColumns(includeProject = true): ColumnDef<EmployeeRow, unknown>[] {
  const num = (key: keyof EmployeeRow, header: string, cls?: string): ColumnDef<EmployeeRow, unknown> => ({
    accessorKey: key,
    header,
    cell: ({ getValue }) => <span className={`tabular-nums ${cls ?? ''} ${(getValue() as number) === 0 ? 'text-muted-foreground/50' : ''}`}>{getValue() as number}</span>,
  })
  const cols: ColumnDef<EmployeeRow, unknown>[] = [
    { accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <span className="font-medium whitespace-nowrap">{getValue() as string}</span> },
  ]
  if (includeProject) {
    cols.push({ accessorKey: 'project', header: 'Project / Team' })
    if (FEATURES.applications) cols.push({ accessorKey: 'application', header: 'Application', cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> })
  }
  cols.push(
    num('reports', 'Reports'),
    num('total_activities', 'Activities'),
    num('unique_tickets', 'Tickets'),
    num('completed', 'Completed', 'text-green-600 font-medium'),
    num('in_progress', 'In progress', 'text-blue-600'),
    num('pending', 'Pending', 'text-orange-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('analysis', 'Analysis'),
    num('development', 'Dev'),
    num('testing', 'Test'),
    num('dev_deployed', 'Dev deployed'),
    num('production_releases', 'Prod releases'),
    { accessorKey: 'production_status', header: 'Prod status', cell: ({ getValue }) => (getValue() ? <Badge variant="outline">{getValue() as string}</Badge> : <span className="text-muted-foreground">Ã¢â‚¬â€</span>) },
    { accessorKey: 'last_report_date', header: 'Last report', cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{fmtDate(getValue() as string)}</span> },
  )
  return cols
}

export function statusColumns(): ColumnDef<EmployeeRow, unknown>[] {
  const num = (key: keyof EmployeeRow, header: string, cls?: string): ColumnDef<EmployeeRow, unknown> => ({
    accessorKey: key,
    header,
    cell: ({ getValue }) => <span className={cn('tabular-nums', cls, (getValue() as number) === 0 && 'text-muted-foreground/50')}>{getValue() as number}</span>,
  })
  return [
    { accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <span className="font-medium whitespace-nowrap">{getValue() as string}</span> },
    { accessorKey: 'project', header: 'Project / Team', cell: ({ getValue }) => <span className="text-xs">{getValue() as string}</span> },
    num('unique_tickets', 'Assigned', 'font-medium'),
    num('completed', 'Completed', 'text-green-600 font-medium'),
    num('development_tickets', 'In development', 'text-blue-600'),
    num('code_review', 'Code review', 'text-indigo-600'),
    num('testing_tickets', 'Testing / QA', 'text-purple-600'),
    num('ready_for_deployment', 'Ready to deploy', 'text-teal-600'),
    num('backlog', 'Backlog'),
    num('on_hold', 'On hold', 'text-yellow-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('dev_deployed', 'Dev deployed'),
    num('production_released', 'Prod deployed'),
    num('total_activities', 'Activities'),
    { accessorKey: 'last_report_date', header: 'Last update', cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{fmtDate(getValue() as string)}</span> },
  ]
}

/** Inline progress cell: number printed on a proportional bar â€” readable without hovering. */
export function BarCell({ value, max, label, color = 'bg-green-500', pct }: { value: number; max: number; label?: string; color?: string; pct?: number | null }) {
  const width = max > 0 ? Math.max(2, Math.round((100 * value) / max)) : 0
  return (
    <div className="relative h-5 min-w-[120px] overflow-hidden rounded bg-muted">
      <div className={cn('h-full rounded', color)} style={{ width: `${width}%`, opacity: 0.35 }} />
      <span className="absolute inset-0 flex items-center px-1.5 text-[11px] tabular-nums">
        <span className="font-medium">{label ?? value}</span>
        {pct !== undefined && pct !== null && <span className="ml-auto text-muted-foreground">{fmtNum(pct, 0)}%</span>}
      </span>
    </div>
  )
}

/** Fair-comparison table: workload (assigned), delivery (completed %) and speed (cycle time), each as a bar with the number printed. */
export function performanceColumns(rows: EmployeeRow[]): ColumnDef<EmployeeRow, unknown>[] {
  const maxAssigned = Math.max(1, ...rows.map((r) => r.unique_tickets))
  const maxCycle = Math.max(1, ...rows.map((r) => r.avg_cycle_days ?? 0))
  const teamPct = rows.length ? (100 * rows.reduce((s, r) => s + r.completed, 0)) / Math.max(1, rows.reduce((s, r) => s + r.unique_tickets, 0)) : 0
  const num = (key: keyof EmployeeRow, header: string, cls?: string): ColumnDef<EmployeeRow, unknown> => ({
    accessorKey: key,
    header,
    cell: ({ getValue }) => <span className={cn('tabular-nums', cls, (getValue() as number) === 0 && 'text-muted-foreground/50')}>{getValue() as number}</span>,
  })
  return [
    { accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <span className="font-medium whitespace-nowrap">{getValue() as string}</span> },
    {
      accessorKey: 'unique_tickets',
      header: () => <HelpTip text="Workload: unique tickets the person worked on in the period. Bar length is relative to the busiest person."><span className="underline decoration-dotted">Assigned</span></HelpTip>,
      cell: ({ row }) => <BarCell value={row.original.unique_tickets} max={maxAssigned} color="bg-slate-500" label={`${row.original.unique_tickets}`} />,
    },
    {
      id: 'mix',
      accessorFn: (r) => r.new_in_period,
      header: () => <HelpTip text="Where the workload came from: tickets carried over from before the period vs tickets first worked on inside the period."><span className="underline decoration-dotted">Carried / New</span></HelpTip>,
      cell: ({ row }) => <span className="whitespace-nowrap text-xs tabular-nums"><span className="text-muted-foreground">{row.original.carried_in}</span> / <span className="text-blue-600">{row.original.new_in_period}</span></span>,
    },
    {
      accessorKey: 'completed_pct',
      header: () => <HelpTip text={`Delivery: completed Ã· assigned. Compare people fairly regardless of how many tickets they got. Team average ${fmtNum(teamPct, 0)}%.`}><span className="underline decoration-dotted">Completed</span></HelpTip>,
      cell: ({ row }) => <BarCell value={row.original.completed} max={row.original.unique_tickets} label={`${row.original.completed} of ${row.original.unique_tickets}`} pct={row.original.completed_pct} color={(row.original.completed_pct ?? 0) >= teamPct ? 'bg-green-500' : 'bg-orange-400'} />,
    },
    num('in_progress', 'In progress', 'text-blue-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('overdue', 'Overdue', 'text-red-600'),
    {
      accessorKey: 'avg_cycle_days',
      header: () => <HelpTip text="Speed: average days from a ticket first appearing to its completion (completed tickets only). Shorter is better; team average shown as a tick."><span className="underline decoration-dotted">Avg days to complete</span></HelpTip>,
      cell: ({ row }) => {
        const v = row.original.avg_cycle_days
        if (v === null || v === undefined) return <span className="text-xs text-muted-foreground">no completions</span>
        const team = row.original.team_avg_cycle_days
        return (
          <div className="relative h-5 min-w-[120px] overflow-hidden rounded bg-muted">
            <div className={cn('h-full rounded', team !== null && v > team ? 'bg-orange-400' : 'bg-teal-500')} style={{ width: `${Math.max(2, Math.round((100 * v) / maxCycle))}%`, opacity: 0.35 }} />
            {team !== null && team !== undefined && <div className="absolute top-0 h-full w-0.5 bg-foreground/60" style={{ left: `${Math.min(99, Math.round((100 * team) / maxCycle))}%` }} title={`Team average ${team} days`} />}
            <span className="absolute inset-0 flex items-center px-1.5 text-[11px] tabular-nums"><span className="font-medium">{fmtNum(v, 1)} d</span>{row.original.median_cycle_days !== null && <span className="ml-auto text-muted-foreground">med {fmtNum(row.original.median_cycle_days, 0)}</span>}</span>
          </div>
        )
      },
    },
    num('dev_deployed', 'Dev deployed'),
    num('production_released', 'Prod deployed'),
    { accessorKey: 'last_report_date', header: 'Last update', cell: ({ getValue }) => <span className="whitespace-nowrap text-xs">{fmtDate(getValue() as string)}</span> },
  ]
}

/** Ticket-status series used by the employee charts (unique tickets by latest status). */
export const EMP_STATUS_SERIES: StackSeries[] = [
  { key: 'completed', label: 'Completed', color: 'green' },
  { key: 'development_tickets', label: 'In development', color: 'blue' },
  { key: 'code_review', label: 'Code review', color: 'indigo' },
  { key: 'testing_tickets', label: 'Testing / QA', color: 'purple' },
  { key: 'ready_for_deployment', label: 'Ready to deploy', color: 'teal' },
  { key: 'backlog', label: 'Backlog', color: 'orange' },
  { key: 'on_hold', label: 'On hold', color: 'amber' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
]

export default function EmployeesPage() {
  const { queryString, toggleValue, filters } = useFilters()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['employees', queryString], queryFn: () => employeeApi.list(queryString), placeholderData: (p) => p })
  const team = useQuery({ queryKey: ['team', queryString], queryFn: () => dashboardApi.team(queryString), placeholderData: (p) => p })
  const [view, setView] = useState<'performance' | 'status' | 'detail'>('performance')
  const statusCols = useMemo(() => statusColumns(), [])
  const detailCols = useMemo(() => employeeColumns(), [])
  const qs = queryString ? `?${queryString}` : ''
  const go = (n: string) => nav(`/employees/${encodeURIComponent(n)}${qs}`)
  const d = q.data
  const rows = d?.items ?? []
  const perfCols = useMemo(() => performanceColumns(rows), [rows])
  const totals = useMemo(() => {
    const sum = (k: keyof EmployeeRow) => rows.reduce((s, r) => s + Number(r[k] ?? 0), 0)
    return { assigned: sum('unique_tickets'), completed: sum('completed'), in_progress: sum('in_progress'), code_review: sum('code_review'), testing: sum('testing_tickets'), backlog: sum('backlog'), on_hold: sum('on_hold'), blocked: sum('blocked'), dev: sum('dev_deployed'), prod: sum('production_released') }
  }, [rows])

  return (
    <>
      <PageHeader
        title="Employee Performance"
        description="Who is working on what: assigned tickets, what is completed, in development, in code review, in testing, blocked. Click a person to open the individual report."
        breadcrumbs={[{ label: 'Employees' }]}
        period={d?.period}
        actions={<PrintButton />}
      />
      <GlobalFilterBar />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="People active" value={rows.length} icon={<Users className="h-4 w-4" />} tone="grey" compact sub={d.inactive.length ? `${d.inactive.length} with no activity` : undefined} />
            <KpiCard label="Assigned tickets" value={totals.assigned} icon={<Ticket className="h-4 w-4" />} tone="blue" compact hint="Unique tickets worked on in the period, summed per person (a shared ticket counts for each person)." />
            <KpiCard label="Completed" value={totals.completed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={totals.in_progress} icon={<Activity className="h-4 w-4" />} tone="blue" compact sub={`${totals.code_review} review Â· ${totals.testing} testing`} />
            <KpiCard label="Backlog / on hold" value={totals.backlog + totals.on_hold} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact sub={`${totals.on_hold} on hold`} />
            <KpiCard label="Blocked" value={totals.blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
          </KpiGrid>

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Employee performance ({rows.length})</CardTitle>
                <CardDescription>
                  Read each row left to right: <b>Assigned</b> = workload, <b>Completed</b> = how much of that workload was finished (the % compares people fairly whatever their load),
                  <b> Avg days to complete</b> = speed. Numbers are printed on the bars; the tick marks the team average. Click a row for the individual report.
                </CardDescription>
              </div>
              <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                <Button size="sm" variant={view === 'performance' ? 'default' : 'ghost'} className="h-7" onClick={() => setView('performance')}>Performance</Button>
                <Button size="sm" variant={view === 'status' ? 'default' : 'ghost'} className="h-7" onClick={() => setView('status')}>Ticket status</Button>
                <Button size="sm" variant={view === 'detail' ? 'default' : 'ghost'} className="h-7" onClick={() => setView('detail')}>Work detail</Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable key={view} data={rows} columns={view === 'performance' ? perfCols : view === 'status' ? statusCols : detailCols} onRowClick={(r) => go(r.employee)} exportName="employee-performance" dense initialSorting={[{ id: view === 'detail' ? 'completed' : 'unique_tickets', desc: true }]} searchPlaceholder="Search employeesâ€¦" />
            </CardContent>
          </Card>

          {team.data && (
            <Card>
              <CardHeader>
                <CardTitle>Week-by-week timeline</CardTitle>
                <CardDescription>
                  One column per week. Each cell shows <span className="text-blue-600">tickets the person started</span> â†’ <span className="text-green-600">tickets completed</span> that week; darker green = more completed.
                  This is where a mid-period surge of new tickets (or a quiet week) becomes visible.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <WeeklyTimeline data={team.data.charts.weekly_by_employee} onEmployee={go} />
              </CardContent>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Work status by employee" description="Completed, in development, code review, testing, ready, backlog, on hold, blocked.">
              <StackedBarChart data={rows.map((r) => ({ name: r.employee, ...Object.fromEntries(EMP_STATUS_SERIES.map((s) => [s.key, Number(r[s.key as keyof EmployeeRow] ?? 0)])) }))} series={EMP_STATUS_SERIES} onSelect={go} max={30} />
            </ChartCard>
            <ChartCard title="Ticket status (all selected people)" description="Unique tickets by latest status.">
              {team.data ? <DonutChart data={team.data.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" /> : <LoadingState rows={1} />}
            </ChartCard>
          </div>
          {d.inactive.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <UserX className="h-4 w-4 text-orange-500" /> No activity in the selected period ({d.inactive.length})
                </CardTitle>
                <CardDescription>These people exist in the data but have nothing reported inside the period. Click to open their full history.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {d.inactive.map((n) => (
                  <Button key={n} variant="outline" size="sm" onClick={() => nav(`/employees/${encodeURIComponent(n)}?preset=all`)}>
                    {n}
                  </Button>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </>
  )
}
