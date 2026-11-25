import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ArrowRight, BarChart3, Bot, Brain, CheckCircle2, ChevronLeft, ChevronRight, Database, FileOutput, GitCompareArrows, Layers, LogIn, Pause, Play, Rocket, ServerCog, ShieldCheck, Sparkles, Target, Timer, Users, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { homeFor, useSession } from '@/hooks/useSession'
import { cn } from '@/lib/utils'
import './welcome.css'
import './demo.css'

/* ------------------------------------------------------------------ helpers */
function useCountUp(target: number, duration = 1200, delay = 0) {
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

function Reveal({ children, delay = 0, className }: { children: ReactNode; delay?: number; className?: string }) {
  return <div className={cn('dm-reveal', className)} style={{ '--d': `${delay}s` } as React.CSSProperties}>{children}</div>
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="dm-note">
      <span className="dm-note-dot" />
      <p>{children}</p>
    </div>
  )
}

function Frame({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('dm-frame', className)}>
      <div className="dm-frame-bar">
        <span className="flex gap-1"><i className="h-2 w-2 rounded-full bg-red-400" /><i className="h-2 w-2 rounded-full bg-amber-400" /><i className="h-2 w-2 rounded-full bg-emerald-400" /></span>
        <span className="text-[11px] text-slate-400">{title}</span>
        <span className="w-10" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Kpi({ label, value, tone, delay = 0, suffix = '' }: { label: string; value: number; tone: string; delay?: number; suffix?: string }) {
  const v = useCountUp(value, 1200, delay)
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-3">
      <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={cn('mt-1 text-2xl font-semibold tabular-nums', tone)}>{v}{suffix}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ chapter visuals */
function VisualChallenge() {
  const pains = ['Five spreadsheets, five answers', 'Status known a week late', 'Who is overloaded? Nobody knows', 'Reports rebuilt by hand every Friday']
  return (
    <div className="relative h-full">
      <div className="grid gap-3">
        {pains.map((p, i) => (
          <Reveal key={p} delay={0.2 + i * 0.25}>
            <div className="dm-pain flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/5 px-4 py-3 text-sm text-red-100">
              <span className="h-2 w-2 rounded-full bg-red-400" />{p}
            </div>
          </Reveal>
        ))}
      </div>
      <Reveal delay={1.5} className="mt-5">
        <div className="dm-glow flex items-center gap-3 rounded-2xl border border-cyan-400/40 bg-gradient-to-r from-cyan-500/15 to-blue-500/15 px-5 py-4">
          <CheckCircle2 className="h-6 w-6 text-cyan-300" />
          <div>
            <p className="font-semibold text-white">One source of truth, live from Jira</p>
            <p className="text-sm text-slate-300">Every number traceable to a ticket. Same colour, same meaning, every page.</p>
          </div>
        </div>
      </Reveal>
    </div>
  )
}

function VisualFlow() {
  const cols: { icon: LucideIcon; title: string; items: string[]; tone: string }[] = [
    { icon: Database, title: 'Sources', items: ['Jira Cloud boards', 'Scrum and Kanban', 'Excel workbooks (optional)'], tone: 'text-sky-300' },
    { icon: ShieldCheck, title: 'Engine', items: ['Encrypted credentials', 'Standardised statuses', 'Cached analytics'], tone: 'text-emerald-300' },
    { icon: BarChart3, title: 'Outputs', items: ['Dashboards', 'Comparisons', 'PDF / Excel reports'], tone: 'text-violet-300' },
  ]
  return (
    <div className="relative grid h-full grid-cols-3 items-center gap-4">
      <div className="dm-flow-line" />
      {cols.map((c, i) => {
        const Icon = c.icon
        return (
          <Reveal key={c.title} delay={0.2 + i * 0.35}>
            <div className="dm-frame relative z-10 p-4">
              <Icon className={cn('h-6 w-6', c.tone)} />
              <p className="mt-2 font-semibold">{c.title}</p>
              <ul className="mt-2 space-y-1.5 text-sm text-slate-300">
                {c.items.map((it) => <li key={it} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-slate-500" />{it}</li>)}
              </ul>
            </div>
          </Reveal>
        )
      })}
    </div>
  )
}

function VisualExecutive() {
  const seg = [['Completed', 42, '#22c55e'], ['In progress', 31, '#3b82f6'], ['Review', 10, '#8b5cf6'], ['Testing', 9, '#f59e0b'], ['Backlog', 8, '#64748b']] as const
  return (
    <Frame title="Executive dashboard">
      <div className="grid grid-cols-4 gap-2">
        <Kpi label="Tickets" value={473} tone="text-white" />
        <Kpi label="Completed" value={196} tone="text-emerald-300" delay={100} />
        <Kpi label="In progress" value={277} tone="text-blue-300" delay={200} />
        <Kpi label="Blocked" value={3} tone="text-red-300" delay={300} />
      </div>
      <div className="mt-3 grid grid-cols-[1fr_1.4fr] gap-3">
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Work status</p>
          <svg viewBox="0 0 100 100" className="mx-auto mt-1 h-[120px] w-[120px] -rotate-90">
            <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="14" />
            {seg.reduce<{ acc: number; nodes: ReactNode[] }>((s, [l, v, c], i) => {
              const len = (v / 100) * 251.2
              s.nodes.push(<circle key={l} cx="50" cy="50" r="40" fill="none" stroke={c} strokeWidth="14" strokeDasharray={`${len} ${251.2 - len}`} strokeDashoffset={-s.acc} className="dm-arc" style={{ '--d': `${i * 0.15}s` } as React.CSSProperties} />)
              return { acc: s.acc + len, nodes: s.nodes }
            }, { acc: 0, nodes: [] }).nodes}
          </svg>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-400">Status by team</p>
          <div className="mt-2 space-y-2">
            {[['Platform', [55, 30, 15]], ['Data', [40, 45, 15]], ['Web', [62, 28, 10]], ['Mobile', [35, 40, 25]]].map(([n, p], i) => (
              <div key={n as string} className="flex items-center gap-2 text-xs">
                <span className="w-14 text-slate-300">{n as string}</span>
                <div className="flex h-3 flex-1 overflow-hidden rounded-full bg-white/5">
                  {(p as number[]).map((w, j) => <i key={j} className="dm-seg" style={{ width: `${w}%`, background: ['#22c55e', '#3b82f6', '#64748b'][j], '--d': `${0.2 + i * 0.1 + j * 0.1}s` } as React.CSSProperties} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Frame>
  )
}

function VisualEmployees() {
  const rows = [['Priya S.', 24, 18, 5, 82], ['Rahul M.', 20, 12, 7, 70], ['Anita K.', 18, 16, 2, 93], ['Vikram D.', 22, 9, 10, 55], ['Neha P.', 15, 13, 2, 90]] as const
  return (
    <Frame title="Employee performance">
      <table className="w-full text-sm">
        <thead><tr className="text-[10px] uppercase tracking-wide text-slate-400"><th className="pb-2 text-left font-medium">Employee</th><th className="pb-2 text-right font-medium">Assigned</th><th className="pb-2 text-right font-medium">Completed</th><th className="pb-2 text-right font-medium">In progress</th><th className="w-[30%] pb-2 pl-4 text-left font-medium">Progress</th></tr></thead>
        <tbody>
          {rows.map(([n, a, c, p, pr], i) => (
            <tr key={n} className="dm-row border-t border-white/5" style={{ '--d': `${0.15 + i * 0.12}s` } as React.CSSProperties}>
              <td className="py-2"><span className="inline-flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 text-[10px] font-semibold">{n.slice(0, 1)}</span>{n}</span></td>
              <td className="py-2 text-right tabular-nums">{a}</td>
              <td className="py-2 text-right tabular-nums text-emerald-300">{c}</td>
              <td className="py-2 text-right tabular-nums text-blue-300">{p}</td>
              <td className="py-2 pl-4"><div className="flex items-center gap-2"><div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5"><i className="dm-seg block h-full rounded-full" style={{ width: `${pr}%`, background: pr >= 80 ? '#22c55e' : pr >= 60 ? '#f59e0b' : '#ef4444', '--d': `${0.4 + i * 0.12}s` } as React.CSSProperties} /></div><span className="w-9 text-right text-xs tabular-nums">{pr}%</span></div></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Frame>
  )
}

function VisualVelocity() {
  const sprints = [['S41', 34, 28], ['S42', 36, 33], ['S43', 30, 30], ['S44', 40, 31], ['S45', 38, 36], ['S46', 42, 39]] as const
  return (
    <Frame title="Sprint velocity">
      <div className="flex h-[200px] items-end gap-4 px-2">
        {sprints.map(([s, c, d], i) => (
          <div key={s} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex h-[170px] w-full items-end justify-center gap-1">
              <i className="dm-grow w-1/2 rounded-t-md bg-slate-500/70" style={{ height: `${(c / 45) * 100}%`, '--d': `${0.1 + i * 0.1}s` } as React.CSSProperties} />
              <i className="dm-grow w-1/2 rounded-t-md bg-gradient-to-t from-blue-600 to-cyan-400" style={{ height: `${(d / 45) * 100}%`, '--d': `${0.25 + i * 0.1}s` } as React.CSSProperties} />
            </div>
            <span className="text-[10px] text-slate-400">{s}</span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-between text-xs text-slate-300">
        <span className="flex items-center gap-3"><span className="flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-slate-500/70" />Committed</span><span className="flex items-center gap-1"><i className="h-2 w-3 rounded-sm bg-cyan-400" />Completed</span></span>
        <span>Average velocity <b className="text-white">33 tickets</b> | Done <b className="text-emerald-300">90%</b></span>
      </div>
    </Frame>
  )
}

function VisualDeployments() {
  const stages = [['Dev pending', 18, 'border-amber-400/40 text-amber-200'], ['Dev deployed', 41, 'border-sky-400/40 text-sky-200'], ['Prod deployed', 37, 'border-emerald-400/40 text-emerald-200']] as const
  return (
    <Frame title="Deployments">
      <div className="relative grid grid-cols-3 gap-6 py-4">
        <div className="dm-pipe" />
        <span className="dm-dot" /><span className="dm-dot" style={{ animationDelay: '1.3s' }} /><span className="dm-dot" style={{ animationDelay: '2.6s' }} />
        {stages.map(([l, v, cls], i) => (
          <Reveal key={l} delay={0.2 + i * 0.3}>
            <div className={cn('relative z-10 rounded-2xl border bg-[#0b1020] p-4 text-center', cls.split(' ')[0])}>
              <p className="text-[10px] uppercase tracking-wide text-slate-400">{l}</p>
              <p className={cn('mt-1 text-3xl font-semibold tabular-nums', cls.split(' ')[1])}><Count v={v} delay={200 + i * 300} /></p>
            </div>
          </Reveal>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
        {[['Release 2.14', 'Prod deployed', 'text-emerald-300'], ['Release 2.15', 'Dev deployed', 'text-sky-300'], ['Hotfix 2.14.1', 'Prod deployed', 'text-emerald-300'], ['Release 2.16', 'Dev pending', 'text-amber-300']].map(([r, s, c], i) => (
          <div key={r} className="dm-row flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2" style={{ '--d': `${0.9 + i * 0.1}s` } as React.CSSProperties}><span>{r}</span><span className={c}>{s}</span></div>
        ))}
      </div>
    </Frame>
  )
}
function Count({ v, delay }: { v: number; delay: number }) { return <>{useCountUp(v, 1000, delay)}</> }

function VisualCompare() {
  const rows = [['Completed', 164, 196, true], ['In progress', 301, 277, false], ['Blocked', 9, 3, false], ['Prod deployed', 28, 37, true]] as const
  return (
    <Frame title="Period comparison">
      <div className="grid grid-cols-[1.2fr_1fr_1fr_1fr] gap-y-2 text-sm">
        <span className="text-[10px] uppercase tracking-wide text-slate-400">Metric</span><span className="text-right text-[10px] uppercase tracking-wide text-slate-400">Period A (earlier)</span><span className="text-right text-[10px] uppercase tracking-wide text-slate-400">Period B (later)</span><span className="text-right text-[10px] uppercase tracking-wide text-slate-400">Change</span>
        {rows.map(([m, a, b, up], i) => {
          const d = b - a
          const good = up ? d >= 0 : d <= 0
          return (
            <div key={m} className="dm-row contents" style={{ '--d': `${0.15 + i * 0.15}s` } as React.CSSProperties}>
              <span className="py-1.5 text-slate-200">{m}</span>
              <span className="py-1.5 text-right tabular-nums text-slate-400">{a}</span>
              <span className="py-1.5 text-right tabular-nums text-white">{b}</span>
              <span className="py-1.5 text-right"><span className={cn('rounded-full px-2 py-0.5 text-xs font-medium tabular-nums', good ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300')}>{d > 0 ? '+' : ''}{d}</span></span>
            </div>
          )
        })}
      </div>
      <p className="mt-4 text-xs text-slate-400">Compare any two sprints, months or custom ranges. Per-employee deltas show who improved and where work is slipping.</p>
    </Frame>
  )
}

function VisualReports() {
  return (
    <div className="relative flex h-full items-center justify-center">
      {[2, 1, 0].map((i) => (
        <div key={i} className="dm-page absolute w-[260px] rounded-lg border border-white/10 bg-[#0f1629] p-4 shadow-2xl" style={{ '--i': i, '--d': `${0.2 + (2 - i) * 0.25}s` } as React.CSSProperties}>
          <div className="h-2 w-1/2 rounded bg-gradient-to-r from-blue-400 to-cyan-300" />
          <div className="mt-3 grid grid-cols-4 gap-1">{[0, 1, 2, 3].map((k) => <div key={k} className="h-8 rounded bg-white/5" />)}</div>
          <div className="mt-3 space-y-1.5">{[90, 75, 85, 60, 70].map((w, k) => <div key={k} className="h-1.5 rounded bg-white/10" style={{ width: `${w}%` }} />)}</div>
          <div className="mt-3 flex h-12 items-end gap-1">{[40, 70, 55, 85, 60, 90].map((h, k) => <i key={k} className="flex-1 rounded-t bg-cyan-400/60" style={{ height: `${h}%` }} />)}</div>
        </div>
      ))}
      <div className="absolute bottom-0 flex gap-2">
        {['PDF', 'Excel', 'CSV'].map((f, i) => <Reveal key={f} delay={1 + i * 0.15}><span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs font-medium">{f}</span></Reveal>)}
      </div>
    </div>
  )
}

function Typewriter({ text, delay = 0, speed = 18 }: { text: string; delay?: number; speed?: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let i = 0
    let id: number
    const t = window.setTimeout(() => { id = window.setInterval(() => { i += 1; setN(i); if (i >= text.length) window.clearInterval(id) }, speed) }, delay)
    return () => { window.clearTimeout(t); window.clearInterval(id) }
  }, [text, delay, speed])
  return <>{text.slice(0, n)}<span className={cn('dm-caret', n >= text.length && 'opacity-0')} /></>
}

function VisualAI() {
  const insights = [
    ['warning', 'Vikram D. has 10 tickets in progress against 9 completed; consider rebalancing before sprint close.'],
    ['positive', 'Prod deployments up 32% versus the previous period; release cadence is improving.'],
    ['info', 'Platform team completion rate 90%, above the 82% team average for the third sprint running.'],
  ] as const
  return (
    <Frame title="Insights">
      <div className="flex items-center gap-2 text-xs text-slate-400"><Bot className="h-4 w-4 text-cyan-300" /> Generated from the same numbers shown on screen</div>
      <div className="mt-3 space-y-2">
        {insights.map(([k, t], i) => (
          <div key={t} className="dm-row flex gap-3 rounded-xl border border-white/10 bg-white/5 p-3 text-sm" style={{ '--d': `${0.2 + i * 1.6}s` } as React.CSSProperties}>
            <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', k === 'warning' ? 'bg-amber-400' : k === 'positive' ? 'bg-emerald-400' : 'bg-sky-400')} />
            <p className="text-slate-200"><Typewriter text={t} delay={300 + i * 1600} /></p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 p-3"><p className="font-semibold text-emerald-200">Available today</p><p className="mt-1 text-slate-300">Rule-based management insights on every page: overload, blockers, stale work, delivery trends.</p></div>
        <div className="rounded-lg border border-violet-400/30 bg-violet-500/10 p-3"><p className="font-semibold text-violet-200">Roadmap</p><p className="mt-1 text-slate-300">AI narrative summaries, risk forecasts for sprints and natural-language questions on your data.</p></div>
      </div>
    </Frame>
  )
}

function VisualRoadmap() {
  const items: { icon: LucideIcon; when: string; title: string; desc: string; state: 'done' | 'next' | 'later' }[] = [
    { icon: Layers, when: 'Today', title: 'Jira and Excel, dashboards, reports', desc: 'Executive, employee, team, sprint, deployment and comparison views with PDF/Excel export.', state: 'done' },
    { icon: Brain, when: 'Next', title: 'AI narrative summaries', desc: 'One-paragraph management summaries generated per team, sprint and employee.', state: 'next' },
    { icon: Target, when: 'Next', title: 'Sprint risk forecast', desc: 'Predict carry-over and at-risk commitments from velocity history.', state: 'next' },
    { icon: Rocket, when: 'Later', title: 'Ask the dashboard', desc: 'Natural-language questions answered with the right chart and the tickets behind it.', state: 'later' },
  ]
  return (
    <div className="relative h-full pl-6">
      <div className="absolute bottom-2 left-[11px] top-2 w-px bg-gradient-to-b from-emerald-400 via-violet-400 to-slate-600" />
      <div className="space-y-4">
        {items.map((it, i) => {
          const Icon = it.icon
          return (
            <Reveal key={it.title} delay={0.2 + i * 0.3}>
              <div className="relative">
                <span className={cn('absolute -left-6 top-1 h-3 w-3 -translate-x-[5px] rounded-full ring-4 ring-[#070b16]', it.state === 'done' ? 'bg-emerald-400' : it.state === 'next' ? 'bg-violet-400' : 'bg-slate-500')} />
                <div className="dm-frame p-4">
                  <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide"><Icon className="h-4 w-4 text-cyan-300" /><span className={it.state === 'done' ? 'text-emerald-300' : it.state === 'next' ? 'text-violet-300' : 'text-slate-400'}>{it.when}</span></div>
                  <p className="mt-1 font-semibold">{it.title}</p>
                  <p className="mt-0.5 text-sm text-slate-400">{it.desc}</p>
                </div>
              </div>
            </Reveal>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ chapters */
type Chapter = { id: string; icon: LucideIcon; label: string; eyebrow: string; title: string; lead: string; points: string[]; note: string; visual: () => ReactNode; audience?: string }

const CHAPTERS: Chapter[] = [
  { id: 'challenge', icon: Target, label: 'The challenge', eyebrow: 'Why this exists', title: 'Where does delivery actually stand?', lead: 'Leaders spend hours stitching spreadsheets together and still argue about the numbers. The dashboard replaces that with one live, traceable view.', points: ['Single source of truth for people, teams, sprints and releases', 'Every figure links back to a Jira ticket', 'Zero manual reporting effort'], note: 'Open with the pain: late, inconsistent and manual status. Then land the promise: one view, always current.', visual: VisualChallenge, audience: 'Delivery leads, programme managers' },
  { id: 'data', icon: Database, label: 'How data flows', eyebrow: 'Architecture in one slide', title: 'Jira in, insight out. Nothing to export.', lead: 'Boards are connected once with encrypted credentials. Statuses from different boards are mapped to one standard set so a colour always means the same thing.', points: ['Jira Cloud (Scrum and Kanban), multiple sites', 'Optional Excel workbooks for legacy periods', 'Analytics cached for instant filtering'], note: 'Reassure on security (tokens encrypted at rest) and on effort (no exports, no ETL team).', visual: VisualFlow, audience: 'IT, security, PMO' },
  { id: 'exec', icon: BarChart3, label: 'Executive view', eyebrow: 'Module 1', title: 'The delivery position in ten seconds.', lead: 'Status mix, work type split, open work by project and deployments, with board, project, sprint and date filters that drive every chart.', points: ['KPI tiles with period change', 'Status by team and by project', 'Click any segment to drill down'], note: 'This is the screen leadership opens every Monday. Emphasise consistency: same colours as every other page and every report.', visual: VisualExecutive, audience: 'Leadership' },
  { id: 'people', icon: Users, label: 'Employees and teams', eyebrow: 'Module 2', title: 'Understand every person without micromanaging.', lead: 'Assigned, completed, in progress and deployed work per employee with a weighted progress score, then drill into tickets and work notes.', points: ['Employee flow table: assigned to prod deployed', 'Current versus previous period change pills', 'Team roll-ups with the same layout'], note: 'Frame this as support, not surveillance: it shows load and blockers so managers can rebalance early.', visual: VisualEmployees, audience: 'Delivery managers, team leads' },
  { id: 'velocity', icon: Timer, label: 'Sprint velocity', eyebrow: 'Module 3', title: 'Plan the next sprint on evidence.', lead: 'Committed versus completed per sprint, in tickets or story points, with carry-over and the running average for the last 5, 10 or 15 sprints.', points: ['Tickets or points toggle', 'Carry-over and done percentage per sprint', 'Active sprint always first'], note: 'Show how the average velocity becomes the commitment ceiling for planning.', visual: VisualVelocity, audience: 'Scrum masters, product owners' },
  { id: 'deploy', icon: ServerCog, label: 'Deployments', eyebrow: 'Module 4', title: 'From dev pending to production, tracked.', lead: 'What reached dev, what is still pending, and every production release with its status, by employee and by project.', points: ['Dev and production pipelines', 'Status breakdown per employee', 'Release list with dates and owners'], note: 'Link delivery to business value: a ticket is only done when it is in production.', visual: VisualDeployments, audience: 'Release managers' },
  { id: 'compare', icon: GitCompareArrows, label: 'Period comparison', eyebrow: 'Module 5', title: 'Did we improve? Prove it.', lead: 'Put any two periods side by side: team totals and per-employee deltas, colour-coded so improvement and slippage are obvious.', points: ['Period A (earlier) versus Period B (later)', 'Per-employee change pills', 'Works for sprints, months or custom ranges'], note: 'Useful for quarterly reviews and retrospectives.', visual: VisualCompare, audience: 'Leadership, HR partners' },
  { id: 'reports', icon: FileOutput, label: 'Report Center', eyebrow: 'Module 6', title: 'Board-ready reports in three steps.', lead: 'Choose a report type, pick the period and filters, and generate a PDF, Excel or CSV built from exactly the numbers on screen.', points: ['Consolidated management pack or individual report', 'Colour-coded tables and KPI tiles', 'Recent reports kept for re-download'], note: 'Close the loop: what you present is what the dashboard shows. No re-keying.', visual: VisualReports, audience: 'PMO, programme managers' },
  { id: 'ai', icon: Sparkles, label: 'Insights and AI', eyebrow: 'Intelligence layer', title: 'The dashboard tells you what to look at.', lead: 'Management insights are generated on every page from the live data: overload, blockers, stale work and trends. AI narrative summaries and forecasts are next.', points: ['Rule-based insights available today', 'AI summaries and sprint risk forecasts on the roadmap', 'Always grounded in ticket-level data'], note: 'Be clear on what is live versus roadmap. The value today is already real; AI extends it.', visual: VisualAI, audience: 'Everyone' },
  { id: 'roadmap', icon: Rocket, label: 'Roadmap and next steps', eyebrow: 'Where this goes', title: 'Built to grow with the organisation.', lead: 'The foundation is live. The next phases add AI narrative, forecasting and natural-language questions on top of the same trusted data.', points: ['Onboard a board in minutes', 'Scale to more teams and sites', 'Feedback loop with stakeholders'], note: 'End with the ask: nominate a pilot team and a board to connect this week.', visual: VisualRoadmap, audience: 'Sponsors' },
]

const SLIDE_MS = 14000

/* ------------------------------------------------------------------ page */
export default function DemoPage() {
  const nav = useNavigate()
  const { user } = useSession()
  const [i, setI] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [notes, setNotes] = useState(true)
  const ch = CHAPTERS[i]
  const Visual = ch.visual
  const Icon = ch.icon

  const go = useCallback((n: number) => setI((Math.max(0, Math.min(CHAPTERS.length - 1, n)))), [])
  const next = useCallback(() => setI((v) => (v + 1) % CHAPTERS.length), [])
  const prev = useCallback(() => setI((v) => (v - 1 + CHAPTERS.length) % CHAPTERS.length), [])

  useEffect(() => {
    if (!playing) return
    const t = window.setTimeout(next, SLIDE_MS)
    return () => window.clearTimeout(t)
  }, [i, playing, next])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); next() }
      if (e.key === 'ArrowLeft') prev()
      if (e.key === 'Escape') nav('/welcome')
      if (e.key.toLowerCase() === 'p') setPlaying((p) => !p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, prev, nav])

  const progress = useMemo(() => ((i + 1) / CHAPTERS.length) * 100, [i])

  return (
    <div className="wl-root dm-root relative flex h-screen flex-col overflow-hidden">
      <div className="wl-aurora" />
      <div className="wl-grid" />

      {/* top bar */}
      <header className="relative z-20 flex h-14 items-center justify-between border-b border-white/10 px-5">
        <div className="flex items-center gap-3">
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => nav('/welcome')}><ArrowLeft /> Back</Button>
          <span className="hidden text-sm text-slate-400 sm:inline">Product demo</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setNotes((n) => !n)}>{notes ? 'Hide notes' : 'Show notes'}</Button>
          <Button size="sm" variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => setPlaying((p) => !p)}>{playing ? <><Pause /> Pause</> : <><Play /> Play</>}</Button>
          {user ? <Button size="sm" onClick={() => nav(homeFor(user))}>Open dashboard <ArrowRight /></Button> : <Button size="sm" className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white hover:from-blue-400 hover:to-cyan-300" onClick={() => nav('/welcome?auth=login')}><LogIn /> Log in</Button>}
        </div>
      </header>
      <div className="relative z-20 h-0.5 w-full bg-white/5"><div className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500" style={{ width: `${progress}%` }} /></div>

      <div className="relative z-10 grid min-h-0 flex-1 grid-cols-[240px_1fr]">
        {/* chapter list */}
        <aside className="hidden min-h-0 overflow-y-auto border-r border-white/10 p-3 md:block">
          {CHAPTERS.map((c, k) => {
            const CI = c.icon
            return (
              <button key={c.id} onClick={() => go(k)} className={cn('mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition', k === i ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200')}>
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-[11px] font-semibold', k === i ? 'border-cyan-400/50 bg-cyan-400/10 text-cyan-200' : k < i ? 'border-emerald-400/30 text-emerald-300' : 'border-white/10')}>{k < i ? <CheckCircle2 className="h-3.5 w-3.5" /> : k + 1}</span>
                <span className="flex-1 truncate">{c.label}</span>
                <CI className="h-4 w-4 shrink-0 opacity-60" />
              </button>
            )
          })}
        </aside>

        {/* stage */}
        <main className="min-h-0 overflow-y-auto">
          <div key={ch.id} className="mx-auto grid h-full max-w-6xl items-center gap-10 px-8 py-8 lg:grid-cols-[1fr_1.15fr]">
            <div>
              <Reveal><p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-200"><Icon className="h-3.5 w-3.5" /> {ch.eyebrow}</p></Reveal>
              <Reveal delay={0.1}><h1 className="mt-5 text-3xl font-semibold leading-tight tracking-tight md:text-[2.6rem]">{ch.title}</h1></Reveal>
              <Reveal delay={0.2}><p className="mt-4 text-base leading-7 text-slate-400">{ch.lead}</p></Reveal>
              <ul className="mt-5 space-y-2">
                {ch.points.map((p, k) => (
                  <Reveal key={p} delay={0.3 + k * 0.1}><li className="flex items-start gap-2 text-sm text-slate-200"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />{p}</li></Reveal>
                ))}
              </ul>
              {ch.audience && <Reveal delay={0.6}><p className="mt-5 text-xs text-slate-500">Most relevant for: <span className="text-slate-300">{ch.audience}</span></p></Reveal>}
              {notes && <Reveal delay={0.7}><Note>{ch.note}</Note></Reveal>}
            </div>
            <div className="dm-stage"><Visual /></div>
          </div>
        </main>
      </div>

      {/* footer controls */}
      <footer className="relative z-20 flex h-14 items-center justify-between border-t border-white/10 px-5 text-xs text-slate-400">
        <span>Chapter {i + 1} of {CHAPTERS.length} | Arrow keys to navigate, P to pause, Esc to exit</span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="border-white/15 bg-white/5 text-white hover:bg-white/10" onClick={prev}><ChevronLeft /> Previous</Button>
          <Button size="sm" className="bg-gradient-to-r from-blue-500 to-cyan-400 text-white hover:from-blue-400 hover:to-cyan-300" onClick={next}>Next <ChevronRight /></Button>
        </div>
      </footer>
    </div>
  )
}
