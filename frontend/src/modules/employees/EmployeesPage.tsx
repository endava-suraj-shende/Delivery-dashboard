import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, AlertOctagon, CheckCircle2, Hourglass, Ticket, Users, UserX } from 'lucide-react'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { ChartCard, DonutChart, StackedBarChart, TrendChart, CHART_HEIGHT_TALL, type StackSeries } from '@/components/charts'
import { EmployeeSnapshotTable } from '@/components/common/EmployeeSnapshotTable'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/hooks/useFilters'
import { dashboardApi, employeeApi } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'
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
    num('unique_tickets', 'Tickets'),
    num('completed', 'Completed', 'text-green-600 font-medium'),
    num('in_progress', 'In progress', 'text-blue-600'),
    num('pending', 'Pending', 'text-orange-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('development', 'Dev'),
    num('testing', 'Test'),
    num('dev_deployed', 'Dev deployed'),
    num('production_released', 'Prod deployed'),
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
  const [view, setView] = useState<'status' | 'detail'>('status')
  const statusCols = useMemo(() => statusColumns(), [])
  const detailCols = useMemo(() => employeeColumns(), [])
  const qs = queryString ? `?${queryString}` : ''
  const go = (n: string) => nav(`/employees/${encodeURIComponent(n)}${qs}`)
  const d = q.data
  const rows = d?.items ?? []
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
            <KpiCard label="In progress" value={totals.in_progress} icon={<Activity className="h-4 w-4" />} tone="blue" compact sub={`${totals.code_review} review | ${totals.testing} testing`} />
            <KpiCard label="Backlog / on hold" value={totals.backlog + totals.on_hold} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact sub={`${totals.on_hold} on hold`} />
            <KpiCard label="Blocked" value={totals.blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
          </KpiGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Ticket status (all selected people)" description="Unique tickets by latest status. Click to filter." height={CHART_HEIGHT_TALL}>
              {team.data ? <DonutChart data={team.data.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" /> : <LoadingState rows={1} />}
            </ChartCard>
            <ChartCard title="Work status by employee" description="Tickets per person by latest status, sorted by total. Click a bar to open the employee." className="lg:col-span-2" height={CHART_HEIGHT_TALL}>
              <StackedBarChart data={rows.map((r) => ({ name: r.employee, ...Object.fromEntries(EMP_STATUS_SERIES.map((s) => [s.key, Number(r[s.key as keyof EmployeeRow] ?? 0)])) }))} series={EMP_STATUS_SERIES} onSelect={go} max={40} />
            </ChartCard>
          </div>

          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Assigned vs completed" description="Unique tickets per person. Bar length = assigned (relative to the busiest person); green = completed, blue = in progress. Click a row to open the employee." height="auto">
              <EmployeeSnapshotTable variant="assigned" rows={rows} onRow={go} pageSize={10} />
            </ChartCard>
            <ChartCard title="Deployments by employee" description="Dev deployments and production releases per person. Bar = deployed total (teal dev, purple production). Click a row to open the employee." height="auto">
              <EmployeeSnapshotTable variant="deploy" rows={rows} onRow={go} pageSize={10} />
            </ChartCard>
          </div>

          {team.data && (
            <ChartCard title="Completion trend" description="Completed tickets and open backlog per day across the selected people.">
              <TrendChart data={team.data.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }, { key: 'backlog', label: 'Open backlog', color: 'orange', dashed: true }]} />
            </ChartCard>
          )}

          <Card>
            <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Employees with activity in period ({rows.length})</CardTitle>
                <CardDescription>Unique tickets per person by latest status. Click a row to open the individual dashboard.</CardDescription>
              </div>
              <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                <Button size="sm" variant={view === 'status' ? 'default' : 'ghost'} className="h-7" onClick={() => setView('status')}>Ticket status</Button>
                <Button size="sm" variant={view === 'detail' ? 'default' : 'ghost'} className="h-7" onClick={() => setView('detail')}>Work detail</Button>
              </div>
            </CardHeader>
            <CardContent>
              <DataTable key={view} data={rows} columns={view === 'status' ? statusCols : detailCols} onRowClick={(r) => go(r.employee)} exportName="employee-performance" dense initialSorting={[{ id: view === 'status' ? 'unique_tickets' : 'completed', desc: true }]} searchPlaceholder="Search employees" />
            </CardContent>
          </Card>
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
