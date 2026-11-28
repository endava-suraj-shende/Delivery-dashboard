import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { fmtDateShort } from '@/lib/utils'

const axisTick = { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }
const gridStroke = 'hsl(var(--border))'
const C = { started: '#2563eb', completed: '#16a34a', blocked: '#dc2626', activity: '#7c3aed', muted: 'hsl(var(--muted-foreground))' }

export type WeeklyRow = { date: string; started?: number; completed?: number; blocked?: number; activity?: number }

function median(xs: number[]) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function WeekTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string; dataKey?: string }[]; label?: string | number }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium">Week of {fmtDateShort(String(label))}</p>
      {payload.filter((p) => p.dataKey !== 'usual').map((p) => (
        <p key={String(p.dataKey)} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: p.color }} />{p.name}</span>
          <span className="font-semibold tabular-nums">{p.value}</span>
        </p>
      ))}
    </div>
  )
}

/** Started vs completed as grouped bars (flow in vs flow out), blocked as a line on top. */
export function WeeklyFlowChart({ data, height = 260 }: { data: WeeklyRow[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} margin={{ top: 12, right: 8, left: -16, bottom: 0 }} barCategoryGap="22%" barGap={3}>
        <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={fmtDateShort} minTickGap={16} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<WeekTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        <Bar dataKey="started" name="Started" fill={C.started} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={600} />
        <Bar dataKey="completed" name="Completed" fill={C.completed} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={600} animationBegin={100} />
        <Line type="monotone" dataKey="blocked" name="Blocked" stroke={C.blocked} strokeWidth={2} dot={{ r: 3, fill: C.blocked, strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive animationDuration={700} animationBegin={200} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

/** One metric as bars against its own "usual" (median of the previous weeks, dashed). The latest week is highlighted. */
export function WeeklyBaselineChart({ data, metric, label, color = C.activity, height = 260 }: { data: WeeklyRow[]; metric: keyof WeeklyRow; label: string; color?: string; height?: number }) {
  const vals = data.map((d) => Number(d[metric] ?? 0))
  const usual = median(vals.slice(0, -1))
  const last = vals.length - 1
  const lastVal = vals[last] ?? 0
  const below = lastVal < usual
  const rows = data.map((d) => ({ ...d, usual }))
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 12, right: 8, left: -16, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={gridStroke} strokeOpacity={0.6} vertical={false} />
        <XAxis dataKey="date" tick={axisTick} axisLine={false} tickLine={false} tickFormatter={fmtDateShort} minTickGap={16} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip content={<WeekTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.5 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 6 }} />
        <Bar dataKey={metric as string} name={label} fill={color} radius={[3, 3, 0, 0]} isAnimationActive animationDuration={600}>
          {rows.map((_, i) => <Cell key={i} fill={i === last ? (below ? C.blocked : color) : color} fillOpacity={i === last ? 1 : 0.45} />)}
        </Bar>
        <ReferenceLine y={usual} stroke={C.muted} strokeDasharray="5 4" ifOverflow="extendDomain" label={{ value: `usual ${Math.round(usual)}`, position: 'insideTopRight', fontSize: 10, fill: C.muted }} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}
