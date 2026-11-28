import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import type { ColumnDef } from '@tanstack/react-table'
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Brain, Check, Copy, ExternalLink, Gauge, ListChecks,
  MessageSquareText, RefreshCw, Send, ShieldCheck, Sparkles, TrendingUp,
} from 'lucide-react'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States'
import { DataTable } from '@/components/common/DataTable'
import { CategoryCell, EmployeeLink, TicketLink } from '@/components/common/Tables'
import { CategoryBarChart, ChartCard, StackedBarChart, type StackSeries } from '@/components/charts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFilters } from '@/hooks/useFilters'
import { can, useSession } from '@/hooks/useSession'
import {
  intelligenceApi, type AnomaliesResponse, type AnomalyItem, type AskResponse, type IntelligenceStatus, type Recommendation, type RecommendationsResponse,
  type RiskBand, type RiskFactor, type RiskItem, type RiskResponse,
} from '@/services/api'
import type { CategoryPoint, GroupedRow } from '@/types'
import { cn, fmtDate } from '@/lib/utils'

// ------------------------------------------------------------------------------------------------------ naming
// One vocabulary across the page, the API and the docs:
//   Risk score        = open tickets ranked by predicted probability of slipping
//   Recommended actions = reviewable next steps derived from risk and load
//   Early warnings    = weekly series that moved unusually versus their own history
//   Ask the data      = natural-language question -> engine-computed answer
//   Model & trust     = how the model was trained, how good it is, what drives it

type TabKey = 'risk' | 'actions' | 'warnings' | 'ask' | 'model'

const BAND_LABEL: Record<RiskBand, string> = { high: 'High risk', medium: 'Medium risk', low: 'Low risk' }
const BAND_CLS: Record<RiskBand, string> = {
  high: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
}
const BAND_BAR: Record<RiskBand, string> = { high: 'bg-red-500', medium: 'bg-amber-500', low: 'bg-emerald-500' }
const SEV_CLS: Record<AnomalyItem['severity'], string> = {
  danger: BAND_CLS.high,
  warning: BAND_CLS.medium,
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
}
const ACTION_KIND: Record<string, { label: string; hint: string }> = {
  focus: { label: 'Focus', hint: 'Highest predicted risk - review first' },
  unblock: { label: 'Unblock', hint: 'Blocked long enough to need escalation' },
  rebalance: { label: 'Rebalance', hint: 'Overloaded person with movable work' },
  due: { label: 'Due soon', hint: 'At risk and due within days' },
  hygiene: { label: 'Hygiene', hint: 'Data gaps that hide work from plans' },
}
const SUGGESTED_QUESTIONS = [
  'Which tickets are most at risk this sprint?',
  'Who has the most blocked tickets?',
  'How many tickets were completed last week?',
  'What is overdue right now?',
  'When will the remaining work be done?',
  'What should I do first today?',
]

