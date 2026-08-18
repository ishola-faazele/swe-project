import { Skeleton } from "@/components/ui/skeleton"

// Mirrors the customer portal: header then a stack of order cards.
export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 space-y-2">
                <Skeleton className="h-5 w-56" />
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-6 w-24 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
