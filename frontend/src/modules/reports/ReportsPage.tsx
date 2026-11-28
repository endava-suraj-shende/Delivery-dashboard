import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { BarChart3, Briefcase, Building2, CheckCircle2, Clock, Download, FileSpreadsheet, FileText, FileType, FolderKanban, Kanban, Loader2, Rocket, ServerCog, Ticket, User, Users, type LucideIcon } from 'lucide-react'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { MultiSelect } from '@/components/common/MultiSelect'
import { DataTable } from '@/components/common/DataTable'
import { ScheduledDigests } from '@/modules/reports/ScheduledDigests'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { useDimensions } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { errorMessage, filtersBodyFromQuery, reportApi } from '@/services/api'
import { cn, fileSize, fmtDate } from '@/lib/utils'
import { FEATURES } from '@/lib/features'
import type { ReportInfo } from '@/types'

type Fmt = 'pdf' | 'xlsx' | 'csv'

const FORMATS: { key: Fmt; label: string; icon: LucideIcon; desc: string; tone: string }[] = [
  { key: 'pdf', label: 'PDF', icon: FileText, desc: 'Printable management document: key figures, distributions, colour-coded tables and notes.', tone: 'text-red-600 bg-red-500/10' },
  { key: 'xlsx', label: 'Excel', icon: FileSpreadsheet, desc: 'Multi-sheet workbook with filters, frozen headers and status colouring for further analysis.', tone: 'text-green-700 bg-green-500/10' },
  { key: 'csv', label: 'CSV', icon: FileType, desc: 'Flat export of the main detail table for the chosen report.', tone: 'text-blue-700 bg-blue-500/10' },
]

/** Per report type: icon, audience/purpose and the sections the PDF contains (in order). */
const TYPE_META: Record<string, { icon: LucideIcon; group: 'People' | 'Delivery' | 'Deployments' | 'Management'; desc: string; sections: string[] }> = {
  employee: { icon: User, group: 'People', desc: 'Everything about one person: tickets, status, deployments, work items and notes.', sections: ['Employee details', 'Key figures', 'Distribution', 'Jira tickets', 'Dev deployment detail', 'Production releases', 'Work items', 'Additional work notes'] },
  all_employees: { icon: Users, group: 'People', desc: 'Every person in the current filters with per-person performance.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Project-wise performance', 'Jira tickets', 'Work items'] },
  team: { icon: Users, group: 'People', desc: 'Team view with people, projects, observations and releases.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Project-wise performance', 'Observations', 'Jira tickets', 'Production releases', 'Work items'] },
  project: { icon: FolderKanban, group: 'Delivery', desc: 'One project: who works on it, ticket status, deployments and releases.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Jira tickets', 'Dev deployment detail', 'Production releases', 'Work items'] },
  application: { icon: Building2, group: 'Delivery', desc: 'One application across projects and people.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Jira tickets'] },
  jira_board: { icon: Kanban, group: 'Delivery', desc: 'One Jira board: people, status mix and tickets.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Project-wise performance', 'Jira tickets'] },
  jira_status: { icon: Ticket, group: 'Delivery', desc: 'Latest status of every ticket in the period.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Jira tickets'] },
  dev_deployment: { icon: ServerCog, group: 'Deployments', desc: 'Dev deployment status of every work item.', sections: ['Key figures', 'Distribution', 'Dev deployment detail'] },
  prod_deployment: { icon: Rocket, group: 'Deployments', desc: 'Production release records with status and details.', sections: ['Key figures', 'Distribution', 'Production releases'] },
  management: { icon: BarChart3, group: 'Management', desc: 'Complete consolidated pack for leadership: everything above plus data quality.', sections: ['Key figures', 'Distribution', 'Employee-wise performance', 'Project-wise performance', 'Observations', 'Jira tickets', 'Dev deployment detail', 'Production releases', 'Work items', 'Data quality', 'Calculation rules'] },
}
const GROUPS = ['Management', 'People', 'Delivery', 'Deployments'] as const

