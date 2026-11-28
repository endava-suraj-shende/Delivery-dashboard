import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertOctagon, BarChart3, CheckCircle2, Clock, Hourglass, Rocket, ServerCog, Table as TableIcon, Ticket, Users, UserCheck, ShieldAlert, Plug } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { EmployeeSnapshotTable } from '@/components/common/EmployeeSnapshotTable'
import { ChartCard, DonutChart, NamedBarChart, StackedBarChart, TrendChart, STATUS_SERIES, TYPE_SERIES, CHART_HEIGHT_TALL } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { InsightsPanel } from '@/components/common/InsightsPanel'
import { NarrativeCard } from '@/components/common/NarrativeCard'
import { ErrorState, LoadingState } from '@/components/common/States'
import { TicketDialog } from '@/components/common/Tables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useExecutive } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { FEATURES } from '@/lib/features'
import { cn } from '@/lib/utils'
import { Link } from 'react-router-dom'

export default function ExecutivePage() {
  const q = useExecutive()
  const { toggleValue, filters, queryString, setList } = useFilters()
  const nav = useNavigate()
  const [ticket, setTicket] = useState<string | null>(null)
  const [empView, setEmpView] = useState<'table' | 'chart'>('table')
  const [openView, setOpenView] = useState<'table' | 'chart'>('table')
  const [moreKpis, setMoreKpis] = useState(false)
  const qs = queryString ? `?${queryString}` : ''

  const goEmployee = (name: string) => nav(`/employees/${encodeURIComponent(name)}${qs}`)
  const goProject = (name: string) => nav(`/projects/${encodeURIComponent(name)}${qs}`)

  return (
    <>
      <PageHeader title="Executive Dashboard" description={q.data?.source === 'jira' ? 'Delivery position across all teams, built live from the configured Jira boards.' : q.data?.source === 'both' ? 'Delivery position across all teams, combining Jira boards and bi-weekly Excel reports.' : 'Delivery position across all teams, derived from the bi-weekly Excel reports.'} period={q.data?.period} actions={<PrintButton />} />
      <GlobalFilterBar />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          {q.data.kpis.total_activities === 0 && (
            <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/30">
              <CardContent className="flex items-center justify-between p-4 text-sm">
                <span>No bi-weekly reports fall inside <b>{q.data.period.label}</b>. Try widening the date range.</span>
                <Button size="sm" variant="outline" onClick={() => nav(`/?preset=all`)}>
                  Show all data
                </Button>
              </CardContent>
            </Card>
          )}
          {/* Primary question first: how much is done, what is stuck, what reached production. Secondary metrics on demand. */}
          <KpiGrid cols={5}>
            <KpiCard label="Completed" value={q.data.kpis.completed_tickets} sub={`of ${q.data.kpis.total_tickets} tickets`} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" previous={q.data.previous_kpis?.completed_tickets} hint="Tickets whose latest status is Completed or Deployed." onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={q.data.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" previous={q.data.previous_kpis?.in_progress_tickets} onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Blocked" value={q.data.kpis.blocked_tickets} sub={`${q.data.kpis.pending_tickets} pending / on hold`} icon={<AlertOctagon className="h-4 w-4" />} tone="red" previous={q.data.previous_kpis?.blocked_tickets} onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Production releases" value={q.data.kpis.production_releases} sub={`${q.data.kpis.production_released} deployed | ${q.data.kpis.production_pending} pending`} icon={<Rocket className="h-4 w-4" />} tone="purple" previous={q.data.previous_kpis?.production_releases} onClick={() => nav(`/deployments/production${qs}`)} />
            <KpiCard label="Active people" value={q.data.kpis.active_employees} sub={`of ${q.data.kpis.total_employees} team members`} icon={<UserCheck className="h-4 w-4" />} tone="grey" previous={q.data.previous_kpis?.active_employees} hint="Employees with at least one report in the selected period." onClick={() => nav(`/employees${qs}`)} />
          </KpiGrid>
          <div className="-mt-2 flex justify-end">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => setMoreKpis((v) => !v)} aria-expanded={moreKpis}>
              {moreKpis ? 'Hide secondary metrics' : 'More metrics'}
            </Button>
          </div>
          {moreKpis && (
            <KpiGrid cols={5}>
              <KpiCard label="Unique Jira tickets" value={q.data.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" previous={q.data.previous_kpis?.total_tickets} hint="Distinct Jira ids referenced in the period (each counted once)." onClick={() => nav(`/jira${qs}`)} compact />
              <KpiCard label="Pending / on hold" value={q.data.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" previous={q.data.previous_kpis?.pending_tickets} onClick={() => setList('status', ['pending', 'on_hold'])} compact />
              <KpiCard label="Dev deployments" value={q.data.kpis.dev_deployed} sub={`${q.data.kpis.dev_pending} pending`} icon={<ServerCog className="h-4 w-4" />} tone="teal" previous={q.data.previous_kpis?.dev_deployed} onClick={() => nav(`/deployments/dev${qs}`)} compact />
              <KpiCard label="Prod success rate" value={q.data.kpis.production_success_rate} suffix="%" icon={<Clock className="h-4 w-4" />} tone="green" hint="Released / production release records in period." compact />
              {q.data.jira ? (
                <KpiCard
                  label="Excel vs Jira"
                  value={q.data.jira.errors + q.data.jira.warnings}
                  sub={`${q.data.jira.matched}/${q.data.jira.compared} match | ${q.data.jira.not_found} not found`}
                  icon={<Plug className="h-4 w-4" />}
                  tone={q.data.jira.errors ? 'red' : q.data.jira.warnings ? 'orange' : 'green'}
                  hint={`Discrepancies between the bi-weekly sheets and live Jira. Last sync ${q.data.jira.last_sync ? new Date(q.data.jira.last_sync).toLocaleString() : 'never'}.`}
                  onClick={() => nav(`/jira?tab=live${queryString ? `&${queryString}` : ''}`)}
                  compact
                />
              ) : (
                <KpiCard label="Team members" value={q.data.kpis.total_employees} icon={<Users className="h-4 w-4" />} tone="grey" hint="Distinct employees across all loaded data (not date-filtered)." compact />
              )}
            </KpiGrid>
          )}

          <NarrativeCard />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <ChartCard title="Overall work status" description="Unique tickets by latest status. Click to filter.">
              <DonutChart data={q.data.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
            </ChartCard>
            <ChartCard title="Work type split" description="Share of work by type. Click to filter.">
              <DonutChart data={q.data.charts.work_type} onSelect={(k) => toggleValue('work_type', k)} selected={filters.work_type} centerLabel="work rows" />
            </ChartCard>
            <ChartCard title="Dev deployment summary" description="Work rows by dev deployment status.">
              <DonutChart data={q.data.charts.dev_deployment} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="work rows" />
            </ChartCard>
            <ChartCard title="Production release summary" description="Release records by status.">
              <DonutChart data={q.data.charts.prod_deployment} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
            </ChartCard>
          </div>

          <ChartCard
            title="Employee-wise performance"
            description={empView === 'table' ? 'Exact counts per person; red cells and tinted rows mark blocked work. Progress = completed (green) and in progress (blue) share of assigned tickets. Click a row to open the employee.' : 'Ticket status per employee, sorted by assigned tickets. Click a bar to open the employee.'}
            height={empView === 'table' ? 'auto' : CHART_HEIGHT_TALL}
            action={
              <div className="flex items-center gap-0.5 rounded-md border p-0.5 text-xs">
                <Button size="sm" variant={empView === 'table' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setEmpView('table')}><TableIcon /> Table</Button>
                <Button size="sm" variant={empView === 'chart' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setEmpView('chart')}><BarChart3 /> Chart</Button>
              </div>
            }
          >
            {empView === 'table' ? <EmployeeSnapshotTable rows={q.data.employees} onRow={goEmployee} /> : <StackedBarChart data={q.data.charts.status_by_employee} series={STATUS_SERIES} onSelect={goEmployee} max={40} />}
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Project-wise performance" description="Ticket status per project. Click to open the project." height={CHART_HEIGHT_TALL}>
              <StackedBarChart data={q.data.charts.status_by_project} series={STATUS_SERIES} onSelect={goProject} />
            </ChartCard>
            <ChartCard title="Daily completed tickets" description="Per report date. Completed = first report date the ticket was marked complete." height={CHART_HEIGHT_TALL}>
              <TrendChart data={q.data.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }, { key: 'unique_tickets', label: 'Tickets worked on', color: 'purple', dashed: true }]} />
            </ChartCard>
          </div>

          <ChartCard
            title="Employee-wise pending & in-progress work"
            description={openView === 'table' ? 'Open tickets per person by stage; red marks blocked work. Click a row to open the employee.' : 'Tickets not yet completed per employee. Click a bar to open the employee.'}
            height={openView === 'table' ? 'auto' : CHART_HEIGHT_TALL}
            action={
              <div className="flex items-center gap-0.5 rounded-md border p-0.5 text-xs">
                <Button size="sm" variant={openView === 'table' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setOpenView('table')}><TableIcon /> Table</Button>
                <Button size="sm" variant={openView === 'chart' ? 'default' : 'ghost'} className="h-7 px-2" onClick={() => setOpenView('chart')}><BarChart3 /> Chart</Button>
              </div>
            }
          >
            {openView === 'table' ? <EmployeeSnapshotTable variant="open" rows={q.data.employees.filter((e) => e.in_progress + e.pending + e.blocked > 0)} onRow={goEmployee} pageSize={10} /> : (
            <StackedBarChart data={q.data.charts.status_by_employee.filter((e) => Number(e.total) - Number(e.completed_total) > 0)} series={[{ key: 'in_progress', label: 'In progress', color: 'blue' }, { key: 'development', label: 'Development', color: 'blue' }, { key: 'code_review', label: 'Code review', color: 'indigo' }, { key: 'testing', label: 'Testing', color: 'purple' }, { key: 'pending', label: 'Pending', color: 'orange' }, { key: 'on_hold', label: 'On hold', color: 'amber' }, { key: 'blocked', label: 'Blocked', color: 'red' }]} onSelect={goEmployee} max={40} />
            )}
          </ChartCard>

          {(FEATURES.applications || FEATURES.workTypeByEmployee || FEATURES.dataQualityCard) && (
          <div className={cn('grid gap-4', [FEATURES.applications, FEATURES.workTypeByEmployee, FEATURES.dataQualityCard].filter(Boolean).length > 1 ? 'lg:grid-cols-3' : 'lg:grid-cols-1')}>
            {FEATURES.applications && (
              <ChartCard title="Workload by application" description="Work rows per application.">
                <NamedBarChart data={q.data.charts.activities_by_application} onSelect={(n) => toggleValue('application', n)} color="#0d9488" valueLabel="Activities" />
              </ChartCard>
            )}
            {FEATURES.workTypeByEmployee && (
              <ChartCard title="Work type by employee" description="Work rows by type.">
                <StackedBarChart data={q.data.charts.type_by_employee} series={TYPE_SERIES} onSelect={goEmployee} max={25} />
              </ChartCard>
            )}
            {FEATURES.dataQualityCard && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ShieldAlert className="h-4 w-4 text-orange-500" /> Data quality
                </CardTitle>
                <CardDescription>Issues detected in the reports of this period.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {[
                  ['Missing employee names', q.data.data_quality.missing_employee],
                  ['Missing project names', q.data.data_quality.missing_project],
                  ['Rows without Jira id', q.data.data_quality.activities_without_ticket],
                  ['Blank work status', q.data.data_quality.missing_status],
                  ['Invalid / corrected dates', q.data.data_quality.invalid_dates],
                  ['Duplicate rows', q.data.data_quality.duplicates],
                  ['Incomplete deployment info', q.data.data_quality.incomplete_deployment],
                  ['Unmapped status values', q.data.data_quality.unmapped_statuses],
                ].map(([label, n]) => (
                  <div key={label as string} className="flex items-center justify-between border-b pb-1 last:border-0">
                    <span className="text-muted-foreground">{label}</span>
                    <Badge variant={(n as number) > 0 ? 'warning' : 'success'} className="tabular-nums">
                      {n as number}
                    </Badge>
                  </div>
                ))}
                <Button asChild variant="outline" size="sm" className="mt-2 w-full">
                  <Link to="/excel?tab=quality">View all issues</Link>
                </Button>
              </CardContent>
            </Card>
            )}
          </div>
          )}

          <InsightsPanel insights={q.data.insights} />

          {FEATURES.calculationRules && (
          <Card>
            <CardHeader>
              <CardTitle>Calculation rules & data limitations</CardTitle>
              <CardDescription>Latest-status rule: <b>{q.data.latest_status_rule === 'most_advanced' ? 'most advanced status wins' : 'latest report date wins'}</b> (change in Status Configuration).</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                {q.data.calculation_rules.map((r, i) => (
                  <li key={i}>{r.replace(/\*/g, '')}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
          )}
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}