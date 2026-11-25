import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GitCompareArrows, Moon, Sun, Info, Database, Lock, Server, TrendingDown, TrendingUp, Plug, FileSpreadsheet, RefreshCw } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/common/DataTable'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { DataSourceCard } from '@/components/common/DataSourceCard'
import { KeyValueList, OptionTile, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { ErrorState, LoadingState } from '@/components/common/States'
import { KpiCard } from '@/components/common/KpiCard'
import { ChartCard, TrendChart } from '@/components/charts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useAppConfig, useDataStatus } from '@/hooks/useData'
import { useFilters, presetRange } from '@/hooks/useFilters'
import { useTheme } from '@/hooks/useTheme'
import { dashboardApi } from '@/services/api'
import { cn, fmtNum, toISODate } from '@/lib/utils'

const COMPARE_KEYS: [string, string][] = [
  ['total_tickets', 'Unique tickets'],
  ['completed_tickets', 'Completed'],
  ['in_progress_tickets', 'In progress'],
  ['pending_tickets', 'Pending'],
  ['blocked_tickets', 'Blocked'],
  ['analysis_tickets', 'Analysis tickets'],
  ['development_activities', 'Development'],
  ['analysis_activities', 'Analysis'],
  ['testing_activities', 'Testing'],
  ['dev_deployed', 'Dev deployed'],
  ['dev_pending', 'Dev pending'],
  ['production_releases', 'Prod releases'],
  ['production_released', 'Prod deployed'],
  ['production_pending', 'Prod pending'],
  ['active_employees', 'Active employees'],
]


type CompareEmp = { employee: string; unique_tickets: number; completed: number; in_progress: number; blocked: number }
type CompareRow = { employee: string; assigned_a: number; assigned_b: number; completed_a: number; completed_b: number; completed_change: number; blocked_a: number; blocked_b: number; blocked_change: number; in_a: boolean; in_b: boolean }

function ChangePill({ value, lowerIsBetter }: { value: number; lowerIsBetter?: boolean }) {
  if (value === 0) return <span className="inline-block min-w-[2.75rem] rounded-full bg-muted px-2 py-0.5 text-center text-[11px] text-muted-foreground">0</span>
  const good = lowerIsBetter ? value < 0 : value > 0
  return (
    <span className={cn('inline-flex min-w-[2.75rem] items-center justify-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums', good ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400')}>
      {value > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
      {value > 0 ? '+' : ''}{value}
    </span>
  )
}

function CountPill({ value, tone }: { value: number | null; tone: 'green' | 'red' | 'slate' }) {
  if (value === null) return <span className="text-xs text-muted-foreground/50">n/a</span>
  if (!value) return <span className="inline-block min-w-[2rem] text-center tabular-nums text-muted-foreground/40">0</span>
  const cls = { green: 'bg-green-500/10 text-green-700 dark:text-green-400', red: 'bg-red-500/15 text-red-700 dark:text-red-400 font-semibold', slate: 'bg-slate-500/10 text-slate-700 dark:text-slate-300' }[tone]
  return <span className={cn('inline-block min-w-[2rem] rounded-full px-2 py-0.5 text-center text-xs tabular-nums', cls)}>{value}</span>
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
const AVATAR = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-orange-500']
function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR[h % AVATAR.length]
}

function EmployeeComparisonCard({ a, b }: { a: { period: { label: string }; employees: CompareEmp[] }; b: { period: { label: string }; employees: CompareEmp[] } }) {
  const nav = useNavigate()
  const { queryString } = useFilters()
  const rows = useMemo<CompareRow[]>(() => {
    const names = Array.from(new Set([...a.employees.map((e) => e.employee), ...b.employees.map((e) => e.employee)]))
    return names.map((name) => {
      const ea = a.employees.find((e) => e.employee === name)
      const eb = b.employees.find((e) => e.employee === name)
      return {
        employee: name,
        assigned_a: ea?.unique_tickets ?? 0,
        assigned_b: eb?.unique_tickets ?? 0,
        completed_a: ea?.completed ?? 0,
        completed_b: eb?.completed ?? 0,
        completed_change: (eb?.completed ?? 0) - (ea?.completed ?? 0),
        blocked_a: ea?.blocked ?? 0,
        blocked_b: eb?.blocked ?? 0,
        blocked_change: (eb?.blocked ?? 0) - (ea?.blocked ?? 0),
        in_a: !!ea,
        in_b: !!eb,
      }
    })
  }, [a, b])
  const right = { meta: { align: 'right' } } as const
  const group = (metric: string, period: string, cls: string) => () => (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{metric}</span>
      <span className={cn('mt-0.5 rounded px-1 text-[10px] normal-case tracking-normal', cls)}>{period}</span>
    </span>
  )
  const change = (metric: string) => () => (
    <span className="inline-flex flex-col items-end leading-tight">
      <span>{metric}</span>
      <span className="mt-0.5 text-[10px] normal-case tracking-normal text-muted-foreground">B minus A</span>
    </span>
  )
  const columns = useMemo<ColumnDef<CompareRow, unknown>[]>(
    () => [
      {
        accessorKey: 'employee',
        header: 'Employee',
        cell: ({ row }) => (
          <span className="flex items-center gap-2.5 whitespace-nowrap">
            <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white', avatarColor(row.original.employee))}>{initials(row.original.employee)}</span>
            <span className="font-medium">{row.original.employee}</span>
            {!row.original.in_a && <Badge variant="info" className="text-[10px]" title="No activity in Period A">New</Badge>}
            {!row.original.in_b && <Badge variant="secondary" className="text-[10px]" title="No activity in Period B">Inactive</Badge>}
          </span>
        ),
      },
      { accessorKey: 'assigned_a', header: group('Assigned', 'Period A', 'bg-slate-500/10 text-slate-600 dark:text-slate-300'), ...right, cell: ({ row }) => <CountPill value={row.original.in_a ? row.original.assigned_a : null} tone="slate" /> },
      { accessorKey: 'assigned_b', header: group('Assigned', 'Period B', 'bg-slate-500/10 text-slate-600 dark:text-slate-300'), ...right, cell: ({ row }) => <CountPill value={row.original.in_b ? row.original.assigned_b : null} tone="slate" /> },
      { accessorKey: 'completed_a', header: group('Completed', 'Period A', 'bg-green-500/10 text-green-700 dark:text-green-400'), ...right, cell: ({ row }) => <CountPill value={row.original.in_a ? row.original.completed_a : null} tone="green" /> },
      { accessorKey: 'completed_b', header: group('Completed', 'Period B', 'bg-green-500/10 text-green-700 dark:text-green-400'), ...right, cell: ({ row }) => <CountPill value={row.original.in_b ? row.original.completed_b : null} tone="green" /> },
      { accessorKey: 'completed_change', header: change('Completed change'), ...right, cell: ({ getValue }) => <ChangePill value={getValue() as number} /> },
    ],
    [],
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Employee comparison</CardTitle>
        <CardDescription>
          Per person: tickets assigned and completed in <b>Period A</b> ({a.period.label}) and <b>Period B</b> ({b.period.label}). Change = Period B minus Period A; green means more tickets completed than in Period A, red means fewer. Click a row to open the employee.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <DataTable
          data={rows}
          columns={columns}
          dense
          pageSize={15}
          exportName="employee-period-comparison"
          searchPlaceholder="Search employee"
          initialSorting={[{ id: 'completed_b', desc: true }]}
          onRowClick={(r) => nav(`/employees/${encodeURIComponent(r.employee)}${queryString ? `?${queryString}` : ''}`)}
        />
      </CardContent>
    </Card>
  )
}

export function ComparePage() {
  const { queryString } = useFilters()
  const today = new Date()
  const [a, setA] = useState<[string, string]>(() => {
    const [s, e] = presetRange('previous_month', today)
    return [s!, e!]
  })
  const [b, setB] = useState<[string, string]>(() => {
    const [s, e] = presetRange('current_month', today)
    return [s!, e!]
  })
  const base = new URLSearchParams(queryString)
  base.delete('start_date')
  base.delete('end_date')
  const q = useQuery({ queryKey: ['compare', base.toString(), a, b], queryFn: () => dashboardApi.compare(base.toString(), a, b), enabled: !!(a[0] && a[1] && b[0] && b[1]) })

  const quick = (daysA: number) => {
    const end = toISODate(today)
    const d = (n: number) => toISODate(new Date(today.getFullYear(), today.getMonth(), today.getDate() - n))
    setB([d(daysA - 1), end])
    setA([d(2 * daysA - 1), d(daysA)])
  }

  return (
    <>
      <PageHeader title="Period Comparison" description="Compare an earlier period (A) with a later period (B). KPI cards show the value for Period B and the change from Period A. Other global filters apply to both periods." breadcrumbs={[{ label: 'Compare' }]} />
      <GlobalFilterBar compact />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <RangeInput label="Period A (earlier)" value={a} onChange={setA} />
          <GitCompareArrows className="mb-2 h-5 w-5 text-muted-foreground" />
          <RangeInput label="Period B (later)" value={b} onChange={setB} />
          <div className="ml-auto flex gap-1">
            <Button size="sm" variant="outline" onClick={() => quick(7)}>Last 7 vs previous 7</Button>
            <Button size="sm" variant="outline" onClick={() => quick(15)}>Last 15 vs previous 15</Button>
            <Button size="sm" variant="outline" onClick={() => quick(30)}>Last 30 vs previous 30</Button>
          </div>
        </CardContent>
      </Card>
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {COMPARE_KEYS.map(([k, label]) => {
              const d = q.data!.deltas[k]
              return <KpiCard key={k} label={label} value={d.b} previous={d.a} compact sub={`Period A: ${fmtNum(d.a, 1)}`} />
            })}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title={`Period A: ${q.data.a.period.label}`} description={`${q.data.a.period.report_count} reports`}>
              <TrendChart data={q.data.a.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }]} />
            </ChartCard>
            <ChartCard title={`Period B: ${q.data.b.period.label}`} description={`${q.data.b.period.report_count} reports`}>
              <TrendChart data={q.data.b.trend} series={[{ key: 'completed_tickets', label: 'Completed tickets', color: 'green' }]} />
            </ChartCard>
          </div>
          <EmployeeComparisonCard a={q.data.a} b={q.data.b} />
        </>
      )}
    </>
  )
}

