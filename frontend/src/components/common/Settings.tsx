import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { CheckCircle2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Card with an icon title, used by all configuration pages so they share one visual rhythm. */
export function SettingsCard({ icon: Icon, title, description, action, children, className, tone }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; tone?: 'default' | 'warning' | 'info' | 'danger' }) {
  const border = tone === 'warning' ? 'border-orange-300 dark:border-orange-800' : tone === 'danger' ? 'border-red-300 dark:border-red-800' : tone === 'info' ? 'border-blue-300 dark:border-blue-800' : ''
  const iconTone = tone === 'warning' ? 'bg-orange-500/10 text-orange-600' : tone === 'danger' ? 'bg-red-500/10 text-red-600' : tone === 'info' ? 'bg-blue-500/10 text-blue-600' : 'bg-primary/10 text-primary'
  return (
    <Card className={cn(border, className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon && <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md', iconTone)}><Icon className="h-4 w-4" /></span>}
          <div className="min-w-0">
            <CardTitle className="text-sm font-semibold leading-5">{title}</CardTitle>
            {description && <CardDescription className="mt-0.5 text-xs leading-4">{description}</CardDescription>}
          </div>
        </div>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

/** Selectable tile (radio-like). */
export function OptionTile({ icon: Icon, title, description, active, disabled, onClick, badge }: { icon?: LucideIcon; title: ReactNode; description?: ReactNode; active?: boolean; disabled?: boolean; onClick?: () => void; badge?: ReactNode }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('flex w-full items-start gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50', active && 'border-primary bg-primary/5 ring-1 ring-primary')} aria-pressed={active}>
      {Icon && <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}><Icon className="h-4 w-4" /></span>}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium leading-5">{title}{badge}</span>
        {description && <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span>}
      </span>
      {active && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
    </button>
  )
}

/** Label / value rows. */
export function KeyValueList({ items, className }: { items: { label: ReactNode; value: ReactNode }[]; className?: string }) {
  return (
    <dl className={cn('divide-y text-sm', className)}>
      {items.map((it, i) => (
        <div key={i} className="flex items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-muted-foreground">{it.label}</dt>
          <dd className="min-w-0 text-right font-medium">{it.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Small status strip tile (health / counters). */
export function StatTile({ icon: Icon, label, value, sub, tone = 'default' }: { icon?: LucideIcon; label: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'green' | 'orange' | 'red' | 'blue' | 'grey' }) {
  const t = { default: 'bg-primary/10 text-primary', green: 'bg-green-500/10 text-green-600', orange: 'bg-orange-500/10 text-orange-600', red: 'bg-red-500/10 text-red-600', blue: 'bg-blue-500/10 text-blue-600', grey: 'bg-gray-500/10 text-gray-600' }[tone]
  return (
    <Card className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</p>
          {sub && <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</p>}
        </div>
        {Icon && <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md', t)}><Icon className="h-4 w-4" /></span>}
      </div>
    </Card>
  )
}

export function StatStrip({ children, cols = 5 }: { children: ReactNode; cols?: 4 | 5 | 6 }) {
  const c = { 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }[cols]
  return <div className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', c)}>{children}</div>
}

/** Inline notice (info / warning). */
export function Notice({ tone = 'info', icon: Icon, children, action }: { tone?: 'info' | 'warning' | 'success'; icon?: LucideIcon; children: ReactNode; action?: ReactNode }) {
  const cls = { info: 'border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-100', warning: 'border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900 dark:bg-orange-950/30 dark:text-orange-100', success: 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/30 dark:text-green-100' }[tone]
  return (
    <div className={cn('flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm', cls)}>
      {Icon && <Icon className="h-4 w-4 shrink-0" />}
      <span className="min-w-0 flex-1">{children}</span>
      {action}
    </div>
  )
}
