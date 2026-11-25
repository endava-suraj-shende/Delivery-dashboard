import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AtSign, Ban, CalendarPlus, CheckCircle2, Copy, Globe, Kanban, KeyRound, Plus, ShieldCheck, Ticket, Trash2, UserCheck, UserCog, UserX, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable } from '@/components/common/DataTable'
import { Notice, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { useSession } from '@/hooks/useSession'
import { adminApi, ROLE_LABEL, STATUS_LABEL, type AccountStatus, type AuthCode, type AuthUser, type Role } from '@/services/authApi'
import { errorMessage } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

const STATUS_TONE: Record<AccountStatus, string> = {
  pending_verification: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  disabled: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
}

function Avatar({ name }: { name: string }) {
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
}

export default function UsersAdminPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const { user: me } = useSession()
  const [status, setStatus] = useState<AccountStatus | ''>('')
  const [q, setQ] = useState('')
  const [reject, setReject] = useState<AuthUser | null>(null)
  const [reason, setReason] = useState('')
  const [temp, setTemp] = useState<{ user: AuthUser; password: string; sent: boolean } | null>(null)
  const [approveRole, setApproveRole] = useState<Record<string, Role>>({})
  const [extendUser, setExtendUser] = useState<AuthUser | null>(null)
  const [extendDays, setExtendDays] = useState(5)
  const [boardsUser, setBoardsUser] = useState<AuthUser | null>(null)
  const [boardDraft, setBoardDraft] = useState<string[]>([])

  const users = useQuery({ queryKey: ['admin-users', status, q], queryFn: () => adminApi.users(status, q), refetchInterval: 30_000 })
  const policy = useQuery({ queryKey: ['admin-policy'], queryFn: adminApi.policy })
  const codes = useQuery({ queryKey: ['admin-codes'], queryFn: adminApi.codes })
  const invalidate = () => { void qc.invalidateQueries({ queryKey: ['admin-users'] }) }
  const onErr = (e: unknown) => toast({ title: 'Action failed', description: errorMessage(e), variant: 'destructive' })

  const approve = useMutation({ mutationFn: ({ id, role }: { id: string; role?: Role }) => adminApi.approve(id, role), onSuccess: (u) => { invalidate(); toast({ title: 'Access approved', description: `${u.email} is now ${ROLE_LABEL[u.role]}`, variant: 'success' }) }, onError: onErr })
  const doReject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.reject(id, reason), onSuccess: (u) => { invalidate(); setReject(null); setReason(''); toast({ title: 'Request rejected', description: u.email }) }, onError: onErr })
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.setRole(id, role), onSuccess: () => { invalidate(); toast({ title: 'Role updated', variant: 'success' }) }, onError: onErr })
  const toggle = useMutation({ mutationFn: ({ id, enable }: { id: string; enable: boolean }) => (enable ? adminApi.enable(id) : adminApi.disable(id)), onSuccess: () => invalidate(), onError: onErr })
  const tempPw = useMutation({ mutationFn: (id: string) => adminApi.temporaryPassword(id), onSuccess: (r) => { invalidate(); setTemp({ user: r.user, password: r.temporary_password, sent: r.email_sent }) }, onError: onErr })
  const remove = useMutation({ mutationFn: (id: string) => adminApi.remove(id), onSuccess: () => { invalidate(); toast({ title: 'User deleted' }) }, onError: onErr })
  const addRule = useMutation({ mutationFn: ({ kind, value }: { kind: 'domain' | 'email'; value: string }) => adminApi.addRule(kind, value), onSuccess: () => { void qc.invalidateQueries({ queryKey: ['admin-policy'] }); setNewDomain(''); setNewEmail('') }, onError: onErr })
  const removeRule = useMutation({ mutationFn: (id: string) => adminApi.removeRule(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-policy'] }), onError: onErr })
  const [newDomain, setNewDomain] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const extend = useMutation({ mutationFn: ({ id, days }: { id: string; days: number }) => adminApi.extend(id, { days }), onSuccess: (u) => { invalidate(); setExtendUser(null); toast({ title: 'Guest access extended', description: `${u.email} until ${fmtDate(u.access_expires_at ?? '', { day: '2-digit', month: 'short', year: 'numeric' })}`, variant: 'success' }) }, onError: onErr })
  const setBoards = useMutation({ mutationFn: ({ id, ids }: { id: string; ids: string[] }) => adminApi.setBoards(id, ids), onSuccess: () => { invalidate(); setBoardsUser(null); toast({ title: 'Board access updated', variant: 'success' }) }, onError: onErr })
  const [codeForm, setCodeForm] = useState<{ role: Role; label: string; board_id: string; expires_days: string; max_uses: string }>({ role: 'employee', label: '', board_id: '', expires_days: '', max_uses: '' })
  const createCode = useMutation({
    mutationFn: () => adminApi.createCode({ role: codeForm.role, label: codeForm.label || undefined, board_id: codeForm.role === 'dm' && codeForm.board_id ? codeForm.board_id : undefined, expires_days: codeForm.expires_days ? Number(codeForm.expires_days) : undefined, max_uses: codeForm.max_uses ? Number(codeForm.max_uses) : undefined }),
    onSuccess: (c) => { void qc.invalidateQueries({ queryKey: ['admin-codes'] }); setCodeForm((f) => ({ ...f, label: '' })); toast({ title: 'Auth code created', description: c.code, variant: 'success' }) },
    onError: onErr,
  })
  const toggleCode = useMutation({ mutationFn: (c: AuthCode) => (c.active ? adminApi.revokeCode(c.id) : adminApi.enableCode(c.id)), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-codes'] }), onError: onErr })
  const deleteCode = useMutation({ mutationFn: (id: string) => adminApi.deleteCode(id), onSuccess: () => void qc.invalidateQueries({ queryKey: ['admin-codes'] }), onError: onErr })
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast({ title: 'Copied', description: text }) }

  const counts = users.data?.counts ?? {}
  const pending = useMemo(() => (users.data?.items ?? []).filter((u) => u.status === 'pending_approval' || u.status === 'pending_verification'), [users.data])

  const columns = useMemo<ColumnDef<AuthUser, unknown>[]>(() => [
    { id: 'user', header: 'User', accessorFn: (r) => `${r.name} ${r.email}`, size: 260, cell: ({ row }) => (
      <div className="flex items-center gap-2.5"><Avatar name={row.original.name} /><div className="min-w-0"><p className="truncate text-sm font-medium">{row.original.name}{row.original.id === me?.id && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}</p><p className="truncate text-xs text-muted-foreground">{row.original.email}</p></div></div>
    ) },
    { accessorKey: 'role', header: 'Role', size: 170, cell: ({ row }) => row.original.status === 'active' && row.original.id !== me?.id ? (
      <NativeSelect value={row.original.role} onChange={(e) => setRole.mutate({ id: row.original.id, role: e.target.value as Role })} className="h-8 text-xs">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
      </NativeSelect>
    ) : <span className="text-sm">{ROLE_LABEL[row.original.role]}</span> },
    { accessorKey: 'status', header: 'Status', size: 170, cell: ({ row }) => (
      <div className="flex flex-col gap-0.5">
        <span className={cn('inline-flex w-fit rounded-full px-2 py-0.5 text-[11px] font-medium', STATUS_TONE[row.original.status])}>{row.original.role === 'guest' && row.original.access_expired ? 'Guest expired' : STATUS_LABEL[row.original.status]}</span>
        {row.original.role === 'guest' && row.original.access_expires_at && <span className="text-[10px] text-muted-foreground">until {fmtDate(row.original.access_expires_at, { day: '2-digit', month: 'short' })}</span>}
        {row.original.role === 'dm' && (row.original.board_ids ?? []).length > 0 && <span className="text-[10px] text-muted-foreground">{row.original.board_ids.length} granted board(s)</span>}
      </div>
    ) },
    { accessorKey: 'last_login_at', header: 'Last sign-in', size: 130, cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{getValue() ? fmtDate(getValue() as string, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'Never'}</span> },
    { accessorKey: 'created_at', header: 'Registered', size: 110, cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{fmtDate(getValue() as string, { day: '2-digit', month: 'short', year: 'numeric' })}</span> },
    { id: 'actions', header: '', size: 220, enableSorting: false, cell: ({ row }) => {
      const u = row.original
      const self = u.id === me?.id
      return (
        <div className="flex justify-end gap-1">
          {(u.status === 'pending_approval' || u.status === 'pending_verification') && <>
            <Button size="sm" variant="outline" className="h-7 text-emerald-700" onClick={() => approve.mutate({ id: u.id, role: approveRole[u.id] })}><UserCheck /> Approve</Button>
            <Button size="sm" variant="outline" className="h-7 text-red-700" onClick={() => setReject(u)}><UserX /> Reject</Button>
          </>}
          {u.status === 'rejected' && <Button size="sm" variant="outline" className="h-7" onClick={() => approve.mutate({ id: u.id })}><UserCheck /> Approve anyway</Button>}
          {u.role === 'guest' && u.status !== 'rejected' && <Button size="sm" variant="outline" className="h-7" title="Extend guest access" onClick={() => { setExtendUser(u); setExtendDays(5) }}><CalendarPlus /> Extend</Button>}
          {u.role === 'dm' && u.status === 'active' && <Button size="sm" variant="ghost" className="h-7" title="Board access" onClick={() => { setBoardsUser(u); setBoardDraft(u.board_ids ?? []) }}><Kanban /></Button>}
          {u.status === 'active' && !self && <>
            <Button size="sm" variant="ghost" className="h-7" title="Issue temporary password" onClick={() => tempPw.mutate(u.id)}><KeyRound /></Button>
            <Button size="sm" variant="ghost" className="h-7" title="Disable account" onClick={() => toggle.mutate({ id: u.id, enable: false })}><Ban /></Button>
          </>}
          {u.status === 'disabled' && <Button size="sm" variant="outline" className="h-7" onClick={() => toggle.mutate({ id: u.id, enable: true })}><CheckCircle2 /> Enable</Button>}
          {!self && <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-red-600" title="Delete user" onClick={() => { if (confirm(`Delete ${u.email}? This cannot be undone.`)) remove.mutate(u.id) }}><Trash2 /></Button>}
        </div>
      )
    } },
  ], [me, approve, approveRole, remove, setRole, tempPw, toggle])
  const pendingLabel = (u: AuthUser) => (u.status === 'pending_verification' ? `${ROLE_LABEL[u.requested_role]} - e-mail not verified yet` : u.role === 'guest' && u.status === 'pending_approval' ? 'guest access expired' : `requested ${ROLE_LABEL[u.requested_role]}`)

  return (
    <>
      <PageHeader title="User Management" description="Review access requests, manage roles, issue auth codes and control who can register." />

      <StatStrip cols={5}>
        <StatTile icon={Users} label="Total users" value={Object.values(counts).reduce((a, b) => a + b, 0)} />
        <StatTile icon={UserCog} label="Waiting approval" value={counts.pending_approval ?? 0} tone={counts.pending_approval ? 'orange' : 'default'} />
        <StatTile icon={ShieldCheck} label="Active" value={counts.active ?? 0} tone="green" />
        <StatTile icon={AtSign} label="E-mail not verified" value={counts.pending_verification ?? 0} tone="grey" />
        <StatTile icon={XCircle} label="Rejected / disabled" value={(counts.rejected ?? 0) + (counts.disabled ?? 0)} tone={(counts.rejected ?? 0) + (counts.disabled ?? 0) ? 'red' : 'default'} />
      </StatStrip>

      {pending.length > 0 && (
        <SettingsCard icon={UserCog} title={`Access requests (${pending.length})`} description="Admin sign-ups and expired guests wait here for your decision. Accounts that have not verified their e-mail yet can also be approved directly, which skips the e-mail check." tone="warning">
          <div className="space-y-2">
            {pending.map((u) => (
              <div key={u.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3 lg:flex-row lg:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <Avatar name={u.name} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  <div className="ml-auto hidden shrink-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-300">{pendingLabel(u)}</span>
                    <span>{fmtDate(u.created_at ?? '', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2 lg:justify-end">
                  {u.role === 'guest' && u.status === 'pending_approval' ? (
                    <Button size="sm" className="h-8" onClick={() => { setExtendUser(u); setExtendDays(5) }}><CalendarPlus /> Extend access</Button>
                  ) : (<>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Grant role
                    <NativeSelect value={approveRole[u.id] ?? u.requested_role} onChange={(e) => setApproveRole((m) => ({ ...m, [u.id]: e.target.value as Role }))} className="h-8 w-[170px] text-xs">
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </NativeSelect>
                  </label>
                  <Button size="sm" className="h-8" onClick={() => approve.mutate({ id: u.id, role: approveRole[u.id] ?? u.requested_role })} disabled={approve.isPending} title={u.status === 'pending_verification' ? 'Activate without waiting for e-mail verification' : undefined}><UserCheck /> {u.status === 'pending_verification' ? 'Approve (skip e-mail check)' : 'Approve'}</Button>
                  </>)}
                  <Button size="sm" variant="outline" className="h-8 text-red-700" onClick={() => setReject(u)}><UserX /> Reject</Button>
                </div>
              </div>
            ))}
          </div>
        </SettingsCard>
      )}

      <SettingsCard icon={Users} title="All users" description="Change roles inline, disable accounts, or issue a temporary password. Passwords are never visible, not even to admins.">
        <DataTable
          data={users.data?.items ?? []}
          columns={columns}
          pageSize={15}
          fluid
          searchPlaceholder="Search name or e-mail"
          toolbar={
            <NativeSelect value={status} onChange={(e) => setStatus(e.target.value as AccountStatus | '')} className="h-9 w-[190px] text-xs">
              <option value="">All statuses</option>
              {(Object.keys(STATUS_LABEL) as AccountStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </NativeSelect>
          }
          emptyTitle="No users match"
        />
        <input className="hidden" value={q} onChange={(e) => setQ(e.target.value)} />
      </SettingsCard>

      <SettingsCard icon={Ticket} title="Auth codes" description="Hand a code to people you trust. Employees and delivery managers with a valid code are active immediately (no e-mail verification or approval). Guests always need a code plus e-mail verification and get 5 days of demo access. A delivery manager code can be tied to a board to grant that board's data.">
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <form className="space-y-3 rounded-xl border bg-muted/30 p-4" onSubmit={(e) => { e.preventDefault(); createCode.mutate() }}>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">New code</p>
            <div>
              <label className="text-xs text-muted-foreground">Role</label>
              <NativeSelect value={codeForm.role} onChange={(e) => setCodeForm((f) => ({ ...f, role: e.target.value as Role, board_id: '' }))} className="mt-1 h-9">
                {(['employee', 'dm', 'guest'] as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </NativeSelect>
            </div>
            {codeForm.role === 'dm' && (
              <div>
                <label className="text-xs text-muted-foreground">Board (optional)</label>
                <NativeSelect value={codeForm.board_id} onChange={(e) => setCodeForm((f) => ({ ...f, board_id: e.target.value }))} className="mt-1 h-9">
                  <option value="">No board - manager configures own boards</option>
                  {codes.data?.boards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                </NativeSelect>
              </div>
            )}
            <div><label className="text-xs text-muted-foreground">Label</label><Input value={codeForm.label} onChange={(e) => setCodeForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Phoenix team onboarding" className="mt-1 h-9" /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><label className="text-xs text-muted-foreground">Expires in (days)</label><Input type="number" min={1} value={codeForm.expires_days} onChange={(e) => setCodeForm((f) => ({ ...f, expires_days: e.target.value }))} placeholder="never" className="mt-1 h-9" /></div>
              <div><label className="text-xs text-muted-foreground">Max uses</label><Input type="number" min={1} value={codeForm.max_uses} onChange={(e) => setCodeForm((f) => ({ ...f, max_uses: e.target.value }))} placeholder="unlimited" className="mt-1 h-9" /></div>
            </div>
            <Button type="submit" size="sm" className="w-full" disabled={createCode.isPending}><Plus /> Generate code</Button>
          </form>
          <div className="space-y-2">
            {!codes.data?.items.length && <p className="text-sm text-muted-foreground">No codes yet. Generate one on the left and share it with the person.</p>}
            {codes.data?.items.map((c) => (
              <div key={c.id} className={cn('flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2', !c.usable && 'opacity-60')}>
                <button className="font-mono text-sm font-semibold tracking-wider hover:underline" onClick={() => copy(c.code)} title="Copy">{c.code}</button>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => copy(c.code)} aria-label="Copy code"><Copy className="h-3.5 w-3.5" /></Button>
                <Badge variant="secondary">{ROLE_LABEL[c.role]}</Badge>
                {c.board_label && <Badge variant="outline" className="gap-1"><Kanban className="h-3 w-3" /> {c.board_label}</Badge>}
                {c.label && <span className="text-xs text-muted-foreground">{c.label}</span>}
                <span className="ml-auto text-xs text-muted-foreground">
                  {c.uses}{c.max_uses ? ` / ${c.max_uses}` : ''} used{c.expires_at ? ` | expires ${fmtDate(c.expires_at, { day: '2-digit', month: 'short' })}` : ''}
                </span>
                <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', c.usable ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-slate-500/15 text-slate-600 dark:text-slate-300')}>{c.usable ? 'Active' : c.active ? 'Exhausted' : 'Revoked'}</span>
                <Button size="sm" variant="ghost" className="h-7" onClick={() => toggleCode.mutate(c)}>{c.active ? 'Revoke' : 'Enable'}</Button>
                <Button size="sm" variant="ghost" className="h-7 text-muted-foreground hover:text-red-600" onClick={() => { if (confirm(`Delete code ${c.code}?`)) deleteCode.mutate(c.id) }} aria-label="Delete code"><Trash2 className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        </div>
      </SettingsCard>

      <SettingsCard icon={Globe} title="Who can register" description="Sign-up is limited to these e-mail domains. Allow-list individual addresses for people outside the company.">
        <div className="grid gap-5 md:grid-cols-2">
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allowed domains</p>
            <div className="flex flex-wrap gap-2">
              {policy.data?.domains.map((r) => <Badge key={r.id} variant="secondary" className="gap-1 pr-1">@{r.value}<button className="rounded p-0.5 hover:bg-foreground/10" onClick={() => removeRule.mutate(r.id)} aria-label="Remove"><XCircle className="h-3 w-3" /></button></Badge>)}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newDomain.trim()) addRule.mutate({ kind: 'domain', value: newDomain.trim() }) }}>
              <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" className="h-9" />
              <Button type="submit" size="sm" variant="outline" className="h-9" disabled={addRule.isPending}>Add domain</Button>
            </form>
          </div>
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allow-listed addresses</p>
            <div className="flex flex-wrap gap-2">
              {policy.data?.emails.length ? policy.data.emails.map((r) => <Badge key={r.id} variant="secondary" className="gap-1 pr-1">{r.value}<button className="rounded p-0.5 hover:bg-foreground/10" onClick={() => removeRule.mutate(r.id)} aria-label="Remove"><XCircle className="h-3 w-3" /></button></Badge>) : <span className="text-xs text-muted-foreground">None</span>}
            </div>
            <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) addRule.mutate({ kind: 'email', value: newEmail.trim() }) }}>
              <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="partner@external.com" className="h-9" type="email" />
              <Button type="submit" size="sm" variant="outline" className="h-9" disabled={addRule.isPending}>Allow address</Button>
            </form>
          </div>
        </div>
      </SettingsCard>

      <Notice tone="info" icon={ShieldCheck}>
        Passwords are stored as Argon2id hashes and can never be read back. If someone is locked out, issue a temporary password: it is shown to you once, e-mailed to the user, and must be changed at the next sign-in.
      </Notice>

      {/* reject dialog */}
      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Reject access request</DialogTitle><DialogDescription>{reject?.name} ({reject?.email}) will be notified by e-mail and will not be able to sign in.</DialogDescription></DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, included in the e-mail)" />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReject(null)}>Cancel</Button><Button variant="destructive" onClick={() => reject && doReject.mutate({ id: reject.id, reason: reason || undefined })} disabled={doReject.isPending}>Reject</Button></div>
        </DialogContent>
      </Dialog>

      {/* extend guest access */}
      <Dialog open={!!extendUser} onOpenChange={(o) => !o && setExtendUser(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Extend guest access</DialogTitle><DialogDescription>{extendUser?.name} ({extendUser?.email}){extendUser?.access_expires_at ? ` currently until ${fmtDate(extendUser.access_expires_at, { day: '2-digit', month: 'short', year: 'numeric' })}` : ''}. Choose how many more days from today.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap gap-2">{[5, 10, 30, 90].map((d) => <Button key={d} size="sm" variant={extendDays === d ? 'default' : 'outline'} onClick={() => setExtendDays(d)}>{d} days</Button>)}<Input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value) || 1)} className="h-9 w-24" /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setExtendUser(null)}>Cancel</Button><Button onClick={() => extendUser && extend.mutate({ id: extendUser.id, days: extendDays })} disabled={extend.isPending}><CalendarPlus /> Extend</Button></div>
        </DialogContent>
      </Dialog>

      {/* board access for a delivery manager */}
      <Dialog open={!!boardsUser} onOpenChange={(o) => !o && setBoardsUser(null)}>
        <DialogContent className="sm:max-w-[460px]">
          <DialogHeader><DialogTitle>Board access</DialogTitle><DialogDescription>Boards {boardsUser?.name} can see in addition to the boards they configured themselves.</DialogDescription></DialogHeader>
          <div className="space-y-1.5">
            {codes.data?.boards.map((b) => (
              <label key={b.id} className="flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-accent">
                <input type="checkbox" checked={boardDraft.includes(b.id)} onChange={(e) => setBoardDraft((d) => (e.target.checked ? [...d, b.id] : d.filter((x) => x !== b.id)))} />
                <Kanban className="h-4 w-4 text-muted-foreground" /> {b.label}
              </label>
            ))}
            {!codes.data?.boards.length && <p className="text-sm text-muted-foreground">No boards configured yet.</p>}
          </div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setBoardsUser(null)}>Cancel</Button><Button onClick={() => boardsUser && setBoards.mutate({ id: boardsUser.id, ids: boardDraft })} disabled={setBoards.isPending}>Save</Button></div>
        </DialogContent>
      </Dialog>

      {/* temporary password dialog */}
      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader><DialogTitle>Temporary password issued</DialogTitle><DialogDescription>For {temp?.user.email}. {temp?.sent ? 'It was also e-mailed to the user.' : 'E-mail is not configured, so share it with the user securely.'} It is shown only once and must be changed at sign-in.</DialogDescription></DialogHeader>
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 font-mono text-lg tracking-wider">{temp?.password}<Button size="sm" variant="outline" onClick={() => temp && navigator.clipboard.writeText(temp.password)}>Copy</Button></div>
          <div className="flex justify-end"><Button onClick={() => setTemp(null)}>Done</Button></div>
        </DialogContent>
      </Dialog>
    </>
  )
}