function RangeInput({ label, value, onChange }: { label: string; value: [string, string]; onChange: (v: [string, string]) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-1">
        <Input type="date" value={value[0]} onChange={(e) => onChange([e.target.value, value[1]])} className="h-8 w-40 text-xs" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={value[1]} onChange={(e) => onChange([value[0], e.target.value])} className="h-8 w-40 text-xs" />
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { theme, toggle } = useTheme()
  const cfg = useAppConfig()
  const status = useDataStatus()
  const st = status.data
  const c = cfg.data
  return (
    <>
      <PageHeader title="Application Settings" description="Where the data comes from, how the application looks, and runtime details for support." breadcrumbs={[{ label: 'Settings' }]} />
      {st && (
        <StatStrip cols={5}>
          <StatTile icon={Database} label="Data source" value={<span className="uppercase">{st.source}</span>} sub={st.configured_mode === 'auto' ? 'chosen automatically' : 'set manually'} tone="blue" />
          <StatTile icon={Plug} label="Jira boards" value={st.jira ? st.jira.boards.length : 0} sub={st.jira ? `${st.jira.issues} issues loaded` : 'not connected'} tone={st.jira ? 'green' : 'grey'} />
          <StatTile icon={FileSpreadsheet} label="Work rows" value={st.activity_count} sub={`${st.employee_count} people | ${st.project_count} projects`} tone="default" />
          <StatTile icon={RefreshCw} label="Last refresh" value={st.last_refresh ? new Date(st.last_refresh).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '-'} sub={st.last_refresh ? new Date(st.last_refresh).toLocaleDateString() : undefined} tone="grey" />
          <StatTile icon={theme === 'dark' ? Moon : Sun} label="Theme" value={theme === 'dark' ? 'Dark' : 'Light'} sub="change below" tone="grey" />
        </StatStrip>
      )}
      <DataSourceCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <SettingsCard icon={Sun} title="Appearance" description="Applies to this browser only.">
          <div className="grid gap-2 sm:grid-cols-2">
            <OptionTile icon={Sun} title="Light" description="Default. Best for bright rooms and printing." active={theme !== 'dark'} onClick={() => theme === 'dark' && toggle()} />
            <OptionTile icon={Moon} title="Dark" description="Reduced glare for long sessions." active={theme === 'dark'} onClick={() => theme !== 'dark' && toggle()} />
          </div>
        </SettingsCard>
        <SettingsCard icon={Plug} title="Integrations" description="Connections used to build the dashboards." action={<Button asChild size="sm" variant="outline"><Link to="/config/jira">Manage Jira</Link></Button>}>
          <KeyValueList items={[
            { label: 'Jira', value: c?.jira_configured ? <span className="flex items-center justify-end gap-2"><Badge variant="success">connected</Badge><span className="text-muted-foreground">{c.jira_email}</span></span> : <Badge variant="warning">not configured</Badge> },
            { label: 'Boards', value: c ? `${c.jira_boards} board(s)` : '-' },
            { label: 'Auto-sync', value: c ? <Badge variant={c.jira_auto_sync ? 'success' : 'secondary'}>{c.jira_auto_sync ? 'on' : 'off'}</Badge> : '-' },
            { label: 'Excel source folder', value: st ? <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{st.source_dir}</code> : '-' },
          ]} />
        </SettingsCard>
        <SettingsCard icon={Info} title="Runtime" description="Useful when reporting a problem.">
          {c && (
            <KeyValueList items={[
              { label: 'Application', value: `${c.app_name} v${c.version}` },
              { label: 'Environment', value: <Badge variant="secondary">{c.environment}</Badge> },
              { label: 'Default period', value: `Last ${c.default_period_days} days` },
              { label: 'Upload limit', value: `${c.max_upload_mb} MB | ${c.allowed_extensions.join(', ')}` },
              { label: 'Database', value: <span className="flex items-center justify-end gap-1"><Database className="h-3.5 w-3.5" /> {c.database}</span> },
              { label: 'Authentication', value: <span className="flex items-center justify-end gap-1"><Lock className="h-3.5 w-3.5" /> {c.authentication}</span> },
              { label: 'Backend API', value: <a className="flex items-center justify-end gap-1 text-primary hover:underline" href="/docs" target="_blank" rel="noreferrer"><Server className="h-3.5 w-3.5" /> API docs (/docs)</a> },
              ...(st ? [{ label: 'Data version', value: <Badge variant="secondary">v{st.version}</Badge> }] : []),
            ]} />
          )}
        </SettingsCard>
        <SettingsCard icon={Lock} title="Security notice" tone="warning" description="Please read before sharing this application.">
          <p className="text-sm text-muted-foreground">
            This version has <b>no authentication or role-based access</b> and is intended for a trusted local environment only. Jira tokens are stored encrypted on the server; no other data leaves the machine. The service layer, data store and event bus are ready for authentication and a database to be added without rewriting the application.
          </p>
        </SettingsCard>
      </div>
    </>
  )
}
