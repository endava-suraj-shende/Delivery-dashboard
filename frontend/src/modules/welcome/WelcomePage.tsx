import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowRight, BarChart3, FileOutput, GitCompareArrows, LogIn, Mail, Play, ServerCog, ShieldCheck, Sparkles, Timer, UserPlus, Users, Zap, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'
import './welcome.css'

/* ------------------------------------------------------------------ content */
const FEATURES: { icon: LucideIcon; title: string; desc: string; tone: string }[] = [
  { icon: BarChart3, title: 'Executive dashboard', desc: 'Delivery position across teams: status mix, people, projects and deployments on one screen.', tone: 'from-blue-500 to-cyan-400' },
  { icon: Users, title: 'Employee and team performance', desc: 'Assigned, completed, in progress and blocked work per person, with drill-down to every ticket.', tone: 'from-violet-500 to-fuchsia-400' },
  { icon: Timer, title: 'Sprint velocity', desc: 'Committed versus completed per sprint in tickets or story points, with averages for planning.', tone: 'from-emerald-500 to-teal-400' },
  { icon: ServerCog, title: 'Dev and production deployments', desc: 'What reached dev, what is pending, and every production release with its status.', tone: 'from-orange-500 to-amber-400' },
  { icon: GitCompareArrows, title: 'Period comparison', desc: 'Compare any two periods side by side and see who improved and where work is slipping.', tone: 'from-pink-500 to-rose-400' },
  { icon: FileOutput, title: 'Report Center', desc: 'Board-ready PDF, Excel and CSV reports built from the same numbers you see on screen.', tone: 'from-sky-500 to-indigo-400' },
]

const VALUES: { icon: LucideIcon; value: number | null; prefix?: string; suffix?: string; text?: string; label: string; tone: string }[] = [
  { icon: BarChart3, value: 12, suffix: '+', label: 'Dashboards and reports, one standard', tone: 'text-cyan-300' },
  { icon: FileOutput, value: 0, suffix: ' hrs', label: 'Building reports by hand', tone: 'text-emerald-300' },
  { icon: Zap, value: null, text: 'Live', label: 'Jira data, nothing to export', tone: 'text-amber-300' },
  { icon: ShieldCheck, value: 100, suffix: '%', label: 'Figures traceable to a ticket', tone: 'text-violet-300' },
]

function useCountUp(target: number, duration = 1100, delay = 0) {
  const [v, setV] = useState(0)
  useEffect(() => {
    let raf = 0
    const start = performance.now() + delay
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - start) / duration))
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, delay])
  return v
}

function ValueCard({ icon: Icon, value, prefix = '', suffix = '', text, label, tone, delay }: (typeof VALUES)[number] & { delay: number }) {
  const n = useCountUp(value ?? 0, 1100, 500 + delay)
  return (
    <TiltCard className="group p-4">
      <div className="flex items-center justify-between">
        <span className={cn('text-2xl font-semibold tabular-nums tracking-tight text-white')}>{text ?? `${prefix}${n}${suffix}`}</span>
        <span className={cn('flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 transition group-hover:bg-white/10', tone)}><Icon className="h-4 w-4" /></span>
      </div>
      <p className="mt-2 text-xs leading-5 text-slate-400">{label}</p>
    </TiltCard>
  )
}

