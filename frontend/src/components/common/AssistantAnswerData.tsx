import { CategoryCell, TicketLink } from '@/components/common/Tables'
import type { AskResponse } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

type Row = Record<string, unknown>
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0) || 0)
const str = (v: unknown) => (v == null ? '' : String(v))

/**
 * Renders the structured part of an assistant answer in the most readable shape for that answer type:
 * ticket lists -> table, people rankings -> bars, KPI answers -> chips, forecast -> milestone table, etc.
 * Only shows what the engine returned; never invents figures.
 */
export function AssistantAnswerData({ reply, onNavigate }: { reply: AskResponse; onNavigate: (url: string) => void }) {
  const d = (reply.data ?? {}) as Row
  const openTicket = (id: string) => onNavigate(`/jira?ticket=${encodeURIComponent(id)}`)

  if (Array.isArray(d.tickets) && d.tickets.length) return <TicketsMini rows={d.tickets as Row[]} onOpen={openTicket} />
  if (Array.isArray(d.employees) && d.employees.length) {
    const key = reply.spec.status.length === 1 ? reply.spec.status[0] : 'completed'
    return <PeopleBars rows={d.employees as Row[]} metric={key} onOpen={(n) => onNavigate(`/employees/${encodeURIComponent(n)}`)} />
  }
  if (d.risk && typeof d.risk === 'object') {
    const r = d.risk as { items?: Row[]; summary?: Row }
    return r.items?.length ? <RiskMini rows={r.items} onOpen={openTicket} /> : null
  }
  if (d.kpis && typeof d.kpis === 'object') return <KpiChips kpis={d.kpis as Row} intent={reply.spec.intent} />
  if (d.forecast && typeof d.forecast === 'object') return <ForecastMini fc={d.forecast as Row} />
  if (d.velocity && typeof d.velocity === 'object') return <KpiChips kpis={d.velocity as Row} intent="velocity" />
  if (d.recommendations && typeof d.recommendations === 'object') {
    const items = ((d.recommendations as { items?: Row[] }).items ?? []).slice(0, 5)
    return items.length ? (
      <ol className="mt-2 space-y-1 text-xs">
        {items.map((r, i) => (
          <li key={i} className="flex gap-2 rounded border bg-background px-2 py-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{i + 1}</span>
            <span className="min-w-0"><span className="font-medium">{str(r.title)}</span>{r.effect ? <span className="text-muted-foreground"> - {str(r.effect)}</span> : null}</span>
          </li>
        ))}
      </ol>
    ) : null
  }
  if (d.anomalies && typeof d.anomalies === 'object') {
    const items = ((d.anomalies as { items?: Row[] }).items ?? []).slice(0, 6)
    return items.length ? (
      <MiniTable head={['Who', 'Metric', 'This week', 'Usual']} rows={items.map((a) => [str(a.scope), str(a.metric_label), <b key="v" className={num(a.z) < 0 ? 'text-red-600' : 'text-emerald-700'}>{num(a.value)}</b>, Math.round(num(a.baseline_median))])} />
    ) : null
  }
  return null
}

