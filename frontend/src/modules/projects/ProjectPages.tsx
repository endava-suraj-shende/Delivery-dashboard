import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertOctagon, CheckCircle2, FileOutput, Hourglass, Rocket, ServerCog, Ticket, Users, Layers, Kanban } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, StackedBarChart, TrendChart, STATUS_SERIES, DEV_SERIES, PROD_SERIES, TYPE_SERIES } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { ActivitiesTable, ReleasesTable, TicketDialog, TicketsTable } from '@/components/common/Tables'
import { InsightsPanel } from '@/components/common/InsightsPanel'
import { MultiSelect } from '@/components/common/MultiSelect'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useDimensions } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { FEATURES } from '@/lib/features'
import { cn } from '@/lib/utils'
import { dashboardApi, projectApi } from '@/services/api'
import { employeeColumns } from '@/modules/employees/EmployeesPage'
import { projectColumns } from '@/modules/teams/TeamPage'

export function ProjectsPage() {
  const { queryString } = useFilters()
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['projects', queryString], queryFn: () => projectApi.list(queryString), placeholderData: (p) => p })
  const cols = useMemo(() => projectColumns(), [])
  const qs = queryString ? `?${queryString}` : ''
  return (
    <>
      <PageHeader title="Project Analytics" description="Select a project / team to view all employee contributions and project-level delivery statistics." breadcrumbs={[{ label: 'Projects' }]} period={q.data?.period} />
      <GlobalFilterBar />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {q.data.items.slice(0, 8).map((p) => (
              <Card key={p.project} className="cursor-pointer transition hover:border-primary/50 hover:shadow-md" onClick={() => nav(`/projects/${encodeURIComponent(p.project)}${qs}`)}>
                <CardContent className="p-4">
                  <p className="truncate font-semibold" title={p.project}>
                    {p.project}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {p.employees} employee{p.employees === 1 ? '' : 's'}{FEATURES.applications && ` | ${p.applications.length} app${p.applications.length === 1 ? '' : 's'}`}
                  </p>
                  <div className="mt-3 flex items-center gap-3 text-xs">
                    <span className="text-green-600 font-medium">{p.completed} done</span>
                    <span className="text-blue-600">{p.in_progress} in progress</span>
                    {p.blocked > 0 && <span className="text-red-600 font-medium">{p.blocked} blocked</span>}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader>
              <CardTitle>All projects ({q.data.items.length})</CardTitle>
            </CardHeader>
            <CardContent>
              <DataTable data={q.data.items} columns={cols} onRowClick={(r) => nav(`/projects/${encodeURIComponent(r.project)}${qs}`)} exportName="projects" dense initialSorting={[{ id: 'unique_tickets', desc: true }]} />
            </CardContent>
          </Card>
        </>
      )}
    </>
  )
}

