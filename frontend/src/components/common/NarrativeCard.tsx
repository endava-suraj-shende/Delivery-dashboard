import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, Check, Copy, Info, Sparkles } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useNarrative } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import type { NarrativeFlag } from '@/services/api'
import { cn } from '@/lib/utils'

const SEV: Record<NarrativeFlag['severity'], { icon: typeof Info; cls: string }> = {
  danger: { icon: AlertOctagon, cls: 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200' },
  warning: { icon: AlertTriangle, cls: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200' },
  info: { icon: Info, cls: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/30 dark:text-sky-200' },
}

/**
 * Paste-ready narrative for the current filter scope: every sentence is derived from the same numbers the
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
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable (http, permissions) - silently ignore */
    }
  }

  const follow = (f: NarrativeFlag) => {
    if (!f.link) return
    if (f.link.type === 'employee') nav(`/employees/${encodeURIComponent(f.link.value)}${qs}`)
    else if (f.link.type === 'ticket') nav(`/jira${qs}${qs ? '&' : '?'}ticket=${encodeURIComponent(f.link.value)}`)
    else if (f.link.type === 'config') nav('/config/status')
    else if (f.link.type === 'project') nav(`/projects/${encodeURIComponent(f.link.value)}${qs}`)
  }

  return (
    <Card className={cn('border-primary/20', className)} data-testid="narrative-card">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-primary" aria-hidden /> {employee ? 'This period in one paragraph' : 'Delivery narrative'}</CardTitle>
          <CardDescription>{q.data ? `${q.data.scope} | ${q.data.period.label}` : 'Generated from the figures on this page'}</CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={copy} disabled={!text} aria-label="Copy narrative">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />} {copied ? 'Copied' : 'Copy'}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 text-sm leading-relaxed">
        {q.isLoading && <p className="text-muted-foreground">Writing summary...</p>}
        {q.isError && <p className="text-red-600">Could not build the narrative.</p>}
        {q.data && (
          <>
            {q.data.paragraphs.map((p, i) => (
              <p key={i} className={cn(p.kind === 'headline' && 'font-medium text-foreground', p.kind === 'risks' && 'text-amber-800 dark:text-amber-200', p.kind === 'next' && 'text-muted-foreground')}>{p.text}</p>
            ))}
            {q.data.flags.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1" aria-label="Anomaly flags">
                {q.data.flags.map((f, i) => {
                  const { icon: Icon, cls } = SEV[f.severity]
                  return (
                    <button key={i} type="button" onClick={() => (f.link ? follow(f) : f.code === 'blocked_rising' || f.code === 'blocked_age' ? setList('status', ['blocked']) : undefined)}
                      className={cn('inline-flex max-w-full items-start gap-1.5 rounded-md border px-2 py-1 text-left text-xs', cls, (f.link || f.code.startsWith('blocked')) && 'cursor-pointer hover:brightness-95')}
                      title={f.link ? 'Open' : undefined}>
                      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> <span>{f.text}</span>
                    </button>
                  )
                })}
              </div>
            )}
            {q.data.flags.length === 0 && <Badge variant="secondary" className="font-normal">No anomalies detected for this scope</Badge>}
          </>
        )}
      </CardContent>
    </Card>
  )
}
