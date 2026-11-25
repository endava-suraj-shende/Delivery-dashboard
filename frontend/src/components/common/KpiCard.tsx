import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { HelpTip } from '@/components/ui/primitives'
import { cn, fmtNum } from '@/lib/utils'

export type Tone = 'default' | 'green' | 'blue' | 'orange' | 'amber' | 'pink' | 'red' | 'grey' | 'purple' | 'teal'

const toneClasses: Record<Tone, string> = {
  default: 'bg-primary/10 text-primary',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  amber: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  pink: 'bg-pink-500/10 text-pink-600 dark:text-pink-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  grey: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  teal: 'bg-teal-500/10 text-teal-600 dark:text-teal-400',
}

export interface KpiCardProps {
  label: string
  value: number | string | null | undefined
  icon?: ReactNode
  tone?: Tone
  hint?: string
  previous?: number | null
  suffix?: string
  onClick?: () => void
  active?: boolean
  sub?: string
  compact?: boolean
}

export function KpiCard({ label, value, icon, tone = 'default', hint, previous, suffix, onClick, active, sub, compact }: KpiCardProps) {
  const numeric = typeof value === 'number' ? value : null
  const delta = numeric !== null && previous !== null && previous !== undefined ? numeric - previous : null
  const body = (
    <Card
      className={cn(
        'relative overflow-hidden transition-all',
        onClick && 'cursor-pointer hover:shadow-md hover:border-primary/40',
        active && 'ring-2 ring-primary border-primary',
        compact ? 'p-3' : 'p-4',
      )}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={cn('truncate font-medium text-muted-foreground', compact ? 'text-[11px]' : 'text-xs')}>{label}</p>
          <p className={cn('mt-1 font-semibold tracking-tight tabular-nums', compact ? 'text-xl' : 'text-2xl')}>
            {typeof value === 'number' ? fmtNum(value, 1) : (value ?? '-')}
            {suffix && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{suffix}</span>}
          </p>
          {sub && <p className="mt-0.5 text-[11px] text-muted-foreground truncate">{sub}</p>}
          {delta !== null && (
            <p className={cn('mt-1 flex items-center gap-0.5 text-[11px] font-medium', delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-muted-foreground')}>
              {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : delta < 0 ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
              {delta > 0 ? '+' : ''}
              {fmtNum(delta, 1)} vs previous
            </p>
          )}
        </div>
        {icon && <div className={cn('rounded-md p-2 shrink-0', toneClasses[tone])}>{icon}</div>}
      </div>
    </Card>
  )
  return hint ? <HelpTip text={hint}>{body}</HelpTip> : body
}

export function KpiGrid({ children, cols = 5 }: { children: ReactNode; cols?: 4 | 5 | 6 }) {
  const c = { 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols]
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', c)}>{children}</div>
}
