import { useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, CheckCircle2, Eye, FileSpreadsheet, FolderOpen, History, Info, RefreshCw, ShieldAlert, Trash2, Upload, Loader2, Copy } from 'lucide-react'
import { KeyValueList, Notice, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable } from '@/components/common/DataTable'
import { ErrorState, LoadingState, EmptyState } from '@/components/common/States'
import { Card } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Label, NativeSelect } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { useSession } from '@/hooks/useSession'
import { useDataStatus } from '@/hooks/useData'
import { dashboardApi, errorMessage, excelApi, type MyTicketRow, type MyUpload, type Validation } from '@/services/api'
import { jiraLiveApi } from '@/services/jiraApi'
import { ReconSummaryCards, ReconciliationTable } from '@/components/common/JiraReconciliation'
import { TicketDialog } from '@/components/common/Tables'
import { fileSize, fmtDate, cn, STATUS_COLORS } from '@/lib/utils'
import type { FileInfo, Issue } from '@/types'

/** Readable category pill coloured with the standard status palette (no config lookup needed). */
function CatPill({ value, raw }: { value: string | null; raw?: string | null }) {
  if (!value) return <span className="text-muted-foreground">-</span>
  const color = STATUS_COLORS[value] ?? '#64748b'
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize" style={{ borderColor: `${color}55`, background: `${color}14`, color }} title={raw && raw !== value ? `Source value: ${raw}` : undefined}>
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />{value.replace(/_/g, ' ')}
    </span>
  )
}

