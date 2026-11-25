import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Plus, RotateCcw, SlidersHorizontal, X } from 'lucide-react'
import { PageHeader } from '@/components/common/PageHeader'
import { ErrorState, LoadingState } from '@/components/common/States'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
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
  const unmappedTotal = useMemo(() => Object.values(cfg?.unmapped ?? {}).reduce((s, v) => s + Object.keys(v).length, 0), [cfg])

  return (
    <>
      <PageHeader
        title="Status Configuration"
        description="Map the free-text values found in Excel to standard reporting categories. Original values are always preserved; only the classification changes."
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4" /> Ticket latest-status rule</CardTitle>
                <CardDescription>When the same Jira ticket appears in several bi-weekly reports, this decides which status represents the ticket in unique-ticket KPIs.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(cfg.latest_status_rules).map(([k, desc]) => (
                  <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${cfg.latest_status_rule === k ? 'border-primary bg-primary/5' : ''}`}>
                    <input type="radio" name="rule" className="mt-1" checked={cfg.latest_status_rule === k} onChange={() => update.mutate({ latest_status_rule: k })} />
                    <span>
                      <p className="font-medium">{k === 'latest_report' ? 'Latest report date wins' : 'Most advanced status wins'}</p>
                      <p className="text-xs text-muted-foreground">{desc}</p>
                    </span>
                  </label>
                ))}
                <div className="flex items-center gap-3 pt-2 text-sm">
                  <Label>Blank Work Status counts as</Label>
                  <NativeSelect className="w-auto" value={cfg.count_blank_status_as} onChange={(e) => update.mutate({ count_blank_status_as: e.target.value })}>
                    {Object.entries(cfg.categories.work_status).map(([k, m]) => (
                      <option key={k} value={k}>{m.label}</option>
                    ))}
                  </NativeSelect>
                </div>
              </CardContent>
            </Card>
            <Card className={unmappedTotal ? 'border-orange-300' : ''}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><AlertTriangle className={`h-4 w-4 ${unmappedTotal ? 'text-orange-500' : 'text-green-600'}`} /> Unmapped values in current data ({unmappedTotal})</CardTitle>
                <CardDescription>Values seen in the workbooks that are not mapped. They currently count as "Other / Unmapped" - never as completed, pending or successful. Choose a category to map each one.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {unmappedTotal === 0 && <p className="text-sm text-muted-foreground">All values in the loaded workbooks are mapped.</p>}
                {Object.entries(cfg.unmapped).flatMap(([dim, vals]) =>
                  Object.entries(vals).map(([value, count]) => (
                    <div key={`${dim}:${value}`} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                      <Badge variant="outline">{DIMENSIONS.find((d) => d.key === dim)?.label ?? dim}</Badge>
                      <span className="font-mono">"{value}"</span>
                      <span className="text-xs text-muted-foreground">x{count}</span>
                      <NativeSelect className="ml-auto h-8 w-auto text-xs" defaultValue="" onChange={(e) => e.target.value && add.mutate({ d: dim, c: e.target.value, v: value })}>
                        <option value="">Map to</option>
                        {Object.entries(cfg.categories[dim]).filter(([k]) => k !== 'other').map(([k, m]) => (
                          <option key={k} value={k}>{m.label}</option>
                        ))}
                      </NativeSelect>
                    </div>
                  )),
                )}
              </CardContent>
            </Card>
          </div>

          <Tabs defaultValue="work_status">
            <TabsList>
              {DIMENSIONS.map((d) => (
                <TabsTrigger key={d.key} value={d.key}>{d.label}</TabsTrigger>
              ))}
            </TabsList>
            {DIMENSIONS.map((d) => (
              <TabsContent key={d.key} value={d.key}>
                <Card>
                  <CardHeader>
                    <CardTitle>{d.label}</CardTitle>
                    <CardDescription>{d.desc} Matching is case-insensitive and ignores punctuation; a value also matches if it contains a mapped phrase (e.g. "Completed - QA" to Completed).</CardDescription>
                  </CardHeader>
                  <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {Object.entries(cfg.categories[d.key])
                      .sort((a, b) => a[1].order - b[1].order)
                      .filter(([k]) => k !== 'other')
                      .map(([cat, meta]) => {
                        const values = cfg.mappings[d.key]?.[cat] ?? []
                        const inputKey = `${d.key}:${cat}`
                        return (
                          <div key={cat} className="rounded-md border p-3">
                            <div className="mb-2 flex items-center justify-between">
                              <StatusBadge color={meta.color}>{meta.label}</StatusBadge>
                              <span className="text-xs text-muted-foreground">{values.length} value{values.length === 1 ? '' : 's'}</span>
                            </div>
                            <div className="mb-2 flex flex-wrap gap-1">
                              {values.map((v) => (
                                <Badge key={v} variant="secondary" className="gap-1 pr-1 font-normal">
                                  {v}
                                  <button className="rounded-sm p-0.5 hover:bg-background" onClick={() => add.mutate({ d: d.key, c: 'other', v })} aria-label={`Unmap ${v}`}>
                                    <X className="h-3 w-3" />
                                  </button>
                                </Badge>
                              ))}
                            </div>
                            <form
                              className="flex gap-1"
                              onSubmit={(e) => {
                                e.preventDefault()
                                const v = (newValue[inputKey] ?? '').trim()
                                if (v) {
                                  add.mutate({ d: d.key, c: cat, v })
                                  setNewValue((s) => ({ ...s, [inputKey]: '' }))
                                }
                              }}
                            >
                              <Input value={newValue[inputKey] ?? ''} onChange={(e) => setNewValue((s) => ({ ...s, [inputKey]: e.target.value }))} placeholder="Add Excel value" className="h-7 text-xs" />
                              <Button type="submit" size="xs" variant="outline"><Plus /></Button>
                            </form>
                          </div>
                        )
                      })}
                  </CardContent>
                </Card>
              </TabsContent>
            ))}
          </Tabs>
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
