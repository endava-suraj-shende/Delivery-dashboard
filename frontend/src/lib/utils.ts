import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const STATUS_COLORS: Record<string, string> = {
  green: '#16a34a',
  blue: '#2563eb',
  sky: '#0ea5e9',
  orange: '#f97316',
  amber: '#eab308',
  pink: '#db2777',
  red: '#dc2626',
  grey: '#9ca3af',
  slate: '#64748b',
  purple: '#7c3aed',
  violet: '#a855f7',
  teal: '#0d9488',
  cyan: '#06b6d4',
  indigo: '#4f46e5',
  lime: '#65a30d',
}

export const PALETTE = ['#2563eb', '#16a34a', '#f97316', '#7c3aed', '#0d9488', '#dc2626', '#0891b2', '#ca8a04', '#db2777', '#4f46e5', '#65a30d', '#9333ea', '#ea580c', '#0284c7']

export function colorFor(token?: string | null, index = 0): string {
  if (token && STATUS_COLORS[token]) return STATUS_COLORS[token]
  return PALETTE[index % PALETTE.length]
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 })
}

export function fmtPct(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  return `${v.toFixed(1)}%`
}

export function fmtDate(v: string | null | undefined, opts: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric' }): string {
  if (!v) return '-'
  const d = new Date(v.length === 10 ? `${v}T00:00:00` : v)
  if (Number.isNaN(d.getTime())) return v
  return d.toLocaleDateString(undefined, opts)
}

export function fmtDateShort(v: string | null | undefined): string {
  return fmtDate(v, { day: '2-digit', month: 'short' })
}

export function toISODate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function truncate(s: string | null | undefined, n = 80): string {
  if (!s) return ''
  return s.length > n ? `${s.slice(0, n - 1)}...` : s
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function toCSV(rows: Record<string, unknown>[], columns?: { key: string; label: string }[]): string {
  if (!rows.length) return ''
  const cols = columns ?? Object.keys(rows[0]).map((k) => ({ key: k, label: k }))
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join(', ') : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.map((c) => esc(c.label)).join(','), ...rows.map((r) => cols.map((c) => esc(r[c.key])).join(','))].join('\n')
}