function Step({ n, title, hint, done }: { n: number; title: string; hint?: string; done?: boolean }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className={cn('flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-semibold', done ? 'bg-green-500 text-white' : 'bg-primary text-primary-foreground')}>{done ? <CheckCircle2 className="h-3.5 w-3.5" /> : n}</span>
      <span className="text-sm font-semibold">{title}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export default function ReportsPage() {
  const [sp] = useSearchParams()
  const { queryString, effectiveRange, activeChips } = useFilters()
  const { data: dims } = useDimensions()
  const { toast } = useToast()
  const qc = useQueryClient()
  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: reportApi.types, staleTime: Infinity })
  const history = useQuery({ queryKey: ['reports', 'list'], queryFn: reportApi.list })

  const [type, setType] = useState(sp.get('type') ?? 'management')
  const [format, setFormat] = useState<Fmt>('pdf')
  const [target, setTarget] = useState<string>(sp.get('target') ?? '')
  useEffect(() => {
    if (sp.get('type')) setType(sp.get('type')!)
    if (sp.get('target')) setTarget(sp.get('target')!)
  }, [sp])

  const items = (types.data?.items ?? []).filter((t) => FEATURES.applications || t.key !== 'application')
  const selected = items.find((t) => t.key === type)
  const meta = TYPE_META[type]
  const targetLabel = type === 'jira_board' ? 'Board' : type === 'employee' ? 'Employee' : type === 'project' ? 'Project' : 'Application'
  const targetOptions = useMemo(() => {
    const src = type === 'employee' ? dims?.employees : type === 'project' ? dims?.projects : type === 'application' ? dims?.applications : type === 'jira_board' ? dims?.jira_boards : []
    return (src ?? []).map((v) => ({ value: v, label: v }))
  }, [type, dims])

  const gen = useMutation({
    mutationFn: () => reportApi.generate({ report_type: type, format, target: selected?.requires_target ? target : null, filters: filtersBodyFromQuery(queryString) }),
    onSuccess: (info) => {
      qc.invalidateQueries({ queryKey: ['reports', 'list'] })
      toast({ title: 'Report ready', description: `${info.file_name} (${fileSize(info.size_bytes)})`, variant: 'success' })
      window.open(reportApi.downloadUrl(info.report_id), '_blank')
    },
    onError: (e) => toast({ title: 'Report generation failed', description: errorMessage(e), variant: 'destructive' }),
  })

  const needsTarget = !!selected?.requires_target
  const canGenerate = !!selected && (!needsTarget || !!target)
  const filterChips = activeChips.filter((c) => c.key !== 'search')

  const historyCols = useMemo<ColumnDef<ReportInfo, unknown>[]>(
    () => [
      { accessorKey: 'format', header: 'Format', cell: ({ getValue }) => { const f = FORMATS.find((x) => x.key === getValue()); const Icon = f?.icon ?? FileText; return <span className={cn('inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase', f?.tone)}><Icon className="h-3.5 w-3.5" />{String(getValue())}</span> } },
      { accessorKey: 'report_type', header: 'Report', cell: ({ row }) => { const M = TYPE_META[row.original.report_type]?.icon ?? FileText; return <span className="flex items-center gap-2 whitespace-nowrap font-medium"><M className="h-4 w-4 text-muted-foreground" />{items.find((t) => t.key === row.original.report_type)?.label ?? row.original.report_type}</span> } },
      { accessorKey: 'target', header: 'Scope', cell: ({ getValue }) => (getValue() ? <Badge variant="secondary">{String(getValue())}</Badge> : <span className="text-xs text-muted-foreground">Current filters</span>) },
      { accessorKey: 'period', header: 'Period', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{String(getValue() ?? '-')}</span> },
      { accessorKey: 'size_bytes', header: 'Size', meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums text-muted-foreground">{fileSize(getValue() as number)}</span> },
      { accessorKey: 'created_at', header: 'Generated', cell: ({ getValue }) => <span className="whitespace-nowrap text-muted-foreground">{fmtDate(getValue() as string)} {new Date(getValue() as string).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> },
      { id: 'dl', header: '', enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => <Button asChild variant="outline" size="sm"><a href={reportApi.downloadUrl(row.original.report_id)} target="_blank" rel="noreferrer"><Download /> Download</a></Button> },
    ],
    [items],
  )

  return (
    <>
      <PageHeader title="Report Center" description="Build a report in three steps. The current date range and global filters are applied; source data is never modified." breadcrumbs={[{ label: 'Report Center' }]} />
      <GlobalFilterBar />
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card>
            <CardContent className="p-5">
              <Step n={1} title="Choose a report" done={!!selected} />
              <div className="space-y-3">
                {GROUPS.map((g) => {
                  const list = items.filter((t) => TYPE_META[t.key]?.group === g)
                  if (!list.length) return null
                  return (
                    <div key={g}>
                      <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g}</p>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {list.map((t) => {
                          const m = TYPE_META[t.key]
                          const Icon = m?.icon ?? FileText
                          const active = type === t.key
                          return (
                            <button key={t.key} onClick={() => { setType(t.key); if (!t.requires_target) setTarget('') }} className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40', active && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                              <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground')}><Icon className="h-4 w-4" /></span>
                              <span className="min-w-0">
                                <p className="text-sm font-medium leading-5">{t.label}</p>
                                <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{m?.desc}</p>
                                <p className="mt-1 text-[10px] font-medium text-muted-foreground">{t.requires_target ? 'Needs a selection' : 'Uses current filters'}</p>
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {needsTarget && (
            <Card>
              <CardContent className="p-5">
                <Step n={2} title={`Select the ${targetLabel.toLowerCase()}`} hint="Only one can be chosen per report" done={!!target} />
                <MultiSelect label={targetLabel} options={targetOptions} value={target ? [target] : []} onChange={(v) => setTarget(v[v.length - 1] ?? '')} width="w-full sm:w-[360px]" placeholder="Choose" single />
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="p-5">
              <Step n={needsTarget ? 3 : 2} title="Choose a format" done />
              <div className="grid gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => {
                  const Icon = f.icon
                  const active = format === f.key
                  return (
                    <button key={f.key} onClick={() => setFormat(f.key)} className={cn('flex items-start gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/40', active && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                      <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md', f.tone)}><Icon className="h-4 w-4" /></span>
                      <span>
                        <p className="text-sm font-medium leading-5">{f.label}</p>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{f.desc}</p>
                      </span>
                    </button>
                  )
                })}
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader className="pb-3">
            <CardTitle>Report summary</CardTitle>
            <CardDescription>Check the scope, then generate.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <dl className="space-y-2 text-sm">
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Report</dt><dd className="text-right font-medium">{selected?.label ?? '-'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Scope</dt><dd className="text-right font-medium">{needsTarget ? (target || <span className="text-orange-600">Select a {targetLabel.toLowerCase()}</span>) : 'Current filters'}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Period</dt><dd className="text-right font-medium tabular-nums">{fmtDate(effectiveRange[0])} - {fmtDate(effectiveRange[1])}</dd></div>
              <div className="flex items-start justify-between gap-3"><dt className="text-muted-foreground">Format</dt><dd className="text-right font-medium uppercase">{format}</dd></div>
            </dl>
            {filterChips.length > 0 && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Filters applied</p>
                <div className="flex flex-wrap gap-1">{filterChips.map((c) => <Badge key={`${c.key}:${c.value}`} variant="secondary"><span className="text-muted-foreground">{c.label}:</span>&nbsp;{c.value}</Badge>)}</div>
              </div>
            )}
            {meta && format === 'pdf' && (
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Sections in this PDF</p>
                <ol className="space-y-1 text-xs">
                  {meta.sections.map((sct, i) => <li key={sct} className="flex items-center gap-2"><span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-semibold text-muted-foreground">{i + 1}</span>{sct}</li>)}
                </ol>
              </div>
            )}
            {format === 'xlsx' && <p className="text-xs text-muted-foreground">Sheets: Executive Summary, Employee Summary, Project Summary, Jira Ticket Details, Development Deployment, Production Deployment, Work Items, Data Quality.</p>}
            {format === 'csv' && <p className="text-xs text-muted-foreground">One flat table: releases for the production report, tickets for the Jira status report, people for team reports, otherwise work items.</p>}
            <Button onClick={() => gen.mutate()} disabled={!canGenerate || gen.isPending} size="lg" className="w-full">
              {gen.isPending ? <Loader2 className="animate-spin" /> : <Download />} {gen.isPending ? 'Generating' : `Generate ${format.toUpperCase()}`}
            </Button>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Clock className="h-3 w-3" /> Large reports can take 10-20 seconds. The file opens in a new tab when ready.</p>
          </CardContent>
        </Card>
      </div>

      <ScheduledDigests />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Briefcase className="h-4 w-4" /> Recent reports</CardTitle>
          <CardDescription>Generated files are kept locally (last 50). Click Download to open one again.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable data={history.data ?? []} columns={historyCols} dense pageSize={10} exportName="reports" searchPlaceholder="Search reports" initialSorting={[{ id: 'created_at', desc: true }]} emptyTitle="No reports generated yet" emptyDescription="Build one above; it will appear here for re-download." />
        </CardContent>
      </Card>
    </>
  )
}
