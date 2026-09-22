import * as React from 'react'
import { CalendarDays, X } from 'lucide-react'
import { format, parseISO } from 'date-fns'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

interface DateFieldProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  min?: string
  className?: string
  ariaLabel?: string
}

/** Theme-native local-date picker. Values stay as YYYY-MM-DD and never shift time zones. */
export function DateField({ value, onChange, placeholder = 'Select date', disabled, min, className, ariaLabel }: DateFieldProps) {
  const [open, setOpen] = React.useState(false)
  const selected = value ? parseISO(value.slice(0, 10)) : undefined
  const minDate = min ? parseISO(min.slice(0, 10)) : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative">
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label={ariaLabel}
            className={cn(
              'flex h-9 w-full items-center gap-2 rounded-lg border border-border bg-background px-3 text-left text-sm outline-none transition-colors',
              'hover:bg-foreground/[0.025] focus-visible:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring/15 disabled:opacity-45',
              !value && 'text-foreground/45',
              className,
            )}
          >
            <CalendarDays className="h-4 w-4 flex-none text-foreground/40" />
            <span className="min-w-0 flex-1 truncate">{selected ? format(selected, 'yyyy-MM-dd') : placeholder}</span>
          </button>
        </PopoverTrigger>
        {value && !disabled && (
          <button
            type="button"
            aria-label="Clear date"
            onClick={(event) => {
              event.stopPropagation()
              onChange('')
            }}
            className="absolute right-1.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-md text-foreground/35 hover:bg-foreground/[0.06] hover:text-foreground/70"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent align="start" className="w-[18rem] overflow-hidden p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={minDate ? { before: minDate } : undefined}
          captionLayout="dropdown"
          onSelect={(date) => {
            if (!date) return
            onChange(format(date, 'yyyy-MM-dd'))
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
