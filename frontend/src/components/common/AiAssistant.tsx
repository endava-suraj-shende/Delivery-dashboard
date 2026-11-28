import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useLocation, useNavigate } from 'react-router-dom'
import { Bot, Eraser, Send, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useFilters } from '@/hooks/useFilters'
import { can, useSession } from '@/hooks/useSession'
import { intelligenceApi, errorMessage, type AskResponse } from '@/services/api'
import { cn } from '@/lib/utils'

// ----------------------------------------------------------------------------------------------- open/close store
// Tiny external store so any component (header button, floating launcher, AI Insights page) can open the panel.
let isOpen = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())
export const assistant = {
  open: () => { isOpen = true; emit() },
  close: () => { isOpen = false; emit() },
  toggle: () => { isOpen = !isOpen; emit() },
}
function useAssistantOpen() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => isOpen, () => false)
}

const SUGGESTIONS = [
  'Which tickets are most at risk?',
  'Who has the most blocked tickets?',
  'How many tickets were completed last week?',
  'What is overdue right now?',
  'When will the remaining work be done?',
  'What should I do first today?',
]

type Turn = { id: number; question: string; reply?: AskResponse; error?: string }

/** Header entry point. */
export function AiAssistantButton({ compact }: { compact?: boolean }) {
  const { user } = useSession()
  if (!can(user, 'admin', 'dm', 'guest')) return null
  return (
    <Button variant="outline" size={compact ? 'icon' : 'sm'} onClick={assistant.toggle} aria-label="Open AI Assistant" title="AI Assistant" className="border-primary/40 text-primary hover:bg-primary/10">
      <Sparkles className="h-4 w-4" /> {!compact && <span className="hidden md:inline">AI Assistant</span>}
    </Button>
  )
}

/** Floating launcher + slide-over panel. Mount once in the app shell. */
export function AiAssistant() {
  const open = useAssistantOpen()
  const { user } = useSession()
  const allowed = can(user, 'admin', 'dm', 'guest')
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && assistant.close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!allowed) return null
  return (
    <>
      {!open && (
        <button type="button" onClick={assistant.open} aria-label="Open AI Assistant" data-testid="assistant-launcher"
          className="no-print fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-primary/15 transition-transform hover:scale-105 focus:outline-none focus-visible:ring-primary/40 animate-in zoom-in-75 fade-in-0 duration-300">
          <Sparkles className="h-5 w-5" />
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-emerald-400 ring-2 ring-background" aria-hidden />
        </button>
      )}
      {open && <AssistantPanel />}
    </>
  )
}

