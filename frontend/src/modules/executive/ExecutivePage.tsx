import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertOctagon, CheckCircle2, Clock, Hourglass, Rocket, ServerCog, Ticket, Users, UserCheck, ShieldAlert, Plug } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, NamedBarChart, StackedBarChart, TrendChart, TrendBarChart, STATUS_SERIES, TYPE_SERIES } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { InsightsPanel } from '@/components/common/InsightsPanel'
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
          <KpiGrid cols={5}>
            <KpiCard label="Team members" value={q.data.kpis.total_employees} icon={<Users className="h-4 w-4" />} tone="grey" hint="Distinct employees across all loaded workbooks (not date-filtered)." />
            <KpiCard label="Active in period" value={q.data.kpis.active_employees} icon={<UserCheck className="h-4 w-4" />} tone="blue" previous={q.data.previous_kpis?.active_employees} hint="Employees with at least one report in the selected period." onClick={() => nav(`/team${qs}`)} />
            <KpiCard label="Unique Jira tickets" value={q.data.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" previous={q.data.previous_kpis?.total_tickets} hint="Distinct Jira ids referenced in the period (each counted once)." onClick={() => nav(`/jira${qs}`)} />
            <KpiCard label="Completed" value={q.data.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" previous={q.data.previous_kpis?.completed_tickets} hint="Tickets whose latest status is Completed or Deployed." onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={q.data.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" previous={q.data.previous_kpis?.in_progress_tickets} onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Pending / on hold" value={q.data.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" previous={q.data.previous_kpis?.pending_tickets} onClick={() => setList('status', ['pending', 'on_hold'])} />
            <KpiCard label="Blocked" value={q.data.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" previous={q.data.previous_kpis?.blocked_tickets} onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Dev deployments" value={q.data.kpis.dev_deployed} sub={`${q.data.kpis.dev_pending} pending`} icon={<ServerCog className="h-4 w-4" />} tone="teal" previous={q.data.previous_kpis?.dev_deployed} onClick={() => nav(`/deployments/dev${qs}`)} />
            <KpiCard label="Production releases" value={q.data.kpis.production_releases} sub={`${q.data.kpis.production_released} deployed Â· ${q.data.kpis.production_pending} pending`} icon={<Rocket className="h-4 w-4" />} tone="purple" previous={q.data.previous_kpis?.production_releases} onClick={() => nav(`/deployments/production${qs}`)} />
            <KpiCard label="Prod success rate" value={q.data.kpis.production_success_rate} suffix="%" icon={<Clock className="h-4 w-4" />} tone="green" hint="Released Ã· production release records in period." />
            {q.data.jira && (
              <KpiCard
                label="Excel vs Jira"
                value={q.data.jira.errors + q.data.jira.warnings}
                sub={`${q.data.jira.matched}/${q.data.jira.compared} match Â· ${q.data.jira.not_found} not found Â· ${q.data.jira.missing_from_excel} missing in sheets`}
                icon={<Plug className="h-4 w-4" />}
                tone={q.data.jira.errors ? 'red' : q.data.jira.warnings ? 'orange' : 'green'}
                hint={`Discrepancies between the bi-weekly sheets and live Jira. Last sync ${q.data.jira.last_sync ? new Date(q.data.jira.last_sync).toLocaleString() : 'never'}.`}
                onClick={() => nav(`/jira?tab=live${queryString ? `&${queryString}` : ''}`)}
              />
            )}
          </KpiGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Overall work status" description="Unique tickets by latest status. Click to filter.">
              <DonutChart data={q.data.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
            </ChartCard>
            <ChartCard title="Employee-wise performance" description="Ticket status per employee. Click a bar to open the employee." className="lg:col-span-2">
              <StackedBarChart data={q.data.charts.status_by_employee} series={STATUS_SERIES} onSelect={goEmployee} max={25} />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Project-wise performance" description="Ticket status per project. Click to open the project.">
              <StackedBarChart data={q.data.charts.status_by_project} series={STATUS_SERIES} onSelect={goProject} />
            </ChartCard>
            <ChartCard title="Daily completed tickets & work activity" description="Per report date. Completed = first report date the ticket was marked complete.">
              <TrendChart data={q.data.charts.trend} series={[{ key: 'activities', label: 'Activities', color: '#2563eb' }, { key: 'completed_tickets', label: 'Completed tickets', color: '#16a34a' }, { key: 'unique_tickets', label: 'Unique tickets', color: '#7c3aed', dashed: true }]} />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <ChartCard title="Development vs Analysis vs Testing" description="Activity rows by work type.">
              <TrendBarChart data={q.data.charts.trend} series={[{ key: 'development', label: 'Development', color: '#2563eb' }, { key: 'analysis', label: 'Analysis', color: '#f97316' }, { key: 'testing', label: 'Testing', color: '#7c3aed' }, { key: 'deployment', label: 'Deployment', color: '#16a34a' }, { key: 'bug_fix', label: 'Bug fix', color: '#dc2626' }]} />
            </ChartCard>
            <ChartCard title="Dev deployment summary" description="Activity rows by Dev Deployment Status.">
              <DonutChart data={q.data.charts.dev_deployment} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="activities" />
            </ChartCard>
            <ChartCard title="Production release summary" description="Production Deployment Summary rows by status.">
              <DonutChart data={q.data.charts.prod_deployment} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
            </ChartCard>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Project-wise blocked & pending work" description="Blocked, pending and on-hold tickets per project.">
              <StackedBarChart data={q.data.charts.status_by_project.filter((p) => Number(p.blocked) + Number(p.pending) + Number(p.on_hold) + Number(p.analysis) > 0)} series={[{ key: 'blocked', label: 'Blocked', color: 'red' }, { key: 'pending', label: 'Pending', color: 'orange' }, { key: 'on_hold', label: 'On hold', color: 'amber' }, { key: 'analysis', label: 'Analysis', color: 'purple' }]} onSelect={goProject} />
            </ChartCard>
            <ChartCard title="Employee-wise pending & in-progress work" description="Tickets not yet completed per employee.">
              <StackedBarChart data={q.data.charts.status_by_employee.filter((e) => Number(e.total) - Number(e.completed_total) > 0).map((e) => ({ ...e, name: e.name }))} series={[{ key: 'in_progress', label: 'In progress', color: 'blue' }, { key: 'development', label: 'Development', color: 'blue' }, { key: 'testing', label: 'Testing', color: 'purple' }, { key: 'pending', label: 'Pending', color: 'orange' }, { key: 'on_hold', label: 'On hold', color: 'amber' }, { key: 'blocked', label: 'Blocked', color: 'red' }]} onSelect={goEmployee} />
            </ChartCard>
          </div>

          {(FEATURES.applications || FEATURES.workTypeByEmployee || FEATURES.dataQualityCard) && (
          <div className={cn('grid gap-4', [FEATURES.applications, FEATURES.workTypeByEmployee, FEATURES.dataQualityCard].filter(Boolean).length > 1 ? 'lg:grid-cols-3' : 'lg:grid-cols-1')}>
            {FEATURES.applications && (
              <ChartCard title="Workload by application" description="Activity rows per application.">
                <NamedBarChart data={q.data.charts.activities_by_application} onSelect={(n) => toggleValue('application', n)} color="#0d9488" valueLabel="Activities" />
              </ChartCard>
            )}
            {FEATURES.workTypeByEmployee && (
              <ChartCard title="Work type by employee" description="Activity rows by type.">
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