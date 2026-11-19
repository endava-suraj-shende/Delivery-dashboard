import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, ChevronRight, Filter, Printer, X, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input, Label } from '@/components/ui/input'
import { NativeSelect } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives'
import { MultiSelect } from '@/components/common/MultiSelect'
import { PRESET_LABELS, useFilters, type ListKey, type PresetKey } from '@/hooks/useFilters'
import { useDimensions } from '@/hooks/useData'
import { fmtDate, colorFor } from '@/lib/utils'
import { FEATURES } from '@/lib/features'
import type { Period } from '@/types'

export function Breadcrumbs({ items }: { items: { label: string; to?: string }[] }) {
  return (
    <nav className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="Breadcrumb">
      <Link to="/" className="hover:text-foreground">
        Home
      </Link>
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3" />
          {it.to ? (
            <Link to={it.to} className="hover:text-foreground">
              {it.label}
            </Link>
          ) : (
            <span className="text-foreground">{it.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}

export function PageHeader({ title, description, breadcrumbs, actions, period }: { title: string; description?: string; breadcrumbs?: { label: string; to?: string }[]; actions?: ReactNode; period?: Period | null }) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div className="space-y-1">
        {breadcrumbs && <Breadcrumbs items={breadcrumbs} />}
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        {period && <PeriodBadge period={period} />}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 no-print">{actions}</div>}
    </div>
  )
}

export function PeriodBadge({ period }: { period: Period }) {
  const { filters } = useFilters()
  const sprint = filters.sprint
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {sprint.length ? (
        <Badge variant="info" className="gap-1" title="A sprint is a period of its own â€” the date range is not applied while a sprint is selected.">
          <Zap className="h-3 w-3" /> Sprint: {sprint.join(', ')}
        </Badge>
      ) : (
        <Badge variant="info" className="gap-1">
          <CalendarRange className="h-3 w-3" /> {period.label}
        </Badge>
      )}
      <span>
        {!sprint.length && period.days > 0 && `${period.days} days Â· `}
        {period.report_count} {period.report_count === 1 ? 'report' : 'reports'}
      </span>
    </div>
  )
}

export function PrintButton() {
  return (
    <Button variant="outline" size="sm" onClick={() => window.print()} className="no-print">
      <Printer /> Print
    </Button>
  )
}

export function DateRangePicker() {
  const { filters, setPreset, setCustomRange, effectiveRange } = useFilters()
  const [start, setStart] = useState(effectiveRange[0] ?? '')
  const [end, setEnd] = useState(effectiveRange[1] ?? '')
  useEffect(() => {
    setStart(effectiveRange[0] ?? '')
    setEnd(effectiveRange[1] ?? '')
  }, [effectiveRange])
  const label = filters.preset === 'custom' ? `${fmtDate(effectiveRange[0])} â€“ ${fmtDate(effectiveRange[1])}` : PRESET_LABELS[filters.preset]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-[180px] justify-start font-normal">
          <CalendarRange className="text-muted-foreground" />
          <span className="truncate">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 space-y-3">
        <div className="grid grid-cols-2 gap-1">
          {(Object.keys(PRESET_LABELS) as PresetKey[])
            .filter((k) => k !== 'custom')
            .map((k) => (
              <Button key={k} size="sm" variant={filters.preset === k ? 'default' : 'ghost'} className="justify-start text-xs" onClick={() => setPreset(k)}>
                {PRESET_LABELS[k]}
              </Button>
            ))}
        </div>
        <div className="space-y-2 border-t pt-3">
          <Label>Custom range (inclusive)</Label>
          <div className="grid grid-cols-2 gap-2">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-8 text-xs" />
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 text-xs" />
          </div>
          <Button size="sm" className="w-full" disabled={!start || !end || start > end} onClick={() => setCustomRange(start, end)}>
            Apply custom range
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function GlobalFilterBar({ showStatus = true, showDeployment = true, compact }: { showStatus?: boolean; showDeployment?: boolean; compact?: boolean }) {
  const { filters, setList, activeChips, removeValue, clearAll, setSearch } = useFilters()
  const { data: dims } = useDimensions()
  const opt = (vals: string[] | undefined) => (vals ?? []).map((v) => ({ value: v, label: v }))
  const cat = (vals: { key: string; label: string; color: string }[] | undefined) => (vals ?? []).map((v) => ({ value: v.key, label: v.label, color: colorFor(v.color) }))
  const set = (k: ListKey) => (v: string[]) => setList(k, v)
  // When the board changes, drop employee / sprint selections that no longer belong to the selected board(s).
  useEffect(() => {
    if (filters.jira_board.length > 1) setList('jira_board', [filters.jira_board[0]])  // one board at a time
    if (!dims || !filters.jira_board.length) return
    const emp = new Set(dims.employees.map((e) => e.toLowerCase()))
    const keepEmp = filters.employee.filter((e) => emp.has(e.toLowerCase()))
    if (keepEmp.length !== filters.employee.length) setList('employee', keepEmp)
    const spr = new Set((dims.sprints ?? []).map((s) => s.toLowerCase()))
    const keepSpr = filters.sprint.filter((s) => spr.has(s.toLowerCase()))
    if (keepSpr.length !== filters.sprint.length) setList('sprint', keepSpr)
  }, [dims, filters.jira_board, filters.employee, filters.sprint, setList])
  return (
    <div className="space-y-2 no-print">
      <div className="flex flex-wrap items-center gap-2">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <DateRangePicker />
        <MultiSelect label="Project" options={opt(dims?.projects)} value={filters.project} onChange={set('project')} width="w-[190px]" />
        <MultiSelect label="Employee" options={opt(dims?.employees)} value={filters.employee} onChange={set('employee')} width="w-[190px]" />
        {FEATURES.applications && <MultiSelect label="Application" options={opt(dims?.applications)} value={filters.application} onChange={set('application')} width="w-[190px]" />}
        {!compact && <MultiSelect label="Board" options={opt(dims?.jira_boards)} value={filters.jira_board} onChange={set('jira_board')} width="w-[170px]" single />}
        {(dims?.sprints?.length ?? 0) > 0 && <MultiSelect label="Sprint" options={opt(dims?.sprints)} value={filters.sprint} onChange={set('sprint')} width="w-[170px]" />}
        {showStatus && <MultiSelect label="Status" options={cat(dims?.work_status)} value={filters.status} onChange={set('status')} width="w-[160px]" />}
        {showStatus && !compact && <MultiSelect label="Type" options={cat(dims?.work_type)} value={filters.work_type} onChange={set('work_type')} width="w-[150px]" />}
        {showDeployment && <MultiSelect label="Dev deploy" options={cat(dims?.dev_deployment)} value={filters.dev_deployment} onChange={set('dev_deployment')} width="w-[170px]" />}
        {showDeployment && <MultiSelect label="Prod deploy" options={cat(dims?.prod_deployment)} value={filters.prod_deployment} onChange={set('prod_deployment')} width="w-[170px]" />}
        {activeChips.length > 0 && (
          <Button variant="ghost" size="sm" onClick={clearAll}>
            <X /> Clear all filters
          </Button>
        )}
      </div>
      {activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Active filters:</span>
          {activeChips.map((c) => (
            <Badge key={`${c.key}:${c.value}`} variant="secondary" className="gap-1 pr-1">
              <span className="text-muted-foreground">{c.label}:</span> {c.value}
              <button className="ml-0.5 rounded-sm p-0.5 hover:bg-background" onClick={() => (c.key === 'search' ? setSearch('') : removeValue(c.key as ListKey, c.value))} aria-label={`Remove ${c.label} ${c.value}`}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

export function SortSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <NativeSelect value={value} onChange={(e) => onChange(e.target.value)} className="h-8 w-auto text-xs">
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          Sort: {o.label}
        </option>
      ))}
    </NativeSelect>
  )
}
