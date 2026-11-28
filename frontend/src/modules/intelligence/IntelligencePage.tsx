import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Activity, AlertTriangle, ArrowDownRight, ArrowUpRight, Brain, ExternalLink, ListChecks, MessageSquareText, RefreshCw, Send, Sparkles, TrendingUp } from 'lucide-react'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { EmptyState, ErrorState, LoadingState } from '@/components/common/States'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useFilters } from '@/hooks/useFilters'
import { can, useSession } from '@/hooks/useSession'
import { intelligenceApi, type AnomalyItem, type AskResponse, type IntelligenceStatus, type Recommendation, type RiskBand, type RiskItem, type RiskResponse } from '@/services/api'
import { cn } from '@/lib/utils'

const BAND_CLS: Record<RiskBand, string> = {
  high: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200',
  medium: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200',
  low: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200',
}
const SEV_CLS: Record<AnomalyItem['severity'], string> = {
  danger: BAND_CLS.high,
  warning: BAND_CLS.medium,
  info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200',
}
const KIND_LABEL: Record<string, string> = { focus: 'Focus', unblock: 'Unblock', rebalance: 'Rebalance', due: 'Due dates', hygiene: 'Data hygiene' }

const SUGGESTED_QUESTIONS = [
  'Which tickets are most at risk this sprint?',
  'Who has the most blocked tickets?',
  'How many tickets were completed last week?',
  'What is overdue right now?',
  'When will the remaining work be done?',
  'What should I do first today?',
]

function pct(v: number) {
  return `${Math.round(v * 100)}%`
}

/**
 * Intelligence hub: ML risk scoring for open tickets, anomaly detection on weekly series, prioritised
 * recommendations and a natural-language assistant. Every number is produced by the same analytics engine that
 * feeds the rest of the dashboard, so the page can always be cross-checked against Tickets / People.
 */