function AssistantPanel() {
  const { queryString, filters } = useFilters()
  const nav = useNavigate()
  const loc = useLocation()
  const [question, setQuestion] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ask = useMutation({
    mutationFn: ({ id, q }: { id: number; q: string }) => intelligenceApi.ask(queryString, q).then((reply) => ({ id, reply })),
    onSuccess: ({ id, reply }) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, reply } : x))),
    onError: (err, { id }) => setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: errorMessage(err) } : x))),
  })

  const submit = (raw: string) => {
    const q = raw.trim()
    if (!q || ask.isPending) return
    const id = Date.now()
    setTurns((t) => [...t, { id, question: q }])
    setQuestion('')
    ask.mutate({ id, q })
  }

  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }) }, [turns])
  useEffect(() => { inputRef.current?.focus() }, [])

  const scope = [filters.employee.length && `${filters.employee.length} people`, filters.project.length && `${filters.project.length} projects`, filters.jira_board.length && `${filters.jira_board.length} boards`, filters.sprint.length && filters.sprint.join(', '), filters.status.length && filters.status.join(', ')].filter(Boolean).join(' | ')

  return (
    <div className="no-print fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="AI Assistant" data-testid="assistant-panel">
      <div className="absolute inset-0 bg-black/30 animate-in fade-in-0 duration-200" onClick={assistant.close} aria-hidden />
      <aside className="relative flex h-full w-full max-w-[440px] flex-col border-l bg-background shadow-2xl animate-in slide-in-from-right duration-300">
        <header className="flex items-start gap-3 border-b px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold leading-tight">AI Assistant</h2>
            <p className="truncate text-xs text-muted-foreground" title={scope || 'Whole team'}>Answers from the current page scope{scope ? `: ${scope}` : ''}</p>
          </div>
          {turns.length > 0 && <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setTurns([])} aria-label="Clear conversation" title="Clear"><Eraser className="h-4 w-4" /></Button>}
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={assistant.close} aria-label="Close assistant"><X className="h-4 w-4" /></Button>
        </header>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {turns.length === 0 && (
            <div className="space-y-4 animate-in fade-in-0 slide-in-from-bottom-2 duration-300">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm leading-relaxed">
                <p className="font-medium">Ask anything about delivery - people, boards, sprints, blockers, risk, forecast.</p>
                <p className="mt-1 text-xs text-muted-foreground">Your question becomes a filter and the analytics engine computes the answer, so it always matches what the dashboards show. Nothing is made up by a model.</p>
              </div>
              <div>
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Try one of these</p>
                <div className="flex flex-wrap gap-1.5">
                  {SUGGESTIONS.map((s, i) => (
                    <button key={s} type="button" onClick={() => submit(s)} className={cn('rounded-full border px-2.5 py-1 text-left text-xs transition-colors hover:border-primary/50 hover:bg-primary/5', 'animate-in fade-in-0 slide-in-from-bottom-1 fill-mode-backwards duration-300')} style={{ animationDelay: `${i * 40}ms` }}>{s}</button>
                  ))}
                </div>
              </div>
            </div>
          )}
          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              <div className="flex justify-end"><p className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-foreground animate-in fade-in-0 slide-in-from-bottom-1 duration-200">{t.question}</p></div>
              <div className="flex gap-2">
                <span className="mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary"><Bot className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 max-w-[88%] rounded-2xl rounded-tl-sm border bg-card px-3 py-2 text-sm animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
                  {!t.reply && !t.error && <Thinking />}
                  {t.error && <p className="text-red-600">{t.error}</p>}
                  {t.reply && (
                    <>
                      <p className="leading-relaxed">{t.reply.answer}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                        <span className="rounded bg-muted px-1.5 py-0.5">{t.reply.spec.intent.replace(/_/g, ' ')}</span>
                        {t.reply.filters.label ? <span>{String(t.reply.filters.label)}</span> : null}
                        {t.reply.spec.status.length > 0 && <span>status: {t.reply.spec.status.join(', ')}</span>}
                        {t.reply.spec.employee.length > 0 && <span>{t.reply.spec.employee.join(', ')}</span>}
                        {t.reply.spec.jira_board.length > 0 && <span>{t.reply.spec.jira_board.join(', ')}</span>}
                      </div>
                      {(t.reply.links ?? []).length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {(t.reply.links ?? []).map((l) => (
                            <Button key={l.url} size="sm" variant="outline" className="h-7 text-xs" onClick={() => { assistant.close(); if (l.url !== loc.pathname + loc.search) nav(l.url) }}>{l.label}</Button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <form className="border-t p-3" onSubmit={(e) => { e.preventDefault(); submit(question) }}>
          <div className="flex gap-2">
            <Input ref={inputRef} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Ask about this data..." aria-label="Your question" maxLength={500} autoComplete="off" />
            <Button type="submit" disabled={!question.trim() || ask.isPending} aria-label="Send"><Send className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1.5 text-[10px] text-muted-foreground">Figures are computed by the dashboard engine for the filters shown. Esc to close.</p>
        </form>
      </aside>
    </div>
  )
}

function Thinking() {
  return (
    <span className="inline-flex items-center gap-1 py-1 text-muted-foreground" role="status" aria-label="Thinking">
      {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" style={{ animationDelay: `${i * 120}ms` }} />)}
    </span>
  )
}
