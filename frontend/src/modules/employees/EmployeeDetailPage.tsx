import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertOctagon, CheckCircle2, FileOutput, Hourglass, Rocket, ServerCog, Ticket, FlaskConical, Code2, SearchCheck } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, CategoryBarChart, NamedBarChart, TrendChart, TrendBarChart, StackedBarChart, GroupedBarChart, DEV_SERIES, PROD_SERIES } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState, EmptyState } from '@/components/common/States'
import { ActivitiesTable, ReleasesTable, TicketDialog, TicketsTable } from '@/components/common/Tables'
import { InsightsPanel } from '@/components/common/InsightsPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MultiSelect } from '@/components/common/MultiSelect'
import { useDimensions } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { employeeApi } from '@/services/api'
import { cn, fmtDate, fmtNum } from '@/lib/utils'
import { FEATURES } from '@/lib/features'

export default function EmployeeDetailPage() {
  const { name = '' } = useParams()
  const nav = useNavigate()
  const { queryString, toggleValue, filters, setList } = useFilters()
  const { data: dims } = useDimensions()
  const [ticket, setTicket] = useState<string | null>(null)
  const [tab, setTab] = useState('overview')

  const summary = useQuery({ queryKey: ['employee', name, 'summary', queryString], queryFn: () => employeeApi.summary(name, queryString), enabled: !!name, placeholderData: (p) => p })
  const acts = useQuery({ queryKey: ['employee', name, 'activities', queryString], queryFn: () => employeeApi.activities(name, queryString), enabled: !!name })
  const perf = useQuery({ queryKey: ['employee', name, 'performance', queryString], queryFn: () => employeeApi.performance(name, queryString), enabled: !!name })

  const qs = queryString ? `?${queryString}` : ''
  const d = summary.data
  const row = d?.employees[0]
  const profile = d?.profile[0]

  return (
    <>
      <PageHeader
        title={name}
        description={row ? [row.project ?? 'Project not specified', FEATURES.applications ? (row.application ?? 'Application not specified') : null, row.jira_board ?? 'Board not specified', row.team_lead ? `Lead: ${row.team_lead}` : null].filter(Boolean).join(' Â· ') : profile ? [profile.project, FEATURES.applications ? profile.application : null].filter(Boolean).join(' Â· ') : undefined}
        breadcrumbs={[{ label: 'Employees', to: `/employees${qs}` }, { label: name }]}
        period={d?.period}
        actions={
          <>
            <MultiSelect label="Employee" options={(dims?.employees ?? []).map((e) => ({ value: e, label: e }))} value={[name]} onChange={(v) => v.length && nav(`/employees/${encodeURIComponent(v[v.length - 1])}${qs}`)} width="w-[220px]" />
            <Button variant="outline" size="sm" onClick={() => nav(`/reports?type=employee&target=${encodeURIComponent(name)}${queryString ? `&${queryString}` : ''}`)}>
              <FileOutput /> Generate report
            </Button>
            <PrintButton />
          </>
        }
      />
      <GlobalFilterBar compact />
      {summary.isLoading && <LoadingState />}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      {d && (
        <>
          {d.kpis.total_activities === 0 && (
            <Card className="border-orange-300 bg-orange-50 dark:bg-orange-950/30">
              <CardContent className="flex items-center justify-between p-4 text-sm">
                <span>
                  {name} has no report dated inside <b>{d.period.label}</b>.
                </span>
                <Button size="sm" variant="outline" onClick={() => nav(`/employees/${encodeURIComponent(name)}?preset=all`)}>
                  Show all data
                </Button>
              </CardContent>
            </Card>
          )}
          <KpiGrid cols={6}>
            <KpiCard label="Activity records" value={d.kpis.total_activities} icon={<Activity className="h-4 w-4" />} tone="grey" previous={d.previous_kpis?.total_activities} compact />
            <KpiCard label="Unique Jira tickets" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" previous={d.previous_kpis?.total_tickets} compact />
            <KpiCard label="Completed" value={d.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" previous={d.previous_kpis?.completed_tickets} compact onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={d.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Pending / on hold" value={d.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => setList('status', ['pending', 'on_hold'])} />
            <KpiCard label="Blocked" value={d.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Analysis" value={d.kpis.analysis_activities} icon={<SearchCheck className="h-4 w-4" />} tone="orange" compact hint="Activity rows with Work Type = Analysis" />
            <KpiCard label="Development" value={d.kpis.development_activities} icon={<Code2 className="h-4 w-4" />} tone="blue" compact hint="Activity rows with Work Type = Development" />
            <KpiCard label="Testing" value={d.kpis.testing_activities} icon={<FlaskConical className="h-4 w-4" />} tone="purple" compact />
            <KpiCard label="Deployment activities" value={d.kpis.deployment_activities} icon={<ServerCog className="h-4 w-4" />} tone="teal" compact />
            <KpiCard label="Dev deployed" value={d.kpis.dev_deployed} sub={`${d.kpis.dev_pending} pending`} icon={<ServerCog className="h-4 w-4" />} tone="green" compact />
            <KpiCard label="Production releases" value={d.kpis.production_releases} sub={`${d.kpis.production_released} deployed`} icon={<Rocket className="h-4 w-4" />} tone="purple" compact />
          </KpiGrid>

          {perf.data?.performance && (() => {
            const p = perf.data.performance
            const cur = p.current
            const statusKeys = ['completed', 'development_tickets', 'code_review', 'testing_tickets', 'ready_for_deployment', 'backlog', 'on_hold', 'blocked'] as const
            const statusRows = p.metrics.filter((m) => (statusKeys as readonly string[]).includes(m.key)).map((m) => ({ name: m.label, current: Number(m.current ?? 0), previous: Number(m.previous ?? 0) }))
            const trend = perf.data.current.trend
            const fmtVal = (v: number | null) => (v === null || v === undefined ? '–' : fmtNum(v, 0))
            return (
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Ticket status — current vs previous period" description={`Unique tickets by latest status. ${perf.data.current.period.label} vs ${perf.data.previous.period.label}.`} className="lg:col-span-2" height={300}>
                  <GroupedBarChart data={statusRows} series={[{ key: 'current', label: 'Current period', color: 'blue' }, { key: 'previous', label: 'Previous period', color: 'grey' }]} height={300} />
                </ChartCard>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Ticket summary</CardTitle>
                    <CardDescription>{cur ? `${cur.unique_tickets} assigned · ${cur.completed} completed · ${cur.in_progress} in progress` : 'No activity in the period'}</CardDescription>
                  </CardHeader>
                  <CardContent className="p-0">
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground">
                        <tr className="border-b">
                          <th className="px-3 py-1.5 text-left font-medium">Metric</th>
                          <th className="px-3 py-1.5 text-right font-medium">Current</th>
                          <th className="px-3 py-1.5 text-right font-medium">Previous</th>
                          <th className="px-3 py-1.5 text-right font-medium">Δ</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.metrics.map((m) => (
                          <tr key={m.key} className={cn('border-b last:border-0', ['unique_tickets', 'completed', 'in_progress'].includes(m.key) && 'font-medium')} title={m.hint}>
                            <td className="px-3 py-1.5">{m.label}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{fmtVal(m.current)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{fmtVal(m.previous)}</td>
                            <td className={cn('px-3 py-1.5 text-right tabular-nums', m.delta === null || m.delta === 0 ? 'text-muted-foreground' : (m.delta > 0) === !['blocked', 'overdue', 'on_hold', 'backlog'].includes(m.key) ? 'text-green-600' : 'text-red-600')}>{m.delta === null ? '–' : `${m.delta > 0 ? '+' : ''}${fmtNum(m.delta, 0)}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </CardContent>
                </Card>
                <Card className="lg:col-span-3">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Performance trend</CardTitle>
                    <CardDescription>Per day in the period: tickets touched, completed, in-progress / pending / blocked rows, deployments. Chart on top, same numbers in the table below.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TrendBarChart data={trend} series={[{ key: 'completed_activities', label: 'Completed', color: '#16a34a' }, { key: 'in_progress_activities', label: 'In progress', color: '#2563eb' }, { key: 'pending_activities', label: 'Pending / on hold', color: '#f97316' }, { key: 'blocked_activities', label: 'Blocked', color: '#dc2626' }]} />
                    <div className="max-h-72 overflow-auto rounded-md border">
                      <table className="w-full text-xs">
                        <thead className="sticky top-0 bg-muted text-muted-foreground">
                          <tr>
                            <th className="px-3 py-1.5 text-left font-medium">Date</th>
                            <th className="px-3 py-1.5 text-right font-medium">Tickets</th>
                            <th className="px-3 py-1.5 text-right font-medium">Completed</th>
                            <th className="px-3 py-1.5 text-right font-medium">In progress</th>
                            <th className="px-3 py-1.5 text-right font-medium">Pending</th>
                            <th className="px-3 py-1.5 text-right font-medium">Blocked</th>
                            <th className="px-3 py-1.5 text-right font-medium">Dev deployed</th>
                            <th className="px-3 py-1.5 text-right font-medium">Prod released</th>
                            <th className="px-3 py-1.5 text-right font-medium">Open backlog</th>
                            <th className="px-3 py-1.5 text-right font-medium">Activities</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...trend].reverse().map((t) => (
                            <tr key={t.date} className="border-t">
                              <td className="whitespace-nowrap px-3 py-1.5">{fmtDate(t.date)}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{t.unique_tickets}</td>
                              <td className={cn('px-3 py-1.5 text-right tabular-nums', t.completed_tickets > 0 && 'font-medium text-green-600')}>{t.completed_tickets}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-blue-600">{t.in_progress_activities}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-orange-600">{t.pending_activities}</td>
                              <td className={cn('px-3 py-1.5 text-right tabular-nums', t.blocked_activities > 0 && 'font-medium text-red-600')}>{t.blocked_activities}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{t.dev_deployed}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{t.released}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{t.backlog}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{t.activities}</td>
                            </tr>
                          ))}
                          {!trend.length && <tr><td colSpan={10} className="px-3 py-4 text-center text-muted-foreground">No activity in the period</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          })()}
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="tickets">Jira Tickets</TabsTrigger>
              <TabsTrigger value="activities">Work Activities</TabsTrigger>
              <TabsTrigger value="dev">Dev Deployment</TabsTrigger>
              <TabsTrigger value="prod">Production Release</TabsTrigger>
              <TabsTrigger value="trends">Performance Trends</TabsTrigger>
              <TabsTrigger value="reports">Reports & Notes</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Ticket status distribution" description="Unique tickets by latest status. Click to filter the tables.">
                  <DonutChart data={d.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
                </ChartCard>
                <ChartCard title="Completed vs in progress" description="Unique tickets.">
                  <CategoryBarChart data={d.charts.ticket_status.filter((c) => ['completed', 'deployed', 'in_progress', 'development', 'testing', 'code_review', 'pending', 'on_hold', 'blocked', 'analysis', 'other'].includes(c.key))} onSelect={(k) => toggleValue('status', k)} />
                </ChartCard>
                <ChartCard title="Development vs Analysis vs Testing" description="Activity rows by work type.">
                  <CategoryBarChart data={d.charts.work_type} onSelect={(k) => toggleValue('work_type', k)} />
                </ChartCard>
              </div>
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                <ChartCard title="Daily work activity" description="Activity rows per report date.">
                  <TrendChart data={d.charts.trend} series={[{ key: 'activities', label: 'Activities', color: '#2563eb' }, { key: 'completed_activities', label: 'Completed rows', color: '#16a34a' }]} area />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Project / application contribution" description="Activity rows by application.">
                    <NamedBarChart data={d.charts.activities_by_application} onSelect={(n) => toggleValue('application', n)} color="#0d9488" valueLabel="Activities" />
                  </ChartCard>
                )}
                <ChartCard title="Blocked & pending work" description="Tickets requiring attention.">
                  <CategoryBarChart data={d.charts.ticket_status.filter((c) => ['blocked', 'pending', 'on_hold', 'reopened', 'analysis'].includes(c.key))} onSelect={(k) => toggleValue('status', k)} />
                </ChartCard>
              </div>
              <InsightsPanel insights={d.insights} title="Observations" max={8} />
            </TabsContent>

            <TabsContent value="tickets">
              <Card>
                <CardHeader>
                  <CardTitle>Jira tickets ({perf.data?.tickets.length ?? 'â€¦'})</CardTitle>
                  <CardDescription>One row per unique ticket. Status = latest status according to the configured rule. Click a ticket id for its full history.</CardDescription>
                </CardHeader>
                <CardContent>{perf.data ? <TicketsTable items={perf.data.tickets} onTicket={setTicket} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activities">
              <Card>
                <CardHeader>
                  <CardTitle>Work activities ({acts.data?.total ?? 'â€¦'})</CardTitle>
                  <CardDescription>Every Work Items row for {name} in the period, traceable to the source workbook and row.</CardDescription>
                </CardHeader>
                <CardContent>{acts.data ? <ActivitiesTable items={acts.data.items} onTicket={setTicket} hideEmployee /> : acts.isError ? <ErrorState error={acts.error} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="dev" className="space-y-4">
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-2' : 'lg:grid-cols-1')}>
                <ChartCard title="Dev deployment status" description="Activity rows by Dev Deployment Status.">
                  <DonutChart data={d.charts.dev_deployment} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="activities" />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Dev deployment by application">
                    <StackedBarChart data={d.charts.dev_by_application} series={DEV_SERIES} />
                  </ChartCard>
                )}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Deployment-relevant activities</CardTitle>
                </CardHeader>
                <CardContent>{acts.data ? <ActivitiesTable items={acts.data.items.filter((a) => a.dev_deployment !== 'not_required' || a.prod_required === 'yes')} onTicket={setTicket} hideEmployee /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="prod" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Production deployment status" description="Production Deployment Summary rows.">
                  <DonutChart data={d.charts.prod_deployment} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
                </ChartCard>
                <ChartCard title="Production release activity" description="Release records per date.">
                  <TrendBarChart data={d.charts.release_trend} series={PROD_SERIES.map((s) => ({ key: s.key, label: s.label, color: s.color === 'green' ? '#16a34a' : s.color === 'red' ? '#dc2626' : s.color === 'orange' ? '#f97316' : s.color === 'blue' ? '#2563eb' : '#6b7280' }))} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Production releases ({perf.data?.releases.length ?? 'â€¦'})</CardTitle>
                </CardHeader>
                <CardContent>{perf.data ? <ReleasesTable items={perf.data.releases} onTicket={setTicket} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trends" className="space-y-4">
              {perf.data ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ChartCard title="Daily completed ticket trend" description="First report date each ticket was marked completed.">
                      <TrendChart data={perf.data.current.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: '#16a34a' }, { key: 'unique_tickets', label: 'Tickets reported', color: '#2563eb', dashed: true }]} />
                    </ChartCard>
                    <ChartCard title="Status mix over time" description="Activity rows by status per report date.">
                      <TrendBarChart data={perf.data.current.trend} series={[{ key: 'completed_activities', label: 'Completed', color: '#16a34a' }, { key: 'in_progress_activities', label: 'In progress', color: '#2563eb' }, { key: 'pending_activities', label: 'Pending', color: '#f97316' }, { key: 'blocked_activities', label: 'Blocked', color: '#dc2626' }]} />
                    </ChartCard>
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>Current vs previous period</CardTitle>
                      <CardDescription>
                        {perf.data.current.period.label} compared with {perf.data.previous.period.label}
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
                        {(
                          [
                            ['Activities', 'total_activities'],
                            ['Unique tickets', 'total_tickets'],
                            ['Completed', 'completed_tickets'],
                            ['In progress', 'in_progress_tickets'],
                            ['Blocked', 'blocked_tickets'],
                            ['Dev deployed', 'dev_deployed'],
                            ['Prod releases', 'production_releases'],
                            ['Development rows', 'development_activities'],
                            ['Analysis rows', 'analysis_activities'],
                            ['Testing rows', 'testing_activities'],
                          ] as const
                        ).map(([label, key]) => (
                          <KpiCard key={key} label={label} value={perf.data!.current.kpis[key] as number} previous={perf.data!.previous.kpis[key] as number} compact />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </>
              ) : (
                <LoadingState />
              )}
            </TabsContent>

            <TabsContent value="reports" className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Bi-weekly reports in period ({d.profile.length})</CardTitle>
                  <CardDescription>Source workbooks and the Additional Work Notes captured in each.</CardDescription>
                </CardHeader>
                <CardContent>
                  {d.profile.length === 0 ? (
                    <EmptyState title="No reports in period" />
                  ) : (
                    <div className="space-y-3">
                      {d.profile.map((p) => (
                        <div key={p.file_id} className="rounded-md border p-4">
                          <div className="flex flex-wrap items-center gap-2 text-sm">
                            <Badge variant="info">{fmtDate(p.report_date)}</Badge>
                            <span className="font-medium">{p.file_name}</span>
                            <span className="text-xs text-muted-foreground">
                              {p.project} Â· {p.application} Â· {p.jira_board}
                              {p.team_lead && ` Â· Lead: ${p.team_lead}`}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {p.work_items} work items Â· {p.releases} releases Â· {p.issues} issues
                            </span>
                          </div>
                          {p.team_members && <p className="mt-1 text-xs text-muted-foreground">Team members: {p.team_members}</p>}
                          {p.notes.length > 0 && (
                            <div className="mt-2 space-y-1 border-l-2 border-primary/40 pl-3 text-sm">
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional work notes</p>
                              {p.notes.map((n, i) => (
                                <p key={i} className="whitespace-pre-wrap">
                                  {n}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
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