export default function ExcelPage() {
  const [sp] = useSearchParams()
  const qc = useQueryClient()
  const { toast } = useToast()
  const status = useDataStatus()
  const files = useQuery({ queryKey: ['excel', 'files'], queryFn: excelApi.files })
  const history = useQuery({ queryKey: ['excel', 'history'], queryFn: excelApi.history })
  const { user } = useSession()
  const limited = user?.role === 'employee'  // employees: upload and check only
  const quality = useQuery({ queryKey: ['quality', 'all'], queryFn: () => dashboardApi.quality('', 'all'), enabled: !limited })
  const mine = useQuery({ queryKey: ['excel', 'my'], queryFn: excelApi.my, enabled: limited })
  const [preview, setPreview] = useState<FileInfo | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const invalidate = () => qc.invalidateQueries()
  const refresh = useMutation({ mutationFn: excelApi.refresh, onSuccess: () => { invalidate(); toast({ title: 'Data refreshed', variant: 'success' }) }, onError: (e) => toast({ title: 'Refresh failed', description: errorMessage(e), variant: 'destructive' }) })
  const upload = useMutation({
    mutationFn: ({ file, replace }: { file: File; replace: boolean }) => excelApi.upload(file, replace),
    onSuccess: (r) => {
      invalidate()
      const j = r.jira as { compared?: number; errors?: number; warnings?: number; not_found?: number; error?: string } | null
      const jiraText = j ? (j.error ? ` | Jira: ${j.error}` : ` | Jira: ${j.compared} compared, ${j.errors} conflicts, ${j.warnings} warnings, ${j.not_found} not found`) : ''
      toast({ title: 'Workbook uploaded', description: `${r.file_name} | ${r.issues.length} validation note(s)${jiraText}`, variant: j && (j.errors || 0) > 0 ? 'destructive' : 'success' })
    },
    onError: (e) => toast({ title: 'Upload rejected', description: errorMessage(e), variant: 'destructive' }),
  })
  const remove = useMutation({ mutationFn: excelApi.removeUpload, onSuccess: () => { invalidate(); toast({ title: 'Upload removed' }) }, onError: (e) => toast({ title: 'Remove failed', description: errorMessage(e), variant: 'destructive' }) })
  const clear = useMutation({ mutationFn: excelApi.clearUploads, onSuccess: () => { invalidate(); setConfirmClear(false); toast({ title: 'All uploads removed' }) } })

  const onFiles = (list: FileList | null) => {
    if (!list) return
    Array.from(list).forEach((f) => upload.mutate({ file: f, replace: false }))
  }

  const fileCols = useMemo<ColumnDef<FileInfo, unknown>[]>(
    () => [
      { accessorKey: 'file_name', header: 'File', cell: ({ row }) => <span className="flex items-center gap-2 whitespace-nowrap"><FileSpreadsheet className="h-3.5 w-3.5 text-green-600" />{row.original.file_name}</span> },
      { accessorKey: 'origin', header: 'Origin', cell: ({ row, getValue }) => <span className="flex flex-col"><Badge variant={getValue() === 'upload' ? 'info' : 'muted'} className="w-fit">{getValue() as string}</Badge>{(row.original as FileInfo & { uploaded_by?: string | null }).uploaded_by && <span className="mt-0.5 text-[10px] text-muted-foreground">by {(row.original as FileInfo & { uploaded_by?: string | null }).uploaded_by}</span>}</span>, filterFn: 'equalsString' },
      { accessorKey: 'folder', header: 'Folder' },
      { accessorKey: 'employee', header: 'Employee' },
      { accessorKey: 'project', header: 'Project' },
      { accessorKey: 'report_date', header: 'Report date', cell: ({ row }) => <span className="whitespace-nowrap">{fmtDate(row.original.report_date)} <span className="text-[10px] text-muted-foreground">({row.original.report_date_source})</span></span> },
      { accessorKey: 'sheet_name', header: 'Sheet' },
      { accessorKey: 'layout', header: 'Layout', cell: ({ getValue }) => <Badge variant="outline">{getValue() as string}</Badge>, filterFn: 'equalsString' },
      { accessorKey: 'work_items', header: 'Work items' },
      { accessorKey: 'releases', header: 'Releases' },
      { accessorKey: 'kt_items', header: 'KT' },
      { accessorKey: 'issues', header: 'Issues', cell: ({ getValue }) => <Badge variant={(getValue() as number) > 0 ? 'warning' : 'success'}>{getValue() as number}</Badge> },
      { accessorKey: 'size_bytes', header: 'Size', cell: ({ getValue }) => fileSize(getValue() as number) },
      {
        id: 'actions',
        header: '',
        enableSorting: false,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button size="xs" variant="outline" onClick={(e) => { e.stopPropagation(); setPreview(row.original) }}>
              <Eye /> Preview
            </Button>
            {row.original.origin === 'upload' && !limited && (
              <Button size="xs" variant="ghost" className="text-red-600" onClick={(e) => { e.stopPropagation(); remove.mutate(row.original.file_id) }}>
                <Trash2 />
              </Button>
            )}
          </div>
        ),
      },
    ],
    [remove, limited],
  )

  const issueCols = useMemo<ColumnDef<Issue, unknown>[]>(
    () => [
      { accessorKey: 'severity', header: 'Severity', cell: ({ getValue }) => <Badge variant={getValue() === 'error' ? 'danger' : getValue() === 'warning' ? 'warning' : 'muted'}>{getValue() as string}</Badge>, filterFn: 'equalsString' },
      { accessorKey: 'category', header: 'Category', cell: ({ getValue }) => <span className="whitespace-nowrap">{(getValue() as string).replace(/_/g, ' ')}</span>, filterFn: 'equalsString' },
      { accessorKey: 'employee', header: 'Employee' },
      { accessorKey: 'file_name', header: 'File' },
      { accessorKey: 'row', header: 'Row' },
      { accessorKey: 'field', header: 'Field' },
      { accessorKey: 'value', header: 'Value', cell: ({ getValue }) => <span className="font-mono text-xs">{(getValue() as string) ?? ''}</span> },
      { accessorKey: 'message', header: 'Message', size: 400 },
    ],
    [],
  )

  type Hist = NonNullable<typeof history.data>[number]
  const historyCols = useMemo<ColumnDef<Hist, unknown>[]>(() => [
    { accessorKey: 'timestamp', header: 'When', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{new Date(getValue() as string).toLocaleString()}</span> },
    { accessorKey: 'reason', header: 'Trigger', cell: ({ getValue }) => <Badge variant="secondary">{String(getValue())}</Badge> },
    { id: 'files', accessorFn: (h) => h.parsed, header: 'Files parsed', meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.parsed} / {row.original.files}</span> },
    { accessorKey: 'activities', header: 'Work rows', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { accessorKey: 'releases', header: 'Releases', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}</span> },
    { accessorKey: 'duration_ms', header: 'Duration', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{getValue() as number} ms</span> },
    { accessorKey: 'failed', header: 'Result', cell: ({ row }) => (row.original.failed > 0 ? <Badge variant="danger" title={row.original.failures.map((f) => f.file).join(', ')}>{row.original.failed} failed</Badge> : <Badge variant="success">ok</Badge>) },
  ], [])

  const s = status.data
  const qs = quality.data?.summary
  const myUploadCols = useMemo<ColumnDef<MyUpload, unknown>[]>(() => [
    { accessorKey: 'file_name', header: 'File', cell: ({ getValue }) => <span className="font-medium">{getValue() as string}</span> },
    { accessorKey: 'report_date', header: 'Report date', cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: 'project', header: 'Project' },
    { accessorKey: 'application', header: 'Application' },
    { accessorKey: 'jira_board', header: 'Board' },
    { accessorKey: 'work_items', header: 'Tickets', meta: { align: 'right' } },
    { accessorKey: 'releases', header: 'Releases', meta: { align: 'right' } },
    { accessorKey: 'issues', header: 'Issues', meta: { align: 'right' }, cell: ({ getValue }) => <Badge variant={(getValue() as number) ? 'warning' : 'success'}>{getValue() as number}</Badge> },
    { accessorKey: 'uploaded_at', header: 'Uploaded', cell: ({ getValue }) => fmtDate(getValue() as string, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) },
    { accessorKey: 'size_bytes', header: 'Size', cell: ({ getValue }) => fileSize(getValue() as number) },
  ], [])
  const myTicketCols = useMemo<ColumnDef<MyTicketRow, unknown>[]>(() => [
    { accessorKey: 'ticket_id', header: 'Ticket', cell: ({ row }) => row.original.ticket_link ? <a href={row.original.ticket_link} target="_blank" rel="noreferrer" className="font-medium text-primary hover:underline">{row.original.ticket_id ?? '-'}</a> : <span className="font-medium">{row.original.ticket_id ?? '-'}</span> },
    { accessorKey: 'application', header: 'Application' },
    { accessorKey: 'work_details', header: 'Work details', size: 320, cell: ({ getValue }) => <span className="line-clamp-2" title={getValue() as string}>{getValue() as string}</span> },
    { accessorKey: 'work_type_raw', header: 'Work type' },
    { accessorKey: 'work_status', header: 'Status', cell: ({ row }) => <CatPill value={row.original.work_status} raw={row.original.work_status_raw} /> },
    { accessorKey: 'prod_required', header: 'Prod required', cell: ({ row }) => <CatPill value={row.original.prod_required} /> },
    { accessorKey: 'dev_deployment', header: 'Dev deployment', cell: ({ row }) => <CatPill value={row.original.dev_deployment} raw={row.original.dev_deployment_raw} /> },
    { accessorKey: 'comments', header: 'Comments', size: 240, cell: ({ getValue }) => <span className="line-clamp-2 text-muted-foreground" title={getValue() as string}>{(getValue() as string) || '-'}</span> },
    { accessorKey: 'report_date', header: 'Report date', cell: ({ getValue }) => fmtDate(getValue() as string) },
    { accessorKey: 'file_name', header: 'File', cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue() as string}</span> },
  ], [])
  const categories = useMemo(() => Array.from(new Set((quality.data?.issues ?? []).map((i) => i.category))).map((c) => ({ value: c, label: c.replace(/_/g, ' ') })), [quality.data])

  return (
    <>
      <PageHeader
        title="Excel Data Management"
        description="Workbooks are read from the Data folder (one bi-weekly template per employee per period) plus any files uploaded here. Source files are never modified."
        breadcrumbs={[{ label: 'Excel Data' }]}
        actions={
          <>
            <input ref={inputRef} type="file" accept=".xlsx,.xlsm,.xls" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            <Button onClick={() => inputRef.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Loader2 className="animate-spin" /> : <Upload />} Upload workbook
            </Button>
            {!limited && (
              <Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                <RefreshCw className={cn(refresh.isPending && 'animate-spin')} /> Refresh
              </Button>
            )}
          </>
        }
      />
      {limited && (
        <Notice tone="info" icon={Info}>
          Upload your bi-weekly workbook here. Only the workbooks you uploaded are listed below, with their parsed row counts; that confirms they were received successfully.
        </Notice>
      )}
      {s && s.source === 'jira' && !limited && (
        <Notice tone="info" icon={Info} action={<Button asChild size="sm" variant="outline"><Link to="/settings">Change data source</Link></Button>}>
          The dashboards currently use <b>Jira boards</b> as the primary source; the workbooks below are not loaded. Switch to <b>Excel</b> or <b>Jira + Excel</b> in Settings to use them.
        </Notice>
      )}
      {s && limited && (
        <StatStrip cols={4}>
          <StatTile icon={FileSpreadsheet} label="My workbooks" value={s.file_count} tone="green" />
          <StatTile label="Work rows" value={s.activity_count} tone="default" />
          <StatTile label="Release rows" value={s.release_count} tone="default" />
          <StatTile icon={CheckCircle2} label="Last upload" value={s.last_refresh ? new Date(s.last_refresh).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '-'} tone="blue" />
        </StatStrip>
      )}
      {s && !limited && (
        <StatStrip cols={6}>
          <StatTile icon={FileSpreadsheet} label="Workbooks" value={s.file_count} sub={`${s.uploads} uploaded this session`} tone="green" />
          <StatTile icon={CheckCircle2} label="Reports parsed" value={s.report_count} sub={`${fmtDate(s.date_min)} - ${fmtDate(s.date_max)}`} tone="blue" />
          <StatTile label="Work rows" value={s.activity_count} tone="default" />
          <StatTile label="Release rows" value={s.release_count} tone="default" />
          <StatTile label="People / projects" value={`${s.employee_count} / ${s.project_count}`} tone="grey" />
          {!limited && <StatTile icon={ShieldAlert} label="Data quality issues" value={s.issues_count} sub={s.issues_count ? 'see Data quality tab' : 'no issues found'} tone={s.issues_count ? 'orange' : 'green'} />}
        </StatStrip>
      )}

      <div className={cn('grid gap-4', !limited && 'lg:grid-cols-3')}>
        {!limited && <SettingsCard icon={FolderOpen} title="Source folder" description="Workbooks placed here are read on every refresh. Files are never modified." className="lg:col-span-2"
          action={s?.needs_refresh ? <Badge variant="warning">Folder changed - refresh recommended</Badge> : undefined}>
          {s && (
            <KeyValueList items={[
              { label: 'Folder', value: <code className="rounded bg-muted px-1.5 py-0.5 text-xs">{s.source_dir}</code> },
              { label: 'Last refresh', value: s.last_refresh ? `${new Date(s.last_refresh).toLocaleString()} (${s.load_duration_ms} ms)` : '-' },
              { label: 'Upload limit', value: '25 MB per file | .xlsx, .xlsm, .xls' },
            ]} />
          )}
        </SettingsCard>}
        <Card
          className="flex cursor-pointer flex-col items-center justify-center border-2 border-dashed p-6 text-center transition hover:border-primary/60 hover:bg-primary/[0.03]"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); onFiles(e.dataTransfer.files) }}
          role="button"
        >
          <span className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">{upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}</span>
          <p className="text-sm font-medium">Drop workbooks here or click to upload</p>
          <p className="mt-1 text-[11px] text-muted-foreground">Uploaded files are copied to data/uploads; originals and the source folder are untouched.</p>
        </Card>
      </div>

      {limited ? (
        <>
          <SettingsCard icon={FileSpreadsheet} title={`My uploaded workbooks (${mine.data?.uploads.length ?? 0})`} description="Each row is one workbook you uploaded, stored with its parsed summary. Only you and the administrators can see these.">
            {mine.isLoading && <LoadingState rows={1} />}
            {mine.data && (mine.data.uploads.length ? <DataTable data={mine.data.uploads} columns={myUploadCols} dense pageSize={10} searchPlaceholder="Search workbooks" exportName="my-workbooks" initialSorting={[{ id: 'uploaded_at', desc: true }]} /> : <EmptyState title="No workbooks yet" description="Upload your bi-weekly workbook to see it here." />)}
          </SettingsCard>
          <SettingsCard icon={CheckCircle2} title={`My ticket details (${mine.data?.tickets.length ?? 0})`} description="Every work item read from your workbooks, with the status as written and as the dashboard understands it.">
            {mine.isLoading && <LoadingState rows={1} />}
            {mine.data && (mine.data.tickets.length ? <DataTable data={mine.data.tickets} columns={myTicketCols} dense pageSize={25} searchPlaceholder="Search tickets" exportName="my-tickets" columnFilters={[{ id: 'work_status', label: 'Status', options: Array.from(new Set(mine.data.tickets.map((t) => t.work_status).filter(Boolean) as string[])).map((v) => ({ value: v, label: v.replace(/_/g, ' ') })) }]} /> : <EmptyState title="No tickets yet" description="Ticket rows appear here after your first upload." />)}
          </SettingsCard>
        </>
      ) : (
      <Tabs defaultValue={sp.get('tab') ?? 'files'}>
        <TabsList>
          <TabsTrigger value="files">Workbooks ({files.data?.items.length ?? ''})</TabsTrigger>
          {!limited && <TabsTrigger value="quality">Data quality ({qs?.total_issues ?? ''})</TabsTrigger>}
          <TabsTrigger value="history">Import history</TabsTrigger>
        </TabsList>
        <TabsContent value="files">
          <SettingsCard icon={FileSpreadsheet} title={limited ? 'My uploaded workbooks' : 'Loaded workbooks'} description={limited ? 'Each row is one workbook you uploaded. Preview shows what was read from it.' : 'Click a row or Preview to inspect sheets, raw rows, detected column mapping and validation results.'}
            action={(s?.uploads ?? 0) > 0 && !limited ? <Button variant="outline" size="sm" className="text-red-600" onClick={() => setConfirmClear(true)}><Trash2 /> Remove all uploads</Button> : undefined}>
            {files.isLoading && <LoadingState rows={1} />}
            {files.isError && <ErrorState error={files.error} />}
            {files.data && <DataTable data={files.data.items} columns={fileCols} dense exportName="workbooks" onRowClick={setPreview} searchPlaceholder="Search workbooks" columnFilters={[{ id: 'origin', label: 'Origin', options: [{ value: 'folder', label: 'folder' }, { value: 'upload', label: 'upload' }] }, { id: 'layout', label: 'Layout', options: [{ value: 'template', label: 'template' }, { value: 'flat', label: 'flat' }, { value: 'unknown', label: 'unknown' }] }]} />}
          </SettingsCard>
        </TabsContent>
        <TabsContent value="quality" className="space-y-4">
          {qs && (
            <StatStrip cols={5}>
              <StatTile label="Missing employee" value={qs.missing_employee} tone={qs.missing_employee ? 'orange' : 'green'} />
              <StatTile label="Missing project" value={qs.missing_project} tone={qs.missing_project ? 'orange' : 'green'} />
              <StatTile label="Rows without Jira id" value={qs.activities_without_ticket} tone={qs.activities_without_ticket ? 'orange' : 'green'} />
              <StatTile label="Blank status" value={qs.missing_status} tone={qs.missing_status ? 'orange' : 'green'} />
              <StatTile label="Invalid or corrected dates" value={qs.invalid_dates} tone={qs.invalid_dates ? 'orange' : 'green'} />
              <StatTile label="Duplicate rows" value={qs.duplicates} tone={qs.duplicates ? 'orange' : 'green'} />
              <StatTile label="Incomplete deployment" value={qs.incomplete_deployment} tone={qs.incomplete_deployment ? 'orange' : 'green'} />
              <StatTile label="Unmapped statuses" value={qs.unmapped_statuses} tone={qs.unmapped_statuses ? 'red' : 'green'} />
              <StatTile label="Files with errors" value={qs.files_with_errors} tone={qs.files_with_errors ? 'red' : 'green'} />
              <StatTile label="Total issues" value={qs.total_issues} sub={`${qs.errors} errors | ${qs.warnings} warnings`} tone={qs.total_issues ? 'orange' : 'green'} />
            </StatStrip>
          )}
          {quality.data && Object.values(quality.data.unmapped).some((v) => Object.keys(v).length) && (
            <Notice tone="warning" icon={AlertTriangle} action={<Button asChild size="sm" variant="outline"><Link to="/config/status">Open Status Configuration</Link></Button>}>
              <span className="flex flex-wrap items-center gap-1.5"><span className="mr-1 font-medium">Unmapped status values:</span>{Object.entries(quality.data.unmapped).flatMap(([dim, vals]) => Object.entries(vals).map(([v, n]) => <Badge key={`${dim}:${v}`} variant="warning">{dim.replace('_', ' ')}: {v} x{n}</Badge>))}</span>
            </Notice>
          )}
          <SettingsCard icon={ShieldAlert} title="All issues" description="Every anomaly detected while parsing, traceable to file and row. Nothing is silently discarded.">
            {quality.data ? <DataTable data={quality.data.issues} columns={issueCols} dense exportName="data-quality" pageSize={50} searchPlaceholder="Search issues" columnFilters={[{ id: 'severity', label: 'Severity', options: ['error', 'warning', 'info'].map((v) => ({ value: v, label: v })) }, { id: 'category', label: 'Category', options: categories }]} /> : <LoadingState rows={1} />}
          </SettingsCard>
        </TabsContent>
        <TabsContent value="history">
          <SettingsCard icon={History} title="Import history (this session)" description="Kept in memory for the running application only.">
            {!history.data?.length ? <EmptyState title="No imports yet" /> : <DataTable data={history.data} columns={historyCols} dense pageSize={15} exportName="import-history" searchPlaceholder="Search imports" initialSorting={[{ id: 'timestamp', desc: true }]} />}
          </SettingsCard>
        </TabsContent>
      </Tabs>
      )}

      {preview && <PreviewDialog file={preview} onClose={() => setPreview(null)} />}

      <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove all uploaded workbooks?</DialogTitle>
            <DialogDescription>Only files uploaded through this screen are removed. The Data folder is never touched.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => clear.mutate()} disabled={clear.isPending}>Remove uploads</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PreviewDialog({ file, onClose }: { file: FileInfo; onClose: () => void }) {
  const [sheet, setSheet] = useState<string | undefined>(file.sheet_name ?? undefined)
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const preview = useQuery({ queryKey: ['excel', 'preview', file.file_id, sheet], queryFn: () => excelApi.preview(file.file_id, sheet) })
  const validation = useQuery({ queryKey: ['excel', 'validate', file.file_id, sheet, overrides], queryFn: () => excelApi.validate({ file_id: file.file_id, sheet_name: sheet, column_overrides: Object.keys(overrides).length ? { work_items: overrides } : undefined }) })
  const detail = useQuery({ queryKey: ['excel', 'detail', file.file_id], queryFn: () => excelApi.fileDetail(file.file_id) })
  const jiraStatus = useQuery({ queryKey: ['jira', 'status'], queryFn: jiraLiveApi.status })
  const jiraReady = !!jiraStatus.data?.configured && (jiraStatus.data?.boards.length ?? 0) > 0
  const recon = useQuery({ queryKey: ['jira', 'recon-file', file.file_id, jiraStatus.data?.last_sync], queryFn: () => jiraLiveApi.reconciliationFile(file.file_id), enabled: jiraReady })
  const [ticket, setTicket] = useState<string | null>(null)
  const qcJ = useQueryClient()
  const syncMut = useMutation({ mutationFn: () => jiraLiveApi.sync(true), onSuccess: () => qcJ.invalidateQueries({ queryKey: ['jira'] }) })
  const v: Validation | undefined = validation.data
  const headers = v?.work_mapping?.headers?.filter(Boolean) as string[] | undefined
  const { toast } = useToast()

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent wide className="max-w-6xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><FileSpreadsheet className="h-4 w-4 text-green-600" /> {file.file_name}</DialogTitle>
          <DialogDescription>
            {file.employee} | {file.project} | report date {fmtDate(file.report_date)} ({file.report_date_source}) | {fileSize(file.size_bytes)}
          </DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="validation">
          <TabsList>
            <TabsTrigger value="validation">Validation & mapping</TabsTrigger>
            <TabsTrigger value="jira">
              Compare with Jira
              {recon.data && recon.data.summary.errors + recon.data.summary.warnings > 0 && <span className="ml-1 rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">{recon.data.summary.errors + recon.data.summary.warnings}</span>}
            </TabsTrigger>
            <TabsTrigger value="raw">Raw preview</TabsTrigger>
            <TabsTrigger value="parsed">Parsed records</TabsTrigger>
          </TabsList>
          <TabsContent value="jira" className="space-y-3">
            {!jiraReady ? (
              <EmptyState title="Jira not connected" description="Configure credentials in .env and add a board link under Jira Connections to compare this workbook with live Jira." />
            ) : recon.isLoading ? (
              <LoadingState rows={1} />
            ) : recon.isError ? (
              <ErrorState error={recon.error} onRetry={() => recon.refetch()} />
            ) : recon.data ? (
              <>
                <ReconSummaryCards summary={recon.data.summary} onSync={() => syncMut.mutate()} syncing={syncMut.isPending} />
                <ReconciliationTable items={recon.data.items} hideEmployee onTicket={setTicket} pageSize={25} />
                <TicketDialog ticketId={ticket} onClose={() => setTicket(null)} />
              </>
            ) : null}
          </TabsContent>
          <TabsContent value="validation" className="space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <Label>Worksheet</Label>
              <NativeSelect className="w-auto" value={sheet ?? ''} onChange={(e) => setSheet(e.target.value || undefined)}>
                {(preview.data?.sheets ?? [file.sheet_name ?? '']).map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </NativeSelect>
              {v && (
                <Badge variant={v.valid ? 'success' : 'danger'} className="gap-1">
                  {v.valid ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                  {v.valid ? 'Valid' : 'Problems found'} | layout: {v.layout} | {v.work_items} work items | {v.releases} releases
                </Badge>
              )}
            </div>
            {v?.work_mapping && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Column mapping (header row {v.work_mapping.header_row})</p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {v.canonical_fields.work_items.filter((f) => ['ticket_id', 'ticket_link', 'work_details', 'work_type', 'work_status', 'prod_required', 'dev_deployment', 'comments', 'application', 'date', 'employee', 'project', 'environment'].includes(f)).map((f) => {
                    const mapped = v.work_mapping!.fields[f]
                    const required = ['ticket_id', 'work_status'].includes(f)
                    return (
                      <div key={f} className={cn('flex items-center justify-between gap-2 rounded border p-2 text-xs', required && !mapped && 'border-red-400 bg-red-50 dark:bg-red-950/30')}>
                        <span className="font-medium">{f.replace(/_/g, ' ')}{required && <span className="text-red-500"> *</span>}</span>
                        <NativeSelect className="h-7 w-[55%] text-xs" value={overrides[f] ?? mapped?.header ?? ''} onChange={(e) => setOverrides((o) => ({ ...o, [f]: e.target.value }))}>
                          <option value="">- not mapped -</option>
                          {(headers ?? []).map((h) => (
                            <option key={h} value={h}>{h}</option>
                          ))}
                        </NativeSelect>
                      </div>
                    )
                  })}
                </div>
                {v.work_mapping.unmapped_headers.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Unmapped headers: {v.work_mapping.unmapped_headers.join(', ')}</p>}
                {Object.keys(overrides).length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <Badge variant="info">Preview with overrides: {v.work_items} work items detected</Badge>
                    <Button size="xs" variant="outline" onClick={() => { navigator.clipboard?.writeText(JSON.stringify({ work_items: overrides }, null, 2)); toast({ title: 'Mapping copied', description: 'Overrides are applied to this preview; persistent per-file overrides can be passed to POST /excel/validate.' }) }}><Copy /> Copy mapping JSON</Button>
                    <Button size="xs" variant="ghost" onClick={() => setOverrides({})}>Reset</Button>
                  </div>
                )}
              </div>
            )}
            {v && (v.errors.length > 0 || v.warnings.length > 0) && (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Validation messages</p>
                <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                  {[...v.errors, ...v.warnings].map((i, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <Badge variant={i.severity === 'error' ? 'danger' : i.severity === 'warning' ? 'warning' : 'muted'} className="shrink-0">{String(i.severity)}</Badge>
                      <span>{String(i.message)}{i.row ? ` (row ${String(i.row)})` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {detail.data?.metadata?.notes?.length ? (
              <div>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Additional work notes</p>
                {detail.data.metadata.notes.map((n, i) => <p key={i} className="whitespace-pre-wrap text-xs">{n}</p>)}
              </div>
            ) : null}
          </TabsContent>
          <TabsContent value="raw">
            {preview.isLoading && <LoadingState rows={1} />}
            {preview.data && (
              <div className="max-h-[55vh] overflow-auto rounded border">
                <table className="text-[11px]">
                  <tbody>
                    {preview.data.rows.map((r, i) => (
                      <tr key={i} className={cn('border-b', i + 1 === v?.work_mapping?.header_row && 'bg-primary/10 font-semibold')}>
                        <td className="sticky left-0 bg-muted px-2 py-1 text-right text-muted-foreground">{i + 1}</td>
                        {r.map((c, j) => (
                          <td key={j} className="max-w-[220px] truncate border-l px-2 py-1" title={c === null ? '' : String(c)}>{c === null ? '' : String(c)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="p-2 text-xs text-muted-foreground">Showing first {preview.data.rows.length} of {preview.data.total_rows} rows | {preview.data.total_columns} columns</p>
              </div>
            )}
          </TabsContent>
          <TabsContent value="parsed">
            {detail.data && (
              <div className="max-h-[55vh] space-y-3 overflow-auto text-xs">
                <p className="font-semibold">Work items ({detail.data.work_items.length})</p>
                <RecordTable rows={detail.data.work_items} keys={['source_row', 'application', 'ticket_id', 'ticket_ids', 'work_details', 'work_type', 'work_status', 'prod_required', 'dev_deployment', 'comments']} />
                <p className="font-semibold">Production releases ({detail.data.releases.length})</p>
                <RecordTable rows={detail.data.releases} keys={['source_row', 'application', 'release_tickets', 'release_details', 'release_date', 'prod_deployment']} />
                {detail.data.kt_items.length > 0 && (
                  <>
                    <p className="font-semibold">Knowledge transfer ({detail.data.kt_items.length})</p>
                    <RecordTable rows={detail.data.kt_items} keys={['source_row', 'topic', 'start_date', 'end_date', 'status', 'notes']} />
                  </>
                )}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

function RecordTable({ rows, keys }: { rows: Record<string, unknown>[]; keys: string[] }) {
  if (!rows.length) return <p className="text-muted-foreground">none</p>
  return (
    <div className="overflow-auto rounded border">
      <table className="w-full">
        <thead className="bg-muted">
          <tr>{keys.map((k) => <th key={k} className="px-2 py-1 text-left font-medium">{k}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t">
              {keys.map((k) => <td key={k} className="max-w-[260px] truncate px-2 py-1" title={String(r[k] ?? '')}>{Array.isArray(r[k]) ? (r[k] as unknown[]).join(', ') : String(r[k] ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
