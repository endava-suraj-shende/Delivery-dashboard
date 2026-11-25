import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FolderKanban, Layers, Search, Ticket, User, Kanban, FileText } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { metaApi } from '@/services/api'
import { useFilters } from '@/hooks/useFilters'
import { FEATURES } from '@/lib/features'
import { cn, truncate } from '@/lib/utils'

export function GlobalSearch() {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const nav = useNavigate()
  const { setList, setSearch, queryString } = useFilters()

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    const onClick = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])
  const { data } = useQuery({ queryKey: ['search', debounced], queryFn: () => metaApi.search(debounced), enabled: debounced.length >= 1 })

  const go = (path: string) => {
    setOpen(false)
    setQ('')
    nav(path.includes('?') ? path : `${path}${queryString ? `?${queryString}` : ''}`)
  }
  const empty = data && !data.employees.length && !data.projects.length && !(FEATURES.applications && data.applications.length) && !data.jira_boards.length && !data.tickets.length && !data.notes.length

  return (
    <div ref={ref} className="relative w-full max-w-md">
      <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value)
          setOpen(true)
        }}
        onFocus={() => q && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && q.trim()) {
            setSearch(q.trim())
            setOpen(false)
          }
          if (e.key === 'Escape') setOpen(false)
        }}
        placeholder="Search employees, tickets, projects, apps or notes (Enter = filter all)"
        className="h-9 pl-8"
      />
      {open && debounced && (
        <div className="absolute left-0 right-0 top-10 z-50 max-h-[70vh] overflow-auto rounded-md border bg-popover p-2 shadow-lg text-sm">
          {!data && <p className="p-2 text-xs text-muted-foreground">Searching</p>}
          {empty && <p className="p-2 text-xs text-muted-foreground">No matches. Press Enter to filter all records by text.</p>}
          <Section title="Employees" icon={<User className="h-3.5 w-3.5" />} items={data?.employees} render={(e) => <Row key={e} label={e} onClick={() => go(`/employees/${encodeURIComponent(e)}`)} />} />
          <Section title="Projects" icon={<FolderKanban className="h-3.5 w-3.5" />} items={data?.projects} render={(p) => <Row key={p} label={p} onClick={() => go(`/projects/${encodeURIComponent(p)}`)} />} />
          <Section
            title="Applications"
            icon={<Layers className="h-3.5 w-3.5" />}
            items={FEATURES.applications ? data?.applications : []}
            render={(a) => (
              <Row
                key={a}
                label={a}
                onClick={() => {
                  setList('application', [a])
                  setOpen(false)
                  setQ('')
                  nav('/team')
                }}
              />
            )}
          />
          <Section
            title="Jira boards"
            icon={<Kanban className="h-3.5 w-3.5" />}
            items={data?.jira_boards}
            render={(b) => (
              <Row
                key={b}
                label={b}
                onClick={() => {
                  setList('jira_board', [b])
                  setOpen(false)
                  setQ('')
                  nav('/jira')
                }}
              />
            )}
          />
          <Section title="Tickets" icon={<Ticket className="h-3.5 w-3.5" />} items={data?.tickets} render={(t) => <Row key={t.ticket_id} label={t.ticket_id} sub={`${t.employee} | ${truncate(t.work_details, 60)}`} onClick={() => go(`/jira?ticket=${encodeURIComponent(t.ticket_id)}`)} />} />
          <Section title="Notes / details" icon={<FileText className="h-3.5 w-3.5" />} items={data?.notes} render={(n) => <Row key={n.activity_id} label={truncate(n.work_details ?? n.comments, 70)} sub={`${n.employee}${n.ticket_id ? ` | ${n.ticket_id}` : ''}`} onClick={() => go(n.ticket_id ? `/jira?ticket=${encodeURIComponent(n.ticket_id)}` : `/employees/${encodeURIComponent(n.employee)}`)} />} />
        </div>
      )}
    </div>
  )
}

function Section<T>({ title, icon, items, render }: { title: string; icon: React.ReactNode; items: T[] | undefined; render: (i: T) => React.ReactNode }) {
  if (!items?.length) return null
  return (
    <div className="mb-1">
      <p className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon} {title}
      </p>
      {items.map(render)}
    </div>
  )
}

function Row({ label, sub, onClick }: { label: string; sub?: string; onClick: () => void }) {
  return (
    <button className={cn('flex w-full flex-col items-start rounded px-2 py-1.5 text-left hover:bg-muted')} onClick={onClick}>
      <span className="text-sm">{label}</span>
      {sub && <span className="text-[11px] text-muted-foreground">{sub}</span>}
    </button>
  )
}
