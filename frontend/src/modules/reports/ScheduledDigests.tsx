import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { CalendarClock, Eye, Mail, Pause, Play, Plus, Send, Trash2 } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { DataTable } from '@/components/common/DataTable'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { useFilters } from '@/hooks/useFilters'
import { errorMessage, reportApi, type ReportSchedule, type ScheduleBody, type SchedulePreview } from '@/services/api'
import { fmtDate } from '@/lib/utils'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const PRESET_LABEL: Record<string, string> = { last_7_days: 'Last 7 days', last_15_days: 'Last 15 days', last_30_days: 'Last 30 days', previous_week: 'Previous week', previous_month: 'Previous month' }

/** Recurring e-mail digests: narrative + anomaly flags + optional PDF/XLSX for the current board/project scope. */
export function ScheduledDigests() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const confirm = useConfirm()
  const { filters } = useFilters()
  const q = useQuery({ queryKey: ['reports', 'schedules'], queryFn: reportApi.schedules })
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState<SchedulePreview | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['reports', 'schedules'] })
  const onErr = (e: unknown) => toast({ title: 'Could not save', description: errorMessage(e), variant: 'destructive' })

  const scopeFilters = useMemo(() => {
    const f: Record<string, string[]> = {}
    if (filters.jira_board.length) f.jira_board = filters.jira_board
    if (filters.project.length) f.project = filters.project
    if (filters.employee.length) f.employee = filters.employee
    return f
  }, [filters])

  const create = useMutation({ mutationFn: reportApi.createSchedule, onSuccess: () => { refresh(); setOpen(false); toast({ title: 'Digest scheduled', variant: 'success' }) }, onError: onErr })
  const toggle = useMutation({ mutationFn: (s: ReportSchedule) => reportApi.updateSchedule(s.id, { active: !s.active }), onSuccess: refresh, onError: onErr })
  const remove = useMutation({ mutationFn: reportApi.deleteSchedule, onSuccess: () => { refresh(); toast({ title: 'Schedule deleted' }) }, onError: onErr })
  const sendNow = useMutation({ mutationFn: reportApi.sendScheduleNow, onSuccess: (r) => { refresh(); toast({ title: r.sent ? 'Digest sent' : 'Digest built but not sent', description: r.sent ? `To ${r.recipients.join(', ')}` : (r.reason ?? 'E-mail is not configured (EDD_RESEND_API_KEY)'), variant: r.sent ? 'success' : 'default' }) }, onError: onErr })
  const doPreview = useMutation({ mutationFn: reportApi.previewSchedule, onSuccess: setPreview, onError: onErr })

  const cols: ColumnDef<ReportSchedule>[] = [
    { accessorKey: 'name', header: 'Digest', cell: ({ row }) => <div><p className="font-medium">{row.original.name}</p><p className="text-[11px] text-muted-foreground">{Object.values(row.original.filters).flat().join(', ') || 'All boards'}{q.data?.items.some((s) => s.owner_id !== row.original.owner_id) && row.original.owner ? ` | ${row.original.owner.name}` : ''}</p></div> },
    { id: 'when', header: 'When', cell: ({ row }) => <span className="text-xs">{row.original.cadence === 'daily' ? 'Daily' : `${row.original.cadence === 'weekly' ? 'Weekly' : 'Fortnightly'}, ${WEEKDAYS[row.original.weekday]}`} {String(row.original.hour_utc).padStart(2, '0')}:00 UTC</span> },
    { id: 'content', header: 'Content', cell: ({ row }) => <span className="text-xs">{PRESET_LABEL[row.original.preset] ?? row.original.preset}{row.original.include_narrative ? ' | narrative' : ''}{row.original.format !== 'none' ? ` | ${row.original.format.toUpperCase()}` : ''}</span> },
    { accessorKey: 'recipients', header: 'Recipients', cell: ({ row }) => <span className="text-xs" title={row.original.recipients.join(', ')}>{row.original.recipients.length} recipient{row.original.recipients.length === 1 ? '' : 's'}</span> },
    { id: 'status', header: 'Status', cell: ({ row }) => <div className="text-xs"><Badge variant={row.original.active ? 'default' : 'secondary'} className="font-normal">{row.original.active ? 'Active' : 'Paused'}</Badge>{row.original.next_run_at && row.original.active && <p className="mt-1 text-muted-foreground">next {fmtDate(row.original.next_run_at)}</p>}{row.original.last_status && <p className="text-muted-foreground" title={row.original.last_status}>last: {row.original.last_status.slice(0, 40)}</p>}</div> },
    { id: 'actions', header: '', cell: ({ row }) => (
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" className="h-7 px-2" title="Preview" onClick={() => doPreview.mutate(row.original.id)}><Eye className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" title="Send now" onClick={async () => { if (await confirm({ title: `Send "${row.original.name}" now?`, description: `The digest is e-mailed to ${row.original.recipients.length} recipient(s) immediately.`, confirmLabel: 'Send' })) sendNow.mutate(row.original.id) }}><Send className="h-3.5 w-3.5" /></Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" title={row.original.active ? 'Pause' : 'Resume'} onClick={() => toggle.mutate(row.original)}>{row.original.active ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground hover:text-red-600" title="Delete" onClick={async () => { if (await confirm({ title: `Delete "${row.original.name}"?`, description: 'Recipients stop receiving this digest.', confirmLabel: 'Delete', destructive: true })) remove.mutate(row.original.id) }}><Trash2 className="h-3.5 w-3.5" /></Button>
      </div>
    ) },
  ]

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2"><CalendarClock className="h-4 w-4" /> Scheduled digests</CardTitle>
          <CardDescription>Automatic e-mails with the delivery narrative, anomaly flags and an optional report, built at send time for the chosen scope. {q.data && !q.data.email_enabled && <span className="text-amber-700">E-mail delivery is not configured (EDD_RESEND_API_KEY); digests are logged instead of sent.</span>}</CardDescription>
        </div>
        <Button size="sm" onClick={() => setOpen(true)}><Plus /> New digest</Button>
      </CardHeader>
      <CardContent>
        <DataTable data={q.data?.items ?? []} columns={cols} dense pageSize={10} emptyTitle="No digests yet" emptyDescription="Create one to send the management summary every week or fortnight." />
      </CardContent>

      <ScheduleDialog open={open} onOpenChange={setOpen} scope={scopeFilters} busy={create.isPending} onSubmit={(b) => create.mutate(b)} />

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4" /> {preview?.subject}</DialogTitle>
            <DialogDescription>To {preview?.recipients.join(', ')}{preview?.attachment ? ` | attachment ${preview.attachment}` : ''}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm leading-relaxed">
            {preview?.paragraphs.map((p, i) => <p key={i} className={i === 0 ? 'font-medium' : ''}>{p}</p>)}
            {!!preview?.flags.length && <ul className="list-disc space-y-1 pl-5 text-amber-800 dark:text-amber-200">{preview.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  )
}

