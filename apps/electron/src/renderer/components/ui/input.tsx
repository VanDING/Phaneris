import * as React from "react"
import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentPropsWithoutRef<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        ref={ref}
        data-slot="input"
        className={cn(
          "craft-control craft-field-input flex h-control-lg w-full rounded-md border px-3 py-1 text-body file:border-0 file:bg-transparent file:text-body file:font-medium file:text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-body",
          className
        )}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
