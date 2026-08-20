"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

/**
 * Thin wrapper over Base UI's Switch, following the same convention as dialog.tsx: forward the
 * primitive's own props, add a data-slot, merge className through cn().
 *
 * Base UI renders Root as a <span> plus a hidden <input>, so `disabled` genuinely blocks
 * interaction rather than only dimming — which matters for the Phone-login toggle, whose disabled
 * state is asserted in SettingsClient.test.tsx.
 */
function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
      <SwitchPrimitive.Root
        data-slot="switch"
        className={cn(
          "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent p-0.5 transition-colors outline-none",
          "bg-input/80 dark:bg-muted-foreground/30 data-checked:bg-primary",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          className={cn(
            "pointer-events-none block size-4 rounded-full bg-white shadow-sm ring-0 transition-transform",
            "data-checked:translate-x-4 data-unchecked:translate-x-0"
          )}
        />
      </SwitchPrimitive.Root>
  )
}

export { Switch }