function ScheduleDialog({ open, onOpenChange, scope, busy, onSubmit }: { open: boolean; onOpenChange: (o: boolean) => void; scope: Record<string, string[]>; busy: boolean; onSubmit: (b: ScheduleBody) => void }) {
  const [name, setName] = useState('')
  const [recipients, setRecipients] = useState('')
  const [cadence, setCadence] = useState<ScheduleBody['cadence']>('weekly')
  const [weekday, setWeekday] = useState(0)
  const [hour, setHour] = useState(6)
  const [preset, setPreset] = useState('last_15_days')
  const [format, setFormat] = useState<ScheduleBody['format']>('pdf')
  const [narrative, setNarrative] = useState(true)
  const scopeLabel = Object.values(scope).flat().join(', ')

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    onSubmit({ name: name.trim(), recipients: recipients.split(/[,;\s]+/).map((r) => r.trim()).filter(Boolean), cadence, weekday, hour_utc: hour, preset, format, report_type: 'management', include_narrative: narrative, active: true, filters: scope })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New scheduled digest</DialogTitle>
          <DialogDescription>Scope: {scopeLabel || 'all boards you can see'}. Change the Board / Project filter on this page first to scope the digest.</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <div><Label htmlFor="sch-name">Name</Label><Input id="sch-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Weekly client status - OCS" required className="mt-1" /></div>
          <div><Label htmlFor="sch-rcpt">Recipients</Label><Input id="sch-rcpt" value={recipients} onChange={(e) => setRecipients(e.target.value)} placeholder="pm@endava.com, client@company.com" required className="mt-1" /><p className="mt-1 text-[11px] text-muted-foreground">Comma or space separated.</p></div>
          <div className="grid grid-cols-3 gap-2">
            <div><Label htmlFor="sch-cad">Cadence</Label><NativeSelect id="sch-cad" value={cadence} onChange={(e) => setCadence(e.target.value as ScheduleBody['cadence'])} className="mt-1"><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="fortnightly">Fortnightly</option></NativeSelect></div>
            <div><Label htmlFor="sch-day">Day</Label><NativeSelect id="sch-day" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} disabled={cadence === 'daily'} className="mt-1">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</NativeSelect></div>
            <div><Label htmlFor="sch-hour">Hour (UTC)</Label><NativeSelect id="sch-hour" value={hour} onChange={(e) => setHour(Number(e.target.value))} className="mt-1">{Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}</NativeSelect></div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label htmlFor="sch-preset">Period covered</Label><NativeSelect id="sch-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className="mt-1">{Object.entries(PRESET_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</NativeSelect></div>
            <div><Label htmlFor="sch-fmt">Attachment</Label><NativeSelect id="sch-fmt" value={format} onChange={(e) => setFormat(e.target.value as ScheduleBody['format'])} className="mt-1"><option value="pdf">Management PDF</option><option value="xlsx">Management Excel</option><option value="none">No attachment</option></NativeSelect></div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={narrative} onChange={(e) => setNarrative(e.target.checked)} className="h-4 w-4" /> Include the written narrative and anomaly flags in the e-mail body</label>
          <div className="flex justify-end gap-2 pt-1"><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={busy}><CalendarClock /> Schedule</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
