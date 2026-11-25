import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, CheckCircle2, Layers, Plus, RotateCcw, SlidersHorizontal, Tags, X } from 'lucide-react'
import type { ColumnDef } from '@tanstack/react-table'
import { DataTable } from '@/components/common/DataTable'
import { Notice, OptionTile, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { colorFor } from '@/lib/utils'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { configApi, errorMessage } from '@/services/api'

const DIMENSIONS: { key: string; label: string; desc: string }[] = [
  { key: 'work_status', label: 'Work / Jira status', desc: 'Values from the "Work Status" column. Drives Completed / In Progress / Blocked ... ticket counts.' },
  { key: 'work_type', label: 'Work type', desc: 'Values from "Work Type". Drives Development / Analysis / Testing activity counts.' },
  { key: 'dev_deployment', label: 'Dev deployment status', desc: 'Values from "Dev Deployment Status".' },
  { key: 'prod_deployment', label: 'Production deployment status', desc: 'Values from the Production Deployment Summary table.' },
  { key: 'prod_required', label: 'Production required / In Production', desc: 'Values from "Production Deployment Required?".' },
  { key: 'jira_dev_deployment', label: 'Jira status to Dev deployment', desc: 'Used when Jira is the data source: which workflow statuses mean the work has reached a dev/test environment.' },
  { key: 'jira_prod_deployment', label: 'Jira status to Production', desc: 'Used when Jira is the data source and the issue has no fixVersion: which statuses mean released / pending in production.' },
]

export default function StatusConfigPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const q = useQuery({ queryKey: ['config', 'status'], queryFn: configApi.get })
  const [confirmReset, setConfirmReset] = useState(false)
  const [newValue, setNewValue] = useState<Record<string, string>>({})

  const refresh = () => qc.invalidateQueries()
  const add = useMutation({ mutationFn: ({ d, c, v }: { d: string; c: string; v: string }) => configApi.addMapping(d, c, v), onSuccess: () => { refresh(); toast({ title: 'Mapping saved', description: 'All dashboards have been recalculated.', variant: 'success' }) }, onError: (e) => toast({ title: 'Failed', description: errorMessage(e), variant: 'destructive' }) })
  const update = useMutation({ mutationFn: configApi.update, onSuccess: () => { refresh(); toast({ title: 'Configuration saved', variant: 'success' }) }, onError: (e) => toast({ title: 'Failed', description: errorMessage(e), variant: 'destructive' }) })
  const reset = useMutation({ mutationFn: configApi.reset, onSuccess: () => { refresh(); setConfirmReset(false); toast({ title: 'Defaults restored' }) } })

  const cfg = q.data
  const unmappedRows = useMemo(() => Object.entries(cfg?.unmapped ?? {}).flatMap(([dim, vals]) => Object.entries(vals).map(([value, count]) => ({ dim, dimLabel: DIMENSIONS.find((d) => d.key === dim)?.label ?? dim, value, count }))), [cfg])
  const unmappedTotal = unmappedRows.length
  const mappedTotal = useMemo(() => Object.values(cfg?.mappings ?? {}).reduce((s, cats) => s + Object.values(cats).reduce((t, v) => t + v.length, 0), 0), [cfg])
  const unmappedCols = useMemo<ColumnDef<(typeof unmappedRows)[number], unknown>[]>(() => [
    { accessorKey: 'dimLabel', header: 'Dimension', cell: ({ getValue }) => <Badge variant="outline">{String(getValue())}</Badge> },
    { accessorKey: 'value', header: 'Source value', cell: ({ getValue }) => <span className="font-mono text-xs">{String(getValue())}</span> },
    { accessorKey: 'count', header: 'Rows', meta: { align: 'right' }, cell: ({ getValue }) => <span className="font-semibold tabular-nums">{getValue() as number}</span> },
    {
      id: 'map', header: 'Map to category', enableSorting: false,
      cell: ({ row }) => (
        <NativeSelect className="h-8 w-full max-w-[260px] text-xs" defaultValue="" onChange={(e) => e.target.value && add.mutate({ d: row.original.dim, c: e.target.value, v: row.original.value })}>
          <option value="">Choose a category</option>
          {Object.entries(cfg!.categories[row.original.dim]).filter(([k]) => k !== 'other').map(([k, m]) => (
            <option key={k} value={k}>{m.label}</option>
          ))}
        </NativeSelect>
      ),
    },
  ], [cfg, add])

  return (
    <>
      <PageHeader
        title="Status Configuration"
        description="Map the free-text status values found in the source data to the standard reporting categories used across every dashboard. Original values are always kept; only the classification changes."
        breadcrumbs={[{ label: 'Status Configuration' }]}
        actions={
          <Button variant="outline" size="sm" onClick={() => setConfirmReset(true)}>
            <RotateCcw /> Restore defaults
          </Button>
        }
      />
      {q.isLoading && <LoadingState />}
      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {cfg && (
        <>
          <StatStrip cols={4}>
            <StatTile icon={Layers} label="Dimensions" value={DIMENSIONS.length} sub="status families configured" tone="blue" />
            <StatTile icon={Tags} label="Mapped values" value={mappedTotal} sub="source values with a category" tone="green" />
            <StatTile icon={AlertTriangle} label="Unmapped values" value={unmappedTotal} sub={unmappedTotal ? 'counted as Other until mapped' : 'everything is classified'} tone={unmappedTotal ? 'orange' : 'green'} />
            <StatTile icon={SlidersHorizontal} label="Latest-status rule" value={cfg.latest_status_rule === 'latest_report' ? 'Latest report' : 'Most advanced'} sub="for tickets seen in several reports" tone="grey" />
          </StatStrip>

          <div className="grid gap-4 lg:grid-cols-2">
            <SettingsCard icon={SlidersHorizontal} title="Ticket latest-status rule" description="When the same ticket appears in several reports, this decides which status counts in unique-ticket KPIs.">
              <div className="space-y-2">
                {Object.entries(cfg.latest_status_rules).map(([k, desc]) => (
                  <OptionTile key={k} title={k === 'latest_report' ? 'Latest report date wins' : 'Most advanced status wins'} description={desc} active={cfg.latest_status_rule === k} onClick={() => update.mutate({ latest_status_rule: k })} />
                ))}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 p-3 text-sm">
                  <div>
                    <p className="font-medium">Blank status counts as</p>
                    <p className="text-[11px] text-muted-foreground">Used when a work row has no status at all.</p>
                  </div>
                  <NativeSelect className="h-8 w-auto text-xs" value={cfg.count_blank_status_as} onChange={(e) => update.mutate({ count_blank_status_as: e.target.value })}>
                    {Object.entries(cfg.categories.work_status).map(([k, m]) => (
                      <option key={k} value={k}>{m.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              </div>
            </SettingsCard>
            <SettingsCard icon={AlertTriangle} tone={unmappedTotal ? 'warning' : 'default'} title={`Unmapped values (${unmappedTotal})`} description="Values seen in the data without a category. They count as Other / Unmapped - never as completed, pending or successful - until you map them.">
              {unmappedTotal === 0 ? (
                <Notice tone="success" icon={CheckCircle2}>All status values in the loaded data are classified.</Notice>
              ) : (
                <DataTable data={unmappedRows} columns={unmappedCols} dense pageSize={8} searchPlaceholder="Search value" exportName="unmapped-statuses" initialSorting={[{ id: 'count', desc: true }]} />
              )}
            </SettingsCard>
          </div>

          <SettingsCard icon={Tags} title="Category mappings" description="Which source values belong to each category. Matching is case-insensitive, ignores punctuation, and a value also matches if it contains a mapped phrase (for example 'Completed - QA' matches Completed).">
            <Tabs defaultValue="work_status">
              <TabsList className="mb-3 flex-wrap">
                {DIMENSIONS.map((d) => (
                  <TabsTrigger key={d.key} value={d.key}>{d.label}</TabsTrigger>
                ))}
              </TabsList>
              {DIMENSIONS.map((d) => (
                <TabsContent key={d.key} value={d.key} className="space-y-3">
                  <p className="text-xs text-muted-foreground">{d.desc}</p>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(cfg.categories[d.key])
                      .sort((a, b) => a[1].order - b[1].order)
                      .filter(([k]) => k !== 'other')
                      .map(([cat, meta]) => {
                        const values = cfg.mappings[d.key]?.[cat] ?? []
                        const inputKey = `${d.key}:${cat}`
                        return (
                          <div key={cat} className="flex flex-col overflow-hidden rounded-lg border">
                            <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-3 py-2">
                              <span className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(meta.color) }} /><span className="text-sm font-medium">{meta.label}</span></span>
                              <span className="text-[11px] text-muted-foreground">{values.length} value{values.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="flex flex-1 flex-col gap-2 p-3">
                              <div className="flex min-h-[28px] flex-wrap gap-1">
                                {values.length === 0 && <span className="text-[11px] italic text-muted-foreground">No source values yet</span>}
                                {values.map((v) => (
                                  <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
                                    {v}
                                    <button className="rounded-sm p-0.5 hover:bg-background" onClick={() => add.mutate({ d: d.key, c: 'other', v })} aria-label={`Unmap ${v}`} title="Remove from this category">
                                      <X className="h-3 w-3" />
                                    </button>
                                  </Badge>
                                ))}
                              </div>
                              <form
                                className="mt-auto flex gap-1"
                                onSubmit={(e) => {
                                  e.preventDefault()
                                  const v = (newValue[inputKey] ?? '').trim()
                                  if (v) {
                                    add.mutate({ d: d.key, c: cat, v })
                                    setNewValue((s) => ({ ...s, [inputKey]: '' }))
                                  }
                                }}
                              >
                                <Input value={newValue[inputKey] ?? ''} onChange={(e) => setNewValue((s) => ({ ...s, [inputKey]: e.target.value }))} placeholder="Add a source value" className="h-7 text-xs" />
                                <Button type="submit" size="xs" variant="outline" title="Add"><Plus /></Button>
                              </form>
                            </div>
                          </div>
                        )
                      })}
                  </div>
                </TabsContent>
              ))}
            </Tabs>
          </SettingsCard>
        </>
      )}
      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Restore default status mappings?</DialogTitle>
            <DialogDescription>All custom mappings and the latest-status rule will be reset. Dashboards are recalculated immediately.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmReset(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => reset.mutate()}>Restore defaults</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
