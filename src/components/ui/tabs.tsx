"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"

import { cn } from "@/lib/utils"

/**
 * Thin wrapper over Base UI's Tabs, same convention as dialog.tsx/switch.tsx.
 *
 * Export names are deliberately fixed here once and used identically by both call sites (the login
 * page's Email/Phone switcher and the Settings page's Notifications/Login switcher). Base UI's
 * underlying parts are Root/List/Tab/Panel; these wrap them as Tabs/TabsList/TabsTrigger/TabsPanel
 * so the naming reads the way the rest of the ui/ folder does.
 *
 * Arrow-key navigation between tabs comes from the primitive — no custom key handling added.
 */
function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-4", className)}
      {...props}
    />
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex w-full items-center justify-start gap-1 rounded-lg border border-border bg-card p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none",
        "text-muted-foreground hover:text-foreground",
        "data-selected:bg-primary data-selected:text-primary-foreground",
        "focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-panel"
      className={cn("outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsPanel }
