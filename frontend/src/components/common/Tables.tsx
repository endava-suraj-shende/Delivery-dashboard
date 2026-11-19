import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { ExternalLink, History } from 'lucide-react'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable } from '@/components/common/DataTable'
import { LoadingState, ErrorState } from '@/components/common/States'
import { useDimensions } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { jiraApi } from '@/services/api'
import { fmtDate, truncate } from '@/lib/utils'
import { FEATURES } from '@/lib/features'

/** Drop application-wise columns while that feature is hidden. */
function withFeatures<T>(cols: ColumnDef<T, unknown>[]): ColumnDef<T, unknown>[] {
  return FEATURES.applications ? cols : cols.filter((c) => (c as { accessorKey?: string }).accessorKey !== 'application')
}
import type { Activity, CategoryPoint, Release, Ticket } from '@/types'

// ------------------------------------------------------------------ helpers
export function useCategoryLookup() {
  const { data } = useDimensions()
  return useMemo(() => {
    const build = (pts?: CategoryPoint[]) => Object.fromEntries((pts ?? []).map((p) => [p.key, p]))
    return {
      work_status: build(data?.work_status),
      work_type: build(data?.work_type),
      dev_deployment: build(data?.dev_deployment),
      prod_deployment: build(data?.prod_deployment),
      prod_required: build(data?.prod_required),
    }
  }, [data])
}

export function CategoryCell({ dim, value, raw }: { dim: 'work_status' | 'work_type' | 'dev_deployment' | 'prod_deployment' | 'prod_required'; value: string; raw?: string | null }) {
  const lookup = useCategoryLookup()
  const meta = lookup[dim]?.[value]
  const label = meta?.label ?? value
  const differs = raw && raw.toLowerCase() !== label.toLowerCase()
  return (
    <StatusBadge color={meta?.color} title={raw ? `Excel value: ${raw}` : undefined}>
      {raw && differs ? (
        <span>
          {raw} <span className="opacity-60">→ {label}</span>
        </span>
      ) : (
        (raw ?? label)
      )}
    </StatusBadge>
  )
}

