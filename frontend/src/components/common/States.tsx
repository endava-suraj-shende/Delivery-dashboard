import type { ReactNode } from 'react'
import { AlertTriangle, FileSpreadsheet, Inbox, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/primitives'
import { errorMessage, isNoData } from '@/services/api'
import { Link } from 'react-router-dom'

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-64" />
      ))}
    </div>
  )
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (isNoData(error)) return <NoDataState />
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="rounded-full bg-red-500/10 p-3 text-red-600">
        <AlertTriangle className="h-6 w-6" />
      </div>
      <div>
        <p className="font-semibold">Something went wrong</p>
        <p className="mt-1 text-sm text-muted-foreground">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Retry
        </Button>
      )}
    </Card>
  )
}

export function NoDataState() {
  return (
    <Card className="flex flex-col items-center justify-center gap-3 p-10 text-center">
      <div className="rounded-full bg-primary/10 p-3 text-primary">
        <FileSpreadsheet className="h-6 w-6" />
      </div>
      <div>
        <p className="font-semibold">No workbooks loaded</p>
        <p className="mt-1 text-sm text-muted-foreground">Place the bi-weekly Excel files in the Data folder or upload a workbook to get started.</p>
      </div>
      <Button asChild size="sm">
        <Link to="/excel">Open Excel Data Management</Link>
      </Button>
    </Card>
  )
}

export function EmptyState({ title = 'No records for the selected period', description, action, icon }: { title?: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 p-10 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">{icon ?? <Inbox className="h-5 w-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-md text-xs text-muted-foreground">{description}</p>}
      {action}
    </div>
  )
}
