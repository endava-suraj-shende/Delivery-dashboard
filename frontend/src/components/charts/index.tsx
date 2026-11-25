import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  Pie,
  PieChart,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Area,
  AreaChart,
  LabelList,
} from 'recharts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EmptyState } from '@/components/common/States'
import { colorFor, fmtDateShort, truncate, cn } from '@/lib/utils'
import type { CategoryPoint, GroupedRow, NamedValue } from '@/types'

/*
 * Chart standard (after Carbon Design System dashboard guidance):
 *  - every ChartCard body has a fixed height (default 320px) so cards in a row always line up;
 *    charts fill that body exactly and long lists scroll inside it instead of stretching the page.
 *  - legends always sit under the charting area, in the same compact chip style.
 *  - one colour per meaning across the whole application (see STATUS_COLORS / *_SERIES).
 *  - comparisons across people / projects use horizontal bar lists sorted by value with the
 *    value printed at the end of the bar; trends use line / column charts.
 */

// ------------------------------------------------------------------ card + height context
const ChartHeightContext = createContext<number | null>(null)
export const CHART_HEIGHT = 320
export const CHART_HEIGHT_TALL = 440

/** Height available to the chart body (minus a bottom legend when `legend` is true). */
export function useChartHeight(fallback = CHART_HEIGHT, legend = false) {
  const h = useContext(ChartHeightContext) ?? fallback
  return legend ? h - 30 : h
}

