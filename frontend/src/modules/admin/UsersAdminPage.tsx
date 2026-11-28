import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ColumnDef } from '@tanstack/react-table'
import { AtSign, Ban, CalendarPlus, CheckCircle2, Copy, Crown, Globe, Kanban, KeyRound, Link2, Plus, RefreshCw, ShieldCheck, Ticket, Trash2, UserCheck, UserCog, UserX, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useToast } from '@/components/ui/toast'
import { PageHeader } from '@/components/common/PageHeader'
import { DataTable } from '@/components/common/DataTable'
import { EmptyState } from '@/components/common/States'
import { useConfirm } from '@/components/common/ConfirmDialog'
import { Notice, SettingsCard, StatStrip, StatTile } from '@/components/common/Settings'
import { useSession } from '@/hooks/useSession'
import { adminApi, ROLE_LABEL, STATUS_LABEL, type AccountStatus, type AuthCode, type AuthUser, type DmOverview, type Role } from '@/services/authApi'
import { errorMessage } from '@/services/api'
import { cn, fmtDate } from '@/lib/utils'

/* ------------------------------------------------------------------ shared bits */
const STATUS_TONE: Record<AccountStatus, string> = {
  pending_verification: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
  pending_approval: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  active: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  rejected: 'bg-red-500/15 text-red-700 dark:text-red-300',
  disabled: 'bg-slate-500/15 text-slate-600 dark:text-slate-300',
}
const ROLE_TONE: Record<Role, string> = {
  employee: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  dm: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  admin: 'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  guest: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
}
const ALL_ROLES = Object.keys(ROLE_LABEL) as Role[]

function Pill({ className, children, title }: { className: string; children: ReactNode; title?: string }) {
  return <span title={title} className={cn('inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>
}
function Avatar({ name }: { name: string }) {
  return <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">{name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
}
function UserCell({ u, me }: { u: AuthUser; me?: AuthUser | null }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar name={u.name} />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{u.name}{u.id === me?.id && <span className="ml-1 text-[10px] text-muted-foreground">(you)</span>}</p>
        <p className="truncate text-xs text-muted-foreground">{u.email}</p>
      </div>
    </div>
  )
}
function CodeCell({ code, onCopy }: { code: string | null; onCopy: (c: string) => void }) {
  if (!code) return <span className="text-xs text-muted-foreground" title="Encrypted with a key that is no longer available">unavailable</span>
  return (
    <span className="inline-flex items-center gap-1">
      <button className="rounded bg-muted px-2 py-0.5 font-mono text-xs font-semibold tracking-wider hover:bg-muted/70" onClick={() => onCopy(code)} title="Copy">{code}</button>
      <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => onCopy(code)} aria-label="Copy code"><Copy className="h-3 w-3" /></Button>
    </span>
  )
}
const dateCell = (v: unknown, opts?: Intl.DateTimeFormatOptions) => <span className="whitespace-nowrap text-xs text-muted-foreground">{v ? fmtDate(v as string, opts ?? { day: '2-digit', month: 'short', year: 'numeric' }) : '-'}</span>
const IconBtn = ({ title, onClick, className, children }: { title: string; onClick: () => void; className?: string; children: ReactNode }) => (
  <Button size="sm" variant="ghost" className={cn('h-7 w-7 p-0', className)} title={title} aria-label={title} onClick={onClick}>{children}</Button>
)

