import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { Activity, AlertOctagon, CheckCircle2, Hourglass, Rocket, Ticket, Users, Zap, Filter, X, SearchCheck } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, GroupedBarChart, NamedBarChart, StackedBarChart, TrendChart, STATUS_SERIES, TYPE_SERIES, CHART_HEIGHT_TALL } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { ReleasesTable, TicketDialog, TicketsTable } from '@/components/common/Tables'
import { InsightsPanel } from '@/components/common/InsightsPanel'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NativeSelect } from '@/components/ui/input'
import { useFilters } from '@/hooks/useFilters'
import { sprintApi } from '@/services/api'
import { employeeColumns } from '@/modules/employees/EmployeesPage'
import { cn, fmtDate, fmtPct } from '@/lib/utils'
import type { SprintRow } from '@/types'

const STATE_BADGE: Record<string, { label: string; variant: 'success' | 'info' | 'muted' }> = {
  active: { label: 'Active', variant: 'success' },
  future: { label: 'Upcoming', variant: 'info' },
  closed: { label: 'Closed', variant: 'muted' },
}

function sprintRange(s: SprintRow): string {
  if (!s.start_date) return 'no dates'
  const end = s.complete_date ?? s.end_date
  return `${fmtDate(s.start_date, { day: '2-digit', month: 'short' })} - ${end ? fmtDate(end, { day: '2-digit', month: 'short' }) : 'open'}`
}

function sprintColumns(): ColumnDef<SprintRow, unknown>[] {
  const num = (key: keyof SprintRow, header: string, cls?: string): ColumnDef<SprintRow, unknown> => ({
    accessorKey: key,
    header,
    cell: ({ getValue }) => <span className={cn('tabular-nums', cls, (getValue() as number) === 0 && 'text-muted-foreground/50')}>{getValue() as number}</span>,
  })
  return [
    { accessorKey: 'name', header: 'Sprint', cell: ({ row }) => <span className="font-medium whitespace-nowrap">{row.original.name}</span> },
    {
      accessorKey: 'state',
      header: 'State',
      cell: ({ getValue }) => {
        const m = STATE_BADGE[(getValue() as string) ?? '']
        return m ? <Badge variant={m.variant}>{m.label}</Badge> : <span className="text-muted-foreground">-</span>
      },
    },
    { accessorKey: 'start_date', header: 'Dates', cell: ({ row }) => <span className="whitespace-nowrap text-xs">{sprintRange(row.original)}</span> },
    { accessorKey: 'board', header: 'Board', cell: ({ getValue }) => <span className="text-xs">{(getValue() as string) ?? '-'}</span> },
    num('tickets', 'Tickets'),
    num('completed', 'Completed', 'text-green-600 font-medium'),
    num('in_progress', 'In progress', 'text-blue-600'),
    num('pending', 'Pending', 'text-orange-600'),
    num('blocked', 'Blocked', 'text-red-600 font-medium'),
    num('analysis', 'Analysis'),
    num('employees', 'People'),
    num('production_released', 'Prod deployed'),
    { accessorKey: 'completed_share', header: 'Done %', cell: ({ getValue }) => <span className="tabular-nums">{fmtPct(getValue() as number | null)}</span> },
  ]
}

