import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn, STATUS_COLORS } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      destructive: 'border-transparent bg-destructive text-destructive-foreground',
      outline: 'text-foreground',
      success: 'border-transparent bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
      info: 'border-transparent bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
      warning: 'border-transparent bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300',
      danger: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
      muted: 'border-transparent bg-muted text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}

const colorToVariant: Record<string, BadgeProps['variant']> = {
  green: 'success',
  blue: 'info',
  orange: 'warning',
  red: 'danger',
  grey: 'muted',
}

/** Badge colored by a status color token (green/blue/orange/red/grey/...). */
function StatusBadge({ color, children, className, title }: { color?: string | null; children: React.ReactNode; className?: string; title?: string }) {
  const variant = (color && colorToVariant[color]) || undefined
  if (variant) return <Badge variant={variant} className={className} title={title}>{children}</Badge>
  const hex = color ? STATUS_COLORS[color] : undefined
  return (
    <Badge variant="outline" className={className} title={title} style={hex ? { borderColor: hex, color: hex } : undefined}>
      {children}
    </Badge>
  )
}

export { Badge, StatusBadge, badgeVariants }