export function ProjectDetailPage() {
  const { name = '' } = useParams()
  const nav = useNavigate()
  const { queryString, toggleValue, filters } = useFilters()
  const { data: dims } = useDimensions()
  const [ticket, setTicket] = useState<string | null>(null)
  const q = useQuery({ queryKey: ['project', name, queryString], queryFn: () => projectApi.summary(name, queryString), enabled: !!name, placeholderData: (p) => p })
  const projQs = useMemo(() => {
    const p = new URLSearchParams(queryString)
    p.delete('project')
    p.append('project', name)
    return p.toString()
  }, [queryString, name])
  const acts = useQuery({ queryKey: ['project', name, 'activities', projQs], queryFn: () => dashboardApi.activities(projQs, 1, 1000), enabled: !!name })
  const empCols = useMemo(() => employeeColumns(false), [])
  const qs = queryString ? `?${queryString}` : ''
  const d = q.data
  const row = d?.projects[0]

  return (
    <>
      <PageHeader
        title={name}
        description={row ? `${row.employees} employees | Applications: ${row.applications.join(', ') || '-'} | Boards: ${row.jira_boards.join(', ') || '-'}` : undefined}
        breadcrumbs={[{ label: 'Projects', to: `/projects${qs}` }, { label: name }]}
        period={d?.period}
        actions={
          <>
            <MultiSelect label="Project" options={(dims?.projects ?? []).map((p) => ({ value: p, label: p }))} value={[name]} onChange={(v) => v.length && nav(`/projects/${encodeURIComponent(v[v.length - 1])}${qs}`)} width="w-[240px]" />
            <Button variant="outline" size="sm" onClick={() => nav(`/reports?type=project&target=${encodeURIComponent(name)}${queryString ? `&${queryString}` : ''}`)}>
              <FileOutput /> Project report
            </Button>
            <PrintButton />
          </>
        }
      />
      <GlobalFilterBar compact />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {d && row && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="Employees" value={row.employees} icon={<Users className="h-4 w-4" />} tone="grey" compact />
            {FEATURES.applications && <KpiCard label="Applications" value={row.applications.length} icon={<Layers className="h-4 w-4" />} tone="teal" compact />}
            <KpiCard label="Jira boards" value={row.jira_boards.length} icon={<Kanban className="h-4 w-4" />} tone="grey" compact />
            <KpiCard label="Unique tickets" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" compact previous={d.previous_kpis?.total_tickets} />
            <KpiCard label="Completed" value={d.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact previous={d.previous_kpis?.completed_tickets} onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={d.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('status', 'in_progress')} />
            <KpiCard label="Pending" value={d.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => toggleValue('status', 'pending')} />
            <KpiCard label="Blocked" value={d.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} />
            <KpiCard label="Analysis / Dev / Test" value={`${d.kpis.analysis_activities} / ${d.kpis.development_activities} / ${d.kpis.testing_activities}`} tone="grey" compact hint="Work rows by work type" />
            <KpiCard label="Dev deployed" value={d.kpis.dev_deployed} sub={`${d.kpis.dev_pending} pending`} icon={<ServerCog className="h-4 w-4" />} tone="teal" compact />
            <KpiCard label="Prod releases" value={d.kpis.production_releases} sub={`${d.kpis.production_released} deployed`} icon={<Rocket className="h-4 w-4" />} tone="purple" compact />
          </KpiGrid>

          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="employees">Employees</TabsTrigger>
              <TabsTrigger value="tickets">Jira Tickets</TabsTrigger>
              <TabsTrigger value="activities">Work items</TabsTrigger>
              <TabsTrigger value="deploy">Deployments & Releases</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Ticket status" description="Unique tickets by latest status. Click to filter.">
                  <DonutChart data={d.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
                </ChartCard>
                <ChartCard title="Work status by employee" description="Tickets per person in this project by latest status. Click a bar to open the employee." className="lg:col-span-2">
                  <StackedBarChart data={d.charts.status_by_employee} series={STATUS_SERIES} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} />
                </ChartCard>
              </div>
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                <ChartCard title="Daily completion trend" description="Completed tickets per report date.">
                  <TrendChart data={d.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }]} />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Application-wise ticket distribution">
                    <StackedBarChart data={d.charts.status_by_application} series={STATUS_SERIES} onSelect={(n) => toggleValue('application', n)} />
                  </ChartCard>
                )}
                <ChartCard title="Work type by employee" description="Work rows per person by work type. Click a bar to open the employee.">
                  <StackedBarChart data={d.charts.type_by_employee} series={TYPE_SERIES} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} />
                </ChartCard>
              </div>
              <InsightsPanel insights={d.insights} title="Project observations" max={8} />
            </TabsContent>
            <TabsContent value="employees">
              <Card>
                <CardHeader>
                  <CardTitle>Employee-wise detail ({d.employees.length})</CardTitle>
                  <CardDescription>Click a row to open the employee dashboard.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DataTable data={d.employees} columns={empCols} onRowClick={(r) => nav(`/employees/${encodeURIComponent(r.employee)}${qs}`)} exportName={`project-${name}-employees`} dense initialSorting={[{ id: 'completed', desc: true }]} />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="tickets">
              <Card>
                <CardHeader>
                  <CardTitle>Jira tickets ({d.tickets.length})</CardTitle>
                </CardHeader>
                <CardContent>
                  <TicketsTable items={d.tickets} onTicket={setTicket} />
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="activities">
              <Card>
                <CardHeader>
                  <CardTitle>Project work items ({acts.data?.total ?? ''})</CardTitle>
                </CardHeader>
                <CardContent>{acts.data ? <ActivitiesTable items={acts.data.items} onTicket={setTicket} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="deploy" className="space-y-4">
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                <ChartCard title="Dev deployment summary" description="Work rows by dev deployment status. Click to filter.">
                  <DonutChart data={d.charts.dev_deployment} centerLabel="work rows" onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} />
                </ChartCard>
                <ChartCard title="Production release summary" description="Release records by status. Click to filter.">
                  <DonutChart data={d.charts.prod_deployment} centerLabel="releases" onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Dev deployment by application">
                    <StackedBarChart data={d.charts.dev_by_application} series={DEV_SERIES} />
                  </ChartCard>
                )}
              </div>
              <ChartCard title="Production releases by employee" description="Release records per person by status.">
                <StackedBarChart data={d.charts.prod_by_employee} series={PROD_SERIES} />
              </ChartCard>
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
          <div className="flex flex-wrap gap-1">
            {row.employee_names.map((e) => (
              <Badge key={e} variant="secondary" className="cursor-pointer" onClick={() => nav(`/employees/${encodeURIComponent(e)}${qs}`)}>
                {e}
              </Badge>
            ))}
          </div>
        </>
      )}
      {d && !row && <Card><CardContent className="p-6 text-sm text-muted-foreground">No activity for {name} in {d.period.label}. <Button variant="link" onClick={() => nav(`/projects/${encodeURIComponent(name)}?preset=all`)}>Show all data</Button></CardContent></Card>}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}
