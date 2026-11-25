import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { GitCompareArrows, Moon, Sun, Info, Database, Lock, Server } from 'lucide-react'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { DataSourceCard } from '@/components/common/DataSourceCard'
import { ErrorState, LoadingState } from '@/components/common/States'
import { KpiCard } from '@/components/common/KpiCard'
import { ChartCard, TrendChart } from '@/components/charts'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Switch } from '@/components/ui/primitives'
import { Badge } from '@/components/ui/badge'
import { useAppConfig, useDataStatus } from '@/hooks/useData'
import { useFilters, presetRange } from '@/hooks/useFilters'
import { useTheme } from '@/hooks/useTheme'
import { dashboardApi } from '@/services/api'
import { fmtNum, toISODate } from '@/lib/utils'

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
      <PageHeader title="Period Comparison" description="Compare two date ranges side by side. Other global filters (project, employee, ...) apply to both periods." breadcrumbs={[{ label: 'Compare' }]} />
      <GlobalFilterBar compact />
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 p-4">
          <RangeInput label="Period A" value={a} onChange={setA} />
          <GitCompareArrows className="mb-2 h-5 w-5 text-muted-foreground" />
          <RangeInput label="Period B" value={b} onChange={setB} />
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
              return <KpiCard key={k} label={label} value={d.b} previous={d.a} compact sub={`A: ${fmtNum(d.a, 1)} to B: ${fmtNum(d.b, 1)}`} />
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
          <Card>
            <CardHeader>
              <CardTitle>Employee comparison</CardTitle>
              <CardDescription>Completed / blocked unique tickets in each period.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/60 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Employee</th>
                    <th className="px-3 py-2 text-right">Completed A</th>
                    <th className="px-3 py-2 text-right">Completed B</th>
                    <th className="px-3 py-2 text-right">Change in completed</th>
                    <th className="px-3 py-2 text-right">Blocked A</th>
                    <th className="px-3 py-2 text-right">Blocked B</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(new Set([...q.data.a.employees.map((e) => e.employee), ...q.data.b.employees.map((e) => e.employee)]))
                    .sort()
                    .map((name) => {
                      const ea = q.data!.a.employees.find((e) => e.employee === name)
                      const eb = q.data!.b.employees.find((e) => e.employee === name)
                      const delta = (eb?.completed ?? 0) - (ea?.completed ?? 0)
                      return (
                        <tr key={name} className="border-b">
                          <td className="px-3 py-1.5 font-medium">{name}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{ea?.completed ?? '-'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eb?.completed ?? '-'}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${delta > 0 ? 'text-green-600' : delta < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>{delta > 0 ? '+' : ''}{delta}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{ea?.blocked ?? '-'}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eb?.blocked ?? '-'}</td>
                        </tr>
                      )
                    })}
                </tbody>
              </table>
            </CardContent>
          </Card>
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
  return (
    <>
      <PageHeader title="Application Settings" description="Data source, appearance and runtime information." breadcrumbs={[{ label: 'Settings' }]} />
      <DataSourceCard />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <span className="flex items-center gap-2 text-sm">{theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />} Dark theme</span>
            <Switch checked={theme === 'dark'} onCheckedChange={toggle} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Info className="h-4 w-4" /> Runtime</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {cfg.data && (
              <>
                <Row label="Application" value={`${cfg.data.app_name} v${cfg.data.version}`} />
                <Row label="Environment" value={cfg.data.environment} />
                <Row label="Default period" value={`Last ${cfg.data.default_period_days} days`} />
                <Row label="Upload limit" value={`${cfg.data.max_upload_mb} MB | ${cfg.data.allowed_extensions.join(', ')}`} />
                <Row label="Database" value={<span className="flex items-center gap-1"><Database className="h-3.5 w-3.5" /> {cfg.data.database}</span>} />
                <Row label="Authentication" value={<span className="flex items-center gap-1"><Lock className="h-3.5 w-3.5" /> {cfg.data.authentication}</span>} />
                <Row label="Jira integration" value={cfg.data.jira_configured ? <span>{cfg.data.jira_email} | {cfg.data.jira_boards} board(s) | auto-sync {cfg.data.jira_auto_sync ? 'on' : 'off'} | <Link className="text-primary hover:underline" to="/config/jira">manage</Link></span> : <span>not configured | <Link className="text-primary hover:underline" to="/config/jira">set up</Link></span>} />
              </>
            )}
            {status.data && (
              <>
                <Row label="Backend" value={<span className="flex items-center gap-1"><Server className="h-3.5 w-3.5" /> <a className="text-primary hover:underline" href="/docs" target="_blank" rel="noreferrer">API docs (/docs)</a></span>} />
                <Row label="Source folder" value={<code className="rounded bg-muted px-1 text-xs">{status.data.source_dir}</code>} />
                <Row label="Data version" value={<Badge variant="secondary">v{status.data.version}</Badge>} />
              </>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Security notice</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            This first version has no authentication or role-based access and is intended for a <b>trusted local environment</b> only. Excel is the only data source; no database is used. The architecture (service layer, repository-style data store, event bus) is ready for authentication and a database to be introduced later without rewriting the application.
          </CardContent>
        </Card>
      </div>
    </>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  )
}
