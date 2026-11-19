import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toISODate } from '@/lib/utils'

export type PresetKey =
  | 'last_7_days'
  | 'last_15_days'
  | 'last_30_days'
  | 'last_60_days'
  | 'current_week'
  | 'previous_week'
  | 'current_month'
  | 'previous_month'
  | 'all'
  | 'custom'

export const PRESET_LABELS: Record<PresetKey, string> = {
  last_7_days: 'Last 7 days',
  last_15_days: 'Last 15 days',
  last_30_days: 'Last 30 days',
  last_60_days: 'Last 60 days',
  current_week: 'Current week',
  previous_week: 'Previous week',
  current_month: 'Current month',
  previous_month: 'Previous month',
  all: 'All data',
  custom: 'Custom range',
}

export const LIST_KEYS = ['employee', 'project', 'application', 'jira_board', 'sprint', 'status', 'work_type', 'dev_deployment', 'prod_deployment', 'prod_required'] as const
export type ListKey = (typeof LIST_KEYS)[number]

export interface FilterState {
  preset: PresetKey
  start_date: string | null
  end_date: string | null
  search: string
  employee: string[]
  project: string[]
  application: string[]
  jira_board: string[]
  sprint: string[]
  status: string[]
  work_type: string[]
  dev_deployment: string[]
  prod_deployment: string[]
  prod_required: string[]
}

export function presetRange(preset: PresetKey, today = new Date()): [string | null, string | null] {
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate())
  const minus = (n: number) => new Date(t.getFullYear(), t.getMonth(), t.getDate() - n)
  switch (preset) {
    case 'last_7_days':
      return [toISODate(minus(6)), toISODate(t)]
    case 'last_15_days':
      return [toISODate(minus(14)), toISODate(t)]
    case 'last_30_days':
      return [toISODate(minus(29)), toISODate(t)]
    case 'last_60_days':
      return [toISODate(minus(59)), toISODate(t)]
    case 'current_week': {
      const dow = (t.getDay() + 6) % 7
      const start = minus(dow)
      return [toISODate(start), toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))]
    }
    case 'previous_week': {
      const dow = (t.getDay() + 6) % 7
      const start = minus(dow + 7)
      return [toISODate(start), toISODate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6))]
    }
    case 'current_month': {
      const start = new Date(t.getFullYear(), t.getMonth(), 1)
      const end = new Date(t.getFullYear(), t.getMonth() + 1, 0)
      return [toISODate(start), toISODate(end)]
    }
    case 'previous_month': {
      const start = new Date(t.getFullYear(), t.getMonth() - 1, 1)
      const end = new Date(t.getFullYear(), t.getMonth(), 0)
      return [toISODate(start), toISODate(end)]
    }
    case 'all':
      return ['2000-01-01', '2100-01-01']
    default:
      return [null, null]
  }
}

interface FilterContextValue {
  filters: FilterState
  setPreset: (p: PresetKey) => void
  setCustomRange: (start: string, end: string) => void
  setSearch: (s: string) => void
  setList: (key: ListKey, values: string[]) => void
  toggleValue: (key: ListKey, value: string) => void
  removeValue: (key: ListKey, value: string) => void
  clearAll: () => void
  activeChips: { key: string; value: string; label: string }[]
  queryParams: URLSearchParams
  queryString: string
  effectiveRange: [string | null, string | null]
}

const FilterContext = createContext<FilterContextValue | null>(null)

const FILTER_KEYS = ['preset', 'start_date', 'end_date', 'search', ...LIST_KEYS]
const STORAGE_KEY = 'edd-filters'

function parse(sp: URLSearchParams): FilterState {
  const preset = (sp.get('preset') as PresetKey) || 'last_30_days'
  const lists = Object.fromEntries(LIST_KEYS.map((k) => [k, sp.getAll(k).filter(Boolean)])) as Record<ListKey, string[]>
  return {
    preset,
    start_date: sp.get('start_date'),
    end_date: sp.get('end_date'),
    search: sp.get('search') ?? '',
    ...lists,
  }
}

