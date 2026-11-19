import { useMemo } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertOctagon, AlertTriangle, CheckCircle2, ExternalLink, Info, RefreshCw } from 'lucide-react'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { HelpTip } from '@/components/ui/primitives'
import { DataTable } from '@/components/common/DataTable'
import { KpiCard, KpiGrid } from '@/components/common/KpiCard'
import { EmployeeLink, useCategoryLookup } from '@/components/common/Tables'
import { fmtDate, truncate, cn } from '@/lib/utils'
import type { ReconRow, ReconSummary } from '@/services/jiraApi'

export const VERDICT_META = {
  ok: { label: 'Match', variant: 'success' as const, icon: CheckCircle2 },
  error: { label: 'Conflict', variant: 'danger' as const, icon: AlertOctagon },
  warning: { label: 'Warning', variant: 'warning' as const, icon: AlertTriangle },
  info: { label: 'Info', variant: 'muted' as const, icon: Info },
}

export function VerdictBadge({ verdict }: { verdict: ReconRow['verdict'] }) {
  const m = VERDICT_META[verdict]
  const Icon = m.icon
  return (
    <Badge variant={m.variant} className="gap-1">
      <Icon className="h-3 w-3" /> {m.label}
    </Badge>
  )
}

export function JiraStatusBadge({ status, category }: { status: string | null; category: string | null }) {
  const lookup = useCategoryLookup()
  if (!status) return <span className="text-xs text-muted-foreground">—</span>
  const meta = category ? lookup.work_status[category] : undefined
  return <StatusBadge color={meta?.color} title={meta ? `→ ${meta.label}` : undefined}>{status}</StatusBadge>
}

export function ReconSummaryCards({ summary, onSync, syncing, compact = true }: { summary: ReconSummary; onSync?: () => void; syncing?: boolean; compact?: boolean }) {
  return (
    <div className="space-y-2">
      <KpiGrid cols={6}>
        <KpiCard label="Compared rows" value={summary.compared} compact={compact} hint="Excel work-item rows with a Jira id that were checked against Jira." />
        <KpiCard label="Match" value={summary.matched} tone="green" compact={compact} />
        <KpiCard label="Conflicts" value={summary.errors} tone={summary.errors ? 'red' : 'green'} compact={compact} hint="Status conflicts and ticket ids not found in Jira." />
        <KpiCard label="Warnings" value={summary.warnings} tone={summary.warnings ? 'orange' : 'green'} compact={compact} hint="Assignee / production / completion mismatches." />
        <KpiCard label="Not found in Jira" value={summary.not_found} tone={summary.not_found ? 'red' : 'grey'} compact={compact} sub={[summary.unmapped_board ? `${summary.unmapped_board} no board configured` : '', summary.unverified ? `${summary.unverified} unverified (sync error)` : ''].filter(Boolean).join(' · ') || undefined} />
        <KpiCard label="Missing from Excel" value={summary.missing_from_excel} tone={summary.missing_from_excel ? 'orange' : 'grey'} compact={compact} hint="Jira issues assigned to a team member (updated in the period) that no sheet reports." />
      </KpiGrid>
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>Last Jira sync: {summary.last_sync ? new Date(summary.last_sync).toLocaleString() : 'never'}</span>
        {summary.stale && <Badge variant="warning">Excel changed since last sync</Badge>}
        {summary.errors_detail?.map((e) => (
          <Badge key={e.scope} variant="danger" title={e.error}>
            {e.scope}: {truncate(e.error, 60)}
          </Badge>
        ))}
        {onSync && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={onSync} disabled={syncing}>
            <RefreshCw className={cn(syncing && 'animate-spin')} /> Sync with Jira
          </Button>
        )}
      </div>
    </div>
  )
}

