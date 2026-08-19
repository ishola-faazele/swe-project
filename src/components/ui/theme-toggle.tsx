"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"

export function ThemeToggle() {
  const { setTheme, theme, systemTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)

  React.useEffect(() => {
    // Standard next-themes hydration guard: theme is unknowable during SSR, so this defers
    // rendering the sun/moon icon until after mount rather than guessing and risking a
    // hydration mismatch. Not the "derive state from props" anti-pattern the rule targets —
    // `mounted` has no server-renderable value at all until the client takes over.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true)
  }, [])

  if (!mounted) {
    return <div className="h-9 w-9" />
  }

  const currentTheme = theme === "system" ? systemTheme : theme

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setTheme(currentTheme === "dark" ? "light" : "dark")}
      className="w-9 px-0 text-muted-foreground hover:text-foreground"
      title="Toggle theme"
    >
      {currentTheme === "dark" ? (
        <Moon className="h-4 w-4" />
      ) : (
        <Sun className="h-4 w-4" />
      )}
      <span className="sr-only">Toggle theme</span>
    </Button>
  )
}
