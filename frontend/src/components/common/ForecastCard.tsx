import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Area, CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CalendarCheck, CalendarRange, Dices, Gauge, Info, ShieldCheck, TrendingUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useFilters } from '@/hooks/useFilters'
import { dashboardApi, type Forecast } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

const CONF: Record<string, { label: string; level: 1 | 2 | 3; hint: string }> = {
  good: { label: 'Good confidence', level: 3, hint: 'Throughput was steady over the last weeks' },
  fair: { label: 'Fair confidence', level: 2, hint: 'Throughput varied week to week' },
  low: { label: 'Low confidence', level: 1, hint: 'Little or uneven history to learn from' },
}
const C = { done: '#16a34a', likely: '#6D28D9', band: '#8b5cf6', scope: 'hsl(var(--foreground))', muted: 'hsl(var(--muted-foreground))', grid: 'hsl(var(--border))', target: '#f59e0b' }
const short = (iso: string) => fmtDate(iso, { day: '2-digit', month: 'short' })
const DAY = 86_400_000
const localIso = (t: number) => { const x = new Date(t); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}` }
const MAX_PROJECTION_WEEKS = 30

type Pt = { t: number; done?: number; likely?: number; band?: [number, number] }

/**
 * Monte-Carlo forecast: 10,000 bootstrap runs over the last 8 weeks of daily throughput for the current scope.
 * `targetDate` defaults to 14 days ahead; the Sprint page passes the sprint end so the question becomes
 * "how much of the remaining sprint scope will be done by sprint end?".
 */
export function ForecastCard({ targetDate, targetLabel, remaining, scopeLabel, className }: { targetDate?: string | null; targetLabel?: string; remaining?: number | null; scopeLabel?: string; className?: string }) {
  const { queryString } = useFilters()
  const q = useQuery({ queryKey: ['forecast', queryString, targetDate ?? null, remaining ?? null], queryFn: () => dashboardApi.forecast(queryString, targetDate, remaining), placeholderData: (p) => p })
  const d = q.data
  const unit = scopeLabel ?? 'tickets'

  return (
    <Card className={cn('border-violet-200/70 dark:border-violet-900/50', className)} data-testid="forecast-card">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><Dices className="h-4 w-4 text-violet-600" aria-hidden /> Delivery forecast</CardTitle>
        <CardDescription>{d ? <>Based on how {d.scope === 'the team' ? 'the team' : d.scope} actually delivered over the last {d.history.weeks} weeks - not on estimates.</> : 'Monte-Carlo simulation from recent throughput'}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {q.isLoading && !d && <div className="grid gap-4 lg:grid-cols-3"><div className="h-56 animate-pulse rounded-lg bg-muted/60" /><div className="h-56 animate-pulse rounded-lg bg-muted/60 lg:col-span-2" /></div>}
        {q.isError && <p className="text-red-600">Could not compute the forecast.</p>}
        {d && d.note && !d.completion && <p className="flex items-start gap-2 rounded-md bg-muted/60 p-3 text-xs text-muted-foreground"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.note}</p>}
        {d && d.completion && (
          <>
            <SummaryStrip d={d} unit={unit} targetLabel={targetLabel} />
            <BurnUp d={d} unit={unit} targetLabel={targetLabel} />
          </>
        )}
        <p className="text-[11px] text-muted-foreground">
          {d?.runs.toLocaleString() ?? '10,000'} simulated futures are built by re-sampling the team's own recent daily completions. "Likely" is the date half of them finish by; "safe bet" is the date 85% finish by. Assumes team and scope stay as they are.
        </p>
      </CardContent>
    </Card>
  )
}

// --------------------------------------------------------------------------------------------- summary strip
const TONE = {
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  slate: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

function Tile({ icon: Icon, tone, label, children, delay = 0, className }: { icon: typeof Dices; tone: string; label: string; children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <div className={cn('flex min-w-0 flex-col rounded-lg border bg-card p-3.5 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300', className)} style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center gap-2">
        <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', tone)}><Icon className="h-4 w-4" aria-hidden /></span>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      </div>
      <div className="mt-2.5 flex-1">{children}</div>
    </div>
  )
}

function SummaryStrip({ d, unit, targetLabel }: { d: Forecast; unit: string; targetLabel?: string }) {
  const pcts = d.completion!.percentiles
  const p50 = pcts.find((x) => x.p === 50)
  const p85 = pcts.find((x) => x.p === 85)
  const conf = CONF[d.confidence]
  const weeksLeft = d.history.avg_per_week > 0 ? Math.round(d.remaining / d.history.avg_per_week) : null
  const b = d.by_date
  const safe = b?.percentiles.find((x) => x.p === 85)?.completed ?? 0
  const chance = b?.probability_all_done != null ? Math.round(b.probability_all_done * 100) : null
  const pctOf = (n: number) => Math.min(100, Math.round((n / Math.max(1, d.remaining)) * 100))
  const confTone = conf.level === 3 ? TONE.emerald : conf.level === 2 ? TONE.amber : TONE.slate
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2', b ? 'xl:grid-cols-4' : 'xl:grid-cols-3')}>
      <Tile icon={CalendarRange} tone={TONE.violet} label={`All ${d.remaining} open ${unit} done by`}>
        <p className="text-3xl font-semibold tabular-nums leading-none">{p50?.date ? short(p50.date) : '> 1 year'}</p>
        <p className="mt-1 text-xs text-muted-foreground">most likely{p50 ? ` - ${p50.days} days from today` : ''}</p>
        <p className="mt-2 flex items-center gap-1.5 text-xs"><ShieldCheck className="h-3.5 w-3.5 text-violet-600" aria-hidden /><span className="text-muted-foreground">Safe bet</span> <b className="tabular-nums">{p85?.date ? short(p85.date) : '> 1 year'}</b>{p85 && <span className="text-muted-foreground">(85%)</span>}</p>
      </Tile>

      <Tile icon={Gauge} tone={confTone} label="How reliable is this" delay={60}>
        <p className={cn('text-lg font-semibold leading-tight', conf.level === 3 ? 'text-emerald-700 dark:text-emerald-300' : conf.level === 2 ? 'text-amber-700 dark:text-amber-300' : 'text-slate-600 dark:text-slate-300')}>{conf.label.replace(' confidence', '')}</p>
        <div className="mt-1.5 flex gap-1" aria-label={conf.label}>{[1, 2, 3].map((i) => <span key={i} className={cn('h-1.5 flex-1 rounded-full', i <= conf.level ? (conf.level === 3 ? 'bg-emerald-500' : conf.level === 2 ? 'bg-amber-500' : 'bg-slate-400') : 'bg-muted')} />)}</div>
        <p className="mt-2 text-xs text-muted-foreground">{conf.hint}.</p>
      </Tile>

      <Tile icon={TrendingUp} tone={TONE.blue} label="Work remaining" delay={120}>
        <div className="flex items-end gap-1.5 text-sm">
          <span><b className="text-2xl font-semibold tabular-nums leading-none">{d.remaining}</b> <span className="text-muted-foreground">open</span></span>
          <span className="pb-0.5 text-muted-foreground">&divide;</span>
          <span><b className="text-2xl font-semibold tabular-nums leading-none">{d.history.avg_per_week}</b> <span className="text-muted-foreground">/ week</span></span>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">&asymp; <b className="text-foreground">{weeksLeft ?? '-'} weeks</b> of work at the pace of the last {d.history.weeks} weeks</p>
      </Tile>

      {b && (
        <Tile icon={CalendarCheck} tone={chance !== null && chance < 40 ? TONE.red : TONE.amber} label={`By ${targetLabel ?? short(b.date)} (${b.days} days)`} delay={180}>
          <p className="text-sm"><b className="text-2xl font-semibold tabular-nums leading-none">{Math.round(b.expected)}</b> <span className="text-muted-foreground">of {d.remaining} expected</span></p>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-muted" aria-label={`Expected ${Math.round(b.expected)}, safe ${safe}, of ${d.remaining}`}>
            <div className="absolute inset-y-0 left-0 rounded-full bg-violet-500/30" style={{ width: `${pctOf(b.expected)}%` }} />
            <div className="absolute inset-y-0 left-0 rounded-full bg-violet-600" style={{ width: `${pctOf(safe)}%` }} />
          </div>
          <div className="mt-1.5 flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Safe to promise <b className="text-foreground tabular-nums">{safe}</b></span>
            {chance !== null && <span className={cn('rounded px-1.5 py-0.5 font-semibold tabular-nums', chance >= 70 ? TONE.emerald : chance >= 40 ? TONE.amber : TONE.red)} title="Chance that every open ticket is done by the target date">{chance}% all done</span>}
          </div>
          {chance !== null && <p className="mt-2 text-xs text-muted-foreground">{chance < 40 ? 'Descope or move the date.' : chance < 70 ? 'Achievable with focus - protect the scope.' : 'On course for the full scope.'}</p>}
        </Tile>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------------------------------- burn-up
/**
 * Burn-up: green = tickets completed so far (cumulative, weekly); violet = projected completions at the "likely"
 * pace; shaded band = between the likely and safe-bet paces; the top line is the total scope; the amber line is
 * the target date. Where the projection meets the scope line is the forecast finish.
 */
function BurnUp({ d, unit, targetLabel }: { d: Forecast; unit: string; targetLabel?: string }) {
  const { data, scope, today, finish50, finish85, target, capped } = useMemo(() => {
    const hist = [...d.history.per_week].sort((a, b) => a.week.localeCompare(b.week))
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0)
    const todayT = todayMidnight.getTime()
    let cum = 0
    const pts: Pt[] = hist.map((w) => { cum += w.completed; return { t: new Date(w.week + 'T00:00:00').getTime(), done: cum } })
    const doneSoFar = cum
    const scope = doneSoFar + d.remaining
    const p50 = d.completion!.percentiles.find((x) => x.p === 50)
    const p85 = d.completion!.percentiles.find((x) => x.p === 85)
    const days50 = p50?.days ?? null
    const days85 = p85?.days ?? null
    const rate50 = days50 ? d.remaining / days50 : d.history.avg_per_day
    const rate85 = days85 ? d.remaining / days85 : rate50 * 0.7
    const horizonDays = Math.min(MAX_PROJECTION_WEEKS * 7, Math.max(days85 ?? 0, days50 ?? 0, d.by_date?.days ?? 0, 14))
    const capped = (days85 ?? 0) > horizonDays
    // anchor projection at today with what is done so far
    pts.push({ t: todayT, done: doneSoFar, likely: doneSoFar, band: [doneSoFar, doneSoFar] })
    for (let day = 7; day <= horizonDays + 6; day += 7) {
      const dd = Math.min(day, horizonDays)
      pts.push({ t: todayT + dd * DAY, likely: Math.min(scope, doneSoFar + rate50 * dd), band: [Math.min(scope, doneSoFar + rate85 * dd), Math.min(scope, doneSoFar + rate50 * dd)] })
      if (dd === horizonDays) break
    }
    return {
      data: pts, scope, today: todayT,
      finish50: days50 && days50 <= horizonDays ? todayT + days50 * DAY : null,
      finish85: days85 && days85 <= horizonDays ? todayT + days85 * DAY : null,
      target: d.by_date ? new Date(d.by_date.date + 'T00:00:00').getTime() : null, capped,
    }
  }, [d])

  const fmtT = (t: number) => fmtDate(localIso(t), { day: '2-digit', month: 'short' })
  return (
    <div className="rounded-lg border p-3 animate-in fade-in-0 duration-300" style={{ animationDelay: '120ms' }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Progress towards all {unit}</p>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: C.done }} /> Done so far</li>
          <li className="flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: C.likely }} /> Likely path</li>
          <li className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm opacity-40" style={{ background: C.band }} /> Likely to safe bet</li>
          <li className="flex items-center gap-1"><span className="h-0 w-3 border-t-2 border-dashed border-foreground/70" /> All {unit}</li>
          {target && <li className="flex items-center gap-1"><span className="h-0 w-3 border-t-2 border-dashed" style={{ borderColor: C.target }} /> Target</li>}
        </ul>
      </div>
      <div className="mt-2 h-[280px]">
        <ResponsiveContainer width="100%" height={280}>
          <ComposedChart data={data} margin={{ top: 18, right: 16, left: -12, bottom: 0 }}>
            <CartesianGrid stroke={C.grid} strokeOpacity={0.6} vertical={false} />
            <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={fmtT} tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} minTickGap={28} />
            <YAxis tick={{ fontSize: 11, fill: C.muted }} axisLine={false} tickLine={false} allowDecimals={false} domain={[0, Math.ceil(scope * 1.08)]} />
            <Tooltip content={<BurnTooltip unit={unit} fmtT={fmtT} />} />
            <Area type="monotone" dataKey="band" stroke="none" fill={C.band} fillOpacity={0.18} isAnimationActive animationDuration={700} connectNulls={false} />
            <Line type="monotone" dataKey="done" stroke={C.done} strokeWidth={2.5} dot={{ r: 2.5, fill: C.done, strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive animationDuration={600} />
            <Line type="monotone" dataKey="likely" stroke={C.likely} strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={{ r: 4 }} isAnimationActive animationDuration={700} animationBegin={200} />
            <ReferenceLine y={scope} stroke={C.scope} strokeOpacity={0.7} strokeDasharray="5 4" label={{ value: `All ${scope} ${unit}`, position: 'insideTopLeft', fontSize: 10, fill: C.muted }} />
            <ReferenceLine x={today} stroke={C.muted} strokeOpacity={0.6} label={{ value: 'Today', position: 'insideTopRight', fontSize: 10, fill: C.muted }} />
            {target && <ReferenceLine x={target} stroke={C.target} strokeDasharray="5 4" label={{ value: targetLabel ? 'Target' : `Target ${fmtT(target)}`, position: 'insideBottomRight', offset: 22, fontSize: 10, fill: C.target }} />}
            {finish50 && <ReferenceDot x={finish50} y={scope} r={5} fill={C.likely} stroke="#fff" strokeWidth={2} label={{ value: `Likely ${fmtT(finish50)}`, position: 'top', fontSize: 10, fill: C.likely }} />}
            {finish85 && finish85 !== finish50 && <ReferenceDot x={finish85} y={scope} r={4} fill={C.band} fillOpacity={0.7} stroke="#fff" strokeWidth={2} label={{ value: `Safe ${fmtT(finish85)}`, position: 'bottom', fontSize: 10, fill: C.likely }} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {capped && <p className="mt-1 text-[10px] text-muted-foreground">Projection shown for the next {MAX_PROJECTION_WEEKS} weeks; the safe-bet finish is later than that.</p>}
    </div>
  )
}

function BurnTooltip({ active, payload, label, unit, fmtT }: { active?: boolean; payload?: { dataKey?: string; value?: number | [number, number]; color?: string }[]; label?: number; unit: string; fmtT: (t: number) => string }) {
  if (!active || !payload?.length || typeof label !== 'number') return null
  const get = (k: string) => payload.find((p) => p.dataKey === k)?.value
  const done = get('done') as number | undefined
  const likely = get('likely') as number | undefined
  const band = get('band') as [number, number] | undefined
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">{fmtT(label)}</p>
      {done !== undefined && <p className="flex justify-between gap-4"><span style={{ color: C.done }}>Done so far</span><b className="tabular-nums">{Math.round(done)} {unit}</b></p>}
      {likely !== undefined && <p className="flex justify-between gap-4"><span style={{ color: C.likely }}>Likely by then</span><b className="tabular-nums">{Math.round(likely)}</b></p>}
      {band && band[0] !== band[1] && <p className="flex justify-between gap-4 text-muted-foreground"><span>Safe bet (85%)</span><b className="tabular-nums">{Math.round(band[0])}</b></p>}
    </div>
  )
}
