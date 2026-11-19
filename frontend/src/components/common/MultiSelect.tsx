import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/primitives'
import { cn } from '@/lib/utils'

export interface Option {
  value: string
  label: string
  color?: string
  count?: number
}

export function MultiSelect({ label, options, value, onChange, className, placeholder = 'All', width = 'w-[200px]', single = false }: { label: string; options: Option[]; value: string[]; onChange: (v: string[]) => void; className?: string; placeholder?: string; width?: string; single?: boolean }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const filtered = useMemo(() => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())), [options, q])
  const summary = value.length === 0 ? placeholder : value.length === 1 ? (options.find((o) => o.value === value[0])?.label ?? value[0]) : `${value.length} selected`
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className={cn('justify-between font-normal', width, className)} title={label}>
          <span className="truncate">
            <span className="text-muted-foreground">{label}: </span>
            {summary}
          </span>
          <ChevronsUpDown className="ml-1 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72 p-2">
        <Input autoFocus placeholder={`Search ${label.toLowerCase()}â€¦`} value={q} onChange={(e) => setQ(e.target.value)} className="mb-2 h-8" />
        <div className="max-h-64 overflow-auto">
          {filtered.length === 0 && <p className="p-2 text-xs text-muted-foreground">No matches</p>}
          {filtered.map((o) => {
            const checked = value.includes(o.value)
            return (
              <button
                key={o.value}
                className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted', checked && 'bg-muted/70')}
                onClick={() => { if (single) { onChange(checked ? [] : [o.value]); setOpen(false) } else onChange(checked ? value.filter((v) => v !== o.value) : [...value, o.value]) }}
              >
                <span className={cn('flex h-4 w-4 items-center justify-center border', single ? 'rounded-full' : 'rounded', checked ? 'bg-primary border-primary text-primary-foreground' : 'border-input')}>{checked && <Check className="h-3 w-3" />}</span>
                {o.color && <span className="h-2.5 w-2.5 rounded-sm" style={{ background: o.color }} />}
                <span className="flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{o.count}</span>}
              </button>
            )
          })}
        </div>
        {value.length > 0 && (
          <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => onChange([])}>
            <X /> Clear {label.toLowerCase()}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}
