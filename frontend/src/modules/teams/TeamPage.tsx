import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, AlertOctagon, CheckCircle2, FileOutput, Hourglass, Rocket, ServerCog, Ticket, Users, UserCheck, Code2, SearchCheck, FlaskConical } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, NamedBarChart, StackedBarChart, TrendChart, TrendBarChart, STATUS_SERIES, TYPE_SERIES, DEV_SERIES, PROD_SERIES, CHART_HEIGHT_TALL } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton, SortSelect } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { ReleasesTable, TicketDialog, TicketsTable } from '@/components/common/Tables'
import { InsightsPanel } from '@/components/common/InsightsPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useTeam } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { FEATURES } from '@/lib/features'
import { employeeColumns } from '@/modules/employees/EmployeesPage'
import type { ProjectRow } from '@/types'

const SORTS = [
  { value: 'completed', label: 'Completed tickets' },
  { value: 'blocked', label: 'Blocked tickets' },
  { value: 'in_progress', label: 'In-progress tickets' },
  { value: 'unique_tickets', label: 'Unique tickets' },
  { value: 'employee', label: 'Name' },
]

export function projectColumns(): ColumnDef<ProjectRow, unknown>[] {
  const num = (key: keyof ProjectRow, header: string, cls?: string): ColumnDef<ProjectRow, unknown> => ({
    accessorKey: key,
    header,
    cell: ({ getValue }) => <span className={`tabular-nums ${cls ?? ''} ${(getValue() as number) === 0 ? 'text-muted-foreground/50' : ''}`}>{getValue() as number}</span>,
  })
  return [
    { accessorKey: 'project', header: 'Project / Team', cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    num('employees', 'Employees'),
    ...(FEATURES.applications ? [{ accessorKey: 'applications', header: 'Applications', cell: ({ getValue }) => <span className="text-xs">{(getValue() as string[]).join(', ')}</span> } as ColumnDef<ProjectRow, unknown>] : []),
    num('unique_tickets', 'Tickets'),
    num('completed', 'Completed', 'text-green-600 font-medium'),
    num('in_progress', 'In progress', 'text-blue-600'),
    num('pending', 'Pending', 'text-orange-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('backlog', 'Backlog'),
    num('analysis', 'Analysis'),
    num('development', 'Dev'),
    num('testing', 'Test'),
    num('dev_deployed', 'Dev deployed'),
    num('production_releases', 'Prod releases'),
    num('production_released', 'Prod deployed'),
  ]
}

export default function TeamPage() {
  const q = useTeam()
  const nav = useNavigate()
  const { queryString, toggleValue, filters, setList } = useFilters()
  const [ticket, setTicket] = useState<string | null>(null)
  const [sort, setSort] = useState('completed')
  const qs = queryString ? `?${queryString}` : ''
  const empCols = useMemo(() => employeeColumns(), [])
  const projCols = useMemo(() => projectColumns(), [])
  const goEmployee = (n: string) => nav(`/employees/${encodeURIComponent(n)}${qs}`)
  const goProject = (n: string) => nav(`/projects/${encodeURIComponent(n)}${qs}`)
  const d = q.data

  return (
    <>
      <PageHeader
        title="Team Performance"
        description="Consolidated delivery performance of the whole team without selecting employees individually."
        breadcrumbs={[{ label: 'Team' }]}
        period={d?.period}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => nav(`/reports?type=team${queryString ? `&${queryString}` : ''}`)}>
              <FileOutput /> Team report
            </Button>
            <PrintButton />
          </>
        }
      />
      <GlobalFilterBar />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="Total employees" value={d.kpis.total_employees} icon={<Users className="h-4 w-4" />} tone="grey" compact hint="All employees across loaded workbooks" />
            <KpiCard label="Active in period" value={d.kpis.active_employees} icon={<UserCheck className="h-4 w-4" />} tone="blue" compact previous={d.previous_kpis?.active_employees} />
            <KpiCard label="Unique tickets" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" compact previous={d.previous_kpis?.total_tickets} />
            <KpiCard label="Completed" value={d.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact previous={d.previous_kpis?.completed_tickets} onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={d.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Pending" value={d.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => setList('status', ['pending', 'on_hold'])} />
            <KpiCard label="Blocked" value={d.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Analysis" value={d.kpis.analysis_activities} icon={<SearchCheck className="h-4 w-4" />} tone="orange" compact />
            <KpiCard label="Development" value={d.kpis.development_activities} icon={<Code2 className="h-4 w-4" />} tone="blue" compact />
            <KpiCard label="Testing" value={d.kpis.testing_activities} icon={<FlaskConical className="h-4 w-4" />} tone="purple" compact />
            <KpiCard label="Dev deployments" value={d.kpis.dev_deployment_activities} sub={`${d.kpis.dev_deployed} deployed`} icon={<ServerCog className="h-4 w-4" />} tone="teal" compact />
            <KpiCard label="Prod releases" value={d.kpis.production_releases} sub={`${d.kpis.production_released} deployed`} icon={<Rocket className="h-4 w-4" />} tone="purple" compact />
            <KpiCard label="Prod pending" value={d.kpis.production_pending} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact />
            <KpiCard label="Prod blocked / failed" value={d.kpis.production_blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact />
          </KpiGrid>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="employees">Employee Performance</TabsTrigger>
              <TabsTrigger value="projects">Project Performance</TabsTrigger>
              <TabsTrigger value="jira">Jira Analytics</TabsTrigger>
              <TabsTrigger value="deploy">Deployment Analytics</TabsTrigger>
              <TabsTrigger value="prod">Production Releases</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Overall team ticket status" description="Unique tickets by latest status.">
                  <DonutChart data={d.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
                </ChartCard>
                <ChartCard title="Team daily completion trend" description="Completed tickets per report date." className="lg:col-span-2">
                  <TrendChart data={d.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }, { key: 'employees', label: 'Reporting employees', color: 'purple', dashed: true }]} />
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Work status by employee" description="Tickets per person by latest status. Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                  <StackedBarChart data={d.charts.status_by_employee} series={STATUS_SERIES} onSelect={goEmployee} max={40} />
                </ChartCard>
                <ChartCard title="Work type by employee" description="Work rows per person by work type. Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                  <StackedBarChart data={d.charts.type_by_employee} series={TYPE_SERIES} onSelect={goEmployee} max={40} />
                </ChartCard>
              </div>
              <InsightsPanel insights={d.insights} />
            </TabsContent>

            <TabsContent value="employees" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Employee-wise completed tickets" description="Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                  <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.completed_total) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value)} onSelect={goEmployee} color="green" max={40} valueLabel="Completed" />
                </ChartCard>
                <ChartCard title="Employee-wise in-progress tickets" description="Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                  <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.in_progress_total) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value)} onSelect={goEmployee} color="blue" max={40} valueLabel="In progress" />
                </ChartCard>
                <ChartCard title="Employee-wise blocked tickets" description="Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                  <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.blocked) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value)} onSelect={goEmployee} color="red" max={40} valueLabel="Blocked" />
                </ChartCard>
              </div>
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle>Team performance table</CardTitle>
                    <CardDescription>One row per employee. Click a row to open the individual dashboard; click a project in the Projects tab to open the project dashboard.</CardDescription>
                  </div>
                  <SortSelect value={sort} onChange={setSort} options={SORTS} />
                </CardHeader>
                <CardContent>
                  <DataTable key={sort} data={d.employees} columns={empCols} onRowClick={(r) => goEmployee(r.employee)} exportName="team-performance" dense initialSorting={[{ id: sort, desc: sort !== 'employee' }]} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="projects" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Project-wise ticket distribution" description="Unique tickets per project. Click a bar to open the project.">
                  <NamedBarChart data={d.charts.status_by_project.map((p) => ({ name: p.name, value: Number(p.total) }))} onSelect={goProject} valueLabel="Tickets" />
                </ChartCard>
                <ChartCard title="Project-wise completion status" description="Tickets per project by latest status. Click a bar to open the project.">
                  <StackedBarChart data={d.charts.status_by_project} series={STATUS_SERIES} onSelect={goProject} />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Application-wise work distribution" description="Work rows per application.">
                    <NamedBarChart data={d.charts.activities_by_application} onSelect={(n) => toggleValue('application', n)} color="#0d9488" valueLabel="Activities" />
                  </ChartCard>
                )}
                <ChartCard title="Project-wise backlog distribution" description="Tickets not yet completed per project. Click a bar to open the project.">
                  <StackedBarChart data={d.charts.status_by_project.filter((p) => Number(p.total) - Number(p.completed_total) > 0)} series={STATUS_SERIES.filter((s) => !['completed', 'deployed'].includes(s.key))} onSelect={goProject} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Project performance table</CardTitle>
                  <CardDescription>Click a row to open the project dashboard.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DataTable data={d.projects} columns={projCols} onRowClick={(r) => goProject(r.project)} exportName="project-performance" dense initialSorting={[{ id: 'unique_tickets', desc: true }]} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="jira" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Status by Jira board" description="Tickets per board by latest status. Click a bar to filter.">
                  <StackedBarChart data={d.charts.status_by_board} series={STATUS_SERIES} onSelect={(n) => toggleValue('jira_board', n)} />
                </ChartCard>
                <ChartCard title="Ticket backlog trend" description="Cumulative tickets seen minus cumulative completed, per report date.">
                  <TrendChart data={d.charts.trend} series={[{ key: 'backlog', label: 'Open backlog', color: 'orange' }, { key: 'completed_tickets', label: 'Completed that day', color: 'green' }]} area />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Jira tickets ({d.tickets.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <TicketsTable items={d.tickets} onTicket={setTicket} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="deploy" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Dev deployment status" description="Work rows by dev deployment status. Click to filter.">
                  <DonutChart data={d.charts.dev_deployment} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="work rows" />
                </ChartCard>
                <ChartCard title="Dev deployment by employee" description="Click a bar to open the employee." className="lg:col-span-2">
                  <StackedBarChart data={d.charts.dev_by_employee} series={DEV_SERIES} onSelect={goEmployee} max={30} />
                </ChartCard>
              </div>
              <ChartCard title="Daily dev deployment trend" description="Deployed and pending work rows per report date.">
                <TrendBarChart data={d.charts.trend} series={[{ key: 'dev_deployed', label: 'Deployed', color: 'green' }, { key: 'dev_pending', label: 'Pending', color: 'orange' }]} />
              </ChartCard>
            </TabsContent>

            <TabsContent value="prod" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Production deployment status" description="Release records by status. Click to filter.">
                  <DonutChart data={d.charts.prod_deployment} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
                </ChartCard>
                <ChartCard title="Project-wise production releases" description="Click a bar to open the project." className="lg:col-span-2">
                  <StackedBarChart data={d.charts.prod_by_project} series={PROD_SERIES} onSelect={goProject} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Production releases ({d.releases.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <ReleasesTable items={d.releases} onTicket={setTicket} />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}
