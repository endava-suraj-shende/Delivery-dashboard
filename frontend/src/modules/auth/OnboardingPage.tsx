import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, KeyRound, Link2, LogOut, Plug, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useSession } from '@/hooks/useSession'
import { jiraLiveApi } from '@/services/jiraApi'
import { errorMessage } from '@/services/api'
import '@/modules/welcome/welcome.css'

const primary = 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white hover:from-blue-400 hover:to-cyan-300'

/** First screen for a delivery manager who has no boards yet: link a board or redeem a board code. */
export default function OnboardingPage() {
  const { user, signOut, refresh } = useSession()
  const nav = useNavigate()
  const [code, setCode] = useState('')
  const redeem = useMutation({
    mutationFn: () => jiraLiveApi.redeemBoardCode(code.trim()),
    onSuccess: async () => { await refresh(); nav('/', { replace: true }) },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); if (code.trim()) redeem.mutate() }

  return (
    <div className="wl-root relative flex min-h-screen items-center justify-center p-6">
      <div className="wl-aurora" />
      <div className="wl-grid" />
      <div className="relative z-10 w-full max-w-3xl text-slate-100">
        <div className="mb-8 text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1 text-xs font-medium text-cyan-200"><Sparkles className="h-3.5 w-3.5" /> Welcome{user ? `, ${user.name.split(' ')[0]}` : ''}</p>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">Your account is ready. Connect a Jira board to begin.</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-400">Dashboards and reports are built from the boards you can see. Pick one of the two ways below; you can add more boards later from Jira Connections.</p>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <div className="wl-card flex flex-col rounded-2xl p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-cyan-400 text-white"><Plug className="h-5 w-5" /></span>
            <h2 className="mt-4 text-lg font-semibold">Connect your Jira board</h2>
            <p className="mt-1 flex-1 text-sm leading-6 text-slate-400">Paste the board link and the Atlassian account that can read it. The board becomes yours; a board code is generated so a superuser can share it with other managers.</p>
            <ul className="mt-3 space-y-1 text-xs text-slate-300">
              {['Scrum and Kanban boards', 'Credentials stored encrypted', 'Data loads automatically'].map((t) => <li key={t} className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />{t}</li>)}
            </ul>
            <Button className={`mt-5 w-full ${primary}`} onClick={() => nav('/config/jira')}>Open Jira Connections <ArrowRight /></Button>
          </div>

          <div className="wl-card flex flex-col rounded-2xl p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-400 text-white"><KeyRound className="h-5 w-5" /></span>
            <h2 className="mt-4 text-lg font-semibold">Use a board auth code</h2>
            <p className="mt-1 flex-1 text-sm leading-6 text-slate-400">Another delivery manager already linked the board? Enter the BOARD code you received from the superuser to see that board's data straight away.</p>
            <form className="mt-5 space-y-2" onSubmit={submit}>
              <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="BOARD-XXXX-XXXX" className="h-10 border-white/15 bg-white/5 font-mono uppercase tracking-wider text-white placeholder:text-slate-500" autoComplete="off" />
              {redeem.isError && <p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-300">{errorMessage(redeem.error)}</p>}
              <Button type="submit" variant="outline" className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10" disabled={redeem.isPending || !code.trim()}><Link2 /> {redeem.isPending ? 'Linking' : 'Link board with code'}</Button>
            </form>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-center gap-4 text-xs text-slate-500">
          <span>Signed in as {user?.email}</span>
          <button className="inline-flex items-center gap-1 hover:text-slate-300" onClick={async () => { await signOut(); nav('/welcome') }}><LogOut className="h-3 w-3" /> Sign out</button>
        </div>
      </div>
    </div>
  )
}
