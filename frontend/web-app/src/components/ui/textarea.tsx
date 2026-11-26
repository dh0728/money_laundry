import * as React from "react"
import { cn } from "@/lib/utils"

type TextareaProps = React.ComponentProps<"textarea"> & {
  variant?: "default" | "plain"
  editor?: boolean
}

function Textarea({ className, variant = "default", editor = false, ...props }: TextareaProps) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        variant === "plain"
          ? "w-full rounded-md border bg-background p-2 text-sm"
          : "flex field-sizing-content w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-(--control-transition-properties) outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-(length:--control-focus-ring-width) focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40",
        editor ? "min-h-textarea-editor flex-1 resize-y text-sm leading-7" : "min-h-16",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
