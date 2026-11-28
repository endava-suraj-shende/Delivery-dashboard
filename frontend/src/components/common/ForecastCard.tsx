import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarCheck, Dices, Info } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useFilters } from '@/hooks/useFilters'
import { dashboardApi } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

const CONF: Record<string, { label: string; cls: string }> = {
  good: { label: 'Good confidence', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  fair: { label: 'Fair confidence', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  low: { label: 'Low confidence', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
}

/**
 * Monte-Carlo forecast: 10,000 bootstrap runs over the last 8 weeks of daily throughput for the current scope.
 * `targetDate` defaults to 14 days ahead; the Sprint page passes the sprint end so the question becomes
 * "how much of the remaining sprint scope will be done by sprint end?".
 */
export function ForecastCard({ targetDate, targetLabel, remaining, scopeLabel, className }: { targetDate?: string | null; targetLabel?: string; remaining?: number | null; scopeLabel?: string; className?: string }) {
  const { queryString } = useFilters()
  const q = useQuery({ queryKey: ['forecast', queryString, targetDate ?? null, remaining ?? null], queryFn: () => dashboardApi.forecast(queryString, targetDate, remaining), placeholderData: (p) => p })
  const d = q.data
  const p85 = d?.completion?.percentiles.find((x) => x.p === 85)
  const p50 = d?.completion?.percentiles.find((x) => x.p === 50)
  const byDate85 = d?.by_date?.percentiles.find((x) => x.p === 85)

  return (
    <Card className={cn('border-violet-200/70 dark:border-violet-900/50', className)} data-testid="forecast-card">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Dices className="h-4 w-4 text-violet-600" aria-hidden /> Delivery forecast</CardTitle>
            <CardDescription>{d ? `${d.scope} | ${d.history.completed} tickets completed in the last ${d.history.weeks} weeks (${d.history.avg_per_week}/week)` : 'Monte-Carlo simulation from recent throughput'}</CardDescription>
          </div>
          {d && <Badge className={cn('font-normal', CONF[d.confidence].cls)}>{CONF[d.confidence].label}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading && <p className="text-muted-foreground">Simulating...</p>}
        {q.isError && <p className="text-red-600">Could not compute the forecast.</p>}
        {d && d.note && <p className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.note}</p>}
        {d && d.completion && (
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">When will the {d.remaining} open {scopeLabel ?? 'tickets'} be done?</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{p85?.date ? fmtDate(p85.date) : 'beyond 12 months'} <span className="text-xs font-normal text-muted-foreground">with 85% confidence</span></p>
              <p className="text-xs text-muted-foreground">50%: {p50?.date ? fmtDate(p50.date) : '-'} {p50 ? `(${p50.days} days)` : ''} | 85%: {p85 ? `${p85.days} days` : '-'}</p>
              <div className="mt-2 flex gap-1" aria-label="Completion percentiles">
                {d.completion.percentiles.map((x) => (
                  <div key={x.p} className="flex-1 rounded bg-violet-500/10 px-1.5 py-1 text-center text-[11px]"><span className="font-medium">P{x.p}</span><br />{x.date ? fmtDate(x.date, { day: '2-digit', month: 'short' }) : '>1y'}</div>
                ))}
              </div>
            </div>
            {d.by_date && (
              <div className="rounded-lg border p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground"><CalendarCheck className="mr-1 inline h-3.5 w-3.5" />By {targetLabel ?? fmtDate(d.by_date.date)} ({d.by_date.days} days)</p>
                <p className="mt-1 text-lg font-semibold tabular-nums">at least {byDate85?.completed ?? '-'} tickets <span className="text-xs font-normal text-muted-foreground">with 85% confidence</span></p>
                <p className="text-xs text-muted-foreground">expected {d.by_date.expected}{d.by_date.probability_all_done != null ? ` | chance all ${d.remaining} are done: ${Math.round(d.by_date.probability_all_done * 100)}%` : ''}</p>
                <div className="mt-2 flex gap-1" aria-label="By-date percentiles">
                  {d.by_date.percentiles.map((x) => (
                    <div key={x.p} className="flex-1 rounded bg-violet-500/10 px-1.5 py-1 text-center text-[11px]"><span className="font-medium">P{x.p}</span><br />{x.completed}</div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {d && d.history.per_week.length > 0 && (
          <div>
            <p className="mb-1 text-xs text-muted-foreground">Weekly throughput used for the simulation</p>
            <div className="h-24">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.history.per_week} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} className="stroke-border" />
                  <XAxis dataKey="week" tickFormatter={(v: string) => fmtDate(v, { day: '2-digit', month: 'short' })} tick={{ fontSize: 10 }} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v) => [String(v ?? 0), 'completed']} labelFormatter={(v) => 'week of ' + fmtDate(String(v))} />
                  <Bar dataKey="completed" fill="#6D28D9" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
        <p className="text-[11px] text-muted-foreground">Method: bootstrap of daily completions ({d?.runs.toLocaleString() ?? '10,000'} runs). Forecasts assume the team and scope stay as they are; they are a conversation aid, not a commitment.</p>
      </CardContent>
    </Card>
  )
}
