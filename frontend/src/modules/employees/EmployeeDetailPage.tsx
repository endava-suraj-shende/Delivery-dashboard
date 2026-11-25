import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Activity, AlertOctagon, CheckCircle2, FileOutput, Hourglass, Rocket, ServerCog, Ticket, FlaskConical, Code2, SearchCheck, TrendingUp, TrendingDown } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, CategoryBarChart, NamedBarChart, TrendChart, TrendBarChart, StackedBarChart, DEV_SERIES, PROD_SERIES } from '@/components/charts'
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
        description={row ? [row.project ?? 'Project not specified', FEATURES.applications ? (row.application ?? 'Application not specified') : null, row.jira_board ?? 'Board not specified', row.team_lead ? `Lead: ${row.team_lead}` : null].filter(Boolean).join(' | ') : profile ? [profile.project, FEATURES.applications ? profile.application : null].filter(Boolean).join(' | ') : undefined}
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
            <KpiCard label="Unique Jira tickets" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" previous={d.previous_kpis?.total_tickets} compact />
            <KpiCard label="Completed" value={d.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" previous={d.previous_kpis?.completed_tickets} compact onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="In progress" value={d.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Pending / on hold" value={d.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => setList('status', ['pending', 'on_hold'])} />
            <KpiCard label="Blocked" value={d.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Analysis" value={d.kpis.analysis_activities} icon={<SearchCheck className="h-4 w-4" />} tone="orange" compact hint="Work rows with type Analysis" />
            <KpiCard label="Development" value={d.kpis.development_activities} icon={<Code2 className="h-4 w-4" />} tone="blue" compact hint="Work rows with type Development" />
            <KpiCard label="Testing" value={d.kpis.testing_activities} icon={<FlaskConical className="h-4 w-4" />} tone="purple" compact />
            <KpiCard label="Dev deployed" value={d.kpis.dev_deployed} sub={`${d.kpis.dev_pending} pending`} icon={<ServerCog className="h-4 w-4" />} tone="green" compact />
            <KpiCard label="Production releases" value={d.kpis.production_releases} sub={`${d.kpis.production_released} deployed`} icon={<Rocket className="h-4 w-4" />} tone="purple" compact />
          </KpiGrid>

          {perf.data?.performance && (() => {
            const p = perf.data.performance
            const cur = p.current
            const trend = perf.data.current.trend
            const fmtVal = (v: number | null) => (v === null || v === undefined ? '-' : fmtNum(v, 0))
            const groups: { title: string; keys: string[]; tone: string }[] = [
              { title: 'Delivery', keys: ['unique_tickets', 'completed', 'on_time', 'overdue'], tone: 'bg-green-500' },
              { title: 'Work in progress', keys: ['development_tickets', 'code_review', 'testing_tickets', 'ready_for_deployment', 'backlog', 'on_hold', 'blocked'], tone: 'bg-blue-500' },
              { title: 'Deployments', keys: ['dev_deployed', 'production_releases', 'production_released'], tone: 'bg-purple-500' },
            ]
            const badKeys = ['blocked', 'overdue', 'on_hold', 'backlog']
            const swatch: Record<string, string> = { unique_tickets: '#64748b', completed: '#16a34a', on_time: '#16a34a', overdue: '#dc2626', development_tickets: '#2563eb', code_review: '#4f46e5', testing_tickets: '#7c3aed', ready_for_deployment: '#0d9488', backlog: '#f97316', on_hold: '#eab308', blocked: '#dc2626', dev_deployed: '#0d9488', production_releases: '#7c3aed', production_released: '#16a34a' }
            const metricByKey = new Map(p.metrics.map((m) => [m.key, m]))
            const Change = ({ m }: { m: (typeof p.metrics)[number] }) => {
              if (m.delta === null || m.delta === undefined || m.delta === 0) return <span className="inline-block min-w-[2.75rem] rounded-full bg-muted px-2 py-0.5 text-center text-[11px] text-muted-foreground">0</span>
              const good = (m.delta > 0) === !badKeys.includes(m.key)
              return (
                <span className={cn('inline-flex min-w-[2.75rem] items-center justify-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium', good ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>
                  {m.delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                  {m.delta > 0 ? '+' : ''}{fmtNum(m.delta, 0)}
                </span>
              )
            }
            const Rate = ({ label, done, of, color }: { label: string; done: number; of: number; color: string }) => {
              const pct = of ? Math.round((100 * done) / of) : null
              return (
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                  <p className="mt-1 flex items-baseline gap-1.5"><span className="text-xl font-semibold tabular-nums">{pct === null ? '-' : `${pct}%`}</span><span className="text-xs text-muted-foreground tabular-nums">{done} of {of}</span></p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className={cn('h-full rounded-full', color)} style={{ width: `${pct ?? 0}%` }} /></div>
                </div>
              )
            }
            return (
              <div className="grid gap-4">
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle>Ticket summary</CardTitle>
                    <CardDescription>{perf.data.current.period.label} compared with the previous period ({perf.data.previous.period.label}). Green change = improvement, red = deterioration.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {cur && (
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Rate label="Assigned to completed" done={cur.completed} of={cur.unique_tickets} color="bg-green-500" />
                        <Rate label="Carried over to completed" done={cur.completed_carried} of={cur.carried_in} color="bg-slate-500" />
                        <Rate label="New this period to completed" done={cur.completed_new} of={cur.new_in_period} color="bg-blue-500" />
                      </div>
                    )}
                    <div className="grid gap-3 lg:grid-cols-3">
                      {groups.map((g) => {
                        const ms = g.keys.map((k) => metricByKey.get(k)).filter((m): m is NonNullable<typeof m> => !!m)
                        if (!ms.length) return null
                        return (
                          <div key={g.title} className="overflow-hidden rounded-lg border">
                            <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                              <span className={cn('h-2 w-2 rounded-sm', g.tone)} />{g.title}
                              <span className="ml-auto flex gap-4 normal-case tracking-normal"><span className="w-10 text-right">Now</span><span className="w-10 text-right">Prev</span><span className="w-14 text-center">Change</span></span>
                            </div>
                            <ul>
                              {ms.map((m) => {
                                const c = Number(m.current ?? 0)
                                return (
                                  <li key={m.key} className={cn('flex items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-0 hover:bg-muted/40', m.key === 'blocked' && c > 0 && 'bg-red-500/[0.05]')} title={m.hint}>
                                    <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: swatch[m.key] ?? '#64748b' }} />
                                    <span className={cn('min-w-0 flex-1 truncate', ['unique_tickets', 'completed'].includes(m.key) && 'font-medium')}>{m.label}</span>
                                    <span className="flex items-center gap-4 tabular-nums">
                                      <span className="w-10 text-right text-sm font-semibold">{fmtVal(m.current)}</span>
                                      <span className="w-10 text-right text-muted-foreground">{fmtVal(m.previous)}</span>
                                      <span className="w-14 text-center"><Change m={m} /></span>
                                    </span>
                                  </li>
                                )
                              })}
                            </ul>
                          </div>
                        )
                      })}
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Performance trend</CardTitle>
                    <CardDescription>Per day in the period: tickets touched, completed, in-progress / pending / blocked rows, deployments. Chart on top, same numbers in the table below.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <TrendBarChart data={trend} series={[{ key: 'completed_activities', label: 'Completed', color: 'green' }, { key: 'in_progress_activities', label: 'In progress', color: 'blue' }, { key: 'pending_activities', label: 'Pending / on hold', color: 'orange' }, { key: 'blocked_activities', label: 'Blocked', color: 'red' }]} height={260} />
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
              <TabsTrigger value="activities">Work items</TabsTrigger>
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
                <ChartCard title="Work type split" description="Work rows by work type. Click to filter.">
                  <CategoryBarChart data={d.charts.work_type} onSelect={(k) => toggleValue('work_type', k)} selected={filters.work_type} />
                </ChartCard>
                <ChartCard title="Open work by status" description="Tickets not yet completed. Blocked and on-hold items need attention. Click to filter.">
                  <CategoryBarChart data={d.charts.ticket_status.filter((c) => !['completed', 'deployed', 'cancelled', 'other'].includes(c.key))} onSelect={(k) => toggleValue('status', k)} selected={filters.status} />
                </ChartCard>
              </div>
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-2' : 'lg:grid-cols-1')}>
                <ChartCard title="Daily work" description="Completed work rows per report date.">
                  <TrendChart data={d.charts.trend} series={[{ key: 'completed_activities', label: 'Completed rows', color: 'green' }]} area />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Project / application contribution" description="Work rows by application.">
                    <NamedBarChart data={d.charts.activities_by_application} onSelect={(n) => toggleValue('application', n)} color="teal" valueLabel="Work rows" />
                  </ChartCard>
                )}
              </div>
              <InsightsPanel insights={d.insights} title="Observations" max={8} />
            </TabsContent>

            <TabsContent value="tickets">
              <Card>
                <CardHeader>
                  <CardTitle>Jira tickets ({perf.data?.tickets.length ?? '...'})</CardTitle>
                  <CardDescription>One row per unique ticket. Status = latest status according to the configured rule. Click a ticket id for its full history.</CardDescription>
                </CardHeader>
                <CardContent>{perf.data ? <TicketsTable items={perf.data.tickets} onTicket={setTicket} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="activities">
              <Card>
                <CardHeader>
                  <CardTitle>Work activities ({acts.data?.total ?? '...'})</CardTitle>
                  <CardDescription>Every Work Items row for {name} in the period, traceable to the source workbook and row.</CardDescription>
                </CardHeader>
                <CardContent>{acts.data ? <ActivitiesTable items={acts.data.items} onTicket={setTicket} hideEmployee /> : acts.isError ? <ErrorState error={acts.error} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="dev" className="space-y-4">
              <div className={cn('grid gap-4', FEATURES.applications ? 'lg:grid-cols-3' : 'lg:grid-cols-2')}>
                <ChartCard title="Dev deployment status" description="Work rows by dev deployment status. Click to filter.">
                  <DonutChart data={d.charts.dev_deployment} onSelect={(k) => toggleValue('dev_deployment', k)} selected={filters.dev_deployment} centerLabel="work rows" />
                </ChartCard>
                <ChartCard title="Daily dev deployment trend" description="Deployed and pending work rows per report date.">
                  <TrendBarChart data={d.charts.trend} series={[{ key: 'dev_deployed', label: 'Deployed', color: 'green' }, { key: 'dev_pending', label: 'Pending', color: 'orange' }]} />
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
                <ChartCard title="Production deployment status" description="Release records by status. Click to filter.">
                  <DonutChart data={d.charts.prod_deployment} onSelect={(k) => toggleValue('prod_deployment', k)} selected={filters.prod_deployment} centerLabel="releases" />
                </ChartCard>
                <ChartCard title="Production release activity" description="Release records per date.">
                  <TrendBarChart data={d.charts.release_trend} series={PROD_SERIES} />
                </ChartCard>
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>Production releases ({perf.data?.releases.length ?? '...'})</CardTitle>
                </CardHeader>
                <CardContent>{perf.data ? <ReleasesTable items={perf.data.releases} onTicket={setTicket} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trends" className="space-y-4">
              {perf.data ? (
                <>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ChartCard title="Daily completed ticket trend" description="First report date each ticket was marked completed.">
                      <TrendChart data={perf.data.current.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }, { key: 'unique_tickets', label: 'Tickets reported', color: 'blue', dashed: true }]} />
                    </ChartCard>
                    <ChartCard title="Status mix over time" description="Work rows by status per report date.">
                      <TrendBarChart data={perf.data.current.trend} series={[{ key: 'completed_activities', label: 'Completed', color: 'green' }, { key: 'in_progress_activities', label: 'In progress', color: 'blue' }, { key: 'pending_activities', label: 'Pending', color: 'orange' }, { key: 'blocked_activities', label: 'Blocked', color: 'red' }]} />
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
                              {p.project} | {p.application} | {p.jira_board}
                              {p.team_lead && ` | Lead: ${p.team_lead}`}
                            </span>
                            <span className="ml-auto text-xs text-muted-foreground">
                              {p.work_items} work items | {p.releases} releases | {p.issues} issues
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