function MiniTable({ head, rows, align }: { head: string[]; rows: React.ReactNode[][]; align?: ('left' | 'right')[] }) {
  return (
    <div className="mt-2 overflow-x-auto rounded border">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-[10px] uppercase tracking-wide text-muted-foreground">
          <tr>{head.map((h, i) => <th key={h} className={cn('px-2 py-1.5 font-semibold', align?.[i] === 'right' ? 'text-right' : 'text-left')}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t odd:bg-background even:bg-muted/20 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 30}ms` }}>
              {r.map((c, j) => <td key={j} className={cn('px-2 py-1.5 align-middle', align?.[j] === 'right' ? 'text-right tabular-nums' : '')}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function dueLabel(due: unknown, overdue: unknown) {
  const s = str(due).slice(0, 10)
  if (!s) return <span className="text-muted-foreground">-</span>
  return <span className={cn('whitespace-nowrap tabular-nums', overdue ? 'font-medium text-red-600' : 'text-muted-foreground')} title={overdue ? 'Overdue' : undefined}>{fmtDate(s)}</span>
}

function TicketsMini({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const shown = rows.slice(0, 10)
  return (
    <>
      <MiniTable
        head={['Ticket', 'Assignee', 'Status', 'Due']}
        rows={shown.map((t) => [
          <TicketLink key="t" id={str(t.ticket_id)} link={str(t.ticket_link) || null} onOpen={onOpen} />,
          <span key="e" className="whitespace-nowrap">{str(t.employee) || '-'}</span>,
          <CategoryCell key="s" dim="work_status" value={str(t.work_status)} />,
          dueLabel(t.due_date, t.overdue),
        ])}
      />
      {rows.length > shown.length && <p className="mt-1 text-[10px] text-muted-foreground">Showing {shown.length} of {rows.length} - use the link below for the full list.</p>}
    </>
  )
}

function RiskMini({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  return (
    <MiniTable
      head={['Ticket', 'Assignee', 'Risk']}
      align={['left', 'left', 'right']}
      rows={rows.slice(0, 8).map((t) => [
        <TicketLink key="t" id={str(t.ticket_id)} link={str(t.ticket_link) || null} onOpen={onOpen} />,
        <span key="e" className="whitespace-nowrap">{str(t.employee) || 'Unassigned'}</span>,
        <span key="r" className="inline-flex items-center justify-end gap-1.5">
          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full rounded-full', num(t.risk) >= 0.75 ? 'bg-red-500' : num(t.risk) >= 0.45 ? 'bg-amber-500' : 'bg-emerald-500')} style={{ width: `${Math.round(num(t.risk) * 100)}%` }} /></span>
          <b className="tabular-nums">{Math.round(num(t.risk) * 100)}%</b>
        </span>,
      ])}
    />
  )
}

const METRIC_LABEL: Record<string, string> = { completed: 'completed', blocked: 'blocked', in_progress: 'in progress', pending: 'pending', on_hold: 'on hold', reopened: 're-opened' }

function PeopleBars({ rows, metric, onOpen }: { rows: Row[]; metric: string; onOpen: (name: string) => void }) {
  const shown = rows.slice(0, 8)
  const max = Math.max(1, ...shown.map((r) => num(r[metric])))
  return (
    <div className="mt-2 space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Tickets {METRIC_LABEL[metric] ?? metric} per person</p>
      {shown.map((r, i) => {
        const v = num(r[metric])
        return (
          <button key={str(r.employee)} type="button" onClick={() => onOpen(str(r.employee))} className="flex w-full items-center gap-2 rounded px-1 py-0.5 text-left text-xs hover:bg-muted animate-in fade-in-0 slide-in-from-left-1 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 40}ms` }}>
            <span className="w-28 shrink-0 truncate" title={str(r.employee)}>{str(r.employee)}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted"><span className={cn('block h-full rounded-full transition-[width] duration-700 ease-out', metric === 'blocked' ? 'bg-red-500' : metric === 'completed' ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${(v / max) * 100}%` }} /></span>
            <span className="w-6 text-right font-semibold tabular-nums">{v}</span>
          </button>
        )
      })}
    </div>
  )
}

const KPI_SETS: Record<string, { key: string; label: string }[]> = {
  completed: [{ key: 'completed_tickets', label: 'Completed' }, { key: 'total_tickets', label: 'Tickets in period' }, { key: 'production_released', label: 'Prod releases' }],
  in_progress: [{ key: 'in_progress_tickets', label: 'In progress' }, { key: 'pending_tickets', label: 'Pending / on hold' }, { key: 'blocked_tickets', label: 'Blocked' }, { key: 'remaining_tickets', label: 'Remaining' }],
  releases: [{ key: 'production_released', label: 'Prod deployed' }, { key: 'production_pending', label: 'Prod pending' }, { key: 'dev_deployed', label: 'Dev deployed' }, { key: 'dev_pending', label: 'Dev pending' }],
  velocity: [{ key: 'average_completed', label: 'Avg per sprint' }, { key: 'average_last3', label: 'Last 3 sprints' }, { key: 'closed_sprints', label: 'Closed sprints' }],
}

function KpiChips({ kpis, intent }: { kpis: Row; intent: string }) {
  const set = KPI_SETS[intent] ?? KPI_SETS.in_progress
  const items = set.filter((k) => kpis[k.key] !== undefined && kpis[k.key] !== null)
  if (!items.length) return null
  return (
    <div className="mt-2 grid grid-cols-2 gap-1.5">
      {items.map((k, i) => (
        <div key={k.key} className="rounded border bg-background px-2 py-1.5 animate-in fade-in-0 zoom-in-95 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 50}ms` }}>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
          <p className="text-base font-semibold tabular-nums">{num(kpis[k.key])}</p>
        </div>
      ))}
    </div>
  )
}

function ForecastMini({ fc }: { fc: Row }) {
  const completion = fc.completion as { percentiles?: { p: number; date: string | null; days: number }[] } | null
  const pcts = completion?.percentiles ?? []
  const hist = fc.history as Row | undefined
  return (
    <>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {[{ label: 'Remaining', v: num(fc.remaining) }, { label: 'Pace / week', v: num(hist?.avg_per_week) }, { label: 'Confidence', v: str(fc.confidence) }].map((k, i) => (
          <div key={k.label} className="rounded border bg-background px-2 py-1.5 animate-in fade-in-0 zoom-in-95 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 50}ms` }}>
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className="text-base font-semibold capitalize tabular-nums">{k.v}</p>
          </div>
        ))}
      </div>
      {pcts.length > 0 && (
        <MiniTable head={['Likelihood', 'Done by', 'In']} align={['left', 'left', 'right']}
          rows={pcts.filter((p) => [50, 85, 95].includes(p.p)).map((p) => [`${p.p}%`, p.date ? fmtDate(p.date) : 'beyond horizon', `${p.days} d`])} />
      )}
    </>
  )
}
