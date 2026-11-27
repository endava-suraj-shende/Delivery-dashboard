import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRight, BarChart3, CheckCircle2, Clock, KeyRound, LogOut, MailCheck, RefreshCw, ShieldCheck, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { homeFor, useSession } from '@/hooks/useSession'
import { authApi, ROLE_LABEL } from '@/services/authApi'
import { errorMessage } from '@/services/api'
import { PasswordField, PasswordStrength } from '@/modules/auth/AuthDialog'
import '@/modules/welcome/welcome.css'

function Shell({ icon, title, lead, children, tone = 'text-cyan-300' }: { icon: ReactNode; title: string; lead: string; children: ReactNode; tone?: string }) {
  return (
    <div className="wl-root relative flex min-h-screen items-center justify-center p-6">
      <div className="wl-aurora" />
      <div className="wl-grid" />
      <div className="relative z-10 w-full max-w-md">
        <Link to="/welcome" className="mb-6 flex items-center justify-center gap-2 text-slate-300 hover:text-white">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white"><BarChart3 className="h-5 w-5" /></span>
          <span className="text-sm font-semibold">Employee Delivery Dashboard</span>
        </Link>
        <div className="wl-card rounded-2xl p-7 text-slate-100">
          <div className={`mb-4 inline-flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 ${tone}`}>{icon}</div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-slate-400">{lead}</p>
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

const dark = 'border-white/15 bg-white/5 text-white hover:bg-white/10'
const primary = 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white hover:from-blue-400 hover:to-cyan-300'

/* ------------------------------------------------------------------ verify e-mail */
export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const nav = useNavigate()
  const q = useQuery({ queryKey: ['verify', token], queryFn: () => authApi.verifyEmail(token), enabled: !!token, retry: false })

  if (!token) return <Shell icon={<XCircle className="h-6 w-6" />} tone="text-red-300" title="Missing link" lead="This verification link is incomplete. Open the link from your e-mail again."><Button className={`w-full ${dark}`} variant="outline" onClick={() => nav('/welcome')}>Back to welcome</Button></Shell>
  if (q.isPending) return <Shell icon={<RefreshCw className="h-6 w-6 animate-spin" />} title="Verifying your e-mail" lead="One moment."><div /></Shell>
  if (q.isError) return (
    <Shell icon={<XCircle className="h-6 w-6" />} tone="text-red-300" title="Link not valid" lead={errorMessage(q.error)}>
      <Button className={`w-full ${primary}`} onClick={() => nav('/welcome?auth=signup')}>Sign up again</Button>
    </Shell>
  )
  const pending = q.data.status === 'pending_approval'
  return (
    <Shell icon={<CheckCircle2 className="h-6 w-6" />} tone="text-emerald-300" title="E-mail verified" lead={pending ? `Thanks. Your request for ${ROLE_LABEL[q.data.role]} access has been sent to a superuser for approval. You will receive an e-mail once it is reviewed.` : 'Your account is active. You can sign in now.'}>
      <Button className={`w-full ${primary}`} onClick={() => nav('/welcome?auth=login')}>Sign in <ArrowRight /></Button>
    </Shell>
  )
}

/* ------------------------------------------------------------------ reset password */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const nav = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const m = useMutation({ mutationFn: () => authApi.resetPassword(token, password, confirm) })
  const submit = (e: FormEvent) => { e.preventDefault(); m.mutate() }

  if (m.isSuccess) return (
    <Shell icon={<CheckCircle2 className="h-6 w-6" />} tone="text-emerald-300" title="Password updated" lead="Your password has been changed and other sessions were signed out. Sign in with the new password.">
      <Button className={`w-full ${primary}`} onClick={() => nav('/welcome?auth=login')}>Sign in <ArrowRight /></Button>
    </Shell>
  )
  return (
    <Shell icon={<KeyRound className="h-6 w-6" />} title="Choose a new password" lead="Use at least 10 characters with upper and lower case letters, a digit and a symbol.">
      <form className="space-y-3 text-slate-900 dark:text-slate-100" onSubmit={submit}>
        <div className="[&_label]:text-slate-300"><PasswordField value={password} onChange={setPassword} label="New password" autoComplete="new-password" /></div>
        <div className="[&_label]:text-slate-300"><PasswordField value={confirm} onChange={setConfirm} label="Confirm new password" autoComplete="new-password" /></div>
        <PasswordStrength value={password} />
        {m.isError && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{errorMessage(m.error)}</p>}
        <Button type="submit" className={`w-full ${primary}`} disabled={m.isPending || !token}>{m.isPending ? 'Saving' : 'Save new password'}</Button>
      </form>
    </Shell>
  )
}

