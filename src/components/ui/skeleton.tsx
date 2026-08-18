import { cn } from "@/lib/utils"

/**
 * `motion-safe:` is belt-and-suspenders with the global
 * `prefers-reduced-motion` override in globals.css — the global rule already
 * neutralizes the animation, but scoping it at the call site states the intent
 * where someone reading this component will see it.
 *
 * Renders no dynamic data (no dates, no counts), so it is server-renderable
 * with byte-identical client output — no hydration-mismatch risk.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("motion-safe:animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
