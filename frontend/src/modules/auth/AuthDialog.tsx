import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LogIn, MailCheck, ShieldCheck, Ticket, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label, NativeSelect } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { homeFor, useSession } from '@/hooks/useSession'
import { authApi, ROLE_HELP, ROLE_LABEL, type Role } from '@/services/authApi'
import { errorMessage } from '@/services/api'
import { cn } from '@/lib/utils'

export type AuthMode = 'login' | 'signup' | 'forgot'

const Req = () => <span className="text-red-500">*</span>

export function PasswordField({ value, onChange, label = 'Password', placeholder, autoComplete, hint }: { value: string; onChange: (v: string) => void; label?: string; placeholder?: string; autoComplete?: string; hint?: string }) {
  const [show, setShow] = useState(false)
  return (
    <div>
      <Label>{label}</Label>
      <div className="relative mt-1">
        <Input type={show ? 'text' : 'password'} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoComplete={autoComplete} required className="pr-10" />
        <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function PasswordStrength({ value }: { value: string }) {
  const checks = [
    ['10+ characters', value.length >= 10],
    ['Upper and lower case', /[a-z]/.test(value) && /[A-Z]/.test(value)],
    ['A digit', /\d/.test(value)],
    ['A symbol', /[^A-Za-z0-9]/.test(value)],
  ] as const
  const score = checks.filter(([, ok]) => ok).length
  return (
    <div className="space-y-1.5">
      <div className="flex gap-1">{[0, 1, 2, 3].map((i) => <i key={i} className={cn('h-1 flex-1 rounded-full bg-muted', i < score && (score < 3 ? 'bg-amber-500' : 'bg-emerald-500'))} />)}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
        {checks.map(([l, ok]) => <span key={l} className={cn('flex items-center gap-1', ok && 'text-emerald-600')}><CheckCircle2 className="h-3 w-3" />{l}</span>)}
      </div>
    </div>
  )
}

export function AuthDialog({ mode, open, onOpenChange, onSwitch, initialError }: { mode: AuthMode; open: boolean; onOpenChange: (o: boolean) => void; onSwitch: (m: AuthMode) => void; initialError?: string }) {
  const { signIn, signUp } = useSession()
  const nav = useNavigate()
  const { data: options } = useQuery({ queryKey: ['auth-options'], queryFn: authApi.options, staleTime: 5 * 60_000, enabled: open })
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [role, setRole] = useState<Role | ''>('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ kind: 'verify' | 'reset' | 'activated'; email: string; debugLink?: string; sent: boolean } | null>(null)

  useEffect(() => { if (open) { setError(initialError ?? null); setPassword(''); setConfirm(''); setDone(null) } }, [open, mode, initialError])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'login') {
        const u = await signIn(email, password)
        onOpenChange(false)
        nav(homeFor(u))
      } else if (mode === 'signup') {
        if (!role) throw new Error('Select your role')
        if (role !== 'admin' && !code.trim()) throw new Error('Auth code is required')
        if (password !== confirm) throw new Error('Passwords do not match')
        const r = await signUp({ name: name.trim(), email, password, confirm_password: confirm, requested_role: role, auth_code: code.trim() || undefined })
        setDone({ kind: r.activated ? 'activated' : 'verify', email: r.email, debugLink: r.debug_link, sent: r.email_sent })
      } else {
        const r = await authApi.forgotPassword(email.trim())
        setDone({ kind: 'reset', email: email.trim(), debugLink: r.debug_link, sent: r.email_sent })
      }
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const title = mode === 'login' ? <><LogIn className="h-4 w-4" /> Sign in</> : mode === 'signup' ? <><UserPlus className="h-4 w-4" /> Create your account</> : <><KeyRound className="h-4 w-4" /> Reset your password</>
  const desc = mode === 'login' ? 'Use your work e-mail to open the dashboards.' : mode === 'signup' ? null : 'Enter your e-mail and we will send you a link to choose a new password.'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{title}</DialogTitle>
          {desc && <DialogDescription>{desc}</DialogDescription>}
        </DialogHeader>

        {done ? (
          <div className="space-y-4 py-2">
            <div className="flex items-start gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4">
              {done.kind === 'activated' ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-600" /> : <MailCheck className="mt-0.5 h-5 w-5 text-emerald-600" />}
              <div className="text-sm">
                <p className="font-medium">{done.kind === 'activated' ? 'Your account is ready' : done.kind === 'verify' ? 'Check your inbox' : 'If that account exists, a link is on its way'}</p>
                <p className="mt-1 text-muted-foreground">
                  {done.kind === 'activated'
                    ? <>The auth code was accepted. <b>{done.email}</b> can sign in straight away.</>
                    : done.kind === 'verify'
                    ? <>We sent a verification link to <b>{done.email}</b>. Open it to activate your account{role === 'admin' && ', then a superuser will review your access request'}{role === 'guest' && '. Guest access lasts 5 days'}.</>
                    : <>Follow the link sent to <b>{done.email}</b> to choose a new password. It expires in 60 minutes.</>}
                </p>
                {!done.sent && done.debugLink && (
                  <p className="mt-2 rounded-md bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-700">E-mail delivery is not configured on this server. Development link: <a className="underline" href={done.debugLink}>open</a></p>
                )}
                {!done.sent && !done.debugLink && done.kind !== 'activated' && <p className="mt-2 text-[11px] text-amber-700">E-mail delivery is not configured on this server. Ask the administrator to complete the step for you.</p>}
              </div>
            </div>
            <Button className="w-full" variant={done.kind === 'activated' ? 'default' : 'outline'} onClick={() => onSwitch('login')}>{done.kind === 'activated' ? 'Sign in now' : 'Back to sign in'}</Button>
          </div>
        ) : (
          <form className="space-y-3" onSubmit={submit}>
            {mode === 'login' && options?.sso?.enabled && options.sso.login_url && (
              <>
                <Button asChild type="button" variant="outline" className="w-full">
                  <a href={`${options.sso.login_url}?next=${encodeURIComponent('/')}`} data-testid="sso-login">
                    <MicrosoftMark /> Sign in with {options.sso.label}
                  </a>
                </Button>
                {options.sso.local_login ? (
                  <div className="relative py-1 text-center text-[11px] uppercase tracking-wider text-muted-foreground">
                    <span className="relative z-10 bg-background px-2">or with e-mail</span>
                    <span className="absolute inset-x-0 top-1/2 -z-0 border-t" aria-hidden />
                  </div>
                ) : <p className="text-center text-xs text-muted-foreground">Use your company account. Guests and demo users: see the invitation e-mail.</p>}
              </>
            )}
            {mode === 'signup' && (
              <div><Label>Full name <Req /></Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1" autoComplete="name" required /></div>
            )}
            <div><Label>Work e-mail {mode === 'signup' && <Req />}</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@endava.com" className="mt-1" autoComplete="email" required /></div>
            {mode === 'signup' && (
              <>
                <div>
                  <Label>Role <Req /></Label>
                  <NativeSelect value={role} onChange={(e) => setRole(e.target.value as Role)} className={cn('mt-1', !role && 'text-muted-foreground')} required>
                    <option value="" disabled>Select your role</option>
                    {(options?.roles ?? (Object.keys(ROLE_LABEL) as Role[]).map((k) => ({ key: k, label: ROLE_LABEL[k] }))).map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </NativeSelect>
                  {role && <p className="mt-1 text-[11px] text-muted-foreground">{ROLE_HELP[role]}</p>}
                </div>
                <div>
                  <Label className="flex items-center gap-1"><Ticket className="h-3.5 w-3.5" /> Auth code {role === 'admin' ? <span className="font-normal text-muted-foreground">(not needed for Admin)</span> : <Req />}</Label>
                  <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={role === 'admin'}
                    placeholder={role === 'guest' ? 'GUEST-XXXX-XXXX' : role === 'dm' ? 'DM-XXXX-XXXX' : role === 'employee' ? 'EMP-XXXX-XXXX' : role === 'admin' ? 'Admins are approved by a superuser' : 'Enter the code you received'}
                    className="mt-1 font-mono uppercase tracking-wider" autoComplete="off" required={role !== 'admin'} />
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {role === 'admin' ? 'Admin requests are verified by e-mail and approved by a superuser.'
                      : role === 'guest' ? 'With a valid guest code you only need to confirm your e-mail (or a superuser can approve you directly).'
                      : 'A valid code for your role activates the account immediately: no e-mail verification, no approval.'}
                  </p>
                </div>
              </>
            )}
            {mode !== 'forgot' && (
              <PasswordField value={password} onChange={setPassword} label={mode === 'signup' ? 'Password *' : 'Password'} placeholder={mode === 'signup' ? 'Choose a strong password' : 'Your password'} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
            )}
            {mode === 'signup' && (
              <>
                <PasswordField value={confirm} onChange={setConfirm} label="Confirm password *" placeholder="Repeat the password" autoComplete="new-password" />
                <PasswordStrength value={password} />
              </>
            )}
            {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} <ArrowRight /></Button>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {mode === 'login' ? (
                <>
                  <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSwitch('forgot')}>Forgot password?</button>
                  <span>New here? <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSwitch('signup')}>Create an account</button></span>
                </>
              ) : (
                <span className="mx-auto">Already have an account? <button type="button" className="font-medium text-primary hover:underline" onClick={() => onSwitch('login')}>Sign in</button></span>
              )}
            </div>
            <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> Passwords are stored as one-way hashes. Nobody can read them.</p>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function MicrosoftMark() {
  return (
    <svg viewBox="0 0 21 21" className="h-4 w-4" aria-hidden>
      <rect x="1" y="1" width="9" height="9" fill="#F25022" /><rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" /><rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  )
}
