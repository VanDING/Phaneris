import type { ComponentProps } from 'react'
import { cn } from '@/lib/utils'

/** One optical slot for Lucide icons and configured inline SVGs alike. */
export function MenuIcon({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('menu-icon inline-flex size-4 shrink-0 items-center justify-center', className)} aria-hidden="true" {...props} />
}
