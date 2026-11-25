import { useNavigate } from 'react-router-dom'
import { EmptyState } from '@/components/common/States'
import { cn, fmtDate } from '@/lib/utils'
import type { WeeklyByEmployee, WeeklyCell } from '@/types'

/** Background intensity for a cell relative to the largest value in the grid. */
function shade(value: number, max: number, hue: 'green' | 'blue'): string {
  if (!value || !max) return ''
  const step = Math.min(4, Math.ceil((value / max) * 4))
  const g = ['bg-green-500/10', 'bg-green-500/25', 'bg-green-500/45', 'bg-green-500/70 text-white']
  const b = ['bg-blue-500/10', 'bg-blue-500/25', 'bg-blue-500/45', 'bg-blue-500/70 text-white']
  return (hue === 'green' ? g : b)[step - 1]
}

/**
 * Week-by-week grid: one row per employee, one column per week.
 * Every cell prints "new to done" so no hover is needed; colour shows how much was completed.
 */
export function WeeklyTimeline({ data, onEmployee, maxRows = 30, compact }: { data: WeeklyByEmployee; onEmployee?: (name: string) => void; maxRows?: number; compact?: boolean }) {
  const nav = useNavigate()
  if (!data.weeks.length || !data.employees.length) return <EmptyState title="No weekly activity" description="Nothing was reported in the selected period." />
  const rows = data.employees.slice(0, maxRows)
  const maxDone = Math.max(1, ...rows.flatMap((r) => r.weeks.map((c) => c.completed)))
  const maxNew = Math.max(1, ...rows.flatMap((r) => r.weeks.map((c) => c.new)))
  const go = onEmployee ?? ((n: string) => nav(`/employees/${encodeURIComponent(n)}`))
  const weekLabel = (w: string, i: number) => `W${i + 1} | ${fmtDate(w, { day: '2-digit', month: 'short' })}`
  return (
    <div className="overflow-auto rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
          <tr>
            <th className="sticky left-0 z-20 bg-muted px-3 py-2 text-left font-medium">Employee</th>
            {data.weeks.map((w, i) => (
              <th key={w} className="px-2 py-2 text-center font-medium whitespace-nowrap">{weekLabel(w, i)}</th>
            ))}
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total new</th>
            <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Total done</th>
          </tr>
          <tr className="text-[10px] font-normal">
            <th className="sticky left-0 z-20 bg-muted px-3 pb-1 text-left">each cell: <span className="text-blue-600">new</span> to <span className="text-green-600">done</span></th>
            {data.weeks.map((w) => <th key={w} />)}
            <th /><th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employee} className="border-t hover:bg-muted/30">
              <td className="sticky left-0 z-10 cursor-pointer bg-background px-3 py-1.5 font-medium whitespace-nowrap hover:underline" onClick={() => go(r.employee)}>{r.employee}</td>
              {r.weeks.map((c) => <Cell key={c.week} c={c} maxDone={maxDone} maxNew={maxNew} compact={compact} />)}
              <td className="px-3 py-1.5 text-right tabular-nums text-blue-600">{r.total_new}</td>
              <td className="px-3 py-1.5 text-right tabular-nums font-medium text-green-600">{r.total_completed}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t bg-muted/40 font-medium">
          <tr>
            <td className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5">Team</td>
            {data.weeks.map((w, i) => {
              const n = rows.reduce((s, r) => s + (r.weeks[i]?.new ?? 0), 0)
              const d = rows.reduce((s, r) => s + (r.weeks[i]?.completed ?? 0), 0)
              return <td key={w} className="px-2 py-1.5 text-center tabular-nums whitespace-nowrap"><span className="text-blue-600">{n}</span> to <span className="text-green-600">{d}</span></td>
            })}
            <td className="px-3 py-1.5 text-right tabular-nums text-blue-600">{rows.reduce((s, r) => s + r.total_new, 0)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums text-green-600">{rows.reduce((s, r) => s + r.total_completed, 0)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Cell({ c, maxDone, maxNew, compact }: { c: WeeklyCell; maxDone: number; maxNew: number; compact?: boolean }) {
  const empty = !c.new && !c.completed && !c.worked
  const cls = c.completed ? shade(c.completed, maxDone, 'green') : c.new ? shade(c.new, maxNew, 'blue') : ''
  const title = empty ? undefined : `Week of ${fmtDate(c.week)}: ${c.new} ticket(s) started, ${c.completed} completed, ${c.worked} worked on (${c.activities} updates)${c.blocked ? `, ${c.blocked} blocked` : ''}`
  return (
    <td className={cn('px-2 py-1.5 text-center tabular-nums whitespace-nowrap', cls, empty && 'text-muted-foreground/40')} title={title}>
      {empty ? '|' : (
        <>
          <span className={cn(!cls.includes('text-white') && 'text-blue-700 dark:text-blue-300')}>{c.new}</span>
          <span className="opacity-60"> to </span>
          <span className={cn('font-medium', !cls.includes('text-white') && 'text-green-700 dark:text-green-300')}>{c.completed}</span>
          {!compact && c.blocked > 0 && <span className="ml-1 text-red-600">Blocked {c.blocked}</span>}
        </>
      )}
    </td>
  )
}
