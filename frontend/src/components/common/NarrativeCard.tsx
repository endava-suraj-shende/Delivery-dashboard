import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, Check, Copy, Flag, Info, ListChecks, Minus, Rocket, Sparkles, Users, Workflow } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useNarrative } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import type { Narrative, NarrativeFlag } from '@/services/api'
import { cn } from '@/lib/utils'

const SEV: Record<NarrativeFlag['severity'], { icon: typeof Info; cls: string }> = {
  danger: { icon: AlertOctagon, cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200' },
  warning: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200' },
}

type Kind = Narrative['paragraphs'][number]['kind']
const SECTION: Record<Exclude<Kind, 'headline'>, { label: string; icon: typeof Info; tone: string }> = {
  delivery: { label: 'Delivery', icon: Workflow, tone: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
  releases: { label: 'Releases', icon: Rocket, tone: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
  people: { label: 'People', icon: Users, tone: 'bg-purple-500/10 text-purple-600 dark:text-purple-400' },
  risks: { label: 'Watch', icon: Flag, tone: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
  next: { label: 'Next', icon: ListChecks, tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
}
const ORDER: Exclude<Kind, 'headline'>[] = ['delivery', 'releases', 'people', 'risks', 'next']

const STATUS = {
  track: { label: 'On track', dot: 'bg-emerald-500', cls: 'text-emerald-700 dark:text-emerald-300' },
  progressing: { label: 'Progressing', dot: 'bg-sky-500', cls: 'text-sky-700 dark:text-sky-300' },
  attention: { label: 'Needs attention', dot: 'bg-red-500', cls: 'text-red-700 dark:text-red-300' },
}
function statusOf(headline: string) {
  if (/on track/i.test(headline)) return STATUS.track
  if (/needs attention/i.test(headline)) return STATUS.attention
  return STATUS.progressing
}

/** Small "value + change vs previous period" tile. Down is good for blocked. */
function Fact({ label, value, prev, invert, suffix }: { label: string; value: number | string | null | undefined; prev?: number | null; invert?: boolean; suffix?: string }) {
  const v = typeof value === 'number' ? value : null
  const raw = v !== null && prev !== null && prev !== undefined ? v - prev : null
  const delta = raw === 0 ? null : raw
  const good = delta === null ? null : delta === 0 ? null : invert ? delta < 0 : delta > 0
  return (
    <div className="rounded-md border bg-background/70 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-lg font-semibold tabular-nums leading-none">{value ?? '-'}{suffix}</span>
        {delta !== null && (
          <span className={cn('inline-flex items-center text-[11px] font-medium tabular-nums', good === null ? 'text-muted-foreground' : good ? 'text-emerald-600 dark:text-emerald-300' : 'text-red-600 dark:text-red-300')} title="vs the previous period of the same length">
            {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : delta < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}{delta > 0 ? '+' : ''}{delta}
          </span>
        )}
      </p>
    </div>
  )
}

/**
 * Period summary for the current filter scope (or one person): a status verdict, the key figures with change
 * versus the previous period, then one line per topic. Every sentence is derived from the same numbers the
 * dashboard shows (rule-based, deterministic). Flags are the anomalies worth raising in a status call.
 */
export function NarrativeCard({ employee, className }: { employee?: string; className?: string }) {
  const q = useNarrative(employee)
  const nav = useNavigate()
  const { queryString, setList } = useFilters()
  const [copied, setCopied] = useState(false)
  const qs = queryString ? `?${queryString}` : ''

  const text = q.data ? q.data.paragraphs.map((p) => p.text).join('\n\n') : ''
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* clipboard unavailable */ }
  }
  const follow = (f: NarrativeFlag) => {
    if (!f.link) return
    if (f.link.type === 'employee') nav(`/employees/${encodeURIComponent(f.link.value)}${qs}`)
    else if (f.link.type === 'ticket') nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(f.link.value)}`)
    else if (f.link.type === 'config') nav('/config/status')
    else if (f.link.type === 'project') nav(`/projects/${encodeURIComponent(f.link.value)}${qs}`)
  }

  const d = q.data
  const facts = d?.facts ?? {}
  const n = (k: string) => (typeof facts[k] === 'number' ? (facts[k] as number) : null)
  const status = d ? statusOf(d.headline) : null
  // the 'Watch' sentence repeats the flags shown as clickable chips below, so it is only kept when there are no flags
  const sections = d ? ORDER.filter((k) => k !== 'risks' || !d.flags.length).map((k) => ({ kind: k, lines: d.paragraphs.filter((p) => p.kind === k).map((p) => p.text) })).filter((s) => s.lines.length) : []
  const hasWork = d ? (n('total') ?? 0) > 0 : false

  return (
    <Card className={cn('border-primary/20', className)} data-testid="narrative-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> {employee ? 'This period in one paragraph' : 'Delivery narrative'}</CardTitle>
          <CardDescription>{d ? `${d.scope} | ${d.period.label}` : 'Generated from the figures on this page'}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={copy} disabled={!text} aria-label="Copy narrative">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading && !d && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-10 animate-pulse rounded-md bg-muted/60" />)}</div>}
        {q.isError && <p className="text-red-600">Could not build the narrative.</p>}
        {d && status && (
          <>
            {/* headline: verdict + sentence */}
            <div className="flex items-start gap-3 rounded-lg border bg-gradient-to-br from-muted/40 to-transparent p-3 animate-in fade-in-0 duration-300">
              <span className={cn('mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full', status.dot)} aria-hidden />
              <div className="min-w-0">
                <p className={cn('text-[11px] font-semibold uppercase tracking-wide', status.cls)}>{hasWork ? status.label : 'No activity'}</p>
                <p className="font-medium leading-snug">{d.headline}</p>
              </div>
            </div>

            {hasWork && (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Fact label="Completed" value={n('completed')} prev={n('completed_prev')} />
                <Fact label="In progress" value={n('in_progress')} />
                <Fact label="Blocked" value={n('blocked')} prev={n('blocked_prev')} invert />
                <Fact label="Pending" value={n('pending')} />
                <Fact label="Releases" value={n('releases') ? `${n('released') ?? 0}/${n('releases')}` : 0} />
                {employee ? <Fact label="Tickets" value={n('total')} /> : <Fact label="Carried over" value={n('carry_over_pct')} suffix={n('carry_over_pct') !== null ? '%' : ''} />}
              </div>
            )}

            {sections.length > 0 && (
              <dl className="divide-y rounded-lg border">
                {sections.map((s, i) => {
                  const meta = SECTION[s.kind]
                  const Icon = meta.icon
                  return (
                    <div key={s.kind} className="flex gap-3 px-3 py-2.5 animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300" style={{ animationDelay: `${i * 60}ms` }}>
                      <dt className="flex w-28 shrink-0 items-center gap-2 self-start text-xs font-semibold text-muted-foreground">
                        <span className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-md', meta.tone)}><Icon className="h-3.5 w-3.5" aria-hidden /></span>{meta.label}
                      </dt>
                      <dd className={cn('min-w-0 flex-1 space-y-1 leading-relaxed', s.kind === 'risks' && 'text-amber-800 dark:text-amber-200', s.kind === 'next' && 'text-foreground')}>
                        {s.lines.map((l, j) => { const t = l.replace(/^(Watch|Suggested focus):\s*/i, ''); return <p key={j}>{t.charAt(0).toUpperCase() + t.slice(1)}</p> })}
                      </dd>
                    </div>
                  )
                })}
              </dl>
            )}

            {d.flags.length > 0 ? (
              <div className="flex flex-wrap gap-2" aria-label="Anomaly flags">
                {d.flags.map((f, i) => {
                  const { icon: Icon, cls } = SEV[f.severity]
                  const clickable = !!f.link || f.code.startsWith('blocked')
                  return (
                    <button key={i} type="button" onClick={() => (f.link ? follow(f) : f.code.startsWith('blocked') ? setList('status', ['blocked']) : undefined)}
                      className={cn('inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-xs transition-colors', cls, clickable && 'cursor-pointer hover:brightness-95')} title={clickable ? 'Open' : undefined}>
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> <span>{f.text}</span>
                    </button>
                  )
                })}
              </div>
            ) : hasWork ? <p className="text-xs text-muted-foreground">No anomalies detected for this scope.</p> : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
