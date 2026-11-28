import { useNavigate } from 'react-router-dom'
import { AlertOctagon, ArrowRight, CalendarClock, Database, type LucideIcon, Scale, TrendingDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useFilters } from '@/hooks/useFilters'
import type { NarrativeFlag } from '@/services/api'
import { cn } from '@/lib/utils'

/**
 * Structured presentation of narrative flags: grouped by theme, numbers first, one action per row.
 * Workload flags become a bar list against the team average instead of repeated sentences.
 */
type Group = { key: string; title: string; icon: LucideIcon; tone: string; codes: string[] }
const GROUPS: Group[] = [
  { key: 'blockers', title: 'Blockers', icon: AlertOctagon, tone: 'bg-red-500/10 text-red-600 dark:text-red-400', codes: ['blocked_age', 'blocked_rising'] },
  { key: 'deadlines', title: 'Stale & overdue', icon: CalendarClock, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', codes: ['stale', 'overdue'] },
  { key: 'workload', title: 'Workload', icon: Scale, tone: 'bg-purple-500/10 text-purple-600 dark:text-purple-400', codes: ['overloaded'] },
  { key: 'flow', title: 'Flow', icon: TrendingDown, tone: 'bg-sky-500/10 text-sky-600 dark:text-sky-400', codes: ['throughput_drop', 'carry_over', 'low_completion'] },
  { key: 'data', title: 'Data quality', icon: Database, tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300', codes: ['unmapped'] },
]
const SEV_DOT: Record<NarrativeFlag['severity'], string> = { danger: 'bg-red-500', warning: 'bg-amber-500', info: 'bg-sky-500' }

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown) => (v == null ? '' : String(v))
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function WatchList({ flags, className }: { flags: NarrativeFlag[]; className?: string }) {
  const nav = useNavigate()
  const { queryString, setList } = useFilters()
  const qs = queryString ? `?${queryString}` : ''
  const go = {
    ticket: (id: string) => nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(id)}`),
    employee: (n: string) => nav(`/employees/${encodeURIComponent(n)}${qs}`),
    blocked: () => { setList('status', ['blocked']); nav(`/jira${qs}`) },
    tickets: () => nav(`/jira${qs}`),
    config: () => nav('/config/status'),
    team: () => nav(`/team${qs}`),
  }
  if (!flags.length) return null
  const groups = GROUPS.map((g) => ({ ...g, items: flags.filter((f) => g.codes.includes(f.code)) })).filter((g) => g.items.length)
  const other = flags.filter((f) => !GROUPS.some((g) => g.codes.includes(f.code)))

  return (
    <div className={cn('grid gap-3 md:grid-cols-2', className)} aria-label="Watch list">
      {groups.map((g, gi) => {
        const Icon = g.icon
        return (
          <section key={g.key} className={cn('rounded-lg border bg-card animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300', g.key === 'workload' && g.items.length > 2 && 'md:col-span-2')} style={{ animationDelay: `${gi * 60}ms` }}>
            <header className="flex items-center gap-2 border-b px-3 py-2">
              <span className={cn('flex h-6 w-6 items-center justify-center rounded-md', g.tone)}><Icon className="h-3.5 w-3.5" aria-hidden /></span>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{g.title}</h4>
              <span className="ml-auto rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">{g.items.length}</span>
            </header>
            {g.key === 'workload' ? <WorkloadBars items={g.items} onOpen={go.employee} /> : (
              <ul className="divide-y">
                {g.items.map((f, i) => <FlagRow key={`${f.code}-${i}`} f={f} go={go} />)}
              </ul>
            )}
          </section>
        )
      })}
      {other.map((f, i) => (
        <section key={`o-${i}`} className="rounded-lg border bg-card"><ul><FlagRow f={f} go={go} /></ul></section>
      ))}
    </div>
  )
}

type Go = { ticket: (id: string) => void; employee: (n: string) => void; blocked: () => void; tickets: () => void; config: () => void; team: () => void }

function FlagRow({ f, go }: { f: NarrativeFlag; go: Go }) {
  const d = f.data ?? {}
  let headline: React.ReactNode = f.value ?? ''
  let label = ''
  let detail: React.ReactNode = f.text
  let action: { label: string; run: () => void } | null = null
  switch (f.code) {
    case 'blocked_age':
      headline = num(d.count); label = `${num(d.count) === 1 ? 'ticket' : 'tickets'} blocked ${num(d.threshold)}+ days`
      detail = <>Longest: <b className="font-mono font-medium text-foreground">{str(d.ticket)}</b> - {plural(num(d.days), 'day')}{d.employee ? ` - ${str(d.employee)}` : ''}</>
      action = { label: 'View blocked', run: go.blocked }
      break
    case 'blocked_rising':
      headline = <>{num(d.previous)} <ArrowRight className="inline h-4 w-4 text-muted-foreground" aria-label="to" /> {num(d.current)}</>; label = 'blocked tickets vs previous period'
      detail = `Up by ${num(d.current) - num(d.previous)} - blocked work tends to slip`
      action = { label: 'View blocked', run: go.blocked }
      break
    case 'stale':
      headline = num(d.count); label = `open ${plural(num(d.count), 'ticket').split(' ')[1]} unchanged for ${num(d.threshold)}+ days`
      detail = <TicketChips ids={(d.tickets as string[]) ?? []} total={num(d.count)} onOpen={go.ticket} />
      action = { label: 'View tickets', run: go.tickets }
      break
    case 'overdue':
      headline = num(d.count); label = `${plural(num(d.count), 'ticket').split(' ')[1]} past their due date`
      detail = (d.tickets as string[])?.length ? <TicketChips ids={d.tickets as string[]} total={num(d.count)} onOpen={go.ticket} prefix="Oldest due first:" /> : 'Re-plan or communicate before more dates pass'
      action = { label: 'View tickets', run: go.tickets }
      break
    case 'carry_over':
      headline = `${num(d.pct)}%`; label = 'of tickets carried over from before the period'
      detail = 'Scope is rolling rather than closing - check what keeps slipping sprint to sprint'
      action = { label: 'Open team view', run: go.team }
      break
    case 'throughput_drop':
      headline = <>{num(d.previous)} <ArrowRight className="inline h-4 w-4 text-muted-foreground" aria-label="to" /> {num(d.current)}</>; label = 'tickets completed vs previous period'
      detail = `${Math.round((1 - num(d.current) / Math.max(1, num(d.previous))) * 100)}% fewer completions`
      break
    case 'low_completion':
      headline = `${num(d.pct)}%`; label = `completed by ${str(d.employee)}`
      detail = `Team average ${Math.round(num(d.average))}% - may need support or has heavier tickets`
      action = { label: 'Open profile', run: () => go.employee(str(d.employee)) }
      break
    case 'unmapped':
      headline = num(d.count); label = `${plural(num(d.count), 'ticket').split(' ')[1]} with an unmapped Jira status`
      detail = 'These never count as complete until mapped'
      action = { label: 'Map statuses', run: go.config }
      break
    default:
      break
  }
  return (
    <li className="flex items-start gap-3 px-3 py-2.5">
      <span className={cn('mt-2 h-2 w-2 shrink-0 rounded-full', SEV_DOT[f.severity])} aria-label={f.severity} />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-semibold tabular-nums leading-tight">{headline}</span>
          <span className="text-sm font-medium">{label}</span>
        </p>
        <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>
      </div>
      {action && <Button size="sm" variant="ghost" className="h-7 shrink-0 text-xs text-primary" onClick={action.run}>{action.label} &rarr;</Button>}
    </li>
  )
}

function TicketChips({ ids, total, onOpen, prefix }: { ids: string[]; total?: number; onOpen: (id: string) => void; prefix?: string }) {
  if (!ids.length) return null
  const rest = Math.max(0, (total ?? ids.length) - Math.min(5, ids.length))
  return (
    <span className="flex flex-wrap items-center gap-1">
      {prefix && <span>{prefix}</span>}
      {ids.slice(0, 5).map((id) => <button key={id} type="button" onClick={() => onOpen(id)} className="rounded border bg-background px-1.5 py-0.5 font-mono text-[11px] text-primary hover:bg-muted">{id}</button>)}
      {rest > 0 && <span>+{rest} more</span>}
    </span>
  )
}

function WorkloadBars({ items, onOpen }: { items: NarrativeFlag[]; onOpen: (n: string) => void }) {
  const rows = items.map((f) => ({ name: str(f.data?.employee), load: num(f.data?.load), avg: num(f.data?.average) })).sort((a, b) => b.load - a.load)
  const avg = rows[0]?.avg ?? 0
  const max = Math.max(1, ...rows.map((r) => r.load), avg)
  return (
    <div className="px-3 py-2.5">
      <p className="mb-2 text-xs text-muted-foreground">Open tickets per person compared with the team average of <b className="text-foreground">{Math.round(avg)}</b> (dashed line). Spread or pair work before it slips.</p>
      <ul className="space-y-1.5">
        {rows.map((r, i) => {
          const unassigned = /^unassigned$/i.test(r.name)
          return (
            <li key={`${r.name}-${i}`} className="animate-in fade-in-0 slide-in-from-left-1 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 40}ms` }}>
              <button type="button" disabled={unassigned} onClick={() => onOpen(r.name)} className={cn('flex w-full items-center gap-3 rounded px-1 py-0.5 text-left text-sm', !unassigned && 'hover:bg-muted')}>
                <span className={cn('w-32 shrink-0 truncate', unassigned ? 'italic text-muted-foreground' : 'text-primary')} title={r.name}>{r.name}</span>
                <span className="relative h-2.5 flex-1 overflow-visible rounded-full bg-muted">
                  <span className="absolute inset-y-0 left-0 rounded-full bg-purple-500 transition-[width] duration-700 ease-out" style={{ width: `${(r.load / max) * 100}%` }} />
                  <span className="absolute -top-1 bottom-[-4px] w-px border-l border-dashed border-foreground/60" style={{ left: `${(avg / max) * 100}%` }} aria-hidden />
                </span>
                <span className="w-16 shrink-0 text-right text-xs tabular-nums"><b className="text-sm">{r.load}</b> <span className="text-muted-foreground">({r.load >= avg ? '+' : ''}{Math.round(r.load - avg)})</span></span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