export function TicketLink({ id, link, onOpen }: { id: string | null; link?: string | null; onOpen?: (id: string) => void }) {
  if (!id) return <span className="text-xs text-muted-foreground">—</span>
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <button className="font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onOpen?.(id) }}>
        {id}
      </button>
      {link && (
        <a href={link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground" title="Open in Jira">
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </span>
  )
}

export function EmployeeLink({ name }: { name: string | null }) {
  const { queryString } = useFilters()
  if (!name) return <span className="text-muted-foreground">—</span>
  return (
    <Link to={`/employees/${encodeURIComponent(name)}${queryString ? `?${queryString}` : ''}`} className="hover:underline whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
      {name}
    </Link>
  )
}

export function ProjectLink({ name }: { name: string | null }) {
  const { queryString } = useFilters()
  if (!name) return <span className="text-muted-foreground">—</span>
  return (
    <Link to={`/projects/${encodeURIComponent(name)}${queryString ? `?${queryString}` : ''}`} className="hover:underline" onClick={(e) => e.stopPropagation()}>
      {name}
    </Link>
  )
}

// ------------------------------------------------------------------ activity table
export function ActivitiesTable({ items, onTicket, hideEmployee, pageSize = 25 }: { items: Activity[]; onTicket?: (id: string) => void; hideEmployee?: boolean; pageSize?: number }) {
  const lookup = useCategoryLookup()
  const columns = useMemo<ColumnDef<Activity, unknown>[]>(() => {
    const cols: ColumnDef<Activity, unknown>[] = [
      { accessorKey: 'report_date', header: 'Date', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue() as string)}</span>, size: 100 },
    ]
    if (!hideEmployee) cols.push({ accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <EmployeeLink name={getValue() as string} /> })
    cols.push(
      { accessorKey: 'project', header: 'Project / Team', cell: ({ getValue }) => <ProjectLink name={getValue() as string} /> },
      { accessorKey: 'application', header: 'Application' },
      { accessorKey: 'jira_board', header: 'Jira Board' },
      { id: 'ticket', accessorFn: (r) => r.ticket_id ?? r.ticket_raw ?? '', header: 'Jira Ticket', cell: ({ row }) => (row.original.ticket_id ? <TicketLink id={row.original.ticket_id} link={row.original.ticket_link} onOpen={onTicket} /> : <span className="text-xs text-muted-foreground italic">{row.original.ticket_raw ?? 'no id'}</span>) },
      { accessorKey: 'work_details', header: 'Work details', cell: ({ getValue }) => <span title={getValue() as string}>{truncate(getValue() as string, 90)}</span>, size: 320 },
      { accessorKey: 'work_type', header: 'Type', cell: ({ row }) => <CategoryCell dim="work_type" value={row.original.work_type} raw={row.original.work_type_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'work_status', header: 'Work Status', cell: ({ row }) => <CategoryCell dim="work_status" value={row.original.work_status} raw={row.original.work_status_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'dev_deployment', header: 'Dev Deployment', cell: ({ row }) => <CategoryCell dim="dev_deployment" value={row.original.dev_deployment} raw={row.original.dev_deployment_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'prod_required', header: 'In Production?', cell: ({ row }) => <CategoryCell dim="prod_required" value={row.original.prod_required} raw={row.original.prod_required_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'comments', header: 'Additional notes', cell: ({ getValue }) => <span title={getValue() as string}>{truncate(getValue() as string, 70)}</span>, size: 260 },
      { accessorKey: 'file_name', header: 'Source', cell: ({ row }) => <span className="text-[11px] text-muted-foreground whitespace-nowrap" title={row.original.file_name}>{truncate(row.original.file_name, 28)} · r{row.original.source_row}</span> },
    )
    return withFeatures(cols)
  }, [hideEmployee, onTicket])
  const opts = (dim: keyof typeof lookup) => Object.values(lookup[dim]).map((c) => ({ value: c.key, label: c.label }))
  return (
    <DataTable
      data={items}
      columns={columns}
      pageSize={pageSize}
      dense
      exportName="activities"
      searchPlaceholder="Search activities…"
      initialSorting={[{ id: 'report_date', desc: true }]}
      columnFilters={[
        { id: 'work_status', label: 'Status', options: opts('work_status') },
        { id: 'work_type', label: 'Type', options: opts('work_type') },
        { id: 'dev_deployment', label: 'Dev deploy', options: opts('dev_deployment') },
      ]}
      rowClassName={(r) => (r.is_duplicate ? 'opacity-60' : undefined)}
      emptyDescription="Adjust the date range or filters to see activity records."
    />
  )
}

// ------------------------------------------------------------------ ticket table
export function TicketsTable({ items, onTicket, pageSize = 25 }: { items: Ticket[]; onTicket?: (id: string) => void; pageSize?: number }) {
  const lookup = useCategoryLookup()
  const columns = useMemo<ColumnDef<Ticket, unknown>[]>(
    () => withFeatures<Ticket>([
      { accessorKey: 'ticket_id', header: 'Jira Ticket', cell: ({ row }) => <TicketLink id={row.original.ticket_id} link={row.original.ticket_link} onOpen={onTicket} /> },
      { accessorKey: 'work_status', header: 'Latest Status', cell: ({ row }) => <CategoryCell dim="work_status" value={row.original.work_status} raw={row.original.work_status_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'work_type', header: 'Type', cell: ({ row }) => <CategoryCell dim="work_type" value={row.original.work_type} raw={row.original.work_type_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'employee', header: 'Employee(s)', cell: ({ row }) => <span className="flex flex-wrap gap-1">{row.original.employees.map((e) => <EmployeeLink key={e} name={e} />)}</span> },
      { accessorKey: 'project', header: 'Project' },
      { accessorKey: 'application', header: 'Application' },
      { accessorKey: 'jira_board', header: 'Board' },
      { accessorKey: 'work_details', header: 'Summary', cell: ({ getValue }) => <span title={getValue() as string}>{truncate(getValue() as string, 80)}</span>, size: 300 },
      { accessorKey: 'dev_deployment', header: 'Dev Deploy', cell: ({ row }) => <CategoryCell dim="dev_deployment" value={row.original.dev_deployment} raw={row.original.dev_deployment_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'prod_deployment', header: 'Prod Deploy', cell: ({ row }) => (row.original.has_release ? <CategoryCell dim="prod_deployment" value={row.original.prod_deployment} raw={row.original.prod_deployment_raw} /> : <span className="text-xs text-muted-foreground">no release record</span>), filterFn: 'equalsString' },
      { accessorKey: 'last_seen', header: 'Last reported', cell: ({ getValue }) => <span className="whitespace-nowrap">{fmtDate(getValue() as string)}</span> },
      { accessorKey: 'activity_count', header: 'Rows', cell: ({ row }) => <span className="tabular-nums">{row.original.activity_count}{row.original.status_changed && <History className="ml-1 inline h-3 w-3 text-blue-500" aria-label="status changed" />}</span> },
    ]),
    [onTicket],
  )
  const opts = (dim: keyof typeof lookup) => Object.values(lookup[dim]).map((c) => ({ value: c.key, label: c.label }))
  return (
    <DataTable
      data={items}
      columns={columns}
      pageSize={pageSize}
      dense
      exportName="tickets"
      searchPlaceholder="Search by ticket id, text…"
      initialSorting={[{ id: 'last_seen', desc: true }]}
      columnFilters={[
        { id: 'work_status', label: 'Status', options: opts('work_status') },
        { id: 'work_type', label: 'Type', options: opts('work_type') },
        { id: 'prod_deployment', label: 'Prod', options: opts('prod_deployment') },
      ]}
      emptyTitle="No Jira tickets in the selected period"
    />
  )
}

// ------------------------------------------------------------------ releases table
export function ReleasesTable({ items, onTicket, pageSize = 25 }: { items: Release[]; onTicket?: (id: string) => void; pageSize?: number }) {
  const lookup = useCategoryLookup()
  const columns = useMemo<ColumnDef<Release, unknown>[]>(
    () => withFeatures<Release>([
      { accessorKey: 'release_date', header: 'Release date', cell: ({ row }) => <span className="whitespace-nowrap" title={row.original.release_date_source === 'cell' ? 'From Production Release Date column' : 'No release date in Excel; using report date'}>{fmtDate(row.original.release_date)}{row.original.release_date_source !== 'cell' && <span className="ml-1 text-[10px] text-muted-foreground">(report)</span>}</span> },
      { accessorKey: 'employee', header: 'Employee', cell: ({ getValue }) => <EmployeeLink name={getValue() as string} /> },
      { accessorKey: 'project', header: 'Project', cell: ({ getValue }) => <ProjectLink name={getValue() as string} /> },
      { accessorKey: 'application', header: 'Application' },
      { id: 'tickets', accessorFn: (r) => r.ticket_raw ?? '', header: 'Release tickets', cell: ({ row }) => (row.original.ticket_ids.length ? <span className="flex flex-wrap gap-1">{row.original.ticket_ids.map((t) => <TicketLink key={t} id={t} onOpen={onTicket} />)}</span> : <span className="text-xs italic text-muted-foreground">{row.original.ticket_raw ?? '—'}</span>) },
      { accessorKey: 'release_details', header: 'Release details', cell: ({ getValue }) => <span title={getValue() as string}>{truncate(getValue() as string, 100)}</span>, size: 320 },
      { accessorKey: 'prod_deployment', header: 'Production status', cell: ({ row }) => <CategoryCell dim="prod_deployment" value={row.original.prod_deployment} raw={row.original.prod_deployment_raw} />, filterFn: 'equalsString' },
      { accessorKey: 'comments', header: 'Comments', cell: ({ getValue }) => truncate(getValue() as string, 60) },
      { accessorKey: 'file_name', header: 'Source', cell: ({ row }) => <span className="text-[11px] text-muted-foreground whitespace-nowrap">{truncate(row.original.file_name, 28)} · r{row.original.source_row}</span> },
    ]),
    [onTicket],
  )
  return (
    <DataTable
      data={items}
      columns={columns}
      pageSize={pageSize}
      dense
      exportName="production-releases"
      searchPlaceholder="Search releases…"
      initialSorting={[{ id: 'release_date', desc: true }]}
      columnFilters={[{ id: 'prod_deployment', label: 'Status', options: Object.values(lookup.prod_deployment).map((c) => ({ value: c.key, label: c.label })) }]}
      emptyTitle="No production release records in the selected period"
    />
  )
}

// ------------------------------------------------------------------ ticket detail dialog
export function TicketDialog({ ticketId, onClose }: { ticketId: string | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ['ticket', ticketId], queryFn: () => jiraApi.ticket(ticketId!), enabled: !!ticketId })
  return (
    <Dialog open={!!ticketId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {ticketId}
            {q.data?.ticket && <CategoryCell dim="work_status" value={q.data.ticket.work_status} raw={q.data.ticket.work_status_raw} />}
          </DialogTitle>
          <DialogDescription>{q.data?.ticket?.work_details}</DialogDescription>
        </DialogHeader>
        {q.isLoading && <LoadingState rows={1} />}
        {q.isError && <ErrorState error={q.error} />}
        {q.data && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Meta label="Employee(s)" value={q.data.ticket.employees.join(', ')} />
              <Meta label="Project" value={q.data.ticket.project} />
              {FEATURES.applications && <Meta label="Application" value={q.data.ticket.application} />}
              <Meta label="Jira board" value={q.data.ticket.jira_board} />
              <Meta label="First seen" value={fmtDate(q.data.ticket.first_seen)} />
              <Meta label="Last seen" value={fmtDate(q.data.ticket.last_seen)} />
              <Meta label="Completed on" value={fmtDate(q.data.ticket.completed_on)} />
              <Meta label="Reports / rows" value={`${q.data.ticket.report_count} / ${q.data.ticket.activity_count}`} />
            </div>
            <div className="flex flex-wrap gap-2">
              <CategoryCell dim="work_type" value={q.data.ticket.work_type} raw={q.data.ticket.work_type_raw} />
              <CategoryCell dim="dev_deployment" value={q.data.ticket.dev_deployment} raw={q.data.ticket.dev_deployment_raw} />
              <CategoryCell dim="prod_required" value={q.data.ticket.prod_required} raw={q.data.ticket.prod_required_raw} />
              {q.data.ticket.has_release ? <CategoryCell dim="prod_deployment" value={q.data.ticket.prod_deployment} raw={q.data.ticket.prod_deployment_raw} /> : <Badge variant="muted">No production release record</Badge>}
              {q.data.ticket.ticket_link && (
                <a href={q.data.ticket.ticket_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
                  Open in Jira <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status history (by report date)</p>
              <ol className="relative ml-2 border-l pl-4">
                {(q.data.ticket.status_history ?? []).map((h, i) => (
                  <li key={i} className="mb-2">
                    <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                    <span className="text-xs text-muted-foreground">{fmtDate(h.date)}</span> · <CategoryCell dim="work_status" value={h.status} raw={h.status_raw} /> <span className="text-xs text-muted-foreground">by {h.employee}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Excel activity records</p>
              <div className="space-y-2">
                {q.data.activities.map((a) => (
                  <div key={a.activity_id} className="rounded-md border p-3 text-xs">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="font-medium">{fmtDate(a.report_date)}</span>
                      <span>{a.employee}</span>
                      <CategoryCell dim="work_status" value={a.work_status} raw={a.work_status_raw} />
                      <CategoryCell dim="work_type" value={a.work_type} raw={a.work_type_raw} />
                      <CategoryCell dim="dev_deployment" value={a.dev_deployment} raw={a.dev_deployment_raw} />
                      <span className="ml-auto text-muted-foreground">
                        {a.file_name} · row {a.source_row}
                      </span>
                    </div>
                    <p>{a.work_details}</p>
                    {a.comments && <p className="mt-1 text-muted-foreground">Notes: {a.comments}</p>}
                  </div>
                ))}
              </div>
            </div>
            {q.data.releases.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Production release records</p>
                <div className="space-y-2">
                  {q.data.releases.map((r) => (
                    <div key={r.release_id} className="rounded-md border p-3 text-xs">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="font-medium">{fmtDate(r.release_date)}</span>
                        <span>{r.employee}</span>
                        <span>{r.application}</span>
                        <CategoryCell dim="prod_deployment" value={r.prod_deployment} raw={r.prod_deployment_raw} />
                        <span className="ml-auto text-muted-foreground">
                          {r.file_name} · row {r.source_row}
                        </span>
                      </div>
                      <p>{r.release_details}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Meta({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="truncate text-sm" title={value ?? undefined}>
        {value || '—'}
      </p>
    </div>
  )
}
