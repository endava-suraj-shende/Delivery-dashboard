import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, Info, Lightbulb, XCircle } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/common/States'
import { useFilters } from '@/hooks/useFilters'
import { cn } from '@/lib/utils'
import type { Insight } from '@/types'

const ICON = {
  success: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  info: <Info className="h-4 w-4 text-blue-600" />,
  warning: <AlertTriangle className="h-4 w-4 text-orange-600" />,
  danger: <XCircle className="h-4 w-4 text-red-600" />,
}
const BORDER = { success: 'border-l-green-500', info: 'border-l-blue-500', warning: 'border-l-orange-500', danger: 'border-l-red-500' }

export function InsightsPanel({ insights, title = 'Management insights', max = 12 }: { insights: Insight[]; title?: string; max?: number }) {
  const { queryString } = useFilters()
  const q = queryString ? `?${queryString}` : ''
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-primary" /> {title}
        </CardTitle>
        <CardDescription>Rule-based observations calculated from the Excel data for the selected period and filters.</CardDescription>
      </CardHeader>
      <CardContent>
        {insights.length === 0 ? (
          <EmptyState title="No insights available" />
        ) : (
          <ul className="grid gap-2 md:grid-cols-2">
            {insights.slice(0, max).map((ins, i) => {
              const body = (
                <li key={i} className={cn('flex gap-3 rounded-md border border-l-4 bg-card p-3 text-sm', BORDER[ins.type], ins.link && 'hover:bg-muted/50')}>
                  <span className="mt-0.5 shrink-0">{ICON[ins.type]}</span>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {ins.title}
                      {ins.value !== null && ins.value !== undefined && (
                        <Badge variant="secondary" className="tabular-nums">
                          {ins.value}
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">{ins.detail}</p>
                  </div>
                </li>
              )
              if (!ins.link) return body
              const href = ins.link.type === 'employee' ? `/employees/${encodeURIComponent(ins.link.value)}${q}` : ins.link.type === 'project' ? `/projects/${encodeURIComponent(ins.link.value)}${q}` : ins.link.type === 'config' ? '/config/status' : ins.link.type === 'jira' ? `/jira?tab=live${queryString ? `&${queryString}` : ''}` : `/team${q}`
              return (
                <Link key={i} to={href} className="contents">
                  {body}
                </Link>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