const pct = (v: number) => `${Math.round(v * 100)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Days from today to an ISO date (negative = past). */
function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  const d = new Date(`${iso}T00:00:00`)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86_400_000)
}

/** Turn a model factor into a short, human sentence fragment. Returns null for factors not worth showing. */
function describeFactor(f: RiskFactor): string | null {
  const v = f.value
  switch (f.factor) {
    case 'days to due date': return v < 0 ? `${plural(-v, 'day')} past due` : v === 0 ? 'due today' : `due in ${plural(v, 'day')}`
    case 'has due date': return null // implied by the due-date factor
    case 'age (days)': return `${plural(v, 'day')} old`
    case 'days blocked': return v > 0 ? `blocked for ${plural(v, 'day')}` : null
    case 'was blocked': return v ? 'has been blocked' : null
    case 'was on hold': return v ? 'has been on hold' : null
    case 're-opened': return v ? 're-opened' : null
    case 'sprints carried': return v > 1 ? `carried across ${plural(v, 'sprint')}` : null
    case 'assignee open load': return v > 0 ? `assignee has ${plural(v, 'other open ticket')}` : null
    case 'several assignees': return v ? 'changed hands' : null
    case 'distinct statuses': return `${plural(v, 'distinct status', 'distinct statuses')}`
    case 'status updates': return `${plural(v, 'status update')}`
    case 'days reported': return `reported on ${plural(v, 'day')}`
    case 'story points': return v > 0 ? `${plural(v, 'story point')}` : null
    default: return v ? f.factor : null // work-type flags
  }
}

export default function IntelligencePage() {
  const { queryString } = useFilters()
  const { user } = useSession()
  const qc = useQueryClient()
  const [tab, setTab] = useState<TabKey>('risk')
  const [band, setBand] = useState<RiskBand | 'all'>('all')

  const status = useQuery({ queryKey: ['intel', 'status'], queryFn: intelligenceApi.status, staleTime: 60_000 })
  const risk = useQuery({ queryKey: ['intel', 'risk', queryString], queryFn: () => intelligenceApi.risk(queryString, 500), placeholderData: (p) => p })
  const actions = useQuery({ queryKey: ['intel', 'actions', queryString], queryFn: () => intelligenceApi.recommendations(queryString), placeholderData: (p) => p })
  const warnings = useQuery({ queryKey: ['intel', 'warnings', queryString, 'employee'], queryFn: () => intelligenceApi.anomalies(queryString, 'employee'), placeholderData: (p) => p })
  const retrain = useMutation({ mutationFn: intelligenceApi.retrain, onSuccess: () => qc.invalidateQueries({ queryKey: ['intel'] }) })

  const model = status.data?.model
  const summary = risk.data?.summary
  const showBand = (b: RiskBand | 'all') => { setBand(b); setTab('risk') }

  return (
    <div className="min-w-0 space-y-6" data-testid="intelligence-page">
      <PageHeader
        title="AI Insights"
        description="Predicted delivery risk, recommended actions and early warnings for the current filter scope. Trained on this installation's own history; every score is explained and every figure can be checked on Tickets or People."
        breadcrumbs={[{ label: 'AI Insights' }]}
        actions={can(user, 'admin', 'dm') ? (
          <Button size="sm" variant="outline" onClick={() => retrain.mutate()} disabled={retrain.isPending} aria-label="Retrain the risk model">
            <RefreshCw className={cn('h-4 w-4', retrain.isPending && 'animate-spin')} /> {retrain.isPending ? 'Training...' : 'Retrain model'}
          </Button>
        ) : undefined}
      />
      <GlobalFilterBar compact />

      {risk.isError && <ErrorState error={risk.error} onRetry={() => risk.refetch()} />}

      <KpiGrid cols={5}>
        <KpiCard label="Tickets scored" value={summary?.open ?? '-'} icon={<ListChecks className="h-4 w-4" />} tone="blue" hint="Open tickets in the current scope" onClick={() => showBand('all')} active={tab === 'risk' && band === 'all'} />
        <KpiCard label="High risk" value={summary?.high ?? '-'} icon={<AlertTriangle className="h-4 w-4" />} tone="red" hint="75% or more likely to slip" onClick={() => showBand('high')} active={tab === 'risk' && band === 'high'} />
        <KpiCard label="Medium risk" value={summary?.medium ?? '-'} tone="amber" hint="45% to 75% likely to slip" onClick={() => showBand('medium')} active={tab === 'risk' && band === 'medium'} />
        <KpiCard label="Expected slips" value={summary?.expected_slips ?? '-'} icon={<TrendingUp className="h-4 w-4" />} tone="orange" hint="Sum of slip probabilities - how many of the open tickets will probably be late" />
        <KpiCard
          label="Model accuracy"
          value={model?.trained && model.auc != null ? model.auc.toFixed(2) : model ? 'rules' : '-'}
          suffix={model?.trained ? 'AUC' : undefined}
          icon={<Brain className="h-4 w-4" />}
          tone="purple"
          hint={model?.trained ? `Rank quality on ${model.samples} historical snapshots (1.0 = perfect, 0.5 = chance)` : model?.reason ?? undefined}
          onClick={() => setTab('model')}
          active={tab === 'model'}
        />
      </KpiGrid>

      <DailyBriefing risk={risk.data} actions={actions.data} warnings={warnings.data} loading={risk.isLoading || actions.isLoading} onGo={setTab} />

      <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)} className="space-y-4">
        <TabsList className="h-auto flex-wrap">
          <TabsTrigger value="risk" className="gap-1.5"><Gauge className="h-3.5 w-3.5" aria-hidden /> Risk score</TabsTrigger>
          <TabsTrigger value="actions" className="gap-1.5"><ListChecks className="h-3.5 w-3.5" aria-hidden /> Recommended actions{actions.data ? ` (${actions.data.items.length})` : ''}</TabsTrigger>
          <TabsTrigger value="warnings" className="gap-1.5"><Activity className="h-3.5 w-3.5" aria-hidden /> Early warnings{warnings.data ? ` (${warnings.data.items.length})` : ''}</TabsTrigger>
          <TabsTrigger value="ask" className="gap-1.5"><MessageSquareText className="h-3.5 w-3.5" aria-hidden /> Ask the data</TabsTrigger>
          <TabsTrigger value="model" className="gap-1.5"><ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Model &amp; trust</TabsTrigger>
        </TabsList>

        <TabsContent value="risk">
          {risk.isLoading && !risk.data ? <LoadingState rows={4} /> : risk.data ? <RiskScore data={risk.data} band={band} onBand={setBand} /> : null}
        </TabsContent>
        <TabsContent value="actions">
          {actions.isLoading && !actions.data ? <LoadingState rows={3} /> : actions.data ? <RecommendedActions items={actions.data.items} /> : null}
        </TabsContent>
        <TabsContent value="warnings">
          <EarlyWarnings queryString={queryString} />
        </TabsContent>
        <TabsContent value="ask">
          <AskTheData queryString={queryString} llmEnabled={!!status.data?.llm.enabled} />
        </TabsContent>
        <TabsContent value="model">
          {status.isLoading ? <LoadingState rows={2} /> : status.data ? <ModelAndTrust status={status.data} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ---------------------------------------------------------------------------------------------- daily briefing
/**
 * The page's signature feature: one paragraph that fuses the three analyses (risk, actions, warnings) into what a
 * delivery manager would say at stand-up. Composed from engine figures only, so it is always consistent with the tabs.
 */
function DailyBriefing({ risk, actions, warnings, loading, onGo }: {
  risk?: RiskResponse; actions?: RecommendationsResponse; warnings?: AnomaliesResponse; loading: boolean; onGo: (t: TabKey) => void
}) {
  const [copied, setCopied] = useState(false)
  const lines = useMemo(() => {
    if (!risk) return []
    const s = risk.summary
    const out: { text: string; tab: TabKey }[] = []
    if (!s.open) return [{ text: 'No open tickets in this scope - nothing to score.', tab: 'risk' as TabKey }]
    out.push({
      tab: 'risk',
      text: `${plural(s.open, 'open ticket')} in scope; ${s.high} high risk and ${s.medium} medium. Roughly ${Math.round(s.expected_slips ?? 0)} are expected to slip at the current pace.`,
    })
    const top = risk.items[0]
    if (top) {
      const why = top.factors.map(describeFactor).filter(Boolean).slice(0, 2).join(', ')
      out.push({ tab: 'risk', text: `Most urgent: ${top.ticket_id}${top.employee ? ` (${top.employee})` : ''} at ${pct(top.risk)}${why ? ` - ${why}` : ''}.` })
    }
    const owner = risk.by_employee?.[0]
    if (owner && owner.high >= 3 && s.high && owner.high / s.high >= 0.2) {
      out.push({ tab: 'risk', text: `${owner.employee} holds ${owner.high} of the ${s.high} high-risk tickets (${pct(owner.high / s.high)}).` })
    }
    const act = actions?.items[0]
    if (act) out.push({ tab: 'actions', text: `First action: ${act.title.replace(/^./, (c) => c.toLowerCase())}.` })
    const warn = warnings?.items[0]
    if (warn) out.push({ tab: 'warnings', text: `Early warning: ${warn.text.replace(/\s*\(.*?\)\.?$/, '.')}` })
    return out
  }, [risk, actions, warnings])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lines.map((l) => l.text).join(' '))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable */ }
  }

  return (
    <Card className="border-primary/25 bg-gradient-to-br from-primary/[0.04] to-transparent animate-in fade-in-0 slide-in-from-bottom-2 duration-500" data-testid="daily-briefing">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> Daily briefing</CardTitle>
          <CardDescription>What a delivery manager should know this morning - risk, first action and anything unusual, in one place.</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={copy} disabled={!lines.length} aria-label="Copy briefing">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent className="text-sm leading-relaxed">
        {loading && !lines.length ? <p className="text-muted-foreground">Preparing the briefing...</p> : (
          <ul className="space-y-1">
            {lines.map((l, i) => (
              <li key={i} className="flex items-start gap-2">
                <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/60" aria-hidden />
                <button type="button" onClick={() => onGo(l.tab)} className="rounded-sm text-left hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary" title="Open the related tab">
                  {l.text}
                </button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

// -------------------------------------------------------------------------------------------------- risk score
const BAND_SERIES: StackSeries[] = [
  { key: 'high', label: 'High risk', color: 'red' },
  { key: 'other', label: 'Medium / low risk', color: 'grey' },
]

type RiskRowData = RiskItem & { idx: number; assignee: string; dueDays: number | null }

/** Staggered entrance for table rows - subtle, fast and consistent with the dialog/toast animations elsewhere. */
const rowEntrance = (idx: number) => `animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300 [animation-delay:${Math.min(idx, 20) * 30}ms]`

function RiskScorePill({ risk, band }: { risk: number; band: RiskBand }) {
  return (
    <div className="flex items-center justify-end gap-2">
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
        <div className={cn('h-full rounded-full transition-[width] duration-700 ease-out', BAND_BAR[band])} style={{ width: pct(risk) }} />
      </div>
      <span className={cn('inline-block min-w-[44px] rounded border px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums', BAND_CLS[band])} title={BAND_LABEL[band]}>{pct(risk)}</span>
    </div>
  )
}

function DueCell({ due, days }: { due: string | null; days: number | null }) {
  if (days === null) return <span className="text-muted-foreground">-</span>
  const cls = days < 0 ? 'text-red-600 dark:text-red-300 font-medium' : days <= 3 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground'
  const label = days < 0 ? `${plural(-days, 'day')} overdue` : days === 0 ? 'Due today' : days <= 7 ? `In ${plural(days, 'day')}` : fmtDate(due)
  return <span className={cn('whitespace-nowrap tabular-nums', cls)} title={due ?? undefined}>{label}</span>
}

function RiskScore({ data, band, onBand }: { data: RiskResponse; band: RiskBand | 'all'; onBand: (b: RiskBand | 'all') => void }) {
  const nav = useNavigate()
  const { queryString } = useFilters()
  const [person, setPerson] = useState<string | null>(null)
  const [selected, setSelected] = useState<RiskItem | null>(null)
  const qs = queryString ? `?${queryString}` : ''

  const rows = useMemo<RiskRowData[]>(
    () => data.items
      .filter((i) => (band === 'all' || i.band === band) && (!person || (i.employee ?? 'Unassigned') === person))
      .map((i, idx) => ({ ...i, idx, assignee: i.employee ?? 'Unassigned', dueDays: daysUntil(i.due_date) })),
    [data.items, band, person],
  )

  const byAssignee = useMemo<GroupedRow[]>(
    () => (data.by_employee ?? []).map((e) => ({ name: e.employee, high: e.high, other: Math.max(0, e.open - e.high), total: e.open })),
    [data.by_employee],
  )

  const distribution = useMemo<CategoryPoint[]>(() => [
    { key: 'high', label: 'High risk (75-100%)', color: 'red', value: data.summary.high },
    { key: 'medium', label: 'Medium risk (45-75%)', color: 'amber', value: data.summary.medium },
    { key: 'low', label: 'Low risk (0-45%)', color: 'green', value: data.summary.low },
  ], [data.summary])

  const columns = useMemo<ColumnDef<RiskRowData, unknown>[]>(() => [
    { accessorKey: 'ticket_id', header: 'Ticket', cell: ({ row }) => <TicketLink id={row.original.ticket_id} link={row.original.ticket_link} onOpen={(id) => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(id)}`)} />, size: 110 },
    { accessorKey: 'summary', header: 'Summary', cell: ({ getValue }) => <span className="block max-w-[320px] truncate text-muted-foreground" title={(getValue() as string) ?? ''}>{((getValue() as string | null) ?? '').replace(/\s*\(([A-Z]+-\d+)\)\s*$/, '') || '-'}</span> },
    { accessorKey: 'assignee', header: 'Assignee', cell: ({ row }) => row.original.employee ? <EmployeeLink name={row.original.employee} avatar /> : <span className="text-muted-foreground">Unassigned</span> },
    { accessorKey: 'work_status', header: 'Status', cell: ({ getValue }) => <CategoryCell dim="work_status" value={getValue() as string} />, filterFn: 'equalsString' },
    { accessorKey: 'dueDays', header: 'Due', cell: ({ row }) => <DueCell due={row.original.due_date} days={row.original.dueDays} />, sortingFn: (a, b) => (a.original.dueDays ?? 9999) - (b.original.dueDays ?? 9999) },
    { accessorKey: 'age_days', header: 'Age', cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{getValue() as number}d</span>, meta: { align: 'right' }, size: 70 },
    { accessorKey: 'risk', header: 'Risk score', cell: ({ row }) => <RiskScorePill risk={row.original.risk} band={row.original.band} />, meta: { align: 'right' }, size: 150 },
  ], [nav, qs])

  if (!data.items.length) return <EmptyState title="No open tickets in this scope" description="Widen the period or clear filters to score more work." />

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Where risk concentrates" description="High-risk share of each assignee's open tickets. Click a bar to filter the table." height="auto">
          <StackedBarChart data={byAssignee} series={BAND_SERIES} max={12} selected={person ? [person] : []} onSelect={(n) => setPerson(person === n ? null : n)} />
        </ChartCard>
        <ChartCard title="Risk band distribution" description="How the open tickets split across the three risk bands. Click to filter the table." height="auto">
          <CategoryBarChart data={distribution} selected={band === 'all' ? [] : [band]} onSelect={(k) => onBand(band === k ? 'all' : (k as RiskBand))} />
        </ChartCard>
      </div>

      <Card className="min-w-0">
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Risk score by ticket</CardTitle>
            <CardDescription>Probability of late delivery for every open ticket in scope. Click a row to see why.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter by risk band">
            {(['all', 'high', 'medium', 'low'] as const).map((b) => (
              <Button key={b} size="sm" variant={band === b ? 'default' : 'outline'} onClick={() => onBand(b)} aria-pressed={band === b}>
                {b === 'all' ? `All (${data.summary.open})` : `${BAND_LABEL[b].split(' ')[0]} (${data.summary[b]})`}
              </Button>
            ))}
            {person && <Badge variant="secondary" className="ml-2 gap-1 font-normal">{person}<button type="button" aria-label="Clear assignee filter" onClick={() => setPerson(null)} className="ml-1 rounded hover:text-foreground">x</button></Badge>}
          </div>
        </CardHeader>
        <CardContent className="p-0" data-testid="risk-table">
          <DataTable<RiskRowData>
            data={rows}
            columns={columns}
            pageSize={25}
            dense
            searchPlaceholder="Search ticket, summary or assignee"
            exportName="risk-scores"
            initialSorting={[{ id: 'risk', desc: true }]}
            onRowClick={setSelected}
            rowClassName={(r) => rowEntrance(r.idx)}
            emptyTitle="No tickets match this band"
          />
          {data.items.length < data.summary.open && <p className="border-t px-3 py-2 text-xs text-muted-foreground">Showing the top {data.items.length} of {data.summary.open} by risk - narrow the filters to see the rest.</p>}
        </CardContent>
      </Card>

      <RiskExplanationDialog item={selected} onClose={() => setSelected(null)} onOpenTicket={(id) => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(id)}`)} />
    </div>
  )
}

function RiskExplanationDialog({ item, onClose, onOpenTicket }: { item: RiskItem | null; onClose: () => void; onOpenTicket: (id: string) => void }) {
  const reasons = (item?.factors ?? []).map((f) => ({ text: describeFactor(f), up: f.impact > 0, impact: Math.abs(f.impact) })).filter((r): r is { text: string; up: boolean; impact: number } => !!r.text)
  const maxImpact = Math.max(0.01, ...reasons.map((r) => r.impact))
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        {item && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2"><span className="font-mono">{item.ticket_id}</span><RiskScorePill risk={item.risk} band={item.band} /></DialogTitle>
              <DialogDescription>{item.summary?.replace(/\s*\(([A-Z]+-\d+)\)\s*$/, '') || 'Why this ticket has this risk score'}</DialogDescription>
            </DialogHeader>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Assignee</dt><dd>{item.employee ?? 'Unassigned'}</dd>
              <dt className="text-muted-foreground">Status</dt><dd><CategoryCell dim="work_status" value={item.work_status ?? ''} /></dd>
              <dt className="text-muted-foreground">Due</dt><dd><DueCell due={item.due_date} days={daysUntil(item.due_date)} /></dd>
              {item.jira_board && (<><dt className="text-muted-foreground">Board</dt><dd>{item.jira_board}{item.sprint ? ` / ${item.sprint}` : ''}</dd></>)}
            </dl>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Why this score</p>
              {reasons.length ? (
                <ul className="space-y-1.5">
                  {reasons.map((r, i) => (
                    <li key={i} className={cn('flex items-center gap-2 text-sm', rowEntrance(i))}>
                      {r.up ? <ArrowUpRight className="h-4 w-4 shrink-0 text-red-600 dark:text-red-300" aria-label="raises risk" /> : <ArrowDownRight className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-label="lowers risk" />}
                      <span className="w-56 shrink-0">{r.text}</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className={cn('h-full rounded-full', r.up ? 'bg-red-400' : 'bg-emerald-400')} style={{ width: `${(r.impact / maxImpact) * 100}%` }} /></div>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">No single factor dominates - the score reflects the overall pattern.</p>}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              {item.ticket_link && <Button variant="outline" size="sm" asChild><a href={item.ticket_link} target="_blank" rel="noreferrer">Open in Jira <ExternalLink className="ml-1 h-3.5 w-3.5" /></a></Button>}
              <Button size="sm" onClick={() => { onClose(); onOpenTicket(item.ticket_id) }}>View in Tickets</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ------------------------------------------------------------------------------------------ recommended actions
type ActionRow = Recommendation & { idx: number; urgency: string }
const URGENCY: Record<number, { label: string; cls: string }> = {
  1: { label: 'Do today', cls: BAND_CLS.high },
  2: { label: 'This week', cls: BAND_CLS.medium },
  3: { label: 'When convenient', cls: 'border-border bg-muted text-muted-foreground' },
}

function RecommendedActions({ items }: { items: Recommendation[] }) {
  const nav = useNavigate()
  const { queryString, setList } = useFilters()
  const [selected, setSelected] = useState<ActionRow | null>(null)
  const qs = queryString ? `?${queryString}` : ''
  const openTicket = (id: string) => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(id)}`)
  const rows = useMemo<ActionRow[]>(() => items.map((r, idx) => ({ ...r, idx, urgency: URGENCY[r.priority]?.label ?? 'Later' })), [items])

  const columns = useMemo<ColumnDef<ActionRow, unknown>[]>(() => [
    { accessorKey: 'idx', header: '#', cell: ({ getValue }) => <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{(getValue() as number) + 1}</span>, size: 50, enableSorting: false },
    { accessorKey: 'urgency', header: 'Urgency', cell: ({ row }) => { const u = URGENCY[row.original.priority] ?? URGENCY[3]; return <span className={cn('inline-block whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium', u.cls)}>{u.label}</span> }, filterFn: 'equalsString', size: 110 },
    { accessorKey: 'kind', header: 'Type', cell: ({ getValue }) => { const k = ACTION_KIND[getValue() as string]; return <Badge variant="secondary" className="font-normal" title={k?.hint}>{k?.label ?? (getValue() as string)}</Badge> }, filterFn: 'equalsString', size: 100 },
    { accessorKey: 'title', header: 'Recommended action', cell: ({ row }) => (
      <div className="min-w-[240px]">
        <p className="font-medium leading-snug">{row.original.title}</p>
        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground" title={row.original.detail}>{row.original.detail}</p>
      </div>
    ) },
    { accessorKey: 'tickets', header: 'Tickets', enableSorting: false, cell: ({ row }) => (
      <div className="flex min-w-[210px] flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
        {row.original.tickets.slice(0, 3).map((t) => <TicketLink key={t} id={t} onOpen={openTicket} chip />)}
        {row.original.tickets.length > 3 && <span className="text-xs text-muted-foreground">+{row.original.tickets.length - 3}</span>}
        {!row.original.tickets.length && <span className="text-xs text-muted-foreground">-</span>}
      </div>
    ) },
    { accessorKey: 'effect', header: 'Why it matters', cell: ({ getValue }) => <span className="block max-w-[260px] truncate text-xs text-muted-foreground" title={(getValue() as string) ?? ''}>{(getValue() as string | null) ?? '-'}</span>, enableSorting: false },
  ], [openTicket])

  if (!items.length) return <EmptyState title="Nothing to recommend" description="No high-risk, blocked or overloaded work was found in this scope." icon={<ListChecks className="h-6 w-6" />} />

  return (
    <Card className="min-w-0">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recommended actions, in priority order</CardTitle>
        <CardDescription>Derived from the risk scores and current load. Click a row for the evidence and every affected ticket.</CardDescription>
      </CardHeader>
      <CardContent className="p-0" data-testid="recommendations">
        <DataTable<ActionRow>
          data={rows}
          columns={columns}
          pageSize={25}
          dense
          searchPlaceholder="Search actions"
          exportName="recommended-actions"
          initialSorting={[{ id: 'idx', desc: false }]}
          onRowClick={setSelected}
          rowClassName={(r) => rowEntrance(r.idx)}
          columnFilters={[
            { id: 'urgency', label: 'Urgency', options: Object.values(URGENCY).map((u) => ({ value: u.label, label: u.label })) },
            { id: 'kind', label: 'Type', options: Object.entries(ACTION_KIND).map(([k, v]) => ({ value: k, label: v.label })) },
          ]}
        />
      </CardContent>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-xl">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2">
                  <span className={cn('inline-block rounded border px-1.5 py-0.5 text-xs font-medium', (URGENCY[selected.priority] ?? URGENCY[3]).cls)}>{selected.urgency}</span>
                  <Badge variant="secondary" className="font-normal">{ACTION_KIND[selected.kind]?.label ?? selected.kind}</Badge>
                </div>
                <DialogTitle className="leading-snug">{selected.title}</DialogTitle>
                <DialogDescription>{selected.detail}</DialogDescription>
              </DialogHeader>
              {selected.effect && <p className="text-sm"><span className="font-medium text-muted-foreground">Why it matters:</span> {selected.effect}</p>}
              {selected.evidence.length > 0 && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
                  <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">{selected.evidence.map((e, j) => <li key={j} className={rowEntrance(j)}>{e}</li>)}</ul>
                </div>
              )}
              {(selected.tickets.length > 0 || (selected.employees?.length ?? 0) > 0) && (
                <div>
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Affected</p>
                  <div className="flex flex-wrap gap-1">
                    {selected.tickets.map((t) => <TicketLink key={t} id={t} onOpen={(id) => { setSelected(null); openTicket(id) }} chip />)}
                    {(selected.employees ?? []).map((e) => <button key={e} type="button" className="rounded border px-1.5 py-0.5 text-xs hover:bg-muted" onClick={() => { setSelected(null); nav(`/employees/${encodeURIComponent(e)}${qs}`) }}>{e}</button>)}
                  </div>
                </div>
              )}
              {selected.kind === 'unblock' && (
                <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => { setSelected(null); setList('status', ['blocked']); nav(`/jira${qs}`) }}>View all blocked tickets</Button></div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  )
}