export function ChartCard({ title, description, children, className, action, height = CHART_HEIGHT }: { title: string; description?: string; children: ReactNode; className?: string; action?: ReactNode; height?: number | 'auto' | 'fill' }) {
  // 'fill': the body stretches to the card's grid-row height (match a taller sibling) and charts size to it.
  const { ref, h } = useElementSize<HTMLDivElement>()
  const fixed = typeof height === 'number'
  const fill = height === 'fill'
  const ctx = fixed ? height : fill ? (h > 40 ? h : CHART_HEIGHT) : null
  return (
    <Card className={cn('flex flex-col', className)}>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 pb-3">
        <div className="min-w-0">
          <CardTitle className="text-sm font-semibold leading-5">{title}</CardTitle>
          {description && <CardDescription className="mt-0.5 text-xs leading-4">{description}</CardDescription>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </CardHeader>
      {fill ? (
        // Absolutely positioned body: it takes the row height from taller siblings but can never grow the card itself.
        <CardContent className="relative min-h-0 flex-1" style={{ minHeight: CHART_HEIGHT }}>
          <div ref={ref} className="absolute inset-0 flex flex-col overflow-hidden px-5 pb-5">
            <ChartHeightContext.Provider value={ctx}>{children}</ChartHeightContext.Provider>
          </div>
        </CardContent>
      ) : (
        <CardContent className={cn('flex min-h-0 flex-col', fixed ? 'flex-none overflow-hidden' : 'flex-1')} style={fixed ? { height } : undefined}>
          <ChartHeightContext.Provider value={ctx}>{children}</ChartHeightContext.Provider>
        </CardContent>
      )}
    </Card>
  )
}

const tooltipStyle = { borderRadius: 8, border: '1px solid hsl(var(--border))', background: 'hsl(var(--popover))', color: 'hsl(var(--popover-foreground))', fontSize: 12 }
const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const gridStroke = 'hsl(var(--border))'

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

// ------------------------------------------------------------------ shared legend + tooltip
export interface StackSeries {
  key: string
  label: string
  color: string
}

export function SeriesLegend({ items, className }: { items: { label: string; color: string }[]; className?: string }) {
  if (!items.length) return null
  return (
    <ul className={cn('flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pt-2 text-[11px] leading-4 text-muted-foreground', className)}>
      {items.map((s) => (
        <li key={s.label} className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  )
}

type TooltipEntry = { dataKey?: string | number; name?: string; value?: number | string; color?: string }

function StackTooltip({ active, payload, label, showShare = true, labelFormatter }: { active?: boolean; payload?: TooltipEntry[]; label?: string | number; showShare?: boolean; labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((e) => Number(e.value ?? 0) > 0)
  const total = rows.reduce((t, e) => t + Number(e.value ?? 0), 0)
  if (!rows.length) return null
  const title = labelFormatter ? labelFormatter(String(label ?? '')) : String(label ?? '')
  return (
    <div className="min-w-[170px] rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <div className="mb-1.5 font-semibold">{title}</div>
      <ul className="space-y-1">
        {rows.map((e) => (
          <li key={String(e.dataKey ?? e.name)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: e.color }} />{e.name}</span>
            <span className="tabular-nums"><span className="font-medium">{Number(e.value ?? 0)}</span>{showShare && rows.length > 1 && <span className="ml-1 text-muted-foreground">{((Number(e.value ?? 0) / total) * 100).toFixed(0)}%</span>}</span>
          </li>
        ))}
      </ul>
      {rows.length > 1 && <div className="mt-1.5 flex items-center justify-between border-t pt-1.5 font-medium"><span>Total</span><span className="tabular-nums">{total}</span></div>}
    </div>
  )
}

// ------------------------------------------------------------------ bar list (HTML) - comparisons across people / projects
interface BarSegment { key: string; label: string; value: number; color: string }
interface BarRow { name: string; total: number; segments: BarSegment[] }

function BarList({ rows, legend, onSelect, selected, valueLabel }: { rows: BarRow[]; legend?: { label: string; color: string }[]; onSelect?: (name: string) => void; selected?: string[]; valueLabel?: string }) {
  const { ref, w, h: outerH } = useElementSize<HTMLDivElement>()
  const h = Math.max(0, outerH - (legend ? 30 : 0))
  if (!rows.length) return <EmptyState />
  const max = Math.max(...rows.map((r) => r.total), 1)
  const labelW = Math.min(160, Math.max(80, Math.max(...rows.map((r) => r.name.length)) * 6.6 + 8))
  // 1-3 rows (e.g. a single-employee filter): expand each row into a panel with its full breakdown.
  // 1-3 rows (e.g. a single-employee filter): expand each row into a panel with its breakdown, choosing the densest layout that fits the card.
  const segCount = rows.map((r) => r.segments.filter((sg) => sg.value > 0).length)
  if (rows.length <= 3 && segCount.some((n) => n > 1) && h > 0) {
    const fitsVertical = rows.length * 70 + segCount.reduce((a, b) => a + b, 0) * 44 + (rows.length - 1) * 12 <= h
    const cols = w >= 760 ? 5 : w >= 600 ? 4 : w >= 380 ? 3 : 2
    const fitsGrid = rows.length * 44 + segCount.reduce((a, n) => a + Math.ceil(n / cols) * 22, 0) + (rows.length - 1) * 8 <= h
    if (fitsVertical || fitsGrid) {
      return (
        <div ref={ref} className="flex h-full min-h-0 flex-col">
          <div className={cn('flex min-h-0 flex-1 flex-col overflow-y-auto pr-1', fitsVertical ? 'gap-3' : 'gap-2')}>
            {rows.map((r) => {
              const segs = r.segments.filter((sg) => sg.value > 0)
              const segMax = Math.max(...segs.map((sg) => sg.value), 1)
              const bar = (
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {segs.map((sg) => (
                    <span key={sg.key} className="h-full" style={{ width: `${(sg.value / r.total) * 100}%`, background: sg.color }} title={`${sg.label}: ${sg.value}`} />
                  ))}
                </div>
              )
              return (
                <div key={r.name} className={cn('flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border', fitsVertical ? 'p-3' : 'px-3 py-2', onSelect && 'cursor-pointer hover:bg-muted/50')} onClick={onSelect ? () => onSelect(r.name) : undefined}>
                  {fitsVertical ? (
                    <>
                      <div className="mb-2 flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-medium">{r.name}</span>
                        <span className="shrink-0 text-xs text-muted-foreground"><span className="text-base font-semibold tabular-nums text-foreground">{r.total}</span> {valueLabel ? valueLabel.toLowerCase() : 'total'}</span>
                      </div>
                      {bar}
                    </>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="w-[26%] min-w-[90px] truncate text-sm font-medium" title={r.name}>{r.name}</span>
                      <div className="flex-1">{bar}</div>
                      <span className="w-10 shrink-0 text-right text-sm font-semibold tabular-nums">{r.total}</span>
                    </div>
                  )}
                  {fitsVertical ? (
                    <ul className="mt-2 flex min-h-0 flex-1 flex-col justify-around overflow-hidden">
                      {segs.map((sg) => (
                        <li key={sg.key} className="py-1" style={{ maxHeight: 64 }}>
                          <div className="flex items-baseline justify-between gap-3 text-xs">
                            <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sg.color }} /><span className="truncate">{sg.label}</span></span>
                            <span className="shrink-0 tabular-nums"><span className="text-sm font-semibold">{sg.value}</span><span className="ml-1.5 text-[11px] text-muted-foreground">{((sg.value / r.total) * 100).toFixed(0)}%</span></span>
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(sg.value / segMax) * 100}%`, background: sg.color }} /></div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <ul className="mt-1.5 grid content-start gap-x-4 gap-y-0.5 border-t pt-1.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
                      {segs.map((sg) => (
                        <li key={sg.key} className="flex items-center justify-between gap-2 text-xs">
                          <span className="flex min-w-0 items-center gap-1.5"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: sg.color }} /><span className="truncate">{sg.label}</span></span>
                          <span className="shrink-0 tabular-nums"><span className="font-semibold">{sg.value}</span><span className="ml-1 text-muted-foreground">{((sg.value / r.total) * 100).toFixed(0)}%</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
          {legend && <SeriesLegend items={legend} />}
        </div>
      )
    }
  }
  // Few rows: grow each row (up to 48px) so the card body is used; many rows: 28px and scroll.
  const rowH = h ? clamp(Math.floor((h - 4) / rows.length), 28, 48) : 28
  const barH = rowH >= 40 ? 20 : rowH >= 32 ? 16 : 14
  return (
    <div ref={ref} className="flex h-full min-h-0 flex-col">
      <ul className="min-h-0 flex-1 overflow-y-auto pr-1">
        {rows.map((r) => {
          const active = selected?.includes(r.name)
          const dimmed = selected?.length && !active
          return (
            <li
              key={r.name}
              className={cn('group relative grid items-center gap-3 rounded-md px-1.5', onSelect && 'cursor-pointer hover:bg-muted/70', active && 'bg-muted', dimmed && 'opacity-50')}
              style={{ gridTemplateColumns: `${labelW}px 1fr 40px`, height: rowH }}
              onClick={onSelect ? () => onSelect(r.name) : undefined}
            >
              <span className="truncate text-xs" title={r.name}>{r.name}</span>
              <div className="flex overflow-hidden rounded-sm bg-muted/40" style={{ height: barH, width: `${(r.total / max) * 100}%`, minWidth: r.total > 0 ? 3 : 0 }}>
                {r.segments.filter((sg) => sg.value > 0).map((sg) => (
                  <span key={sg.key} className="h-full" style={{ width: `${(sg.value / r.total) * 100}%`, background: sg.color }} />
                ))}
              </div>
              <span className="text-right text-xs font-semibold tabular-nums">{r.total}</span>
              <div className="pointer-events-none absolute left-1/2 top-full z-20 hidden min-w-[170px] -translate-x-1/2 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md group-hover:block">
                <div className="mb-1.5 font-semibold">{r.name}</div>
                <ul className="space-y-1">
                  {r.segments.filter((sg) => sg.value > 0).map((sg) => (
                    <li key={sg.key} className="flex items-center justify-between gap-4">
                      <span className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: sg.color }} />{sg.label}</span>
                      <span className="tabular-nums"><span className="font-medium">{sg.value}</span>{r.segments.length > 1 && <span className="ml-1 text-muted-foreground">{((sg.value / r.total) * 100).toFixed(0)}%</span>}</span>
                    </li>
                  ))}
                </ul>
                {r.segments.length > 1 && <div className="mt-1.5 flex items-center justify-between border-t pt-1.5 font-medium"><span>{valueLabel ?? 'Total'}</span><span className="tabular-nums">{r.total}</span></div>}
              </div>
            </li>
          )
        })}
      </ul>
      {legend && <SeriesLegend items={legend} />}
    </div>
  )
}

/** Stacked composition per entity. Horizontal (default) renders as a bar list; vertical renders columns. */
export function StackedBarChart({ data, series, onSelect, selected, max = 30, horizontal = true, hideEmptySeries = true, height }: { data: GroupedRow[]; series: StackSeries[]; onSelect?: (name: string) => void; selected?: string[]; height?: number; max?: number; horizontal?: boolean; hideEmptySeries?: boolean }) {
  const h = useChartHeight(height ?? CHART_HEIGHT, true)
  const points = data.slice(0, max)
  if (!points.length) return <EmptyState />
  const active = hideEmptySeries ? series.filter((s) => points.some((p) => Number(p[s.key] ?? 0) > 0)) : series
  const colors = active.map((s, i) => colorFor(s.color, i))
  const legend = active.map((s, i) => ({ label: s.label, color: colors[i] }))
  if (horizontal) {
    const rows: BarRow[] = points
      .map((p) => ({ name: String(p.name), segments: active.map((s, i) => ({ key: s.key, label: s.label, value: Number(p[s.key] ?? 0), color: colors[i] })), total: active.reduce((t, s) => t + Number(p[s.key] ?? 0), 0) }))
      .sort((a, b) => b.total - a.total)
    return <BarList rows={rows} legend={legend} onSelect={onSelect} selected={selected} />
  }
  const rows = points.map((p) => ({ ...p, __total: active.reduce((t, s) => t + Number(p[s.key] ?? 0), 0) }))
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={rows} margin={{ top: 16, right: 8, left: -12, bottom: 0 }} barCategoryGap={12}>
          <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval={0} angle={rows.length > 6 ? -25 : 0} textAnchor={rows.length > 6 ? 'end' : 'middle'} height={rows.length > 6 ? 56 : 24} tickFormatter={(v: string) => truncate(v, 16)} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<StackTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
          {active.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} stackId="a" fill={colors[i]} barSize={28} onClick={onSelect ? (d) => onSelect((d as unknown as GroupedRow).name as string) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default' }} radius={i === active.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false}>
              {i === active.length - 1 && <LabelList dataKey="__total" position="top" fontSize={11} fontWeight={600} fill="hsl(var(--foreground))" formatter={(v) => (Number(v) > 0 ? String(v) : '')} />}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      <SeriesLegend items={legend} />
    </div>
  )
}

/** Single measure per entity (ranking). */
export function NamedBarChart({ data, onSelect, color = '#2563eb', max = 30, valueLabel = 'Count' }: { data: NamedValue[]; onSelect?: (name: string) => void; height?: number; color?: string; max?: number; valueLabel?: string }) {
  const rows: BarRow[] = [...data]
    .sort((a, b) => b.value - a.value)
    .slice(0, max)
    .map((d) => ({ name: d.name, total: d.value, segments: [{ key: 'value', label: valueLabel, value: d.value, color: colorFor(color) === color ? colorFor(color) : color }] }))
  return <BarList rows={rows} onSelect={onSelect} valueLabel={valueLabel} />
}

/** Few categories (status / work-type split): rows share the card height; each shows label, count, share and a bar. */
export function CategoryBarChart({ data, onSelect, selected }: { data: CategoryPoint[]; onSelect?: (key: string) => void; selected?: string[]; height?: number; horizontal?: boolean }) {
  const points = data.filter((d) => d.value > 0)
  if (!points.length) return <EmptyState />
  const total = points.reduce((t, p) => t + p.value, 0)
  const max = Math.max(...points.map((p) => p.value), 1)
  const tall = points.length <= 4
  return (
    <ul className="flex h-full min-h-0 flex-col gap-1 overflow-y-auto pr-1">
      {points.map((p, i) => {
        const color = colorFor(p.color, i)
        const pct = (p.value / total) * 100
        const active = selected?.includes(p.key)
        const dimmed = selected?.length && !active
        return (
          <li
            key={p.key}
            className={cn('flex min-h-[52px] flex-1 flex-col justify-center rounded-md px-2.5 py-1.5', onSelect && 'cursor-pointer hover:bg-muted/70', active && 'bg-muted', dimmed && 'opacity-50')}
            style={{ maxHeight: tall ? 120 : 72 }}
            onClick={onSelect ? () => onSelect(p.key) : undefined}
            title={`${p.label}: ${p.value} (${pct.toFixed(1)}%)`}
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-xs font-medium"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} /><span className="truncate">{p.label}</span></span>
              <span className="shrink-0 tabular-nums"><span className={cn('font-semibold', tall ? 'text-lg' : 'text-sm')}>{p.value}</span><span className="ml-1.5 text-[11px] text-muted-foreground">{pct.toFixed(0)}%</span></span>
            </div>
            <div className={cn('mt-1.5 w-full overflow-hidden rounded-full bg-muted', tall ? 'h-2' : 'h-1.5')}>
              <div className="h-full rounded-full" style={{ width: `${(p.value / max) * 100}%`, background: color }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

// ------------------------------------------------------------------ donut
export function DonutChart({ data, onSelect, selected, centerLabel }: { data: CategoryPoint[]; onSelect?: (key: string) => void; selected?: string[]; height?: number; centerLabel?: string }) {
  const points = data.filter((d) => d.value > 0)
  const total = points.reduce((s, p) => s + p.value, 0)
  const { ref, w, h } = useElementSize<HTMLDivElement>()
  if (!total) return <EmptyState />

  const row = w >= 460
  const cols = !row && points.length > 4 && w >= 300 ? 2 : 1
  const legendH = Math.ceil(points.length / cols) * 24 + 8
  const size = w === 0 ? 0 : row ? clamp(Math.min(h, w * 0.4), 120, 240) : clamp(Math.min(w * 0.7, h - legendH - 8), 110, 220)
  const big = size >= 180

  return (
    <div ref={ref} className={cn('flex h-full min-h-0 w-full', row ? 'flex-row items-center gap-6' : 'flex-col items-center gap-2')}>
      {size > 0 && (
        <div className="relative shrink-0" style={{ width: size, height: size }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <Pie data={points} dataKey="value" nameKey="label" innerRadius="68%" outerRadius="96%" paddingAngle={points.length > 1 ? 2 : 0} stroke="none" cornerRadius={2} isAnimationActive={false} onClick={onSelect ? (d) => onSelect((d as unknown as CategoryPoint).key) : undefined} style={{ cursor: onSelect ? 'pointer' : 'default', outline: 'none' }}>
                {points.map((p, i) => (
                  <Cell key={p.key} fill={colorFor(p.color, i)} opacity={selected?.length && !selected.includes(p.key) ? 0.3 : 1} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} formatter={(v, n) => [`${Number(v ?? 0)} (${((Number(v ?? 0) / total) * 100).toFixed(0)}%)`, String(n)]} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn('font-semibold tabular-nums leading-none', big ? 'text-2xl' : 'text-lg')}>{total}</span>
            <span className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{centerLabel ?? 'total'}</span>
          </div>
        </div>
      )}
      <ul className={cn('min-h-0 w-full overflow-y-auto', row ? 'flex-1' : '', cols === 2 ? 'grid grid-cols-2 gap-x-3' : 'grid grid-cols-1')}>
        {points.map((p, i) => {
          const pct = (p.value / total) * 100
          const color = colorFor(p.color, i)
          const active = selected?.includes(p.key)
          const dimmed = selected?.length && !active
          return (
            <li key={p.key} className={cn('flex h-6 items-center justify-between gap-2 rounded px-1.5 text-xs', onSelect && 'cursor-pointer hover:bg-muted/70', active && 'bg-muted font-medium', dimmed && 'opacity-50')} onClick={onSelect ? () => onSelect(p.key) : undefined} title={`${p.label}: ${p.value} (${pct.toFixed(1)}%)`}>
              <span className="flex min-w-0 items-center gap-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} /><span className="truncate">{p.label}</span></span>
              <span className="shrink-0 tabular-nums"><span className="font-semibold">{p.value}</span><span className="ml-1.5 w-8 text-muted-foreground">{pct.toFixed(0)}%</span></span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ------------------------------------------------------------------ grouped bars (side-by-side measures)
export function GroupedBarChart({ data, series, height, valueFormatter, horizontal = false, labelFormatter, onSelect }: { data: GroupedRow[]; series: StackSeries[]; height?: number; valueFormatter?: (v: number, key: string) => string; horizontal?: boolean; labelFormatter?: (name: string) => string; onSelect?: (name: string) => void }) {
  const h = useChartHeight(height ?? CHART_HEIGHT, true)
  if (!data.length) return <EmptyState />
  const colors = series.map((s, i) => colorFor(s.color, i))
  const legend = series.map((s, i) => ({ label: s.label, color: colors[i] }))
  const fmt = (v: number, key: string) => (valueFormatter ? valueFormatter(v, key) : v)
  const tooltip = <Tooltip content={(props) => <StackTooltip {...(props as unknown as { active?: boolean; payload?: TooltipEntry[]; label?: string | number })} showShare={false} labelFormatter={labelFormatter} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
  const click = onSelect ? (d: unknown) => onSelect(String((d as GroupedRow).name)) : undefined
  if (horizontal) {
    const maxV = Math.max(...data.flatMap((r) => series.map((s) => Number(r[s.key] ?? 0))), 1)
    const labelW = Math.min(160, Math.max(80, Math.max(...data.map((r) => String(r.name).length)) * 6.6 + 8))
    return (
      <div className="flex h-full min-h-0 flex-col">
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
          {data.map((r) => (
            <li
              key={String(r.name)}
              className={cn('grid items-center gap-3 rounded-md px-1.5 py-1', onSelect && 'cursor-pointer hover:bg-muted/70')}
              style={{ gridTemplateColumns: `${labelW}px 1fr` }}
              onClick={onSelect ? () => onSelect(String(r.name)) : undefined}
              title={`${labelFormatter ? labelFormatter(String(r.name)) : r.name}: ${series.map((sr) => `${sr.label} ${fmt(Number(r[sr.key] ?? 0), sr.key)}`).join(', ')}`}
            >
              <span className="truncate text-xs">{labelFormatter ? labelFormatter(String(r.name)) : r.name}</span>
              <div className="space-y-0.5">
                {series.map((sr, i) => {
                  const v = Number(r[sr.key] ?? 0)
                  return (
                    <div key={sr.key} className="flex items-center gap-2">
                      <div className="h-2 rounded-sm" style={{ width: `calc(${(v / maxV) * 100}% - 28px)`, minWidth: v > 0 ? 3 : 0, background: colors[i] }} />
                      <span className="w-7 shrink-0 text-[10px] tabular-nums text-muted-foreground">{v > 0 ? fmt(v, sr.key) : ''}</span>
                    </div>
                  )
                })}
              </div>
            </li>
          ))}
        </ul>
        <SeriesLegend items={legend} />
      </div>
    )
  }
  const labels = data.map((d) => (labelFormatter ? labelFormatter(String(d.name)) : String(d.name)))
  const longest = Math.max(...labels.map((l) => l.length))
  const bottom = longest > 12 ? Math.min(96, 28 + longest * 4) : longest > 6 ? 44 : 24
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} margin={{ top: 16, right: 8, left: -12, bottom: 0 }} barCategoryGap={14} barGap={3}>
          <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval={0} angle={longest > 12 ? -45 : longest > 6 ? -15 : 0} textAnchor={longest > 6 ? 'end' : 'middle'} height={bottom} tickFormatter={(v: string) => truncate(labelFormatter ? labelFormatter(v) : v, 22)} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          {tooltip}
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={colors[i]} radius={[3, 3, 0, 0]} isAnimationActive={false} onClick={click} style={{ cursor: onSelect ? 'pointer' : 'default' }} label={data.length <= 16 ? { position: 'top', fontSize: 10, fill: 'hsl(var(--muted-foreground))', formatter: (v) => (Number(v) > 0 ? String(fmt(Number(v), s.key)) : '') } : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <SeriesLegend items={legend} />
    </div>
  )
}

// ------------------------------------------------------------------ trends
export interface LineSeries {
  key: string
  label: string
  color: string
  dashed?: boolean
}

const hex = (c: string) => (c.startsWith('#') ? c : colorFor(c))

export function TrendChart<T extends { date: string }>({ data, series, height, area }: { data: T[]; series: LineSeries[]; height?: number; area?: boolean }) {
  const h = useChartHeight(height ?? CHART_HEIGHT, true)
  if (!data.length) return <EmptyState description="No report dates fall within the selected period." />
  const Chart = area ? AreaChart : LineChart
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResponsiveContainer width="100%" height={h}>
        <Chart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={fmtDateShort} minTickGap={24} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={(props) => <StackTooltip {...(props as unknown as { active?: boolean; payload?: TooltipEntry[]; label?: string | number })} showShare={false} labelFormatter={fmtDateShort} />} />
          {series.map((s) =>
            area ? (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={hex(s.color)} fill={hex(s.color)} fillOpacity={0.12} strokeWidth={2} dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
            ) : (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={hex(s.color)} strokeWidth={2} dot={data.length <= 31 ? { r: 2.5, strokeWidth: 0, fill: hex(s.color) } : false} activeDot={{ r: 4 }} strokeDasharray={s.dashed ? '5 4' : undefined} isAnimationActive={false} />
            ),
          )}
        </Chart>
      </ResponsiveContainer>
      <SeriesLegend items={series.map((s) => ({ label: s.label, color: hex(s.color) }))} />
    </div>
  )
}

export function TrendBarChart<T extends { date: string }>({ data, series, height, stacked = true }: { data: T[]; series: LineSeries[]; height?: number; stacked?: boolean }) {
  const h = useChartHeight(height ?? CHART_HEIGHT, true)
  if (!data.length) return <EmptyState description="No report dates fall within the selected period." />
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ResponsiveContainer width="100%" height={h}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }} barCategoryGap={data.length > 20 ? 2 : 6}>
          <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
          <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={fmtDateShort} minTickGap={24} />
          <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
          <Tooltip content={<StackTooltip labelFormatter={fmtDateShort} />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
          {series.map((s, i) => (
            <Bar key={s.key} dataKey={s.key} name={s.label} fill={hex(s.color)} stackId={stacked ? 'a' : undefined} radius={stacked ? (i === series.length - 1 ? [3, 3, 0, 0] : 0) : [3, 3, 0, 0]} isAnimationActive={false} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <SeriesLegend items={series.map((s) => ({ label: s.label, color: hex(s.color) }))} />
    </div>
  )
}

export const STATUS_SERIES: StackSeries[] = [
  { key: 'completed', label: 'Completed', color: 'green' },
  { key: 'deployed', label: 'Deployed', color: 'lime' },
  { key: 'in_progress', label: 'In progress', color: 'blue' },
  { key: 'development', label: 'Development', color: 'blue' },
  { key: 'code_review', label: 'Code review', color: 'indigo' },
  { key: 'testing', label: 'Testing', color: 'purple' },
  { key: 'ready_for_qa', label: 'Ready for QA', color: 'violet' },
  { key: 'ready_for_deployment', label: 'Ready to deploy', color: 'teal' },
  { key: 'analysis', label: 'Analysis', color: 'sky' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'on_hold', label: 'On hold', color: 'amber' },
  { key: 'reopened', label: 'Reopened', color: 'pink' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'cancelled', label: 'Cancelled / Rejected', color: 'slate' },
  { key: 'other', label: 'Other', color: 'grey' },
]

export const TYPE_SERIES: StackSeries[] = [
  { key: 'development', label: 'Development', color: 'blue' },
  { key: 'analysis', label: 'Analysis', color: 'sky' },
  { key: 'testing', label: 'Testing', color: 'purple' },
  { key: 'deployment', label: 'Deployment', color: 'green' },
  { key: 'bug_fix', label: 'Bug fix', color: 'red' },
  { key: 'documentation', label: 'Documentation', color: 'teal' },
  { key: 'support', label: 'Support', color: 'cyan' },
  { key: 'review', label: 'Review', color: 'indigo' },
  { key: 'other', label: 'Other', color: 'grey' },
]

export const DEV_SERIES: StackSeries[] = [
  { key: 'deployed', label: 'Deployed', color: 'green' },
  { key: 'in_progress', label: 'In progress', color: 'blue' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'failed', label: 'Failed', color: 'pink' },
  { key: 'not_required', label: 'Not required', color: 'slate' },
  { key: 'other', label: 'Unknown', color: 'grey' },
]

export const PROD_SERIES: StackSeries[] = [
  { key: 'released', label: 'Released', color: 'green' },
  { key: 'in_progress', label: 'In progress', color: 'blue' },
  { key: 'pending', label: 'Pending', color: 'orange' },
  { key: 'not_released', label: 'Not yet released', color: 'amber' },
  { key: 'blocked', label: 'Blocked', color: 'red' },
  { key: 'failed', label: 'Failed', color: 'pink' },
  { key: 'not_required', label: 'Not required', color: 'slate' },
  { key: 'other', label: 'Unknown', color: 'grey' },
]
