import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Database, FileSpreadsheet, Loader2, Plug, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useDataStatus } from '@/hooks/useData'
import { dataSourceApi, errorMessage } from '@/services/api'
import { cn } from '@/lib/utils'

const MODES = [
  { key: 'auto', label: 'Automatic', desc: 'Jira when credentials and at least one board are configured, otherwise Excel.' },
  { key: 'jira', label: 'Jira boards', desc: 'All dashboards are built from the configured Jira boards (changelog = activities).' },
  { key: 'excel', label: 'Excel workbooks', desc: 'Bi-weekly workbooks in the Data folder and uploads.' },
  { key: 'both', label: 'Jira + Excel', desc: 'Both sources combined; a ticket in both counts once.' },
] as const

export function DataSourceCard({ compact }: { compact?: boolean }) {
  const { data: s } = useDataStatus()
  const qc = useQueryClient()
  const { toast } = useToast()
  const [lookback, setLookback] = useState<number | ''>('')
  const [refresh, setRefresh] = useState<number | ''>('')
  const update = useMutation({
    mutationFn: dataSourceApi.update,
    onSuccess: (st) => { qc.invalidateQueries(); toast({ title: `Data source: ${st.source}`, description: `${st.activity_count} activities · ${st.employee_count} employees`, variant: 'success' }) },
    onError: (e) => toast({ title: 'Could not change data source', description: errorMessage(e), variant: 'destructive' }),
  })
  const reload = useMutation({ mutationFn: dataSourceApi.reload, onSuccess: (st) => { qc.invalidateQueries(); toast({ title: 'Data reloaded', description: `${st.activity_count} activities from ${st.source}`, variant: 'success' }) }, onError: (e) => toast({ title: 'Reload failed', description: errorMessage(e), variant: 'destructive' }) })
  if (!s) return null
  const busy = update.isPending || reload.isPending
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><Database className="h-4 w-4" /> Primary data source</CardTitle>
          <CardDescription>
            Active: <b className="uppercase">{s.source}</b>{s.configured_mode === 'auto' && ' (automatic)'} · {s.activity_count} activities · {s.employee_count} employees · {s.project_count} projects
            {s.jira && ` · ${s.jira.issues} Jira issues from ${s.jira.boards.length} board(s)`}
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" onClick={() => reload.mutate()} disabled={busy}><RefreshCw className={cn(reload.isPending && 'animate-spin')} /> Reload</Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className={cn('grid gap-2', compact ? 'sm:grid-cols-2' : 'sm:grid-cols-4')}>
          {MODES.map((m) => {
            const disabled = (m.key === 'jira' || m.key === 'both') && !s.jira_available
            return (
              <button key={m.key} disabled={disabled || busy} onClick={() => update.mutate({ mode: m.key })}
                className={cn('rounded-md border p-3 text-left text-sm transition hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50', s.configured_mode === m.key && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                <p className="flex items-center gap-1 font-medium">{m.key === 'excel' ? <FileSpreadsheet className="h-3.5 w-3.5" /> : m.key === 'jira' ? <Plug className="h-3.5 w-3.5" /> : <Database className="h-3.5 w-3.5" />} {m.label}</p>
                <p className="text-[11px] text-muted-foreground">{m.desc}{disabled ? ' Requires Jira credentials and a board.' : ''}</p>
              </button>
            )
          })}
        </div>
        {s.source !== 'excel' && (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <div>
              <Label>Jira look-back (days)</Label>
              <Input type="number" min={7} max={730} className="mt-1 h-8 w-32" value={lookback === '' ? s.lookback_days : lookback} onChange={(e) => setLookback(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <div>
              <Label>Auto-refresh (minutes)</Label>
              <Input type="number" min={1} max={1440} className="mt-1 h-8 w-32" value={refresh === '' ? s.refresh_minutes : refresh} onChange={(e) => setRefresh(e.target.value === '' ? '' : Number(e.target.value))} />
            </div>
            <Button size="sm" disabled={busy || (lookback === '' && refresh === '')} onClick={() => update.mutate({ lookback_days: lookback === '' ? undefined : lookback, refresh_minutes: refresh === '' ? undefined : refresh })}>
              {update.isPending ? <Loader2 className="animate-spin" /> : null} Apply & reload
            </Button>
            <span className="text-xs text-muted-foreground">Only issues updated within the look-back window are loaded from each board.</span>
          </div>
        )}
        {s.jira && s.jira.errors.length > 0 && (
          <div className="flex flex-wrap gap-2">{s.jira.errors.map((e) => <Badge key={e.scope} variant="danger" title={e.error}>{e.scope}: {e.error.slice(0, 80)}</Badge>)}</div>
        )}
        {s.jira && Object.keys(s.jira.fields_resolved ?? {}).length > 0 && !compact && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Jira field mapping (resolved by name per site)</summary>
            {Object.entries(s.jira.fields_resolved).map(([site, m]) => (
              <p key={site} className="mt-1"><b>{site}</b>: {Object.entries(m).map(([k, v]) => `${k} → ${v ?? '—'}`).join(' · ')}</p>
            ))}
          </details>
        )}
      </CardContent>
    </Card>
  )
}