export function ReconciliationTable({ items, onTicket, hideEmployee, pageSize = 50 }: { items: ReconRow[]; onTicket?: (id: string) => void; hideEmployee?: boolean; pageSize?: number }) {
  const lookup = useCategoryLookup()
  const columns = useMemo<ColumnDef<ReconRow, unknown>[]>(() => {
    const cols: ColumnDef<ReconRow, unknown>[] = [
      { accessorKey: 'verdict', header: 'Result', cell: ({ getValue }) => <VerdictBadge verdict={getValue() as ReconRow['verdict']} />, filterFn: 'equalsString', size: 100 },
      {
        accessorKey: 'ticket_id',
        header: 'Ticket',
        cell: ({ row }) => (
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <button className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onTicket?.(row.original.ticket_id) }}>{row.original.ticket_id}</button>
            {row.original.jira_url && (
              <a href={row.original.jira_url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" title="Open in Jira">
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </span>
        ),
      },
    ]
    if (!hideEmployee) cols.push({ accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <EmployeeLink name={getValue() as string} /> })
    cols.push(
      { accessorKey: 'report_date', header: 'Excel date', cell: ({ getValue }) => <span className="whitespace-nowrap">{getValue() ? fmtDate(getValue() as string) : <span className="text-muted-foreground">not in sheet</span>}</span> },
      {
        accessorKey: 'excel_status',
        header: 'Excel status',
        cell: ({ row }) => {
          if (!row.original.excel_status) return <span className="text-xs text-muted-foreground">—</span>
          const meta = lookup.work_status[row.original.excel_status]
          return <StatusBadge color={meta?.color} title={meta ? `→ ${meta.label}` : undefined}>{row.original.excel_status_raw ?? meta?.label ?? row.original.excel_status}</StatusBadge>
        },
        filterFn: 'equalsString',
      },
      { accessorKey: 'jira_status', header: 'Jira status', cell: ({ row }) => (row.original.jira_found ? <JiraStatusBadge status={row.original.jira_status} category={row.original.jira_status_category} /> : row.original.flags.some((f) => f.code === 'unverified') ? <Badge variant="muted">unverified</Badge> : row.original.flags.some((f) => f.code === 'unmapped_board') ? <Badge variant="muted">no board</Badge> : <Badge variant="danger">not found</Badge>) },
      {
        accessorKey: 'jira_assignee',
        header: 'Jira assignee',
        cell: ({ row }) => (
          <span className={cn('whitespace-nowrap', row.original.flags.some((f) => f.code === 'assignee_mismatch') && 'text-orange-600 font-medium')}>
            {row.original.jira_assignee ?? (row.original.jira_found ? <span className="italic text-muted-foreground">unassigned</span> : '—')}
          </span>
        ),
      },
      { accessorKey: 'jira_sprint', header: 'Sprint' },
      { accessorKey: 'jira_updated', header: 'Jira updated', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
      { id: 'excel_release_status', accessorFn: (r) => r.excel_release_status ?? '', header: 'Excel prod', cell: ({ row }) => (row.original.excel_release_status ? <StatusBadge color={lookup.prod_deployment[row.original.excel_release_status]?.color}>{lookup.prod_deployment[row.original.excel_release_status]?.label ?? row.original.excel_release_status}</StatusBadge> : <span className="text-xs text-muted-foreground">—</span>) },
      {
        id: 'flags',
        accessorFn: (r) => r.flags.map((f) => f.message).join(' | '),
        header: 'Findings',
        size: 360,
        cell: ({ row }) => (
          <ul className="space-y-0.5">
            {row.original.flags.length === 0 && <li className="text-xs text-green-600">Excel and Jira agree</li>}
            {row.original.flags.map((f, i) => (
              <li key={i} className={cn('text-xs', f.severity === 'error' ? 'text-red-600' : f.severity === 'warning' ? 'text-orange-600' : 'text-muted-foreground')}>
                • {f.message}
              </li>
            ))}
          </ul>
        ),
      },
      { id: 'summary', accessorFn: (r) => r.work_details ?? r.jira_summary ?? '', header: 'Summary', cell: ({ row }) => <HelpTip text={row.original.work_details ?? row.original.jira_summary ?? ''}><span>{truncate(row.original.work_details ?? row.original.jira_summary, 70)}</span></HelpTip>, size: 260 },
      { accessorKey: 'file_name', header: 'Source', cell: ({ row }) => (row.original.file_name ? <span className="text-[11px] text-muted-foreground whitespace-nowrap">{truncate(row.original.file_name, 26)} · r{row.original.source_row}</span> : <span className="text-[11px] text-muted-foreground">Jira only</span>) },
    )
    return cols
  }, [hideEmployee, onTicket, lookup])
  return (
    <DataTable
      data={items}
      columns={columns}
      pageSize={pageSize}
      dense
      exportName="excel-vs-jira"
      searchPlaceholder="Search ticket, employee, finding…"
      columnFilters={[
        { id: 'verdict', label: 'Result', options: Object.entries(VERDICT_META).map(([k, v]) => ({ value: k, label: v.label })) },
        { id: 'excel_status', label: 'Excel status', options: Object.values(lookup.work_status).map((c) => ({ value: c.key, label: c.label })) },
      ]}
      emptyTitle="Nothing to compare"
      emptyDescription="No Excel rows with Jira ids in the selected scope, or Jira has not been synced yet."
      rowClassName={(r) => (r.verdict === 'error' ? 'bg-red-50/60 dark:bg-red-950/20' : r.verdict === 'warning' ? 'bg-orange-50/50 dark:bg-orange-950/20' : undefined)}
    />
  )
}