export default function IntelligencePage() {
  const { queryString } = useFilters()
  const { user } = useSession()
  const qc = useQueryClient()
  const status = useQuery({ queryKey: ['intel', 'status'], queryFn: intelligenceApi.status, staleTime: 60_000 })
  const risk = useQuery({ queryKey: ['intel', 'risk', queryString], queryFn: () => intelligenceApi.risk(queryString, 200), placeholderData: (p) => p })
  const reco = useQuery({ queryKey: ['intel', 'reco', queryString], queryFn: () => intelligenceApi.recommendations(queryString), placeholderData: (p) => p })
  const retrain = useMutation({
    mutationFn: intelligenceApi.retrain,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['intel'] }),
  })
  const model = status.data?.model
  const canRetrain = can(user, 'admin', 'dm')

  return (
    <div className="space-y-6" data-testid="intelligence-page">
      <PageHeader
        title="AI insights"
        description="Predicted delivery risk, unusual movements and recommended actions for the current filter scope. The model is trained on this installation's own completed tickets and explains every score."
        breadcrumbs={[{ label: 'Overview', to: '/' }, { label: 'AI insights' }]}
        actions={canRetrain ? (
          <Button size="sm" variant="outline" onClick={() => retrain.mutate()} disabled={retrain.isPending} aria-label="Retrain model">
            <RefreshCw className={cn('h-4 w-4', retrain.isPending && 'animate-spin')} /> {retrain.isPending ? 'Training...' : 'Retrain'}
          </Button>
        ) : undefined}
      />
      <GlobalFilterBar compact />

      {risk.isError && <ErrorState error={risk.error} onRetry={() => risk.refetch()} />}

      <KpiGrid cols={5}>
        <KpiCard label="Open tickets scored" value={risk.data?.summary.open ?? '-'} icon={<ListChecks className="h-4 w-4" />} tone="blue" />
        <KpiCard label="High risk" value={risk.data?.summary.high ?? '-'} icon={<AlertTriangle className="h-4 w-4" />} tone="red" hint="Probability of slipping 75% or more" />
        <KpiCard label="Medium risk" value={risk.data?.summary.medium ?? '-'} tone="amber" hint="45% to 75%" />
        <KpiCard label="Expected slips" value={risk.data?.summary.expected_slips ?? '-'} icon={<TrendingUp className="h-4 w-4" />} tone="orange" hint="Sum of slip probabilities across open tickets" />
        <KpiCard
          label="Model quality (AUC)"
          value={model?.trained && model.auc != null ? model.auc.toFixed(2) : model ? 'heuristic' : '-'}
          icon={<Brain className="h-4 w-4" />}
          tone="purple"
          hint={model?.trained ? `${model.samples} snapshots from ${model.tickets} completed tickets` : model?.reason ?? undefined}
        />
      </KpiGrid>

      <Tabs defaultValue="risk" className="space-y-4">
        <TabsList>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations{reco.data ? ` (${reco.data.items.length})` : ''}</TabsTrigger>
          <TabsTrigger value="anomalies">Anomalies</TabsTrigger>
          <TabsTrigger value="ask">Ask</TabsTrigger>
          <TabsTrigger value="model">Model</TabsTrigger>
        </TabsList>

        <TabsContent value="risk">
          {risk.isLoading && !risk.data ? <LoadingState rows={4} /> : risk.data ? <RiskTable data={risk.data} /> : null}
        </TabsContent>
        <TabsContent value="recommendations">
          {reco.isLoading && !reco.data ? <LoadingState rows={3} /> : reco.data ? <Recommendations items={reco.data.items} /> : null}
        </TabsContent>
        <TabsContent value="anomalies">
          <Anomalies queryString={queryString} />
        </TabsContent>
        <TabsContent value="ask">
          <AskBox queryString={queryString} llmEnabled={!!status.data?.llm.enabled} />
        </TabsContent>
        <TabsContent value="model">
          {status.isLoading ? <LoadingState rows={2} /> : status.data ? <ModelCard status={status.data} /> : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ------------------------------------------------------------------------------------------------------- risk
function RiskTable({ data }: { data: RiskResponse }) {
  const nav = useNavigate()
  const { queryString } = useFilters()
  const [band, setBand] = useState<RiskBand | 'all'>('all')
  const [person, setPerson] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const qs = queryString ? `?${queryString}` : ''

  const items = useMemo(
    () => data.items.filter((i) => (band === 'all' || i.band === band) && (!person || (i.employee ?? 'Unassigned') === person)),
    [data.items, band, person],
  )

  if (!data.items.length) return <EmptyState title="No open tickets in this scope" description="Widen the period or clear filters to score more work." />

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">Open tickets by predicted slip risk</CardTitle>
            <CardDescription>Click a row to see the factors behind the score; click the ticket id to open it in Tickets.</CardDescription>
          </div>
          <div className="flex gap-1" role="group" aria-label="Filter by band">
            {(['all', 'high', 'medium', 'low'] as const).map((b) => (
              <Button key={b} size="sm" variant={band === b ? 'default' : 'outline'} onClick={() => setBand(b)} className="capitalize">{b}</Button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="risk-table">
              <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Assignee</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Age</th>
                  <th className="px-3 py-2 text-right">Risk</th>
                </tr>
              </thead>
              <tbody>
                {items.slice(0, 100).map((t) => (
                  <RiskRow key={t.ticket_id} t={t} expanded={open === t.ticket_id} onToggle={() => setOpen(open === t.ticket_id ? null : t.ticket_id)}
                    onOpen={() => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(t.ticket_id)}`)} />
                ))}
              </tbody>
            </table>
          </div>
          {items.length > 100 && <p className="px-3 py-2 text-xs text-muted-foreground">Showing the top 100 of {items.length}. Narrow the filters to see the rest.</p>}
          {!items.length && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No tickets match this band.</p>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">By assignee</CardTitle>
          <CardDescription>High-risk count and average risk</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {(data.by_employee ?? []).map((p) => (
            <button key={p.employee} type="button" onClick={() => setPerson(person === p.employee ? null : p.employee)}
              className={cn('flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted', person === p.employee && 'bg-muted font-medium')}>
              <span className="truncate">{p.employee}</span>
              <span className="ml-2 flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
                <span className={cn('rounded border px-1.5', p.high ? BAND_CLS.high : BAND_CLS.low)}>{p.high} high</span>
                <span>{p.open} open</span>
                <span className="w-9 text-right">{pct(p.avg_risk)}</span>
              </span>
            </button>
          ))}
          {person && <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => setPerson(null)}>Clear assignee filter</Button>}
        </CardContent>
      </Card>
    </div>
  )
}

function RiskRow({ t, expanded, onToggle, onOpen }: { t: RiskItem; expanded: boolean; onToggle: () => void; onOpen: () => void }) {
  return (
    <>
      <tr className={cn('cursor-pointer border-t hover:bg-muted/40', expanded && 'bg-muted/30')} onClick={onToggle} aria-expanded={expanded}>
        <td className="px-3 py-2">
          <button type="button" className="font-mono text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onOpen() }}>{t.ticket_id}</button>
          {t.summary && <div className="max-w-[320px] truncate text-xs text-muted-foreground" title={t.summary}>{t.summary}</div>}
        </td>
        <td className="px-3 py-2">{t.employee ?? <span className="text-muted-foreground">Unassigned</span>}</td>
        <td className="px-3 py-2"><Badge variant="secondary" className="font-normal capitalize">{(t.work_status ?? '').replace(/_/g, ' ')}</Badge></td>
        <td className={cn('px-3 py-2 whitespace-nowrap', t.overdue && 'text-red-600 dark:text-red-300')}>{t.due_date ?? '-'}{t.overdue ? ' (overdue)' : ''}</td>
        <td className="px-3 py-2 text-right tabular-nums">{t.age_days}d</td>
        <td className="px-3 py-2 text-right">
          <span className={cn('inline-block min-w-[52px] rounded border px-1.5 py-0.5 text-xs font-medium tabular-nums', BAND_CLS[t.band])}>{pct(t.risk)}</span>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td colSpan={6} className="px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-muted-foreground">Why:</span>
              {t.factors.length ? t.factors.map((f, i) => (
                <span key={i} className="rounded border bg-background px-2 py-0.5">
                  {f.factor} = <span className="font-medium">{f.value}</span>
                  <span className={cn('ml-1', f.impact > 0 ? 'text-red-600 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300')}>{f.impact > 0 ? '+' : ''}{f.impact}</span>
                </span>
              )) : <span className="text-muted-foreground">no single factor dominates</span>}
              {t.jira_board && <span className="ml-auto text-muted-foreground">{t.jira_board}{t.sprint ? ` / ${t.sprint}` : ''}</span>}
              {t.ticket_link && (
                <a href={t.ticket_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={(e) => e.stopPropagation()}>
                  Jira <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------------------------- recommendations
function Recommendations({ items }: { items: Recommendation[] }) {
  const nav = useNavigate()
  const { queryString, setList } = useFilters()
  const qs = queryString ? `?${queryString}` : ''
  if (!items.length) return <EmptyState title="Nothing to recommend" description="No high-risk, blocked or overloaded work was found in this scope." />
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="recommendations">
      {items.map((r, i) => (
        <Card key={i} className={cn(r.priority === 1 && 'border-primary/40')}>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <Badge variant={r.priority === 1 ? 'default' : 'secondary'}>{KIND_LABEL[r.kind] ?? r.kind}</Badge>
              <span className="text-xs text-muted-foreground">priority {r.priority}</span>
            </div>
            <CardTitle className="text-base">{r.title}</CardTitle>
            <CardDescription>{r.detail}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {r.evidence.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                {r.evidence.slice(0, 5).map((e, j) => <li key={j}>{e}</li>)}
              </ul>
            )}
            {r.effect && <p className="text-xs"><span className="text-muted-foreground">Expected effect:</span> {r.effect}</p>}
            <div className="flex flex-wrap gap-1 pt-1">
              {r.tickets.slice(0, 8).map((t) => (
                <button key={t} type="button" className="rounded border px-1.5 py-0.5 font-mono text-xs text-primary hover:bg-muted"
                  onClick={() => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(t)}`)}>{t}</button>
              ))}
              {(r.employees ?? []).slice(0, 4).map((e) => (
                <button key={e} type="button" className="rounded border px-1.5 py-0.5 text-xs hover:bg-muted" onClick={() => nav(`/employees/${encodeURIComponent(e)}${qs}`)}>{e}</button>
              ))}
              {r.kind === 'unblock' && <Button size="sm" variant="outline" className="ml-auto h-6 text-xs" onClick={() => { setList('status', ['blocked']); nav(`/jira${qs}`) }}>View blocked</Button>}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// --------------------------------------------------------------------------------------------------- anomalies
function Anomalies({ queryString }: { queryString: string }) {
  const [groupBy, setGroupBy] = useState<'employee' | 'jira_board'>('employee')
  const q = useQuery({ queryKey: ['intel', 'anomalies', queryString, groupBy], queryFn: () => intelligenceApi.anomalies(queryString, groupBy), placeholderData: (p) => p })
  const nav = useNavigate()
  const qs = queryString ? `?${queryString}` : ''
  if (q.isLoading && !q.data) return <LoadingState rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return null
  const series = q.data.series
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          Weekly series compared with their own last {q.data.weeks} weeks. A movement is flagged when its robust z-score exceeds {q.data.threshold}.
        </p>
        <div className="flex gap-1" role="group" aria-label="Group anomalies by">
          <Button size="sm" variant={groupBy === 'employee' ? 'default' : 'outline'} onClick={() => setGroupBy('employee')}>People</Button>
          <Button size="sm" variant={groupBy === 'jira_board' ? 'default' : 'outline'} onClick={() => setGroupBy('jira_board')}>Boards</Button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Object.entries(series).map(([metric, pts]) => <Sparkline key={metric} label={metric} points={pts} />)}
      </div>
      {q.data.items.length ? (
        <ul className="space-y-2" data-testid="anomaly-list">
          {q.data.items.map((a, i) => (
            <li key={i}>
              <button type="button" className={cn('flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm', SEV_CLS[a.severity], a.group_by === 'employee' && 'hover:brightness-95')}
                onClick={() => a.group_by === 'employee' && nav(`/employees/${encodeURIComponent(a.scope)}${qs}`)}>
                {a.direction === 'up' ? <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                <span className="flex-1">{a.text}</span>
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
  const d = vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * (h - 4) - 2).toFixed(1)}`).join(' ')
  const last = vals[vals.length - 1] ?? 0
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-xs capitalize text-muted-foreground">{label.replace(/_/g, ' ')} / week</span>
          <span className="text-sm font-medium tabular-nums">{last}</span>
        </div>
        <svg viewBox={`0 0 ${w} ${h}`} className="mt-1 h-12 w-full" role="img" aria-label={`${label} weekly trend`}>
          <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-primary" />
          {vals.length > 0 && <circle cx={((vals.length - 1) * step).toFixed(1)} cy={(h - (last / max) * (h - 4) - 2).toFixed(1)} r={2.5} className="fill-primary" />}
        </svg>
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------------------------------------------------- ask
function AskBox({ queryString, llmEnabled }: { queryString: string; llmEnabled: boolean }) {
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
          <CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-primary" aria-hidden /> Ask about this data</CardTitle>
          <CardDescription>
            Questions are turned into filters and answered by the analytics engine, so every answer matches the dashboards.
            {llmEnabled ? ' A language model helps interpret wording; ticket text is never sent.' : ' Rule-based understanding (no external AI service configured).'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); submit(question) }}>
            <Input value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. which tickets are at risk for Team Atlas?" aria-label="Question" maxLength={500} />
            <Button type="submit" disabled={!question.trim() || ask.isPending} aria-label="Ask"><Send className="h-4 w-4" /></Button>
          </form>
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTED_QUESTIONS.map((s) => (
              <button key={s} type="button" className="rounded-full border px-2.5 py-1 text-xs hover:bg-muted" onClick={() => submit(s)} disabled={ask.isPending}>{s}</button>
            ))}
          </div>
          {ask.isPending && <p className="text-sm text-muted-foreground">Thinking...</p>}
          {ask.isError && <ErrorState error={ask.error} />}
        </CardContent>
      </Card>
      {history.map((r, i) => (
        <Card key={`${r.question}-${i}`} className={cn(i === 0 && 'border-primary/30')}>
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-medium">{r.question}</p>
            <p className="leading-relaxed">{r.answer}</p>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="h-3 w-3" aria-hidden /> intent: {r.spec.intent}
              {r.filters.label ? <span>| {String(r.filters.label)}</span> : null}
              {r.spec.status.length > 0 && <span>| status: {r.spec.status.join(', ')}</span>}
              {r.spec.employee.length > 0 && <span>| people: {r.spec.employee.join(', ')}</span>}
              {r.spec.jira_board.length > 0 && <span>| boards: {r.spec.jira_board.join(', ')}</span>}
              <span>| parsed by {r.spec.parser}</span>
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

// ------------------------------------------------------------------------------------------------------- model
function ModelCard({ status }: { status: IntelligenceStatus }) {
  const m = status.model
  const maxW = Math.max(0.01, ...m.top_features.map((f) => Math.abs(f.weight)))
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base"><Brain className="h-4 w-4 text-primary" aria-hidden /> Risk model</CardTitle>
          <CardDescription>{m.method}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {m.trained ? (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Training examples</dt><dd className="tabular-nums">{m.samples} snapshots</dd>
              <dt className="text-muted-foreground">Completed tickets used</dt><dd className="tabular-nums">{m.tickets}</dd>
              <dt className="text-muted-foreground">Slipped share</dt><dd className="tabular-nums">{m.samples ? pct(m.positives / m.samples) : '-'}</dd>
              <dt className="text-muted-foreground">AUC (rank quality)</dt><dd className="tabular-nums">{m.auc?.toFixed(3) ?? '-'}</dd>
              <dt className="text-muted-foreground">Accuracy at 50%</dt><dd className="tabular-nums">{m.accuracy != null ? pct(m.accuracy) : '-'}</dd>
              <dt className="text-muted-foreground">Brier score (lower is better)</dt><dd className="tabular-nums">{m.brier?.toFixed(3) ?? '-'}</dd>
              <dt className="text-muted-foreground">Snapshots per ticket</dt><dd>days {m.snapshot_ages.join(', ')} after first seen</dd>
              <dt className="text-muted-foreground">Trained</dt><dd>{m.trained_at ? new Date(m.trained_at).toLocaleString() : '-'}</dd>
            </dl>
          ) : (
            <p className="text-amber-800 dark:text-amber-200">{m.reason ?? 'Not trained yet.'} Scores fall back to a transparent heuristic (age, blocked time, carry-over, due date, load).</p>
          )}
          <p className="text-xs text-muted-foreground">
            How it works: each completed ticket is replayed as it looked {m.snapshot_ages.join('/')} days after it first appeared, using only the updates known at that moment. The model learns which early
            signals preceded a late delivery, then applies them to open tickets today. It retrains automatically whenever the data is reloaded.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">What drives the score</CardTitle>
          <CardDescription>Standardised weights; positive pushes risk up, negative pulls it down.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {m.top_features.length ? m.top_features.map((f) => (
            <div key={f.feature} className="flex items-center gap-2">
              <span className="w-40 shrink-0 truncate text-xs">{f.feature}</span>
              <div className="relative h-3 flex-1 rounded bg-muted">
                <div className={cn('absolute top-0 h-3 rounded', f.weight >= 0 ? 'left-1/2 bg-red-400/80' : 'right-1/2 bg-emerald-400/80')} style={{ width: `${(Math.abs(f.weight) / maxW) * 50}%` }} />
              </div>
              <span className="w-12 text-right text-xs tabular-nums">{f.weight > 0 ? '+' : ''}{f.weight.toFixed(2)}</span>
            </div>
          )) : <p className="text-muted-foreground">Weights appear once the model is trained.</p>}
          <p className="pt-2 text-xs text-muted-foreground">Inputs: {m.features.join(', ')}.</p>
          <p className="text-xs text-muted-foreground">
            Language model: {status.llm.enabled ? `${status.llm.provider} / ${status.llm.model} (${status.llm.sends_ticket_text ? 'ticket text shared' : 'numbers only'})` : 'not configured - all features work without it.'}
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
