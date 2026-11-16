import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { Center, Cluster, Stack } from "@phaneris/ui"

function Empty({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <Center
      data-slot="empty"
      className={cn("flex-1 rounded-lg p-6 pb-[20%] text-balance", className)}
      {...props}
    >
      <Stack gap="md" align="center">{children}</Stack>
    </Center>
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn(
        "flex max-w-sm flex-col items-center gap-2 text-center",
        className
      )}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "flex shrink-0 items-center justify-center mb-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        icon: "text-muted-foreground flex shrink-0 items-center justify-center [&_svg:not([class*='size-'])]:size-10 [&_svg]:stroke-[1.5]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function EmptyMedia({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("text-body font-medium tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-muted-foreground [&>a:hover]:text-primary text-meta/snug [&>a]:underline [&>a]:underline-offset-4",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <Cluster
      data-slot="empty-content"
      gap="md"
      justify="center"
      className={cn("w-full max-w-sm mt-3 text-body", className)}
      {...props}
    />
  )
}

export {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
  EmptyMedia,
}