export function FilterProvider({ children }: { children: ReactNode }) {
  const [sp, setSp] = useSearchParams()
  const filters = useMemo(() => parse(sp), [sp])

  // Persist the filter selection for the whole browser session and restore it on pages opened without filters.
  useEffect(() => {
    const hasAny = FILTER_KEYS.some((k) => sp.has(k))
    if (hasAny) {
      const keep = new URLSearchParams()
      sp.forEach((v, k) => FILTER_KEYS.includes(k) && keep.append(k, v))
      sessionStorage.setItem(STORAGE_KEY, keep.toString())
      return
    }
    const saved = sessionStorage.getItem(STORAGE_KEY)
    if (saved) {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          new URLSearchParams(saved).forEach((v, k) => next.append(k, v))
          return next
        },
        { replace: true },
      )
    }
  }, [sp, setSp])

  const update = useCallback(
    (fn: (next: URLSearchParams) => void) => {
      setSp(
        (prev) => {
          const next = new URLSearchParams(prev)
          fn(next)
          return next
        },
        { replace: true },
      )
    },
    [setSp],
  )

  const setPreset = useCallback(
    (p: PresetKey) =>
      update((n) => {
        n.set('preset', p)
        if (p !== 'custom') {
          n.delete('start_date')
          n.delete('end_date')
        }
      }),
    [update],
  )
  const setCustomRange = useCallback(
    (start: string, end: string) =>
      update((n) => {
        n.set('preset', 'custom')
        n.set('start_date', start)
        n.set('end_date', end)
      }),
    [update],
  )
  const setSearch = useCallback((s: string) => update((n) => (s ? n.set('search', s) : n.delete('search'))), [update])
  const setList = useCallback(
    (key: ListKey, values: string[]) =>
      update((n) => {
        n.delete(key)
        values.forEach((v) => n.append(key, v))
      }),
    [update],
  )
  const toggleValue = useCallback(
    (key: ListKey, value: string) => {
      const cur = filters[key]
      setList(key, cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value])
    },
    [filters, setList],
  )
  const removeValue = useCallback((key: ListKey, value: string) => setList(key, filters[key].filter((v) => v !== value)), [filters, setList])
  const clearAll = useCallback(
    () =>
      update((n) => {
        LIST_KEYS.forEach((k) => n.delete(k))
        n.delete('search')
      }),
    [update],
  )

  const effectiveRange = useMemo<[string | null, string | null]>(() => {
    if (filters.preset === 'custom') return [filters.start_date, filters.end_date]
    return presetRange(filters.preset)
  }, [filters.preset, filters.start_date, filters.end_date])

  const queryParams = useMemo(() => {
    const q = new URLSearchParams()
    const [s, e] = effectiveRange
    if (s) q.set('start_date', s)
    if (e) q.set('end_date', e)
    LIST_KEYS.forEach((k) => filters[k].forEach((v) => q.append(k, v)))
    if (filters.search) q.set('search', filters.search)
    return q
  }, [filters, effectiveRange])

  const activeChips = useMemo(() => {
    const chips: { key: string; value: string; label: string }[] = []
    const labels: Record<string, string> = {
      employee: 'Employee',
      project: 'Project',
      application: 'Application',
      jira_board: 'Board',
      sprint: 'Sprint',
      status: 'Status',
      work_type: 'Type',
      dev_deployment: 'Dev deploy',
      prod_deployment: 'Prod deploy',
      prod_required: 'Prod required',
    }
    LIST_KEYS.forEach((k) => filters[k].forEach((v) => chips.push({ key: k, value: v, label: labels[k] })))
    if (filters.search) chips.push({ key: 'search', value: filters.search, label: 'Search' })
    return chips
  }, [filters])

  const value: FilterContextValue = {
    filters,
    setPreset,
    setCustomRange,
    setSearch,
    setList,
    toggleValue,
    removeValue,
    clearAll,
    activeChips,
    queryParams,
    queryString: queryParams.toString(),
    effectiveRange,
  }
  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>
}

export function useFilters(): FilterContextValue {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilters must be used within FilterProvider')
  return ctx
}
