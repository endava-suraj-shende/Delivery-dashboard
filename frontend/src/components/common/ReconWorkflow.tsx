import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Check, CheckCircle2, EyeOff, MessageSquare, RotateCcw, Send } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { useFilters } from '@/hooks/useFilters'
import { errorMessage } from '@/services/api'
import { jiraLiveApi, type ReconRow, type ReconState } from '@/services/jiraApi'
import { cn, fmtDate } from '@/lib/utils'

const STATE_META: Record<ReconState, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-red-500/10 text-red-700 dark:text-red-300' },
  acknowledged: { label: 'Acknowledged', cls: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' },
  resolved: { label: 'Resolved', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' },
  ignored: { label: 'Ignored', cls: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' },
}

function useReconMutations() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const invalidate = () => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('jira') || q.queryKey[0] === 'recon' || q.queryKey[0] === 'dashboard' })
  const setState = useMutation({ mutationFn: jiraLiveApi.setReconState, onSuccess: invalidate, onError: (e) => toast({ title: 'Could not update', description: errorMessage(e), variant: 'destructive' }) })
  return { setState }
}

/** State badge + inline actions for one discrepancy row. */
export function ReconWorkflowCell({ row }: { row: ReconRow }) {
  const wf = row.workflow
  const { setState } = useReconMutations()
  const [noteOpen, setNoteOpen] = useState(false)
  const [note, setNote] = useState(wf?.note ?? '')
  if (row.verdict === 'ok' || !wf) return <span className="text-xs text-muted-foreground">-</span>
  const codes = row.flags.map((f) => f.code)
  const go = (state: ReconState, n?: string) => setState.mutate({ ticket_id: row.ticket_id, employee: row.employee, state, note: n ?? undefined, codes })
  const meta = STATE_META[wf.state]
  return (
    <div className="flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-1">
        <Badge className={cn('font-normal', meta.cls)}>{meta.label}{wf.reopened ? ' (re-opened)' : ''}</Badge>
        {wf.nudge_count > 0 && <span className="text-[10px] text-muted-foreground" title={wf.nudged_at ? `last ${fmtDate(wf.nudged_at)}` : undefined}>nudged x{wf.nudge_count}</span>}
      </div>
      <div className="flex items-center gap-0.5">
        {wf.state !== 'acknowledged' && wf.state !== 'resolved' && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Acknowledge" aria-label="Acknowledge" onClick={() => go('acknowledged')}><Check className="h-3.5 w-3.5" /></button>}
        {wf.state !== 'resolved' && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-emerald-700" title="Mark resolved" aria-label="Mark resolved" onClick={() => go('resolved')}><CheckCircle2 className="h-3.5 w-3.5" /></button>}
        {wf.state !== 'ignored' && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Ignore (expected difference)" aria-label="Ignore" onClick={() => go('ignored')}><EyeOff className="h-3.5 w-3.5" /></button>}
        {wf.state !== 'open' && <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground" title="Re-open" aria-label="Re-open" onClick={() => go('open')}><RotateCcw className="h-3.5 w-3.5" /></button>}
        <button type="button" className={cn('rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground', wf.note && 'text-primary')} title={wf.note ? `Note: ${wf.note}` : 'Add note'} aria-label="Note" onClick={() => { setNote(wf.note ?? ''); setNoteOpen(true) }}><MessageSquare className="h-3.5 w-3.5" /></button>
      </div>
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Note for {row.ticket_id}</DialogTitle><DialogDescription>{row.employee ?? 'Unassigned'} - visible to everyone who reviews this discrepancy.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); go(wf.state, note); setNoteOpen(false) }}>
            <div><Label htmlFor="recon-note">Note</Label><Input id="recon-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Client asked to keep the ticket open until UAT" className="mt-1" autoFocus /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setNoteOpen(false)}>Cancel</Button><Button type="submit">Save note</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** "Nudge" button: e-mails one person their open discrepancies for the current filter scope. */
export function NudgeButton({ employee, openCount, className }: { employee: string; openCount: number; className?: string }) {
  const { queryString } = useFilters()
  const { toast } = useToast()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState('')
  const nudge = useMutation({
    mutationFn: () => jiraLiveApi.nudge(queryString, employee, email.trim() || undefined),
    onSuccess: (r) => { qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith('jira') }); setOpen(false); toast({ title: r.sent ? `Nudge sent to ${r.recipient}` : 'Nudge recorded but e-mail not sent', description: r.sent ? `${r.items} item(s)` : (r.reason ?? 'E-mail is not configured'), variant: r.sent ? 'success' : 'default' }) },
    onError: (e) => toast({ title: 'Could not send', description: errorMessage(e), variant: 'destructive' }),
  })
  return (
    <>
      <Button size="sm" variant="outline" className={cn('h-7', className)} disabled={openCount === 0} onClick={() => setOpen(true)} title={openCount ? `E-mail ${employee} their ${openCount} open item(s)` : 'Nothing open'}><Send className="h-3.5 w-3.5" /> Nudge</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Nudge {employee}</DialogTitle><DialogDescription>Sends one e-mail listing their {openCount} open discrepancy(ies) in the current scope, with a link to update the workbook.</DialogDescription></DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); nudge.mutate() }}>
            <div><Label htmlFor="nudge-email">E-mail (optional)</Label><Input id="nudge-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Leave blank to use the mapped Jira / account address" className="mt-1" /></div>
            <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button type="submit" disabled={nudge.isPending}><Send /> Send</Button></div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
