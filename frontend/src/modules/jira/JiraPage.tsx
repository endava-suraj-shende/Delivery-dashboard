import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Ticket, CheckCircle2, Activity, Hourglass, AlertOctagon, SearchCheck, HelpCircle, History, PauseCircle } from 'lucide-react'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { ChartCard, DonutChart, CategoryBarChart, StackedBarChart, TrendChart, NamedBarChart, STATUS_SERIES } from '@/components/charts'
import { GlobalFilterBar, PageHeader, PrintButton } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { TicketDialog, TicketsTable } from '@/components/common/Tables'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/hooks/useFilters'
import { jiraApi, errorMessage } from '@/services/api'
import { jiraLiveApi } from '@/services/jiraApi'
import { ReconSummaryCards, ReconciliationTable } from '@/components/common/JiraReconciliation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/toast'
import { Link } from 'react-router-dom'
import { Plug } from 'lucide-react'
import { FEATURES } from '@/lib/features'

export default function JiraPage() {
  const { queryString, toggleValue, filters, setList } = useFilters()
  const nav = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [ticket, setTicket] = useState<string | null>(sp.get('ticket'))
  const [lookup, setLookup] = useState('')
  useEffect(() => {
    const t = sp.get('ticket')
    if (t) {
      setTicket(t)
      setSp(
        (p) => {
          const n = new URLSearchParams(p)
          n.delete('ticket')
          return n
        },
        { replace: true },
      )
    }
  }, [sp, setSp])

  const summary = useQuery({ queryKey: ['jira', 'summary', queryString], queryFn: () => jiraApi.summary(queryString), placeholderData: (p) => p })
  const tickets = useQuery({ queryKey: ['jira', 'tickets', queryString], queryFn: () => jiraApi.tickets(queryString), placeholderData: (p) => p })
  const live = useQuery({ queryKey: ['jira', 'status'], queryFn: jiraLiveApi.status })
  const recon = useQuery({ queryKey: ['jira', 'recon', queryString], queryFn: () => jiraLiveApi.reconciliation(queryString), enabled: !!live.data?.configured && live.data.boards.length > 0 && summary.data?.source !== 'jira', placeholderData: (p) => p })
  const qc = useQueryClient()
  const { toast } = useToast()
  const syncMut = useMutation({ mutationFn: () => jiraLiveApi.sync(true), onSuccess: (s) => { qc.invalidateQueries(); toast({ title: 'Jira synced', description: `${s.fetched_issues} issues fetched`, variant: 'success' }) }, onError: (e) => toast({ title: 'Sync failed', description: errorMessage(e), variant: 'destructive' }) })
  const liveCount = recon.data ? recon.data.summary.errors + recon.data.summary.warnings : null
  const d = summary.data
  const qs = queryString ? `?${queryString}` : ''
  const ts = d?.kpis.ticket_status

  return (
    <>
      <PageHeader
        title="Jira Analytics"
        description="Complete Jira ticket position across the team. Unique tickets are counted once; status follows the configured latest-status rule."
        breadcrumbs={[{ label: 'Jira Analytics' }]}
        period={d?.period}
        actions={
          <>
            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                if (lookup.trim()) setTicket(lookup.trim().toUpperCase())
              }}
            >
              <Input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="Open ticket id, e.g. OCS-5777" className="h-8 w-56 text-xs" />
              <Button type="submit" size="sm" variant="outline">
                Open
              </Button>
            </form>
            <PrintButton />
          </>
        }
      />
      <GlobalFilterBar />
      {summary.isLoading && <LoadingState />}
      {summary.isError && <ErrorState error={summary.error} onRetry={() => summary.refetch()} />}
      {d && ts && (
        <>
          <KpiGrid cols={6}>
            <KpiCard label="Unique Jira tickets" value={d.kpis.total_tickets} icon={<Ticket className="h-4 w-4" />} tone="blue" compact previous={d.previous_kpis?.total_tickets} />
            <KpiCard label="Completed" value={ts.completed} icon={<CheckCircle2 className="h-4 w-4" />} tone="green" compact onClick={() => toggleValue('status', 'completed')} active={filters.status.includes('completed')} />
            <KpiCard label="Deployed" value={ts.deployed} tone="green" compact onClick={() => toggleValue('status', 'deployed')} active={filters.status.includes('deployed')} />
            <KpiCard label="In progress" value={ts.in_progress} icon={<Activity className="h-4 w-4" />} tone="blue" compact onClick={() => toggleValue('status', 'in_progress')} active={filters.status.includes('in_progress')} />
            <KpiCard label="Development" value={ts.development} tone="blue" compact onClick={() => toggleValue('status', 'development')} />
            <KpiCard label="Code review" value={ts.code_review} tone="blue" compact onClick={() => toggleValue('status', 'code_review')} />
            <KpiCard label="Testing" value={ts.testing} tone="purple" compact onClick={() => toggleValue('status', 'testing')} />
            <KpiCard label="Ready for QA" value={ts.ready_for_qa} tone="blue" compact onClick={() => toggleValue('status', 'ready_for_qa')} />
            <KpiCard label="Ready for deployment" value={ts.ready_for_deployment} tone="teal" compact onClick={() => toggleValue('status', 'ready_for_deployment')} />
            <KpiCard label="Analysis" value={ts.analysis} icon={<SearchCheck className="h-4 w-4" />} tone="purple" compact onClick={() => toggleValue('status', 'analysis')} />
            <KpiCard label="Pending" value={ts.pending} icon={<Hourglass className="h-4 w-4" />} tone="orange" compact onClick={() => toggleValue('status', 'pending')} />
            <KpiCard label="On hold" value={ts.on_hold} icon={<PauseCircle className="h-4 w-4" />} tone="amber" compact onClick={() => toggleValue('status', 'on_hold')} />
            <KpiCard label="Reopened" value={ts.reopened} tone="pink" compact onClick={() => toggleValue('status', 'reopened')} />
            <KpiCard label="Blocked" value={ts.blocked} icon={<AlertOctagon className="h-4 w-4" />} tone="red" compact onClick={() => toggleValue('status', 'blocked')} active={filters.status.includes('blocked')} />
            <KpiCard label="Other / unmapped" value={ts.other} icon={<HelpCircle className="h-4 w-4" />} tone="grey" compact onClick={() => toggleValue('status', 'other')} hint="Statuses not mapped to a category â€” configure in Status Configuration." />
            <KpiCard label="Changed status in period" value={d.kpis.tickets_changed_status} icon={<History className="h-4 w-4" />} tone="grey" compact hint="Tickets that appear with different statuses across reports." />
            <KpiCard label="Remaining" value={d.kpis.remaining_tickets} tone="orange" compact hint="Tickets whose latest status is not Completed/Deployed/Other." />
          </KpiGrid>

          <Tabs defaultValue={sp.get('tab') ?? 'charts'}>
            <TabsList>
              <TabsTrigger value="charts">Charts</TabsTrigger>
              <TabsTrigger value="tickets">Ticket details ({tickets.data?.total ?? 'â€¦'})</TabsTrigger>
              <TabsTrigger value="live" className="gap-1">
                <Plug className="h-3.5 w-3.5" /> Live Jira{liveCount !== null && liveCount > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{liveCount}</span>}
              </TabsTrigger>
              {FEATURES.calculationRules && <TabsTrigger value="rules">Counting rules</TabsTrigger>}
            </TabsList>
            <TabsContent value="charts" className="space-y-4">
              <div className="grid gap-4 lg:grid-cols-3">
                <ChartCard title="Overall Jira status distribution">
                  <DonutChart data={d.charts.ticket_status} onSelect={(k) => toggleValue('status', k)} selected={filters.status} centerLabel="tickets" />
                </ChartCard>
                <ChartCard title="Completed vs remaining">
                  <CategoryBarChart
                    data={[
                      { key: 'completed', label: 'Completed / Deployed', color: 'green', value: d.kpis.completed_tickets },
                      { key: 'remaining', label: 'Remaining', color: 'orange', value: d.kpis.remaining_tickets },
                      { key: 'other', label: 'Unmapped', color: 'grey', value: ts.other },
                    ]}
                    onSelect={(k) => (k === 'completed' ? setList('status', ['completed', 'deployed']) : k === 'other' ? setList('status', ['other']) : setList('status', ['in_progress', 'development', 'code_review', 'testing', 'ready_for_qa', 'ready_for_deployment', 'analysis', 'pending', 'on_hold', 'reopened', 'blocked']))}
                  />
                </ChartCard>
                <ChartCard title="Daily ticket completion trend">
                  <TrendChart data={d.charts.trend} series={[{ key: 'completed_tickets', label: 'Completed', color: '#16a34a' }, { key: 'unique_tickets', label: 'Reported', color: '#2563eb', dashed: true }]} />
                </ChartCard>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <ChartCard title="Status distribution by employee">
                  <StackedBarChart data={d.charts.status_by_employee} series={STATUS_SERIES} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} max={30} />
                </ChartCard>
                <ChartCard title="Status distribution by project">
                  <StackedBarChart data={d.charts.status_by_project} series={STATUS_SERIES} onSelect={(n) => nav(`/projects/${encodeURIComponent(n)}${qs}`)} />
                </ChartCard>
                {FEATURES.applications && (
                  <ChartCard title="Status distribution by application">
                    <StackedBarChart data={d.charts.status_by_application} series={STATUS_SERIES} onSelect={(n) => toggleValue('application', n)} />
                  </ChartCard>
                )}
                <ChartCard title="Jira board-wise ticket distribution">
                  <StackedBarChart data={d.charts.status_by_board} series={STATUS_SERIES} onSelect={(n) => toggleValue('jira_board', n)} />
                </ChartCard>
                <ChartCard title="Ticket backlog trend" description="Cumulative tickets seen minus cumulative completed.">
                  <TrendChart data={d.charts.trend} series={[{ key: 'backlog', label: 'Open backlog', color: '#f97316' }]} area />
                </ChartCard>
                <ChartCard title="Blocked tickets by employee">
                  <NamedBarChart data={d.charts.status_by_employee.map((e) => ({ name: e.name, value: Number(e.blocked) })).filter((e) => e.value > 0)} onSelect={(n) => nav(`/employees/${encodeURIComponent(n)}${qs}`)} color="#dc2626" valueLabel="Blocked" />
                </ChartCard>
                <ChartCard title="In-progress tickets by project">
                  <NamedBarChart data={d.charts.status_by_project.map((p) => ({ name: p.name, value: Number(p.in_progress_total) })).filter((p) => p.value > 0).sort((a, b) => b.value - a.value)} onSelect={(n) => nav(`/projects/${encodeURIComponent(n)}${qs}`)} color="#2563eb" valueLabel="In progress" />
                </ChartCard>
              </div>
            </TabsContent>
            <TabsContent value="tickets">
              <Card>
                <CardHeader>
                  <CardTitle>Jira ticket details</CardTitle>
                  <CardDescription>Search by ticket id; click a ticket to view its Excel activity records, notes and status history.</CardDescription>
                </CardHeader>
                <CardContent>{tickets.data ? <TicketsTable items={tickets.data.items} onTicket={setTicket} pageSize={50} /> : <LoadingState rows={1} />}</CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="live" className="space-y-4">
              {d.source === 'jira' ? (
                <Card>
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                    <span>The dashboards are already built directly from the Jira boards, so there is nothing to reconcile. Excel-vs-Jira comparison is available when the data source is <b>Excel</b> or <b>Jira + Excel</b>.</span>
                    <Button asChild size="sm" variant="outline"><Link to="/config/jira">Data source settings</Link></Button>
                  </CardContent>
                </Card>
              ) : live.data && (!live.data.configured || live.data.boards.length === 0) ? (
                <Card className="border-orange-300">
                  <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5 text-sm">
                    <span>
                      {!live.data.configured ? 'Jira credentials are not configured (EDD_JIRA_EMAIL / EDD_JIRA_API_TOKEN in .env).' : 'No Jira boards configured yet.'} Excel data is unaffected; add a connection to compare it with live Jira.
                    </span>
                    <Button asChild size="sm"><Link to="/config/jira">Open Jira Connections</Link></Button>
                  </CardContent>
                </Card>
              ) : recon.isLoading ? (
                <LoadingState rows={1} />
              ) : recon.isError ? (
                <ErrorState error={recon.error} onRetry={() => recon.refetch()} />
              ) : recon.data ? (
                <>
                  <ReconSummaryCards summary={recon.data.summary} onSync={() => syncMut.mutate()} syncing={syncMut.isPending} />
                  {recon.data.by_employee.some((e) => e.error + e.warning > 0) && (
                    <Card>
                      <CardHeader>
                        <CardTitle>Discrepancies by employee</CardTitle>
                        <CardDescription>Rows reported in the bi-weekly sheets that disagree with Jira, plus Jira issues missing from the sheets.</CardDescription>
                      </CardHeader>
                      <CardContent className="flex flex-wrap gap-2">
                        {recon.data.by_employee.filter((e) => e.error + e.warning + e.info > 0).map((e) => (
                          <Button key={e.employee} variant="outline" size="sm" className="h-auto flex-col items-start py-1.5" onClick={() => nav(`/employees/${encodeURIComponent(e.employee)}${qs}`)}>
                            <span className="font-medium">{e.employee}</span>
                            <span className="text-[11px] text-muted-foreground">{e.ok} ok Â· <span className="text-red-600">{e.error} conflicts</span> Â· <span className="text-orange-600">{e.warning} warnings</span> Â· {e.info} info</span>
                          </Button>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                  <Card>
                    <CardHeader>
                      <CardTitle>Excel vs Jira â€” ticket by ticket</CardTitle>
                      <CardDescription>Excel is the reported view; Jira is live. Checks: {Object.values(recon.data.checks).map((c) => c.description.split(' (')[0]).slice(0, 4).join(' Â· ')} â€¦</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ReconciliationTable items={recon.data.items} onTicket={setTicket} />
                    </CardContent>
                  </Card>
                </>
              ) : null}
            </TabsContent>
            {FEATURES.calculationRules && (
            <TabsContent value="rules">
              <Card>
                <CardHeader>
                  <CardTitle>Counting & status-selection rules</CardTitle>
                  <CardDescription>
                    Active latest-status rule: <b>{d.latest_status_rule === 'most_advanced' ? 'Most advanced status wins' : 'Latest report date wins'}</b>.{' '}
                    <Button variant="link" className="h-auto p-0 text-xs" onClick={() => nav('/config/status')}>
                      Change
                    </Button>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
                    {d.calculation_rules.map((r, i) => (
                      <li key={i}>{r.replace(/\*/g, '')}</li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </TabsContent>
            )}
          </Tabs>
        </>
      )}
      <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
    </>
  )
}