// ------------------------------------------------------------------------------------------------ early warnings
function EarlyWarnings({ queryString }: { queryString: string }) {
  const [groupBy, setGroupBy] = useState<'employee' | 'jira_board'>('employee')
  const q = useQuery({ queryKey: ['intel', 'warnings', queryString, groupBy], queryFn: () => intelligenceApi.anomalies(queryString, groupBy), placeholderData: (p) => p })
  const nav = useNavigate()
  const qs = queryString ? `?${queryString}` : ''
  if (q.isLoading && !q.data) return <LoadingState rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return null
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Each weekly series is compared with its own last {q.data.weeks} weeks. A move is flagged when it is more than {q.data.threshold} robust standard deviations from normal - so a busy team is not penalised for being busy.
        </p>
        <div className="flex gap-1" role="group" aria-label="Group warnings by">
          <Button size="sm" variant={groupBy === 'employee' ? 'default' : 'outline'} onClick={() => setGroupBy('employee')} aria-pressed={groupBy === 'employee'}>People</Button>
          <Button size="sm" variant={groupBy === 'jira_board' ? 'default' : 'outline'} onClick={() => setGroupBy('jira_board')} aria-pressed={groupBy === 'jira_board'}>Boards</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(q.data.series).map(([metric, pts]) => <Sparkline key={metric} label={metric} points={pts} />)}
      </div>
      {q.data.items.length ? (
        <ul className="space-y-2" data-testid="anomaly-list">
          {q.data.items.map((a, i) => (
            <li key={i}>
              <button type="button" className={cn('flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm', SEV_CLS[a.severity], a.group_by === 'employee' && 'hover:brightness-95')}
                onClick={() => a.group_by === 'employee' && nav(`/employees/${encodeURIComponent(a.scope)}${qs}`)} disabled={a.group_by !== 'employee'}>
                {a.direction === 'up' ? <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" aria-label="up" /> : <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0" aria-label="down" />}
                <span className="flex-1"><span className="font-medium">{a.scope}</span> - {a.metric_label} {a.direction === 'up' ? 'jumped to' : 'dropped to'} <span className="font-semibold tabular-nums">{a.value}</span> against a usual <span className="tabular-nums">{Math.round(a.baseline_median)}</span></span>
                <span className="shrink-0 text-xs opacity-70">week of {a.week}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No unusual movements" description="All weekly series are within their normal range for this scope." icon={<Activity className="h-6 w-6" />} />
      )}
    </div>
  )
}

function Sparkline({ label, points }: { label: string; points: { week: string; value: number }[] }) {
  const w = 220
  const h = 48
  const vals = points.map((p) => p.value)
  const max = Math.max(1, ...vals)
  const step = vals.length > 1 ? w / (vals.length - 1) : w
  const y = (v: number) => (h - (v / max) * (h - 4) - 2).toFixed(1)
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v)}`).join(' ')
  const last = vals[vals.length - 1] ?? 0
  const prev = vals[vals.length - 2]
  const delta = prev !== undefined ? last - prev : null
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs capitalize text-muted-foreground">{label.replace(/_/g, ' ')} / week</span>
          <span className="text-sm font-semibold tabular-nums">
            {last}
            {delta !== null && delta !== 0 && <span className={cn('ml-1 text-xs font-normal', delta > 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-red-600 dark:text-red-300')}>{delta > 0 ? '+' : ''}{delta}</span>}
          </span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-12 w-full" role="img" aria-label={`${label} weekly trend, latest ${last}`}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-primary" />
          {vals.length > 0 && <circle cx={((vals.length - 1) * step).toFixed(1)} cy={y(last)} r={2.5} className="fill-primary" />}
        </svg>
      </CardContent>
    </Card>
  )
}

// -------------------------------------------------------------------------------------------------- ask the data
function AskTheData({ queryString, llmEnabled }: { queryString: string; llmEnabled: boolean }) {
  const [question, setQuestion] = useState('')
  const [history, setHistory] = useState<AskResponse[]>([])
  const nav = useNavigate()
  const ask = useMutation({
    mutationFn: (qn: string) => intelligenceApi.ask(queryString, qn),
    onSuccess: (r) => setHistory((h) => [r, ...h].slice(0, 10)),
  })
  const submit = (qn: string) => {
    const t = qn.trim()
    if (!t || ask.isPending) return
    setQuestion('')
    ask.mutate(t)
  }
  return (
    <div className="space-y-4" data-testid="ask-box">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-primary" aria-hidden /> Ask the data</CardTitle>
          <CardDescription>
            Your question becomes a filter, and the analytics engine computes the answer - so it always matches the dashboards.
            {llmEnabled ? ' A language model helps interpret wording; ticket text is never sent.' : ' Understands people, boards, sprints, statuses and periods in plain English.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(question) }}>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. which tickets are at risk for Team Atlas?" aria-label="Your question" maxLength={500} autoComplete="off" />
            <Button type="submit" disabled={!question.trim() || ask.isPending} aria-label="Ask"><Send className="h-4 w-4" /></Button>
          </form>
          <div className="flex flex-wrap gap-1.5" aria-label="Suggested questions">
            {SUGGESTED_QUESTIONS.map((s) => (
              <button key={s} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted disabled:opacity-50" onClick={() => submit(s)} disabled={ask.isPending}>{s}</button>
            ))}
          </div>
          {ask.isPending && <p className="text-sm text-muted-foreground" role="status">Working it out...</p>}
          {ask.isError && <ErrorState error={ask.error} />}
        </CardContent>
      </Card>
      {history.map((r, i) => (
        <Card key={`${r.question}-${i}`} className={cn(i === 0 && 'border-primary/30')}>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium text-muted-foreground">You asked: <span className="text-foreground">{r.question}</span></p>
            <p className="leading-relaxed">{r.answer}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" aria-hidden /> understood as: {r.spec.intent.replace(/_/g, ' ')}</span>
              {r.filters.label ? <span>{String(r.filters.label)}</span> : null}
              {r.spec.status.length > 0 && <span>status {r.spec.status.join(', ')}</span>}
              {r.spec.employee.length > 0 && <span>{r.spec.employee.join(', ')}</span>}
              {r.spec.jira_board.length > 0 && <span>{r.spec.jira_board.join(', ')}</span>}
              {(r.links ?? []).map((l) => (
                <Button key={l.url} size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => nav(l.url)}>{l.label}</Button>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------------------------------------- model & trust
function ModelAndTrust({ status }: { status: IntelligenceStatus }) {
  const m = status.model
  const maxW = Math.max(0.01, ...m.top_features.map((f) => Math.abs(f.weight)))
  const quality = m.auc == null ? null : m.auc >= 0.9 ? 'excellent' : m.auc >= 0.8 ? 'good' : m.auc >= 0.7 ? 'fair' : 'weak'
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-primary" aria-hidden /> How the risk model works</CardTitle>
          <CardDescription>{m.method}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {m.trained ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Learned from</dt><dd className="tabular-nums">{m.tickets} completed tickets ({m.samples} point-in-time snapshots)</dd>
              <dt className="text-muted-foreground">Of which slipped</dt><dd className="tabular-nums">{m.samples ? pct(m.positives / m.samples) : '-'}</dd>
              <dt className="text-muted-foreground">Rank quality (AUC)</dt><dd className="tabular-nums">{m.auc?.toFixed(3) ?? '-'}{quality ? ` - ${quality}` : ''}</dd>
              <dt className="text-muted-foreground">Accuracy at 50%</dt><dd className="tabular-nums">{m.accuracy != null ? pct(m.accuracy) : '-'}</dd>
              <dt className="text-muted-foreground">Calibration (Brier)</dt><dd className="tabular-nums">{m.brier?.toFixed(3) ?? '-'} <span className="text-xs text-muted-foreground">(0 = perfect, 0.25 = guessing)</span></dd>
              <dt className="text-muted-foreground">Snapshots taken</dt><dd>{m.snapshot_ages.join(', ')} days after a ticket first appears</dd>
              <dt className="text-muted-foreground">Last trained</dt><dd>{m.trained_at ? new Date(m.trained_at).toLocaleString() : '-'}</dd>
            </dl>
          ) : (
            <p className="text-amber-800 dark:text-amber-200">{m.reason ?? 'Not trained yet.'} Scores use a transparent rule set instead (age, blocked time, carry-over, due date, load).</p>
          )}
          <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
            <li>Every completed ticket is replayed as it looked {m.snapshot_ages.join('/')} days after it first appeared - using only the updates known at that moment, never the outcome.</li>
            <li>The model learns which early signals preceded a late delivery in <em>this</em> team's history.</li>
            <li>Open tickets are scored with today as the cutoff; the same signals are listed as reasons under each score.</li>
            <li>It retrains automatically whenever the data is reloaded, so it tracks how the team actually works.</li>
          </ol>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> What drives the score</CardTitle>
          <CardDescription>Standardised weights learned from your data. Red pushes risk up, green pulls it down.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {m.top_features.length ? m.top_features.map((f) => (
            <div key={f.feature} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate text-xs" title={f.feature}>{f.feature}</span>
              <div className="relative h-3 flex-1 rounded bg-muted" aria-hidden>
                <div className="absolute left-1/2 top-0 h-3 w-px bg-border" />
                <div className={cn('absolute top-0 h-3 rounded', f.weight >= 0 ? 'left-1/2 bg-red-400/80' : 'right-1/2 bg-emerald-400/80')} style={{ width: `${(Math.abs(f.weight) / maxW) * 50}%` }} />
              </div>
              <span className="w-12 text-right text-xs tabular-nums">{f.weight > 0 ? '+' : ''}{f.weight.toFixed(2)}</span>
            </div>
          )) : <p className="text-muted-foreground">Weights appear once the model is trained.</p>}
          <div className="space-y-1 pt-3 text-xs text-muted-foreground">
            <p><span className="font-medium text-foreground">Signals used:</span> {m.features.join(', ')}.</p>
            <p><span className="font-medium text-foreground">Privacy:</span> {status.llm.enabled ? `language model ${status.llm.provider} / ${status.llm.model} interprets questions only (${status.llm.sends_ticket_text ? 'ticket text shared' : 'numbers and names only'}).` : 'no external AI service is used; everything runs inside this application.'}</p>
            <p><span className="font-medium text-foreground">Grounding:</span> the model never produces a number on its own - every figure on this page is computed by the same engine as the rest of the dashboard.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