/* ------------------------------------------------------------------ page */
export default function UsersAdminPage() {
  const qc = useQueryClient()
  const { toast } = useToast()
  const confirm = useConfirm()
  const { user: me } = useSession()

  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => adminApi.users(), refetchInterval: 30_000 })
  const policy = useQuery({ queryKey: ['admin-policy'], queryFn: adminApi.policy })
  const codes = useQuery({ queryKey: ['admin-codes'], queryFn: adminApi.codes })
  const dms = useQuery({ queryKey: ['admin-dms'], queryFn: adminApi.deliveryManagers })

  const refreshAll = () => { for (const k of ['admin-users', 'admin-codes', 'admin-dms', 'admin-policy']) void qc.invalidateQueries({ queryKey: [k] }) }
  const onErr = (e: unknown) => toast({ title: 'Action failed', description: errorMessage(e), variant: 'destructive' })
  const ok = (title: string, description?: string) => toast({ title, description, variant: 'success' })
  const copy = (text: string) => { void navigator.clipboard?.writeText(text); toast({ title: 'Copied', description: text }) }

  // dialogs / local form state
  const [reject, setReject] = useState<AuthUser | null>(null)
  const [reason, setReason] = useState('')
  const [temp, setTemp] = useState<{ user: AuthUser; password: string; sent: boolean } | null>(null)
  const [extendUser, setExtendUser] = useState<AuthUser | null>(null)
  const [extendDays, setExtendDays] = useState(5)
  const [approveRole, setApproveRole] = useState<Record<string, Role>>({})
  const [grantPick, setGrantPick] = useState<Record<string, string>>({})
  const [codeForm, setCodeForm] = useState<{ role: Role; label: string; board_id: string; expires_days: string; max_uses: string }>({ role: 'employee', label: '', board_id: '', expires_days: '', max_uses: '' })
  const [newDomain, setNewDomain] = useState('')
  const [newEmail, setNewEmail] = useState('')

  // mutations
  const approve = useMutation({ mutationFn: ({ id, role }: { id: string; role?: Role }) => adminApi.approve(id, role), onSuccess: (u) => { refreshAll(); ok('Access approved', `${u.email} is now ${ROLE_LABEL[u.role]}`) }, onError: onErr })
  const doReject = useMutation({ mutationFn: ({ id, reason }: { id: string; reason?: string }) => adminApi.reject(id, reason), onSuccess: (u) => { refreshAll(); setReject(null); setReason(''); toast({ title: 'Request rejected', description: u.email }) }, onError: onErr })
  const setRole = useMutation({ mutationFn: ({ id, role }: { id: string; role: Role }) => adminApi.setRole(id, role), onSuccess: () => { refreshAll(); ok('Role updated') }, onError: onErr })
  const superuser = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => adminApi.setSuperuser(id, enabled), onSuccess: (u) => { refreshAll(); ok(u.is_superuser ? 'Superuser access granted' : 'Superuser access removed', u.email) }, onError: onErr })
  const toggle = useMutation({ mutationFn: ({ id, enable }: { id: string; enable: boolean }) => (enable ? adminApi.enable(id) : adminApi.disable(id)), onSuccess: refreshAll, onError: onErr })
  const tempPw = useMutation({ mutationFn: (id: string) => adminApi.temporaryPassword(id), onSuccess: (r) => { refreshAll(); setTemp({ user: r.user, password: r.temporary_password, sent: r.email_sent }) }, onError: onErr })
  const remove = useMutation({ mutationFn: (id: string) => adminApi.remove(id), onSuccess: () => { refreshAll(); toast({ title: 'User deleted' }) }, onError: onErr })
  const extend = useMutation({ mutationFn: ({ id, days }: { id: string; days: number }) => adminApi.extend(id, { days }), onSuccess: (u) => { refreshAll(); setExtendUser(null); ok('Guest access extended', `${u.email} until ${fmtDate(u.access_expires_at ?? '')}`) }, onError: onErr })
  const grant = useMutation({ mutationFn: ({ userId, boardId }: { userId: string; boardId: string }) => adminApi.grantBoard(userId, boardId), onSuccess: () => { refreshAll(); ok('Board access granted') }, onError: onErr })
  const revoke = useMutation({ mutationFn: ({ userId, boardId }: { userId: string; boardId: string }) => adminApi.revokeBoard(userId, boardId), onSuccess: () => { refreshAll(); toast({ title: 'Board access revoked' }) }, onError: onErr })
  const regen = useMutation({ mutationFn: (boardId: string) => adminApi.regenerateBoardCode(boardId), onSuccess: (c) => { refreshAll(); ok('New board code issued', c.code ?? undefined) }, onError: onErr })
  const createCode = useMutation({
    mutationFn: () => adminApi.createCode({ role: codeForm.role, label: codeForm.label || undefined, board_id: codeForm.role === 'dm' && codeForm.board_id ? codeForm.board_id : undefined, expires_days: codeForm.expires_days ? Number(codeForm.expires_days) : undefined, max_uses: codeForm.max_uses ? Number(codeForm.max_uses) : undefined }),
    onSuccess: (c) => { refreshAll(); setCodeForm((f) => ({ ...f, label: '' })); ok('Auth code created', c.code ?? undefined) },
    onError: onErr,
  })
  const toggleCode = useMutation({ mutationFn: (c: AuthCode) => (c.active ? adminApi.revokeCode(c.id) : adminApi.enableCode(c.id)), onSuccess: refreshAll, onError: onErr })
  const deleteCode = useMutation({ mutationFn: (id: string) => adminApi.deleteCode(id), onSuccess: refreshAll, onError: onErr })
  const addRule = useMutation({ mutationFn: ({ kind, value }: { kind: 'domain' | 'email'; value: string }) => adminApi.addRule(kind, value), onSuccess: () => { refreshAll(); setNewDomain(''); setNewEmail('') }, onError: onErr })
  const removeRule = useMutation({ mutationFn: (id: string) => adminApi.removeRule(id), onSuccess: refreshAll, onError: onErr })

  // derived
  const counts = users.data?.counts ?? {}
  const allUsers = users.data?.items ?? []
  const requests = useMemo(() => allUsers.filter((u) => u.status === 'pending_approval' || u.status === 'pending_verification'), [allUsers])
  const roleCodes = (codes.data?.items ?? []).filter((c) => c.kind !== 'board')
  const boardCodes = (codes.data?.items ?? []).filter((c) => c.kind === 'board')

  /* ------------------------------------------------------------------ columns */
  const userCols = useMemo<ColumnDef<AuthUser, unknown>[]>(() => [
    { id: 'user', header: 'User', accessorFn: (r) => `${r.name} ${r.email}`, size: 280, cell: ({ row }) => <UserCell u={row.original} me={me} /> },
    { accessorKey: 'role', header: 'Role', size: 180, filterFn: 'equalsString', cell: ({ row }) => {
      const u = row.original
      const editable = u.status === 'active' && u.id !== me?.id
      return (
        <div className="flex flex-col gap-1">
          {editable ? (
            <NativeSelect value={u.role} onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value as Role })} className="h-8 w-[160px] text-xs">{ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
          ) : <Pill className={ROLE_TONE[u.role]}>{ROLE_LABEL[u.role]}</Pill>}
          {u.role === 'admin' && u.is_superuser && <Pill className="bg-violet-500/15 text-violet-700 dark:text-violet-300"><Crown className="h-3 w-3" /> Superuser</Pill>}
        </div>
      )
    } },
    { accessorKey: 'status', header: 'Status', size: 150, filterFn: 'equalsString', cell: ({ row }) => {
      const u = row.original
      return (
        <div className="flex flex-col gap-0.5">
          <Pill className={STATUS_TONE[u.status]}>{u.role === 'guest' && u.access_expired ? 'Guest expired' : STATUS_LABEL[u.status]}</Pill>
          {u.role === 'guest' && u.access_expires_at && <span className="text-[10px] text-muted-foreground">until {fmtDate(u.access_expires_at, { day: '2-digit', month: 'short' })}</span>}
          {u.role === 'dm' && (u.board_ids ?? []).length > 0 && <span className="text-[10px] text-muted-foreground">{u.board_ids.length} granted board(s)</span>}
        </div>
      )
    } },
    { accessorKey: 'last_login_at', header: 'Last sign-in', size: 140, cell: ({ getValue }) => (getValue() ? dateCell(getValue(), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : <span className="text-xs text-muted-foreground">Never</span>) },
    { accessorKey: 'created_at', header: 'Registered', size: 120, cell: ({ getValue }) => dateCell(getValue()) },
    { id: 'actions', header: '', size: 190, enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => {
      const u = row.original
      const self = u.id === me?.id
      const pending = u.status === 'pending_approval' || u.status === 'pending_verification'
      return (
        <div className="flex items-center justify-end gap-0.5">
          {pending && u.role !== 'guest' && <IconBtn title="Approve" className="text-emerald-700" onClick={() => approve.mutate({ id: u.id })}><UserCheck className="h-4 w-4" /></IconBtn>}
          {u.status === 'rejected' && <IconBtn title="Approve anyway" className="text-emerald-700" onClick={() => approve.mutate({ id: u.id })}><UserCheck className="h-4 w-4" /></IconBtn>}
          {pending && <IconBtn title="Reject" className="text-red-700" onClick={() => setReject(u)}><UserX className="h-4 w-4" /></IconBtn>}
          {u.role === 'guest' && u.status !== 'rejected' && <IconBtn title="Extend guest access" onClick={() => { setExtendUser(u); setExtendDays(5) }}><CalendarPlus className="h-4 w-4" /></IconBtn>}
          {u.role === 'admin' && u.status === 'active' && !self && <IconBtn title={u.is_superuser ? 'Revoke superuser access' : 'Make superuser'} className={u.is_superuser ? 'text-violet-700' : ''} onClick={async () => { if (await confirm({ title: u.is_superuser ? `Revoke superuser access from ${u.email}?` : `Make ${u.email} a superuser?`, description: u.is_superuser ? 'They keep admin read access but lose user management and configuration rights.' : 'Superusers can manage users, auth codes, boards and all settings.', confirmLabel: u.is_superuser ? 'Revoke' : 'Grant', destructive: u.is_superuser })) superuser.mutate({ id: u.id, enabled: !u.is_superuser }) }}><Crown className="h-4 w-4" /></IconBtn>}
          {u.status === 'active' && !self && <IconBtn title="Issue temporary password" onClick={async () => { if (await confirm({ title: `Issue a temporary password for ${u.email}?`, description: 'Their current password stops working immediately and they must set a new one at next sign-in.', confirmLabel: 'Issue password' })) tempPw.mutate(u.id) }}><KeyRound className="h-4 w-4" /></IconBtn>}
          {u.status === 'active' && !self && <IconBtn title="Disable account" onClick={async () => { if (await confirm({ title: `Disable ${u.email}?`, description: 'The user is signed out everywhere and cannot sign in until re-enabled.', confirmLabel: 'Disable account', destructive: true })) toggle.mutate({ id: u.id, enable: false }) }}><Ban className="h-4 w-4" /></IconBtn>}
          {u.status === 'disabled' && <IconBtn title="Enable account" className="text-emerald-700" onClick={() => toggle.mutate({ id: u.id, enable: true })}><CheckCircle2 className="h-4 w-4" /></IconBtn>}
          {!self && <IconBtn title="Delete user" className="text-muted-foreground hover:text-red-600" onClick={async () => { if (await confirm({ title: `Delete ${u.email}?`, description: 'The account, its board grants and upload history are removed permanently.', confirmLabel: 'Delete user', destructive: true })) remove.mutate(u.id) }}><Trash2 className="h-4 w-4" /></IconBtn>}
        </div>
      )
    } },
  ], [me, approve, remove, setRole, superuser, tempPw, toggle])

  const requestCols = useMemo<ColumnDef<AuthUser, unknown>[]>(() => [
    { id: 'user', header: 'User', accessorFn: (r) => `${r.name} ${r.email}`, size: 280, cell: ({ row }) => <UserCell u={row.original} me={me} /> },
    { accessorKey: 'requested_role', header: 'Requested', size: 150, cell: ({ row }) => <Pill className={ROLE_TONE[row.original.requested_role]}>{row.original.role === 'guest' && row.original.status === 'pending_approval' ? 'Guest (expired)' : ROLE_LABEL[row.original.requested_role]}</Pill> },
    { accessorKey: 'status', header: 'E-mail', size: 130, cell: ({ row }) => (row.original.status === 'pending_verification' ? <Pill className={STATUS_TONE.pending_verification}><AtSign className="h-3 w-3" /> not verified</Pill> : <Pill className={STATUS_TONE.active}><CheckCircle2 className="h-3 w-3" /> verified</Pill>) },
    { accessorKey: 'created_at', header: 'Requested on', size: 130, cell: ({ getValue }) => dateCell(getValue()) },
    { id: 'grant', header: 'Grant role', size: 170, enableSorting: false, cell: ({ row }) => {
      const u = row.original
      if (u.role === 'guest' && u.status === 'pending_approval') return <span className="text-xs text-muted-foreground">guest: extend access</span>
      return <NativeSelect value={approveRole[u.id] ?? u.requested_role} onChange={(e) => setApproveRole((m) => ({ ...m, [u.id]: e.target.value as Role }))} className="h-8 w-[160px] text-xs">{ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect>
    } },
    { id: 'actions', header: '', size: 220, enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => {
      const u = row.original
      return (
        <div className="flex justify-end gap-1">
          {u.role === 'guest' && u.status === 'pending_approval'
            ? <Button size="sm" className="h-8" onClick={() => { setExtendUser(u); setExtendDays(5) }}><CalendarPlus /> Extend</Button>
            : <Button size="sm" className="h-8" title={u.status === 'pending_verification' ? 'Activate without waiting for e-mail verification' : undefined} onClick={() => approve.mutate({ id: u.id, role: approveRole[u.id] ?? u.requested_role })} disabled={approve.isPending}><UserCheck /> Approve</Button>}
          <Button size="sm" variant="outline" className="h-8 text-red-700" onClick={() => setReject(u)}><UserX /> Reject</Button>
        </div>
      )
    } },
  ], [me, approve, approveRole])

  const codeCols = useMemo<ColumnDef<AuthCode, unknown>[]>(() => [
    { accessorKey: 'code', header: 'Code', size: 220, cell: ({ row }) => <CodeCell code={row.original.code} onCopy={copy} /> },
    { accessorKey: 'role', header: 'Role', size: 150, filterFn: 'equalsString', cell: ({ row }) => <Pill className={ROLE_TONE[row.original.role]}>{ROLE_LABEL[row.original.role]}</Pill> },
    { accessorKey: 'label', header: 'Label', size: 220, cell: ({ row }) => <span className="flex flex-col"><span className="truncate text-sm">{row.original.label ?? '-'}</span>{row.original.board_label && <span className="text-[10px] text-muted-foreground"><Kanban className="mr-0.5 inline h-3 w-3" />{row.original.board_label}</span>}</span> },
    { id: 'uses', header: 'Used', size: 90, accessorFn: (r) => r.uses, meta: { align: 'right' }, cell: ({ row }) => <span className="tabular-nums">{row.original.uses}{row.original.max_uses ? ` / ${row.original.max_uses}` : ''}</span> },
    { accessorKey: 'expires_at', header: 'Expires', size: 120, cell: ({ getValue }) => (getValue() ? dateCell(getValue()) : <span className="text-xs text-muted-foreground">never</span>) },
    { accessorKey: 'created_at', header: 'Created', size: 120, cell: ({ getValue }) => dateCell(getValue()) },
    { id: 'state', header: 'State', size: 100, accessorFn: (r) => (r.usable ? 'active' : r.active ? 'exhausted' : 'revoked'), filterFn: 'equalsString', cell: ({ row }) => <Pill className={row.original.usable ? STATUS_TONE.active : STATUS_TONE.disabled}>{row.original.usable ? 'Active' : row.original.active ? 'Exhausted' : 'Revoked'}</Pill> },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (
      <div className="flex justify-end gap-0.5">
        <IconBtn title={row.original.active ? 'Revoke code' : 'Enable code'} onClick={() => toggleCode.mutate(row.original)}>{row.original.active ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-700" />}</IconBtn>
        <IconBtn title="Delete code" className="text-muted-foreground hover:text-red-600" onClick={async () => { if (await confirm({ title: 'Delete this auth code?', description: 'Anyone holding the code can no longer use it. Existing accounts are unaffected.', confirmLabel: 'Delete code', destructive: true })) deleteCode.mutate(row.original.id) }}><Trash2 className="h-4 w-4" /></IconBtn>
      </div>
    ) },
  ], [toggleCode, deleteCode])

  const boardCodeCols = useMemo<ColumnDef<AuthCode, unknown>[]>(() => [
    { accessorKey: 'board_label', header: 'Board', size: 220, cell: ({ row }) => <span className="flex items-center gap-2 font-medium"><Kanban className="h-4 w-4 text-muted-foreground" />{row.original.board_label ?? row.original.board_id}</span> },
    { id: 'linked_by', header: 'Linked by', size: 170, accessorFn: (r) => r.board_owner ?? r.created_by_name ?? '', cell: ({ getValue }) => <span className="text-sm">{(getValue() as string) || <span className="text-muted-foreground">superuser</span>}</span> },
    { accessorKey: 'created_at', header: 'Linked on', size: 120, cell: ({ getValue }) => dateCell(getValue()) },
    { accessorKey: 'code', header: 'Board code', size: 230, cell: ({ row }) => <CodeCell code={row.original.code} onCopy={copy} /> },
    { accessorKey: 'uses', header: 'Used', size: 80, meta: { align: 'right' }, cell: ({ getValue }) => <span className="tabular-nums">{getValue() as number}x</span> },
    { id: 'state', header: 'State', size: 100, accessorFn: (r) => (r.usable ? 'active' : 'revoked'), cell: ({ row }) => <Pill className={row.original.usable ? STATUS_TONE.active : STATUS_TONE.disabled}>{row.original.usable ? 'Active' : 'Revoked'}</Pill> },
    { id: 'actions', header: '', size: 110, enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => (
      <div className="flex justify-end gap-0.5">
        <IconBtn title="Regenerate code (old code stops working)" onClick={async () => { if (row.original.board_id && await confirm({ title: 'Regenerate this board code?', description: 'The current code stops working immediately; delivery managers who already redeemed it keep their access.', confirmLabel: 'Regenerate' })) regen.mutate(row.original.board_id) }}><RefreshCw className="h-4 w-4" /></IconBtn>
        <IconBtn title={row.original.active ? 'Revoke code' : 'Enable code'} onClick={() => toggleCode.mutate(row.original)}>{row.original.active ? <Ban className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4 text-emerald-700" />}</IconBtn>
      </div>
    ) },
  ], [regen, toggleCode])

  const dmCols = useMemo<ColumnDef<DmOverview, unknown>[]>(() => [
    { id: 'user', header: 'Delivery manager', accessorFn: (r) => `${r.user.name} ${r.user.email}`, size: 260, cell: ({ row }) => <UserCell u={row.original.user} me={me} /> },
    { id: 'owned', header: 'Own boards', size: 240, enableSorting: false, cell: ({ row }) => (row.original.owned.length ? <div className="flex flex-wrap gap-1">{row.original.owned.map((b) => <Badge key={b.id} variant="info" className="gap-1"><Kanban className="h-3 w-3" /> {b.label}</Badge>)}</div> : <span className="text-xs text-muted-foreground">none linked yet</span>) },
    { id: 'granted', header: 'Granted boards', size: 280, enableSorting: false, cell: ({ row }) => (row.original.granted.length ? (
      <div className="flex flex-wrap gap-1">
        {row.original.granted.map((b) => (
          <Badge key={b.id} variant="secondary" className="gap-1 pr-1" title={b.since ? `since ${fmtDate(b.since, { day: '2-digit', month: 'short' })}` : undefined}>
            <Link2 className="h-3 w-3" /> {b.label}
            <button className="rounded p-0.5 hover:bg-foreground/10" title="Revoke access" aria-label="Revoke" onClick={async () => { if (await confirm({ title: `Revoke ${b.label} from ${row.original.user.email}?`, description: 'They lose access to this board\'s dashboards immediately.', confirmLabel: 'Revoke access', destructive: true })) revoke.mutate({ userId: row.original.user.id, boardId: b.id }) }}><XCircle className="h-3 w-3" /></button>
          </Badge>
        ))}
      </div>
    ) : <span className="text-xs text-muted-foreground">none</span>) },
    { id: 'grant', header: 'Grant access', size: 300, enableSorting: false, meta: { align: 'right' }, cell: ({ row }) => {
      const r = row.original
      return (
        <div className="flex items-center justify-end gap-2">
          <NativeSelect value={grantPick[r.user.id] ?? ''} onChange={(e) => setGrantPick((m) => ({ ...m, [r.user.id]: e.target.value }))} className="h-8 w-[190px] text-xs" disabled={!r.available.length}>
            <option value="">{r.available.length ? 'Choose a board' : 'All boards granted'}</option>
            {r.available.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
          </NativeSelect>
          <Button size="sm" className="h-8" disabled={!grantPick[r.user.id] || grant.isPending} onClick={() => grant.mutate({ userId: r.user.id, boardId: grantPick[r.user.id] })}><Plus /> Grant</Button>
        </div>
      )
    } },
  ], [me, grant, grantPick, revoke])

  /* ------------------------------------------------------------------ render */
  return (
    <>
      <PageHeader title="User Management" description="Superuser area: accounts, access requests, auth codes, Jira board access and registration policy." />

      <StatStrip cols={5}>
        <StatTile icon={Users} label="Total users" value={Object.values(counts).reduce((a, b) => a + b, 0)} />
        <StatTile icon={UserCog} label="Awaiting decision" value={requests.length} tone={requests.length ? 'orange' : 'default'} />
        <StatTile icon={ShieldCheck} label="Active" value={counts.active ?? 0} tone="green" />
        <StatTile icon={Ticket} label="Active role codes" value={roleCodes.filter((c) => c.usable).length} tone="blue" />
        <StatTile icon={Kanban} label="Linked boards" value={boardCodes.length} tone="grey" />
      </StatStrip>

      <Tabs defaultValue={requests.length ? 'requests' : 'users'}>
        <TabsList>
          <TabsTrigger value="users"><Users className="mr-1.5 h-3.5 w-3.5" /> Users ({allUsers.length})</TabsTrigger>
          <TabsTrigger value="requests"><UserCog className="mr-1.5 h-3.5 w-3.5" /> Access requests {requests.length > 0 && <span className="ml-1.5 rounded-full bg-amber-500 px-1.5 text-[10px] font-semibold text-white">{requests.length}</span>}</TabsTrigger>
          <TabsTrigger value="codes"><Ticket className="mr-1.5 h-3.5 w-3.5" /> Role auth codes ({roleCodes.length})</TabsTrigger>
          <TabsTrigger value="boards"><Kanban className="mr-1.5 h-3.5 w-3.5" /> Jira boards ({boardCodes.length})</TabsTrigger>
          <TabsTrigger value="policy"><Globe className="mr-1.5 h-3.5 w-3.5" /> Registration</TabsTrigger>
        </TabsList>

        <TabsContent value="users" className="space-y-4">
          <SettingsCard icon={Users} title="All users" description="Change roles inline, grant superuser (user-management) access to admins, disable accounts or issue a temporary password. Passwords are stored as one-way hashes; nobody can read them.">
            <DataTable data={allUsers} columns={userCols} pageSize={15} dense searchPlaceholder="Search name or e-mail" exportName="users" initialSorting={[{ id: 'created_at', desc: true }]}
              columnFilters={[
                { id: 'role', label: 'Role', options: ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })) },
                { id: 'status', label: 'Status', options: (Object.keys(STATUS_LABEL) as AccountStatus[]).map((s) => ({ value: s, label: STATUS_LABEL[s] })) },
              ]} emptyTitle="No users yet" />
          </SettingsCard>
          <Notice tone="info" icon={ShieldCheck}>Locked out user? Issue a temporary password (key icon): it is shown to you once, e-mailed to the user and must be changed at the next sign-in.</Notice>
        </TabsContent>

        <TabsContent value="requests">
          <SettingsCard icon={UserCog} title="Access requests" description="Admin sign-ups without a code and expired guests wait here. Accounts that have not verified their e-mail yet can be approved directly, which skips the e-mail check. You may grant a different role than requested." tone={requests.length ? 'warning' : 'default'}>
            {requests.length ? <DataTable data={requests} columns={requestCols} pageSize={10} dense searchPlaceholder="Search requests" initialSorting={[{ id: 'created_at', desc: false }]} /> : <EmptyState title="Nothing waiting" description="New requests appear here automatically; you are also notified by e-mail." />}
          </SettingsCard>
        </TabsContent>

        <TabsContent value="codes">
          <div className="grid gap-4 xl:grid-cols-[340px_1fr]">
            <SettingsCard icon={Plus} title="New role code" description="Employees, delivery managers and admins with a valid code are active immediately. Guests also verify their e-mail and get 5 days of demo access.">
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); createCode.mutate() }}>
                <div><Label>Role</Label><NativeSelect value={codeForm.role} onChange={(e) => setCodeForm((f) => ({ ...f, role: e.target.value as Role, board_id: '' }))} className="mt-1 h-9">{ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}</NativeSelect></div>
                {codeForm.role === 'dm' && (
                  <div><Label>Board (optional)</Label><NativeSelect value={codeForm.board_id} onChange={(e) => setCodeForm((f) => ({ ...f, board_id: e.target.value }))} className="mt-1 h-9"><option value="">No board - manager links own boards</option>{codes.data?.boards.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</NativeSelect></div>
                )}
                <div><Label>Label</Label><Input value={codeForm.label} onChange={(e) => setCodeForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Phoenix team onboarding" className="mt-1 h-9" /></div>
                <div className="grid grid-cols-2 gap-2">
                  <div><Label>Expires in (days)</Label><Input type="number" min={1} value={codeForm.expires_days} onChange={(e) => setCodeForm((f) => ({ ...f, expires_days: e.target.value }))} placeholder="never" className="mt-1 h-9" /></div>
                  <div><Label>Max uses</Label><Input type="number" min={1} value={codeForm.max_uses} onChange={(e) => setCodeForm((f) => ({ ...f, max_uses: e.target.value }))} placeholder="unlimited" className="mt-1 h-9" /></div>
                </div>
                <Button type="submit" size="sm" className="w-full" disabled={createCode.isPending}><Plus /> Generate code</Button>
                <p className="text-[11px] text-muted-foreground">Codes are stored encrypted. Share them only with the people who need them.</p>
              </form>
            </SettingsCard>
            <SettingsCard icon={Ticket} title="Role auth codes" description="Click a code to copy it. Revoked codes can be re-enabled; deleted codes are gone for good (existing accounts are not affected).">
              <DataTable data={roleCodes} columns={codeCols} pageSize={10} dense searchPlaceholder="Search codes or labels" initialSorting={[{ id: 'created_at', desc: true }]}
                columnFilters={[{ id: 'role', label: 'Role', options: ALL_ROLES.map((r) => ({ value: r, label: ROLE_LABEL[r] })) }, { id: 'state', label: 'State', options: [{ value: 'active', label: 'Active' }, { value: 'exhausted', label: 'Exhausted' }, { value: 'revoked', label: 'Revoked' }] }]}
                emptyTitle="No codes yet" emptyDescription="Generate one on the left and share it with the person." />
            </SettingsCard>
          </div>
        </TabsContent>

        <TabsContent value="boards" className="space-y-4">
          <SettingsCard icon={Users} title="Delivery managers and their Jira boards" description="Each manager sees the boards they linked themselves plus the boards you grant here. Granting consumes that board's code; revoking (x on a badge) removes the link immediately.">
            <DataTable data={dms.data?.items ?? []} columns={dmCols} pageSize={10} dense searchPlaceholder="Search delivery managers" emptyTitle="No delivery managers yet" />
          </SettingsCard>
          <SettingsCard icon={Kanban} title="Jira board auth codes" description="A BOARD code is created automatically whenever a manager links a board. Share it with another manager, who enters it on their welcome screen or on Jira Connections. Regenerate to invalidate a code that was shared too widely.">
            <DataTable data={boardCodes} columns={boardCodeCols} pageSize={10} dense searchPlaceholder="Search boards" exportName="board-codes" initialSorting={[{ id: 'created_at', desc: true }]} emptyTitle="No boards linked yet" />
          </SettingsCard>
        </TabsContent>

        <TabsContent value="policy">
          <SettingsCard icon={Globe} title="Who can register" description="Employees, delivery managers and admins must use an allowed e-mail domain. Allow-list individual addresses for people outside the company. Guests are vouched for by their code instead.">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allowed domains</p>
                <div className="flex min-h-8 flex-wrap gap-2">{policy.data?.domains.map((r) => <Badge key={r.id} variant="secondary" className="gap-1 pr-1">@{r.value}<button className="rounded p-0.5 hover:bg-foreground/10" onClick={async () => { if (await confirm({ title: `Remove ${r.value} from the allow-list?`, description: 'New sign-ups from it will be refused; existing accounts are unaffected.', confirmLabel: 'Remove', destructive: true })) removeRule.mutate(r.id) }} aria-label="Remove"><XCircle className="h-3 w-3" /></button></Badge>)}</div>
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newDomain.trim()) addRule.mutate({ kind: 'domain', value: newDomain.trim() }) }}>
                  <Input value={newDomain} onChange={(e) => setNewDomain(e.target.value)} placeholder="example.com" className="h-9" />
                  <Button type="submit" size="sm" variant="outline" className="h-9" disabled={addRule.isPending}>Add domain</Button>
                </form>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Allow-listed addresses</p>
                <div className="flex min-h-8 flex-wrap gap-2">{policy.data?.emails.length ? policy.data.emails.map((r) => <Badge key={r.id} variant="secondary" className="gap-1 pr-1">{r.value}<button className="rounded p-0.5 hover:bg-foreground/10" onClick={async () => { if (await confirm({ title: `Remove ${r.value} from the allow-list?`, description: 'New sign-ups from it will be refused; existing accounts are unaffected.', confirmLabel: 'Remove', destructive: true })) removeRule.mutate(r.id) }} aria-label="Remove"><XCircle className="h-3 w-3" /></button></Badge>) : <span className="text-xs text-muted-foreground">None</span>}</div>
                <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (newEmail.trim()) addRule.mutate({ kind: 'email', value: newEmail.trim() }) }}>
                  <Input value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="partner@external.com" className="h-9" type="email" />
                  <Button type="submit" size="sm" variant="outline" className="h-9" disabled={addRule.isPending}>Allow address</Button>
                </form>
              </div>
            </div>
          </SettingsCard>
        </TabsContent>
      </Tabs>

      <Dialog open={!!reject} onOpenChange={(o) => !o && setReject(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Reject access request</DialogTitle><DialogDescription>{reject?.name} ({reject?.email}) will be notified by e-mail and will not be able to sign in.</DialogDescription></DialogHeader>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional, included in the e-mail)" />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReject(null)}>Cancel</Button><Button variant="destructive" onClick={() => reject && doReject.mutate({ id: reject.id, reason: reason || undefined })} disabled={doReject.isPending}>Reject</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!extendUser} onOpenChange={(o) => !o && setExtendUser(null)}>
        <DialogContent className="sm:max-w-[420px]">
          <DialogHeader><DialogTitle>Extend guest access</DialogTitle><DialogDescription>{extendUser?.name} ({extendUser?.email}){extendUser?.access_expires_at ? ` currently until ${fmtDate(extendUser.access_expires_at)}` : ''}. Choose how many more days from today.</DialogDescription></DialogHeader>
          <div className="flex flex-wrap gap-2">{[5, 10, 30, 90].map((d) => <Button key={d} size="sm" variant={extendDays === d ? 'default' : 'outline'} onClick={() => setExtendDays(d)}>{d} days</Button>)}<Input type="number" min={1} value={extendDays} onChange={(e) => setExtendDays(Number(e.target.value) || 1)} className="h-9 w-24" /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setExtendUser(null)}>Cancel</Button><Button onClick={() => extendUser && extend.mutate({ id: extendUser.id, days: extendDays })} disabled={extend.isPending}><CalendarPlus /> Extend</Button></div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!temp} onOpenChange={(o) => !o && setTemp(null)}>
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader><DialogTitle>Temporary password issued</DialogTitle><DialogDescription>For {temp?.user.email}. {temp?.sent ? 'It was also e-mailed to the user.' : 'E-mail is not configured, so share it with the user securely.'} It is shown only once and must be changed at sign-in.</DialogDescription></DialogHeader>
          <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 font-mono text-lg tracking-wider">{temp?.password}<Button size="sm" variant="outline" onClick={() => temp && copy(temp.password)}>Copy</Button></div>
          <div className="flex justify-end"><Button onClick={() => setTemp(null)}>Done</Button></div>
        </DialogContent>
      </Dialog>
    </>
  )
}