export default function SprintsPage() {
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const { queryString, filters, setList, toggleValue } = useFilters()
  const [ticket, setTicket] = useState<string | null>(null)
  // The list ignores the sprint filter itself so every sprint stays visible for selection.
  const listQs = useMemo(() => {
    const p = new URLSearchParams(queryString)
    p.delete('sprint')
    return p.toString()
  }, [queryString])
  const list = useQuery({ queryKey: ['sprints', listQs], queryFn: () => sprintApi.list(listQs) })
  const [velocityView, setVelocityView] = useState<string>('last:10')
  const [velocityUnit, setVelocityUnit] = useState<'points' | 'tickets' | null>(null)
  const items = useMemo(() => list.data?.items ?? [], [list.data])
  const names = useMemo(() => new Set(items.map((s) => s.name)), [items])
  const requested = sp.get('selected') ?? filters.sprint[0] ?? null
  // A sprint from another board stays in the URL after the filter changes - fall back to the active/first sprint of the new list.
  const selectedName = list.data ? (requested && names.has(requested) ? requested : list.data.active ?? items[0]?.name ?? null) : null
  useEffect(() => {
    if (list.data && selectedName && sp.get('selected') !== selectedName) {
      setSp((prev) => { const n = new URLSearchParams(prev); n.set('selected', selectedName); return n }, { replace: true })
    }
  }, [list.data, selectedName, sp, setSp])
  const detail = useQuery({ queryKey: ['sprints', 'detail', selectedName, listQs], queryFn: () => sprintApi.detail(selectedName!, listQs), enabled: !!selectedName })
  const cols = useMemo(() => sprintColumns(), [])
  const empCols = useMemo(() => employeeColumns(), [])
  const qs = queryString ? `?${queryString}` : ''
  const goEmployee = (n: string) => nav(`/employees/${encodeURIComponent(n)}${qs}`)
  const select = (name: string) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('selected', name); return n })
  const pinned = selectedName !== null && filters.sprint.includes(selectedName)
  const d = detail.data
  const prev = d?.previous_sprint ?? null

  return (
    <>
      <PageHeader
        title="Sprint Performance"
        description="Sprint-wise delivery: the active sprint, previous sprints and what each one completed. Select a sprint to drill in, or apply it as a filter to view it on every tab."
        breadcrumbs={[{ label: 'Sprints' }]}
        period={d?.period}
        actions={<PrintButton />}
      />
      <GlobalFilterBar />
      {list.isLoading && <LoadingState />}
      {list.isError && <ErrorState error={list.error} onRetry={() => list.refetch()} />}
      {list.data && !items.length && <EmptyState title="No sprints found" description="Sprints come from the configured Jira boards (Scrum boards with sprints). Kanban boards and Excel workbooks have no sprints." />}
      {items.length > 0 && (
        <>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {items.slice(0, 12).map((s) => {
              const m = STATE_BADGE[s.state ?? ''] ?? { label: '-', variant: 'muted' as const }
              const isSel = s.name === selectedName
              return (
                <button key={s.name} onClick={() => select(s.name)} className={cn('min-w-[200px] shrink-0 rounded-md border p-3 text-left text-sm transition hover:border-primary/50', isSel && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium" title={s.name}>{s.name}</p>
                    <Badge variant={m.variant} className="shrink-0">{m.label}</Badge>
                  </div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">{sprintRange(s)}{s.board ? ` | ${s.board}` : ''}</p>
                  <div className="mt-2 flex items-center gap-3 text-xs">
                    <span className="text-green-600 font-medium">{s.completed} done</span>
                    <span className="text-blue-600">{s.in_progress} in progress</span>
                    {s.blocked > 0 && <span className="text-red-600 font-medium">{s.blocked} blocked</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{s.tickets} tickets | {s.employees} people{s.completed_share !== null ? ` | ${fmtPct(s.completed_share)} done` : ''}</p>
                </button>
              )
            })}
          </div>

          {selectedName && (
            <div className="flex flex-wrap items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">{selectedName}</span>
              {d?.sprint?.goal && <span className="text-xs text-muted-foreground">| Goal: {d.sprint.goal}</span>}
              {pinned ? (
                <Button size="sm" variant="secondary" onClick={() => setList('sprint', [])}><X /> Remove sprint filter</Button>
              ) : (
                <Button size="sm" variant="outline" onClick={() => setList('sprint', [selectedName])} title="Every dashboard tab will show this sprint only until you remove the filter."><Filter /> Use as filter on all tabs</Button>
              )}
            </div>
          )}

          {detail.isLoading && <LoadingState />}
          {detail.isError && <ErrorState error={detail.error} onRetry={() => detail.refetch()} />}
          {d && (
            <>
              <KpiGrid cols={6}>
                <KpiCard label="Tickets in sprint" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" compact previous={prev?.tickets ?? null} hint={prev ? `Compared with ${prev.name}` : undefined} />
                <KpiCard label="Completed" value={d.kpis.completed_tickets} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact previous={prev?.completed ?? null} onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
                <KpiCard label="In progress" value={d.kpis.in_progress_tickets} icon={<Activity className="h-4 w-4" />} tone="blue" compact previous={prev?.in_progress ?? null} onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
                <KpiCard label="Pending / on hold" value={d.kpis.pending_tickets} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact previous={prev?.pending ?? null} onClick={() => setList('status', ['pending', 'on_hold'])} />
                <KpiCard label="Blocked" value={d.kpis.blocked_tickets} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact previous={prev?.blocked ?? null} onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
                <KpiCard label="Analysis" value={d.kpis.analysis_tickets} icon={<SearchCheck className="h-4 w-4" />} tone="purple" compact previous={prev?.analysis ?? null} />
                <KpiCard label="People" value={d.kpis.active_employees} icon={<Users className="h-4 w-4" />} tone="grey" compact previous={prev?.employees ?? null} />
                <KpiCard label="Dev deployed" value={d.kpis.dev_deployed} tone="teal" compact />
                <KpiCard label="Prod releases" value={d.kpis.production_releases} sub={`${d.kpis.production_released} deployed`} icon={<Rocket className="h-4 w-4" />} tone="purple" compact previous={prev?.production_releases ?? null} />
                <KpiCard label="Remaining" value={d.kpis.remaining_tickets} tone="orange" compact hint="Tickets whose latest status is not Completed / Deployed / Cancelled." />
                <KpiCard label="Done %" value={d.sprint.completed_share} suffix="%" tone="green" compact previous={prev?.completed_share ?? null} />
              </KpiGrid>

              <Tabs defaultValue="overview">
                <TabsList>
                  <TabsTrigger value="overview">Overview</TabsTrigger>
                  <TabsTrigger value="velocity">Velocity</TabsTrigger>
                  <TabsTrigger value="employees">People in sprint</TabsTrigger>
                  <TabsTrigger value="tickets">Tickets ({d.tickets.length})</TabsTrigger>
                  <TabsTrigger value="prod">Production ({d.releases.length})</TabsTrigger>
                  <TabsTrigger value="all">All sprints ({items.length})</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    <ChartCard title="Sprint ticket status" description="Unique tickets by latest status in the sprint.">
                      <DonutChart data={d.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
                    </ChartCard>
                    <ChartCard title="Sprint burn trend" description="Completed tickets per day and open backlog within the sprint." className="lg:col-span-2">
                      <TrendChart data={d.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }, { key: 'backlog', label: 'Open backlog', color: 'orange', dashed: true }]} />
                    </ChartCard>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ChartCard title="Status by person" description="Unique tickets per assignee by latest status. Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                      <StackedBarChart data={d.charts.status_by_employee} series={STATUS_SERIES} onSelect={goEmployee} max={30} />
                    </ChartCard>
                    <ChartCard title="Work type by person" description="Work rows per assignee by work type. Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                      <StackedBarChart data={d.charts.type_by_employee} series={TYPE_SERIES} onSelect={goEmployee} max={30} />
                    </ChartCard>
                  </div>
                  {prev && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Compared with previous sprint - {prev.name}</CardTitle>
                        <CardDescription>{sprintRange(prev)} | {prev.tickets} tickets | {prev.completed} completed | {prev.blocked} blocked | {fmtPct(prev.completed_share)} done. The KPI deltas above are against this sprint.</CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button variant="outline" size="sm" onClick={() => select(prev.name)}>Open {prev.name}</Button>
                      </CardContent>
                    </Card>
                  )}
                  <InsightsPanel insights={d.insights} />
                </TabsContent>

                <TabsContent value="velocity" className="space-y-4">
                  {(() => {
                    const v = list.data!.velocity
                    const unit = velocityUnit ?? v.unit
                    const pts = unit === 'points'
                    const unitLabel = pts ? 'story points' : 'tickets'
                    const all = v.items.map((s) => ({ ...s, committed: pts ? s.committed_points : s.committed_tickets, completed: pts ? s.completed_points : s.completed_tickets }))
                    const shown = velocityView === 'all' ? all : velocityView.startsWith('last:') ? all.slice(-Number(velocityView.slice(5))) : all.filter((s) => s.name === velocityView)
                    const rows = shown.map((s) => ({ name: s.name, committed: s.committed, completed: s.completed }))
                    const avgAll = pts ? v.average_completed_points : v.average_completed_tickets
                    const avg3 = pts ? v.average_last3_points : v.average_last3_tickets
                    const active = all.find((s) => s.state === 'active')
                    const shortName = (n: string) => n.replace(/^.*?(sprint)[\s_-]*/i, 'S').replace(/[_-]+/g, ' ')
                    const rangeLabel = velocityView === 'all' ? `all ${all.length} sprints` : velocityView.startsWith('last:') ? `last ${Math.min(Number(velocityView.slice(5)), all.length)} sprints` : `sprint ${velocityView}`
                    return (
                      <>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground">
                            {v.estimated_share < 30 ? `Only ${v.estimated_share}% of tickets on the selected board(s) carry story points, so velocity is measured in tickets by default.` : `${v.estimated_share}% of tickets carry story points.`}
                          </p>
                          <div className="flex items-center gap-1 rounded-md border p-0.5 text-xs">
                            <Button size="sm" variant={!pts ? 'default' : 'ghost'} className="h-7" onClick={() => setVelocityUnit('tickets')}>Tickets</Button>
                            <Button size="sm" variant={pts ? 'default' : 'ghost'} className="h-7" onClick={() => setVelocityUnit('points')}>Story points</Button>
                          </div>
                        </div>
                        <KpiGrid cols={4}>
                          <KpiCard label={`Average velocity (${unitLabel})`} value={avgAll} icon={<Zap className="h-4 w-4" />} tone="blue" compact hint={`Average completed ${unitLabel} per closed sprint (${v.closed_sprints} closed sprints with work).`} />
                          <KpiCard label="Average of last 3 sprints" value={avg3} tone="teal" compact hint="Recent velocity - the better basis for planning the next sprint." />
                          <KpiCard label={`Current sprint committed`} value={active?.committed ?? null} tone="grey" compact sub={active?.name} />
                          <KpiCard label={`Current sprint completed`} value={active?.completed ?? null} tone="green" compact sub={unitLabel} />
                        </KpiGrid>
                        <ChartCard
                          title={`Velocity by sprint (${unitLabel})`}
                          description={`Committed = ${unitLabel} of all tickets worked in the sprint; Completed = those whose latest status is Completed / Deployed. Showing ${rangeLabel}, oldest on the left; hover a bar for the full sprint name.`}
                          action={
                            <NativeSelect value={velocityView} onChange={(e) => setVelocityView(e.target.value)} className="h-8 w-[220px] text-xs">
                              <option value="last:5">Last 5 sprints</option>
                              <option value="last:10">Last 10 sprints</option>
                              <option value="last:15">Last 15 sprints</option>
                              <option value="all">All sprints ({all.length})</option>
                              <optgroup label="Specific sprint">
                                {[...all].reverse().map((s) => (
                                  <option key={s.name} value={s.name}>{s.name}</option>
                                ))}
                              </optgroup>
                            </NativeSelect>
                          }
                          height={340}
                        >
                          <GroupedBarChart data={rows} series={[{ key: 'committed', label: 'Committed', color: 'slate' }, { key: 'completed', label: 'Completed', color: 'green' }]} labelFormatter={shortName} />
                        </ChartCard>
                        <ChartCard title="Completed velocity trend" description={`Completed ${unitLabel} per sprint with the average as a reference (${rangeLabel}).`} height={260}>
                          <TrendChart data={shown.map((s) => ({ date: shortName(s.name), completed: s.completed, average: avgAll ?? 0 }))} series={[{ key: 'completed', label: 'Completed', color: 'green' }, { key: 'average', label: 'Average', color: 'slate', dashed: true }]} />
                        </ChartCard>
                        <Card>
                          <CardHeader>
                            <CardTitle>Velocity table</CardTitle>
                            <CardDescription>One row per sprint, oldest first. Carry-over = committed - completed.</CardDescription>
                          </CardHeader>
                          <CardContent className="p-0">
                            <table className="w-full text-xs">
                              <thead className="bg-muted text-muted-foreground">
                                <tr>
                                  <th className="px-3 py-1.5 text-left font-medium">Sprint</th>
                                  <th className="px-3 py-1.5 text-left font-medium">Dates</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Committed points</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Completed points</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Tickets</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Completed tickets</th>
                                  <th className="px-3 py-1.5 text-right font-medium">Done %</th>
                                </tr>
                              </thead>
                              <tbody>
                                {v.items.map((s) => (
                                  <tr key={s.name} className={cn('cursor-pointer border-t hover:bg-muted/40', s.state === 'active' && 'font-medium')} onClick={() => select(s.name)}>
                                    <td className="px-3 py-1.5 whitespace-nowrap">{s.name}{s.state === 'active' && <Badge variant="success" className="ml-2">Active</Badge>}</td>
                                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{s.start_date ? `${fmtDate(s.start_date, { day: '2-digit', month: 'short' })} - ${s.end_date ? fmtDate(s.end_date, { day: '2-digit', month: 'short' }) : 'open'}` : '-'}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.committed_points}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-green-600">{s.completed_points}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.committed_tickets}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums text-green-600">{s.completed_tickets}</td>
                                    <td className="px-3 py-1.5 text-right tabular-nums">{s.committed ? fmtPct((100 * s.completed) / s.committed) : '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </CardContent>
                        </Card>
                      </>
                    )
                  })()}
                </TabsContent>

                <TabsContent value="employees" className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-2">
                    <ChartCard title="Completed tickets by person" description="Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                      <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.completed_total) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value)} onSelect={goEmployee} color="green" max={40} valueLabel="Completed" />
                    </ChartCard>
                    <ChartCard title="Blocked tickets by person" description="Click a bar to open the employee." height={CHART_HEIGHT_TALL}>
                      <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.blocked) })).filter((e) => e.value > 0).sort((a, b) => b.value - a.value)} onSelect={goEmployee} color="red" max={40} valueLabel="Blocked" />
                    </ChartCard>
                  </div>
                  <Card>
                    <CardHeader>
                      <CardTitle>People in {selectedName}</CardTitle>
                      <CardDescription>One row per person. Click a row to open the individual dashboard.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable data={d.employees} columns={empCols} onRowClick={(r) => goEmployee(r.employee)} exportName={`sprint-${selectedName}-people`} dense initialSorting={[{ id: 'completed', desc: true }]} />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="tickets">
                  <Card>
                    <CardHeader>
                      <CardTitle>Tickets in {selectedName} ({d.tickets.length})</CardTitle>
                      <CardDescription>Carried-over tickets are attributed to the sprint in which the work happened.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <TicketsTable items={d.tickets} onTicket={setTicket} />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="prod">
                  <Card>
                    <CardHeader>
                      <CardTitle>Production releases in {selectedName} ({d.releases.length})</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <ReleasesTable items={d.releases} onTicket={setTicket} />
                    </CardContent>
                  </Card>
                </TabsContent>

                <TabsContent value="all">
                  <Card>
                    <CardHeader>
                      <CardTitle>All sprints</CardTitle>
                      <CardDescription>Active sprint first, then previous sprints newest first. The global date range is not applied here; the other filters (employee, project, board...) are.</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <DataTable data={items} columns={cols} onRowClick={(r) => select(r.name)} exportName="sprints" dense />
                    </CardContent>
                  </Card>
                </TabsContent>
              </Tabs>
            </>
          )}
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}
