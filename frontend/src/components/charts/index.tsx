import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/States'
import { colorFor, fmtDateShort, truncate, cn } from '@/lib/utils'
import type { CategoryPoint, GroupedRow, NamedValue } from '@/types'

// ------------------------------------------------------------------ wrapper
export function ChartCard({ title, description, children, className, action, height = 280 }: { title: string; description?: string; children: ReactNode; className?: string; action?: ReactNode; height?: number }) {
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle>{title}</CardTitle>
          {description && <CardDescription className="mt-1">{description}</CardDescription>}
        </div>
        {action}
      </CardHeader>
      <CardContent className="flex-1" style={{ minHeight: height }}>
        {children}
      </CardContent>
    </Card>
  )
}

const tooltipStyle = { borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }

// ------------------------------------------------------------------ donut
function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const r = el.getBoundingClientRect()
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return { ref, ...size }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

export function DonutChart({ data, onSelect, selected, centerLabel }: { data: CategoryPoint[]; onSelect?: (key: string) => void; selected?: string[]; height?: number; centerLabel?: string }) {
  const points = data.filter((d) => d.value > 0)
  const total = points.reduce((s, p) => s + p.value, 0)
  const { ref, w, h } = useElementSize<HTMLDivElement>()
  if (!total) return <EmptyState />

  // Side-by-side only when the card is wide and not taller than it is wide; otherwise stack donut over a full-width legend.
  const row = w >= 480 && h <= w
  const legendRows = points.length
  const legendHeight = legendRows * 34 + 8
  const size = w === 0 ? 0 : row ? clamp(Math.min(w * 0.42, h), 150, 280) : clamp(Math.min(w * 0.8, Math.max(h - legendHeight - 12, 0)), 150, 300)
  const big = size >= 220

  return (
    <div ref={ref} className={cn('flex h-full w-full items-center justify-center', row ? 'flex-row gap-6' : 'flex-col gap-3')}>
      {size > 0 && (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie data={points} dataKey="value" nameKey="label" innerRadius="66%" outerRadius="96%" paddingAngle={points.length > 1 ? 2 : 0} stroke="none" cornerRadius={3} onClick={onSelect ? (d) => onSelect((d as unknown as CategoryPoint).key) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}>
                {points.map((p, i) => (
                  <Cell key={p.key} fill={colorFor(p.color, i)} opacity={selected?.length && !selected.includes(p.key) ? 0.3 : 1} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${Number(v ?? 0)} (${((Number(v ?? 0) / total) * 100).toFixed(0)}%)`, String(n)]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn('font-semibold tabular-nums leading-none', big ? 'text-3xl' : 'text-xl')}>{total}</span>
            <span className={cn('mt-1 uppercase tracking-wide text-muted-foreground', big ? 'text-[11px]' : 'text-[10px]')}>{centerLabel ?? 'total'}</span>
          </div>
        </div>
      )}
      <ul className={cn('min-w-0 space-y-1', row ? 'flex-1' : 'w-full')}>
        {points.map((p, i) => {
          const pct = (p.value / total) * 100
          const color = colorFor(p.color, i)
          const active = selected?.includes(p.key)
          const dimmed = selected?.length && !active
          return (
            <li
              key={p.key}
              className={cn('rounded-md px-2 py-1.5 transition-colors', onSelect && 'cursor-pointer hover:bg-muted', active && 'bg-muted', dimmed && 'opacity-60')}
              onClick={onSelect ? () => onSelect(p.key) : undefined}
              title={`${p.label}: ${p.value} (${pct.toFixed(1)}%)`}
            >
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
                  <span className={cn('truncate', active && 'font-medium')}>{p.label}</span>
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className="font-semibold">{p.value}</span>
                  <span className="ml-1.5 text-muted-foreground">{pct.toFixed(0)}%</span>
                </span>
              </div>
              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 1.5)}%`, background: color }} />
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ simple bar (category series)
export function CategoryBarChart({ data, onSelect, height = 260, horizontal }: { data: CategoryPoint[]; onSelect?: (key: string) => void; height?: number; horizontal?: boolean }) {
  const points = data.filter((d) => d.value > 0)
  if (!points.length) return <EmptyState />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={points} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 8, right: 12, left: horizontal ? 8 : -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={!horizontal} horizontal={horizontal} />
        {horizontal ? <XAxis type="number" tick={axisTick} allowDecimals={false} /> : <XAxis dataKey="label" tick={axisTick} interval={0} angle={points.length > 6 ? -20 : 0} textAnchor={points.length > 6 ? 'end' : 'middle'} height={points.length > 6 ? 50 : 30} />}
        {horizontal ? <YAxis type="category" dataKey="label" tick={axisTick} width={120} /> : <YAxis tick={axisTick} allowDecimals={false} />}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Bar dataKey="value" radius={4} onClick={onSelect ? (d) => onSelect((d as unknown as { key: string }).key) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
          {points.map((p, i) => (
            <Cell key={p.key} fill={colorFor(p.color, i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ named horizontal bars
export function NamedBarChart({ data, onSelect, height, color = '#2563eb', max = 15, valueLabel = 'Count' }: { data: NamedValue[]; onSelect?: (name: string) => void; height?: number; color?: string; max?: number; valueLabel?: string }) {
  const points = data.slice(0, max)
  if (!points.length) return <EmptyState />
  const h = height ?? Math.max(200, points.length * 28 + 40)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={points} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={axisTick} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={axisTick} width={140} tickFormatter={(v: string) => truncate(v, 22)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v) => [Number(v ?? 0), valueLabel]} />
        <Bar dataKey="value" fill={color} radius={[0, 4, 4, 0]} onClick={onSelect ? (d) => onSelect((d as unknown as NamedValue).name) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} label={{ position: 'right', fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ stacked grouped bars (by employee / project etc)
export interface StackSeries {
  key: string
  label: string
  color: string
}

export function StackedBarChart({ data, series, onSelect, height, max = 20, horizontal = true, hideEmptySeries = true }: { data: GroupedRow[]; series: StackSeries[]; onSelect?: (name: string) => void; height?: number; max?: number; horizontal?: boolean; hideEmptySeries?: boolean }) {
  const points = data.slice(0, max)
  if (!points.length) return <EmptyState />
  const active = hideEmptySeries ? series.filter((s) => points.some((p) => Number(p[s.key] ?? 0) > 0)) : series
  const h = height ?? (horizontal ? Math.max(220, points.length * 30 + 60) : 300)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={points} layout={horizontal ? 'vertical' : 'horizontal'} margin={{ top: 4, right: 16, left: horizontal ? 8 : -10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={!horizontal} vertical={horizontal} />
        {horizontal ? <XAxis type="number" tick={axisTick} allowDecimals={false} /> : <XAxis dataKey="name" tick={axisTick} interval={0} angle={-20} textAnchor="end" height={60} tickFormatter={(v: string) => truncate(v, 16)} />}
        {horizontal ? <YAxis type="category" dataKey="name" tick={axisTick} width={140} tickFormatter={(v: string) => truncate(v, 22)} /> : <YAxis tick={axisTick} allowDecimals={false} />}
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {active.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={colorFor(s.color, i)} onClick={onSelect ? (d) => onSelect((d as unknown as GroupedRow).name) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} radius={i === active.length - 1 ? (horizontal ? [0, 3, 3, 0] : [3, 3, 0, 0]) : 0} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ score bars (one colour per row, e.g. rating)
export interface ScorePoint {
  name: string
  value: number
  color?: string
  label?: string
}

export function ScoreBarChart({ data, onSelect, height, max = 30, domain = [0, 100], valueLabel = 'Score', thresholds = [] }: { data: ScorePoint[]; onSelect?: (name: string) => void; height?: number; max?: number; domain?: [number, number]; valueLabel?: string; thresholds?: { value: number; label: string; color: string }[] }) {
  const points = data.slice(0, max)
  if (!points.length) return <EmptyState />
  const h = height ?? Math.max(200, points.length * 28 + 40)
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={points} layout="vertical" margin={{ top: 4, right: 32, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
        <XAxis type="number" tick={axisTick} domain={domain} />
        <YAxis type="category" dataKey="name" tick={axisTick} width={140} tickFormatter={(v: string) => truncate(v, 22)} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v, _n, item) => [`${Number(v ?? 0)}${(item as { payload?: ScorePoint }).payload?.label ? ` | ${(item as { payload?: ScorePoint }).payload?.label}` : ''}`, valueLabel]} />
        {thresholds.map((t) => (
          <ReferenceLine key={t.label} x={t.value} stroke={colorFor(t.color)} strokeDasharray="4 4" label={{ value: t.label, position: 'insideTopRight', fontSize: 10, fill: colorFor(t.color) }} />
        ))}
        <Bar dataKey="value" radius={[0, 4, 4, 0]} onClick={onSelect ? (d) => onSelect((d as unknown as ScorePoint).name) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} label={{ position: 'right', fontSize: 11, fill: 'hsl(var(--muted-foreground))' }}>
          {points.map((p, i) => (
            <Cell key={p.name} fill={colorFor(p.color, i)} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ grouped bars (current vs previous)
export function GroupedBarChart({ data, series, height = 280, valueFormatter, horizontal = false, labelFormatter }: { data: GroupedRow[]; series: StackSeries[]; height?: number; valueFormatter?: (v: number, key: string) => string; horizontal?: boolean; labelFormatter?: (name: string) => string }) {
  if (!data.length) return <EmptyState />
  if (horizontal) {
    const h = Math.max(height, data.length * (series.length * 14 + 14) + 60)
    return (
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
          <XAxis type="number" tick={axisTick} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={axisTick} width={170} interval={0} tickFormatter={(v: string) => truncate(v, 26)} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v, n, item) => [valueFormatter ? valueFormatter(Number(v ?? 0), String((item as { dataKey?: string }).dataKey ?? '')) : Number(v ?? 0), String(n)]} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorFor(s.color, i)} radius={[0, 3, 3, 0]} opacity={i === 0 ? 1 : 0.7} label={{ position: 'right', fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    )
  }
  const labels = data.map((d) => (labelFormatter ? labelFormatter(String(d.name)) : String(d.name)))
  const longest = Math.max(...labels.map((l) => l.length))
  const bottom = longest > 12 ? Math.min(120, 40 + longest * 4) : longest > 6 ? 56 : 32
  return (
    <ResponsiveContainer width="100%" height={height + (bottom - 56)}>
      <BarChart data={data} margin={{ top: 16, right: 16, left: -10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
        <XAxis dataKey="name" tick={axisTick} interval={0} angle={longest > 12 ? -45 : longest > 6 ? -15 : 0} textAnchor={longest > 6 ? 'end' : 'middle'} height={bottom} tickFormatter={(v: string) => truncate(labelFormatter ? labelFormatter(v) : v, 22)} />
        <YAxis tick={axisTick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} formatter={(v, n, item) => [valueFormatter ? valueFormatter(Number(v ?? 0), String((item as { dataKey?: string }).dataKey ?? '')) : Number(v ?? 0), String(n)]} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={colorFor(s.color, i)} radius={[3, 3, 0, 0]} opacity={i === 0 ? 1 : 0.55} label={data.length <= 16 ? { position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))' } : undefined} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ trends
export interface LineSeries {
  key: string
  label: string
  color: string
  dashed?: boolean
}

export function TrendChart<T extends { date: string }>({ data, series, height = 260, area }: { data: T[]; series: LineSeries[]; height?: number; area?: boolean }) {
  if (!data.length) return <EmptyState description="No report dates fall within the selected period." />
  const Chart = area ? AreaChart : LineChart
  return (
    <ResponsiveContainer width="100%" height={height}>
      <Chart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={axisTick} tickFormatter={fmtDateShort} />
        <YAxis tick={axisTick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} labelFormatter={(l) => fmtDateShort(String(l))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) =>
          area ? (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} fill={s.color} fillOpacity={0.12} strokeWidth={2} dot={{ r: 3 }} />
          ) : (
            <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={{ r: 3 }} strokeDasharray={s.dashed ? '5 4' : undefined} />
          ),
        )}
      </Chart>
    </ResponsiveContainer>
  )
}

export function TrendBarChart<T extends { date: string }>({ data, series, height = 260, stacked = true }: { data: T[]; series: LineSeries[]; height?: number; stacked?: boolean }) {
  if (!data.length) return <EmptyState description="No report dates fall within the selected period." />
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="date" tick={axisTick} tickFormatter={fmtDateShort} />
        <YAxis tick={axisTick} allowDecimals={false} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'hsl(var(--muted))' }} labelFormatter={(l) => fmtDateShort(String(l))} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color} stackId={stacked ? 'a' : undefined} radius={3} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

export const STATUS_SERIES: StackSeries[] = [
  { key: 'completed', label: 'Completed', color: 'green' },
  { key: 'deployed', label: 'Deployed', color: 'green' },
  { key: 'in_progress', label: 'In Progress', color: 'blue' },
  { key: 'development', label: 'Development', color: 'blue' },
  { key: 'code_review', label: 'Code Review', color: 'indigo' },
  { key: 'testing', label: 'Testing', color: 'purple' },
  { key: 'ready_for_qa', label: 'Ready for QA', color: 'cyan' },
  { key: 'ready_for_deployment', label: 'Ready for Deploy', color: 'teal' },
  { key: 'analysis', label: 'Analysis', color: 'purple' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'on_hold', label: 'On Hold', color: 'amber' },
  { key: 'reopened', label: 'Reopened', color: 'pink' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'cancelled', label: 'Cancelled / Rejected', color: 'grey' },
  { key: 'other', label: 'Other', color: 'grey' },
]

export const TYPE_SERIES: StackSeries[] = [
  { key: 'development', label: 'Development', color: 'blue' },
  { key: 'analysis', label: 'Analysis', color: 'orange' },
  { key: 'testing', label: 'Testing', color: 'purple' },
  { key: 'deployment', label: 'Deployment', color: 'green' },
  { key: 'bug_fix', label: 'Bug Fix', color: 'red' },
  { key: 'documentation', label: 'Documentation', color: 'teal' },
  { key: 'support', label: 'Support', color: 'cyan' },
  { key: 'review', label: 'Review', color: 'indigo' },
  { key: 'other', label: 'Other', color: 'grey' },
]

export const DEV_SERIES: StackSeries[] = [
  { key: 'deployed', label: 'Deployed', color: 'green' },
  { key: 'in_progress', label: 'In Progress', color: 'blue' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'failed', label: 'Failed', color: 'red' },
  { key: 'not_required', label: 'Not Required', color: 'grey' },
  { key: 'other', label: 'Unknown', color: 'grey' },
]

export const PROD_SERIES: StackSeries[] = [
  { key: 'released', label: 'Released', color: 'green' },
  { key: 'in_progress', label: 'In Progress', color: 'blue' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'not_released', label: 'Not Yet Released', color: 'orange' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'failed', label: 'Failed', color: 'red' },
  { key: 'not_required', label: 'Not Required', color: 'grey' },
  { key: 'other', label: 'Unknown', color: 'grey' },
]