/* ------------------------------------------------------------------ forced password change */
export function ChangePasswordPage() {
  const { user, setUser } = useSession()
  const nav = useNavigate()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const m = useMutation({
    mutationFn: () => authApi.changePassword(current, password, confirm),
    onSuccess: (u) => { setUser(u); nav(homeFor(u)) },
  })
  useEffect(() => { if (user && !user.must_change_password) nav(homeFor(user), { replace: true }) }, [user, nav])
  return (
    <Shell icon={<ShieldCheck className="h-6 w-6" />} title="Set your own password" lead="You signed in with a temporary password issued by an administrator. Choose a new password to continue.">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); m.mutate() }}>
        <div className="[&_label]:text-slate-300"><PasswordField value={current} onChange={setCurrent} label="Temporary password" autoComplete="current-password" /></div>
        <div className="[&_label]:text-slate-300"><PasswordField value={password} onChange={setPassword} label="New password" autoComplete="new-password" /></div>
        <div className="[&_label]:text-slate-300"><PasswordField value={confirm} onChange={setConfirm} label="Confirm new password" autoComplete="new-password" /></div>
        <PasswordStrength value={password} />
        {m.isError && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{errorMessage(m.error)}</p>}
        <Button type="submit" className={`w-full ${primary}`} disabled={m.isPending}>{m.isPending ? 'Saving' : 'Save and continue'} <ArrowRight /></Button>
      </form>
    </Shell>
  )
}

/* ------------------------------------------------------------------ waiting for approval */
export function PendingApprovalPage() {
  const { user, signOut, refresh } = useSession()
  const nav = useNavigate()
  const [checking, setChecking] = useState(false)
  useEffect(() => { if (user && user.status === 'active' && !user.access_expired) nav(homeFor(user), { replace: true }) }, [user, nav])
  useEffect(() => {
    const id = window.setInterval(() => { void refresh() }, 30_000)
    return () => window.clearInterval(id)
  }, [refresh])
  const check = async () => { setChecking(true); try { await refresh() } finally { setChecking(false) } }
  const rejected = user?.status === 'rejected'
  const expiredGuest = user?.role === 'guest' && (user.access_expired || user.status === 'pending_approval')
  return (
    <Shell icon={rejected ? <XCircle className="h-6 w-6" /> : <Clock className="h-6 w-6" />} tone={rejected ? 'text-red-300' : 'text-amber-300'}
      title={rejected ? 'Access not approved' : expiredGuest ? 'Your guest access has ended' : 'Thanks for signing up'}
      lead={rejected
        ? `Your request was not approved${user?.rejection_reason ? `: ${user.rejection_reason}` : ''}. Contact your administrator if you believe this is a mistake.`
        : expiredGuest
        ? `The 5-day guest window${user?.access_expires_at ? ` ended on ${new Date(user.access_expires_at).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}` : ' has ended'}. A superuser has been notified and can extend your access; this page checks automatically.`
        : `Your request for ${user ? ROLE_LABEL[user.requested_role] : ''} access is waiting for a superuser to approve it. You will receive an e-mail when it is reviewed; this page also checks automatically.`}>
      <div className="space-y-3">
        {user && (
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-xs font-semibold">{user.name.split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
            <div className="min-w-0"><p className="truncate font-medium">{user.name}</p><p className="truncate text-xs text-slate-400">{user.email}</p></div>
            <span className="ml-auto rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">{rejected ? 'Rejected' : expiredGuest ? 'Expired' : 'Pending'}</span>
          </div>
        )}
        {!rejected && <Button className={`w-full ${primary}`} onClick={check} disabled={checking}><RefreshCw className={checking ? 'animate-spin' : ''} /> Check status</Button>}
        <Button variant="outline" className={`w-full ${dark}`} onClick={async () => { await signOut(); nav('/welcome') }}><LogOut /> Sign out</Button>
        <p className="flex items-center justify-center gap-1 text-[11px] text-slate-500"><MailCheck className="h-3 w-3" /> E-mail verified</p>
      </div>
    </Shell>
  )
}
