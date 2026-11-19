import * as React from 'react'
import * as ToastPrimitives from '@radix-ui/react-toast'
import { cva, type VariantProps } from 'class-variance-authority'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const toastVariants = cva(
  'group pointer-events-auto relative flex w-full items-center justify-between space-x-2 overflow-hidden rounded-md border p-4 pr-8 shadow-lg transition-all data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[swipe=end]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full',
  {
    variants: {
      variant: {
        default: 'border bg-background text-foreground',
        destructive: 'destructive group border-destructive bg-destructive text-destructive-foreground',
        success: 'border-green-600/40 bg-green-50 text-green-900 dark:bg-green-950 dark:text-green-100',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

type ToastVariant = VariantProps<typeof toastVariants>['variant']

interface ToastItem {
  id: number
  title: string
  description?: string
  variant?: ToastVariant
}

interface ToastContextValue {
  toast: (t: Omit<ToastItem, 'id'>) => void
}

const ToastContext = React.createContext<ToastContextValue>({ toast: () => undefined })

export function useToast() {
  return React.useContext(ToastContext)
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([])
  const idRef = React.useRef(0)
  const toast = React.useCallback((t: Omit<ToastItem, 'id'>) => {
    idRef.current += 1
    setItems((prev) => [...prev.slice(-4), { ...t, id: idRef.current }])
  }, [])
  return (
    <ToastContext.Provider value={{ toast }}>
      <ToastPrimitives.Provider swipeDirection="right" duration={4500}>
        {children}
        {items.map((t) => (
          <ToastPrimitives.Root key={t.id} className={cn(toastVariants({ variant: t.variant }))} onOpenChange={(open) => !open && setItems((p) => p.filter((x) => x.id !== t.id))}>
            <div className="grid gap-1">
              <ToastPrimitives.Title className="text-sm font-semibold">{t.title}</ToastPrimitives.Title>
              {t.description && <ToastPrimitives.Description className="text-xs opacity-90">{t.description}</ToastPrimitives.Description>}
            </div>
            <ToastPrimitives.Close className="absolute right-2 top-2 rounded-md p-1 opacity-60 hover:opacity-100">
              <X className="h-4 w-4" />
            </ToastPrimitives.Close>
          </ToastPrimitives.Root>
        ))}
        <ToastPrimitives.Viewport className="fixed top-0 right-0 z-[100] flex max-h-screen w-full flex-col gap-2 p-4 sm:max-w-[400px]" />
      </ToastPrimitives.Provider>
    </ToastContext.Provider>
  )
}