/* ------------------------------------------------------------------ 3D hero scene */
function Scene() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onMove = (e: MouseEvent) => {
      const r = el.getBoundingClientRect()
      const x = (e.clientX - r.left) / r.width - 0.5
      const y = (e.clientY - r.top) / r.height - 0.5
      el.style.setProperty('--ry', `${-18 + x * 16}deg`)
      el.style.setProperty('--rx', `${12 - y * 10}deg`)
    }
    const reset = () => { el.style.setProperty('--ry', '-18deg'); el.style.setProperty('--rx', '12deg') }
    const host = el.parentElement!
    host.addEventListener('mousemove', onMove)
    host.addEventListener('mouseleave', reset)
    return () => { host.removeEventListener('mousemove', onMove); host.removeEventListener('mouseleave', reset) }
  }, [])
  const bars = [42, 68, 55, 80, 64, 90, 72]
  return (
    <div className="wl-scene relative mx-auto h-[420px] w-full max-w-[560px]">
      <div ref={ref} className="wl-stage h-full w-full">
        <div className="wl-orbit text-cyan-300"><span /></div>
        <div className="wl-orbit text-violet-300" style={{ inset: '-80px', animationDuration: '40s', animationDirection: 'reverse' }}><span /></div>

        {/* main dashboard panel */}
        <div className="wl-panel left-[6%] top-[10%] h-[280px] w-[70%] p-4" style={{ '--z': '0px', '--dur': '8s' } as React.CSSProperties}>
          <div className="mb-3 flex items-center justify-between">
            <span className="wl-panel-title">Delivery position</span>
            <span className="flex gap-1"><i className="h-2 w-2 rounded-full bg-red-400" /><i className="h-2 w-2 rounded-full bg-amber-400" /><i className="h-2 w-2 rounded-full bg-emerald-400" /></span>
          </div>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {[['Completed', '196', 'text-emerald-300'], ['In progress', '277', 'text-blue-300'], ['Blocked', '3', 'text-red-300']].map(([l, v, c]) => (
              <div key={l} className="rounded-lg border border-white/10 bg-white/5 p-2">
                <p className="text-[9px] uppercase tracking-wide text-slate-400">{l}</p>
                <p className={cn('text-lg font-semibold', c)}>{v}</p>
              </div>
            ))}
          </div>
          <div className="flex h-[120px] items-end gap-2 rounded-lg border border-white/10 bg-white/5 p-3">
            {bars.map((h, i) => (
              <div key={i} className="wl-bar flex-1 rounded-t-md bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${h}%`, '--d': `${0.2 + i * 0.12}s` } as React.CSSProperties} />
            ))}
          </div>
        </div>

        {/* donut panel */}
        <div className="wl-panel right-[2%] top-[0%] h-[170px] w-[34%] p-3" style={{ '--z': '70px', '--dur': '6.5s', '--delay': '-2s' } as React.CSSProperties}>
          <span className="wl-panel-title">Work status</span>
          <svg viewBox="0 0 100 100" className="mx-auto mt-1 h-[110px] w-[110px] -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#22c55e" strokeWidth="12" className="wl-ring" style={{ '--off': '110' } as React.CSSProperties} />
            <circle cx="50" cy="50" r="40" fill="none" stroke="#3b82f6" strokeWidth="12" className="wl-ring" style={{ '--off': '190', animationDelay: '1s' } as React.CSSProperties} />
          </svg>
        </div>

        {/* trend panel */}
        <div className="wl-panel bottom-[4%] right-[8%] h-[130px] w-[46%] p-3" style={{ '--z': '110px', '--dur': '7.5s', '--delay': '-4s' } as React.CSSProperties}>
          <span className="wl-panel-title">Velocity trend</span>
          <svg viewBox="0 0 200 70" className="mt-2 h-[80px] w-full">
            <defs><linearGradient id="wlg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#22d3ee" stopOpacity="0.5" /><stop offset="1" stopColor="#22d3ee" stopOpacity="0" /></linearGradient></defs>
            <path d="M0 60 L30 48 L60 52 L90 30 L120 36 L150 18 L180 22 L200 10 L200 70 L0 70 Z" fill="url(#wlg)" />
            <path d="M0 60 L30 48 L60 52 L90 30 L120 36 L150 18 L180 22 L200 10" fill="none" stroke="#22d3ee" strokeWidth="2.5" className="wl-line" />
          </svg>
        </div>

        {/* sprint velocity panel */}
        <div className="wl-panel left-[2%] -top-[6%] h-[132px] w-[36%] p-3" style={{ '--z': '170px', '--dur': '7s', '--delay': '-3s' } as React.CSSProperties}>
          <div className="flex items-center justify-between">
            <span className="wl-panel-title">Sprint velocity</span>
            <span className="rounded-full bg-emerald-400/15 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-300">92% done</span>
          </div>
          <div className="relative mt-2 h-[66px]">
            <div className="absolute inset-x-0 border-t border-dashed border-cyan-300/60" style={{ top: '22%' }}><span className="absolute -top-2 right-0 text-[7px] text-cyan-200">avg 33</span></div>
            <div className="flex h-full items-end gap-1.5">
              {[[30, 26], [34, 33], [28, 28], [38, 31], [36, 36], [40, 39]].map(([c, d], i) => (
                <div key={i} className="flex h-full flex-1 items-end gap-[2px]">
                  <div className="wl-bar w-1/2 rounded-t-sm bg-slate-400/40" style={{ height: `${(c / 42) * 100}%`, '--d': `${0.3 + i * 0.1}s` } as React.CSSProperties} />
                  <div className="wl-bar w-1/2 rounded-t-sm bg-gradient-to-t from-emerald-600 to-emerald-300" style={{ height: `${(d / 42) * 100}%`, '--d': `${0.4 + i * 0.1}s` } as React.CSSProperties} />
                </div>
              ))}
            </div>
          </div>
          <div className="mt-1 flex justify-between text-[7px] text-slate-500">{['S41', 'S42', 'S43', 'S44', 'S45', 'S46'].map((t) => <span key={t}>{t}</span>)}</div>
        </div>

        {/* deployments panel */}
        <div className="wl-panel -bottom-[4%] left-[20%] h-[74px] w-[42%] p-3" style={{ '--z': '120px', '--dur': '6.8s', '--delay': '-5s' } as React.CSSProperties}>
          <span className="wl-panel-title">Deployments</span>
          <div className="relative mt-2 grid grid-cols-3 gap-2 text-center">
            <span className="wl-pipe-dot" />
            {[['Dev pending', '18', 'text-amber-300'], ['Dev deployed', '41', 'text-sky-300'], ['Prod deployed', '37', 'text-emerald-300']].map(([l, v, c]) => (
              <div key={l} className="rounded-md border border-white/10 bg-white/5 px-1 py-1"><p className={cn('text-sm font-semibold leading-none', c)}>{v}</p><p className="mt-0.5 text-[8px] text-slate-400">{l}</p></div>
            ))}
          </div>
        </div>

        {/* people chip */}
        <div className="wl-panel bottom-[22%] left-[4%] flex h-[56px] w-[30%] items-center gap-2 p-2.5" style={{ '--z': '150px', '--dur': '6s', '--delay': '-1s' } as React.CSSProperties}>
          <div className="flex -space-x-2">
            {['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500'].map((c) => <span key={c} className={cn('h-6 w-6 rounded-full border-2 border-[#0b1020]', c)} />)}
          </div>
          <div><p className="text-[11px] font-medium leading-tight">181 people</p><p className="text-[9px] text-slate-400">10 boards, 12 projects</p></div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ auth dialogs */
function AuthDialog({ mode, open, onOpenChange, onSwitch }: { mode: 'login' | 'signup'; open: boolean; onOpenChange: (o: boolean) => void; onSwitch: () => void }) {
  const { signIn, signUp } = useSession()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (open) { setError(null); setPassword('') } }, [open, mode])
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true); setError(null)
    try {
      if (mode === 'login') await signIn(email.trim(), password)
      else await signUp(name, email.trim(), password)
      onOpenChange(false)
      nav('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">{mode === 'login' ? <><LogIn className="h-4 w-4" /> Sign in</> : <><UserPlus className="h-4 w-4" /> Create your account</>}</DialogTitle>
          <DialogDescription>{mode === 'login' ? 'Use your work email to open the dashboards.' : 'Access is for the delivery team and leadership. Use your work email.'}</DialogDescription>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          {mode === 'signup' && (
            <div><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="mt-1" autoComplete="name" required /></div>
          )}
          <div><Label>Work email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@endava.com" className="mt-1" autoComplete="email" required /></div>
          <div><Label>Password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'} className="mt-1" autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required /></div>
          {error && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? 'Please wait' : mode === 'login' ? 'Sign in' : 'Create account'} <ArrowRight /></Button>
          <p className="text-center text-xs text-muted-foreground">
            {mode === 'login' ? 'New here? ' : 'Already have an account? '}
            <button type="button" className="font-medium text-primary hover:underline" onClick={onSwitch}>{mode === 'login' ? 'Create an account' : 'Sign in'}</button>
          </p>
          <p className="flex items-center justify-center gap-1 text-[11px] text-muted-foreground"><ShieldCheck className="h-3 w-3" /> Trusted internal environment. No data leaves your network.</p>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ guided tour */
/* ------------------------------------------------------------------ product dialog */
function InfoDialog({ open, onOpenChange, eyebrow, title, lead, children }: { open: boolean; onOpenChange: (o: boolean) => void; eyebrow: string; title: string; lead: string; children: ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto border-white/10 bg-[#0b1020] text-slate-100 sm:max-w-[920px]">
        <DialogHeader>
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">{eyebrow}</p>
          <DialogTitle className="text-2xl font-semibold text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-400">{lead}</DialogDescription>
        </DialogHeader>
        <div className="mt-2">{children}</div>
      </DialogContent>
    </Dialog>
  )
}

function ProductDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <InfoDialog open={open} onOpenChange={onOpenChange} eyebrow="Product" title="Everything a delivery leader asks for, answered." lead="Each module is built on the same standardised statuses and colours, so a number on one page always means the same thing on another.">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {FEATURES.map((f) => {
          const Icon = f.icon
          return (
            <TiltCard key={f.title} className="p-5">
              <span className={cn('inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-lg', f.tone)}><Icon className="h-5 w-5" /></span>
              <h3 className="mt-3 text-base font-semibold">{f.title}</h3>
              <p className="mt-1.5 text-sm leading-6 text-slate-400">{f.desc}</p>
            </TiltCard>
          )
        })}
      </div>
    </InfoDialog>
  )
}

/* ------------------------------------------------------------------ helpers */
function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width - 0.5
    const y = (e.clientY - r.top) / r.height - 0.5
    el.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg) translateY(-4px)`
  }
  const reset = () => { if (ref.current) ref.current.style.transform = '' }
  return <div ref={ref} onMouseMove={onMove} onMouseLeave={reset} className={cn('wl-card wl-tilt rounded-2xl', className)}>{children}</div>
}

/* ------------------------------------------------------------------ background: 3D report diagram */
function ReportBackdrop() {
  return (
    <div className="wl-backdrop" aria-hidden>
      <div className="wl-backdrop-stage">
        {/* stacked report sheets */}
        <div className="wl-sheet" style={{ '--z': '-320px', '--x': '-44vw', '--y': '-22vh', '--r': '-16deg', '--dur': '14s' } as React.CSSProperties}>
          <div className="wl-sheet-head" /><div className="wl-sheet-rows"><i /><i /><i /><i /><i /></div>
        </div>
        <div className="wl-sheet" style={{ '--z': '-420px', '--x': '46vw', '--y': '-30vh', '--r': '18deg', '--dur': '16s', '--delay': '-5s' } as React.CSSProperties}>
          <div className="wl-sheet-head" />
          <div className="wl-sheet-bars"><i style={{ height: '45%' }} /><i style={{ height: '70%' }} /><i style={{ height: '55%' }} /><i style={{ height: '88%' }} /><i style={{ height: '62%' }} /></div>
        </div>
        <div className="wl-sheet" style={{ '--z': '-380px', '--x': '44vw', '--y': '34vh', '--r': '10deg', '--dur': '18s', '--delay': '-9s' } as React.CSSProperties}>
          <div className="wl-sheet-head" />
          <svg viewBox="0 0 100 40" className="mt-2 h-10 w-full"><path d="M0 34 L18 26 L36 30 L54 14 L72 20 L90 6 L100 10" fill="none" stroke="rgba(34,211,238,0.7)" strokeWidth="2" className="wl-line" /></svg>
        </div>
        <div className="wl-sheet" style={{ '--z': '-300px', '--x': '-42vw', '--y': '30vh', '--r': '-8deg', '--dur': '15s', '--delay': '-3s' } as React.CSSProperties}>
          <div className="wl-sheet-head" />
          <svg viewBox="0 0 100 100" className="mx-auto mt-1 h-16 w-16 -rotate-90"><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" /><circle cx="50" cy="50" r="40" fill="none" stroke="rgba(34,197,94,0.8)" strokeWidth="14" className="wl-ring" style={{ '--off': '95' } as React.CSSProperties} /></svg>
        </div>
        {/* floating particles */}
        {Array.from({ length: 18 }).map((_, i) => (
          <span key={i} className="wl-particle" style={{ left: `${(i * 53) % 100}%`, top: `${(i * 37) % 100}%`, '--dur': `${9 + (i % 5) * 2}s`, '--delay': `${-(i % 7)}s`, '--size': `${2 + (i % 3)}px` } as React.CSSProperties} />
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ page */
export default function WelcomePage() {
  const nav = useNavigate()
  const { user, signOut } = useSession()
  const loc = useLocation()
  const [auth, setAuth] = useState<null | 'login' | 'signup'>(((loc.state as { auth?: 'login' | 'signup' } | null)?.auth) ?? null)
  const [product, setProduct] = useState(false)

  return (
    <div className="wl-root relative flex min-h-screen flex-col">
      <div className="wl-aurora" />
      <div className="wl-grid" />
      <ReportBackdrop />

      {/* minimal top bar: actions only */}
      <header className="relative z-20">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white shadow-lg shadow-cyan-500/30"><BarChart3 className="h-5 w-5" /></span>
          </div>
          <nav className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setProduct(true)}>Product</Button>
            <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => nav('/demo')}><Play /> Demo</Button>
            <span className="mx-2 h-5 w-px bg-white/10" />
            {user ? (
              <>
                <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={signOut}>Sign out</Button>
                <Button size="sm" onClick={() => nav('/')}>Open dashboard <ArrowRight /></Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" className="text-slate-200 hover:bg-white/10 hover:text-white" onClick={() => setAuth('login')}><LogIn /> Log in</Button>
                <Button size="sm" className="wl-shimmer bg-gradient-to-r from-blue-500 to-cyan-400 text-white hover:from-blue-400 hover:to-cyan-300" onClick={() => setAuth('signup')}><UserPlus /> Sign up</Button>
              </>
            )}
          </nav>
        </div>
      </header>

      {/* hero */}
      <section className="relative z-10 flex flex-1 items-center">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-6 pb-16 pt-6 lg:grid-cols-[1.05fr_1fr]">
          <div>
            <p className="wl-fade-up inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200"><Sparkles className="h-3.5 w-3.5" /> Employee and project delivery performance</p>
            <h1 className="wl-fade-up mt-6 text-4xl font-semibold leading-[1.1] tracking-tight md:text-6xl" style={{ '--d': '0.1s' } as React.CSSProperties}>
              See delivery <span className="wl-gradient-text">clearly</span>.<br />Decide with <span className="wl-gradient-text">confidence</span>.
            </h1>
            <p className="wl-fade-up mt-6 max-w-xl text-lg leading-8 text-slate-400" style={{ '--d': '0.2s' } as React.CSSProperties}>
              One place for employee, team, sprint and deployment performance, straight from Jira. No spreadsheets to stitch together, no numbers to argue about.
            </p>
            <p className="wl-fade-up mt-4 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-slate-300" style={{ '--d': '0.3s' } as React.CSSProperties}>
              <Sparkles className="h-4 w-4 text-cyan-300" /> Built-in management insights flag overload, blockers and stale work on every page.
            </p>
            <div className="wl-fade-up mt-10 grid grid-cols-2 gap-3 border-t border-white/10 pt-6 lg:grid-cols-4" style={{ '--d': '0.4s' } as React.CSSProperties}>
              {VALUES.map((v, i) => <ValueCard key={v.label} {...v} delay={i * 150} />)}
            </div>
          </div>
          <div className="wl-fade-up" style={{ '--d': '0.25s' } as React.CSSProperties}><Scene /></div>
        </div>
      </section>

      {/* acknowledgement */}
      <section id="team" className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-14">
        <div className="mb-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Leadership and development acknowledgement</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight md:text-3xl">Every meaningful initiative begins with the right vision and guidance.</h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-slate-400">This dashboard has been conceptualised and developed with valuable guidance, direction and encouragement from:</p>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <TiltCard className="relative overflow-hidden p-7">
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-2xl" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-cyan-300">Project guidance and leadership</p>
            <div className="mt-5 flex items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-400 to-blue-600 text-xl font-bold text-white shadow-lg shadow-blue-500/30">GA</span>
              <div><h3 className="text-2xl font-semibold">Gangadhar Ambati</h3><p className="text-sm text-slate-400">Guidance, direction and continuous support in shaping this initiative.</p></div>
            </div>
            <a href="mailto:Gangadhar.Ambati@endava.com" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:border-cyan-400/50 hover:text-white"><Mail className="h-4 w-4" /> Gangadhar.Ambati@endava.com</a>
          </TiltCard>
          <TiltCard className="relative overflow-hidden p-7">
            <div className="absolute -right-16 -top-16 h-48 w-48 rounded-full bg-violet-400/10 blur-2xl" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-violet-300">Designed and developed by</p>
            <div className="mt-5 flex items-center gap-4">
              <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-400 to-fuchsia-600 text-xl font-bold text-white shadow-lg shadow-violet-500/30">SS</span>
              <div><h3 className="text-2xl font-semibold">Suraj Shende</h3><p className="text-sm text-slate-400">Solution design, development and implementation.</p></div>
            </div>
            <a href="mailto:Suraj-Gopal.Shende@endava.com" className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-200 transition hover:border-violet-400/50 hover:text-white"><Mail className="h-4 w-4" /> Suraj-Gopal.Shende@endava.com</a>
          </TiltCard>
        </div>
      </section>

      <footer className="relative z-10 border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-slate-500">
          <span>Employee Delivery Dashboard. Internal tool for a trusted environment.</span>
          <span>Endava | {new Date().getFullYear()}</span>
        </div>
      </footer>

      <AuthDialog mode={auth ?? 'login'} open={auth !== null} onOpenChange={(o) => !o && setAuth(null)} onSwitch={() => setAuth(auth === 'login' ? 'signup' : 'login')} />
      <ProductDialog open={product} onOpenChange={setProduct} />
    </div>
  )
}
