import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Download, FileOutput, FileSpreadsheet, FileText, FileType, Loader2 } from 'lucide-react'
import { GlobalFilterBar, PageHeader } from '@/components/common/PageHeader'
import { MultiSelect } from '@/components/common/MultiSelect'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label, NativeSelect } from '@/components/ui/input'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/common/States'
import { useDimensions } from '@/hooks/useData'
import { useFilters } from '@/hooks/useFilters'
import { errorMessage, filtersBodyFromQuery, reportApi } from '@/services/api'
import { cn, fileSize } from '@/lib/utils'
import { FEATURES } from '@/lib/features'

const FORMATS = [
  { key: 'pdf', label: 'PDF', icon: FileText, desc: 'Printable management document with KPIs, distributions, tables and notes.' },
  { key: 'xlsx', label: 'Excel', icon: FileSpreadsheet, desc: 'Multi-sheet workbook: summary, employees, projects, tickets, deployments, work items, data quality.' },
  { key: 'csv', label: 'CSV', icon: FileType, desc: 'Flat export of the primary detail table for the chosen report.' },
] as const

export default function ReportsPage() {
  const [sp] = useSearchParams()
  const { queryString, effectiveRange } = useFilters()
  const { data: dims } = useDimensions()
  const { toast } = useToast()
  const qc = useQueryClient()
  const types = useQuery({ queryKey: ['reports', 'types'], queryFn: reportApi.types, staleTime: Infinity })
  const history = useQuery({ queryKey: ['reports', 'list'], queryFn: reportApi.list })

  const [type, setType] = useState(sp.get('type') ?? 'management')
  const [format, setFormat] = useState<'pdf' | 'xlsx' | 'csv'>('pdf')
  const [target, setTarget] = useState<string>(sp.get('target') ?? '')
  useEffect(() => {
    if (sp.get('type')) setType(sp.get('type')!)
    if (sp.get('target')) setTarget(sp.get('target')!)
  }, [sp])

  const selected = types.data?.items.find((t) => t.key === type)
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

  const canGenerate = !!selected && (!selected.requires_target || !!target)

  return (
    <>
      <PageHeader title="Report Center" description="Generate downloadable PDF, Excel and CSV reports. The current global filters and date range are applied; the source workbooks are never modified." breadcrumbs={[{ label: 'Report Center' }]} />
      <GlobalFilterBar />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileOutput className="h-4 w-4" /> New report
            </CardTitle>
            <CardDescription>
              Period: <b>{effectiveRange[0]} - {effectiveRange[1]}</b>. Change it using the date selector above.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div>
              <Label>1. Report type</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {(types.data?.items ?? []).filter((t) => FEATURES.applications || t.key !== 'application').map((t) => (
                  <button key={t.key} onClick={() => { setType(t.key); if (!t.requires_target) setTarget('') }} className={cn('rounded-md border p-3 text-left text-sm transition hover:border-primary/50', type === t.key && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                    <p className="font-medium">{t.label}</p>
                    <p className="text-[11px] text-muted-foreground">{t.requires_target ? 'Requires a selection' : 'Uses current filters'}</p>
                  </button>
                ))}
              </div>
            </div>
            {selected?.requires_target && (
              <div>
                <Label>2. Select {type.replace('_', ' ')}</Label>
                <div className="mt-2 flex items-center gap-2">
                  <MultiSelect label={type === 'jira_board' ? 'Board' : type[0].toUpperCase() + type.slice(1)} options={targetOptions} value={target ? [target] : []} onChange={(v) => setTarget(v[v.length - 1] ?? '')} width="w-[320px]" placeholder="Choose" />
                  <NativeSelect className="w-auto sm:hidden" value={target} onChange={(e) => setTarget(e.target.value)}>
                    <option value="">Choose</option>
                    {targetOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            )}
            <div>
              <Label>{selected?.requires_target ? '3' : '2'}. Format</Label>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {FORMATS.map((f) => {
                  const Icon = f.icon
                  return (
                    <button key={f.key} onClick={() => setFormat(f.key)} className={cn('flex items-start gap-3 rounded-md border p-3 text-left text-sm transition hover:border-primary/50', format === f.key && 'border-primary bg-primary/5 ring-1 ring-primary')}>
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <span>
                        <p className="font-medium">{f.label}</p>
                        <p className="text-[11px] text-muted-foreground">{f.desc}</p>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
            <Button onClick={() => gen.mutate()} disabled={!canGenerate || gen.isPending} size="lg">
              {gen.isPending ? <Loader2 className="animate-spin" /> : <Download />} Generate & download {format.toUpperCase()}
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>What's included</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-xs text-muted-foreground">
            <div>
              <p className="font-medium text-foreground">Individual employee (PDF)</p>
              <p>Employee details, reporting period, KPI summary, Jira status distribution, deployment & production summaries, Jira tickets, dev deployment detail, production releases, work items table and Additional Work Notes.</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Consolidated management (PDF)</p>
              <p>Executive summary, team statistics, employee- and project-wise performance, Jira analytics, dev/analysis/testing breakdown, dev & production deployment summaries, blocked & pending work, insights, data-quality observations and calculation rules.</p>
            </div>
            <div>
              <p className="font-medium text-foreground">Excel workbook</p>
              <p>Sheets: Executive Summary, Employee Summary, Project Summary, Jira Ticket Details, Development Deployment, Production Deployment, Work Items, Data Quality - with filters, frozen headers and conditional formatting.</p>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Generated this session</CardTitle>
          <CardDescription>Reports are kept in the local data/reports folder (last {50} are retained).</CardDescription>
        </CardHeader>
        <CardContent>
          {!history.data?.length ? (
            <EmptyState title="No reports generated yet" />
          ) : (
            <div className="divide-y">
              {history.data.map((r) => (
                <div key={r.report_id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <Badge variant="secondary" className="uppercase">
                    {r.format}
                  </Badge>
                  <span className="font-medium">{r.file_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.report_type.replace('_', ' ')}
                    {r.target && ` | ${r.target}`} | {r.period} | {fileSize(r.size_bytes)} | {new Date(r.created_at).toLocaleTimeString()}
                  </span>
                  <Button asChild variant="outline" size="sm" className="ml-auto">
                    <a href={reportApi.downloadUrl(r.report_id)} target="_blank" rel="noreferrer">
                      <Download /> Download
                    </a>
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  )
}
