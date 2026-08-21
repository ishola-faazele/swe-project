"use client"

import { useState } from "react"
import { ChevronLeft, ChevronRight, UtensilsCrossed, Film } from "lucide-react"
import { cn } from "@/lib/utils"

export interface CarouselMedia {
  id: string
  url: string
  type: 'IMAGE' | 'VIDEO'
}

export function MediaCarousel({ media }: { media: CarouselMedia[] }) {
  const [currentIndex, setCurrentIndex] = useState(0)

  if (media.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center text-muted-foreground/30 bg-muted/50">
        <UtensilsCrossed className="h-10 w-10" aria-hidden="true" />
      </div>
    )
  }

  const handlePrevious = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : media.length - 1))
  }

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setCurrentIndex((prev) => (prev < media.length - 1 ? prev + 1 : 0))
  }

  return (
    <div className="relative h-full w-full overflow-hidden group/carousel">
      <div 
        className="flex h-full w-full transition-transform duration-300 ease-out"
        style={{ transform: `translateX(-${currentIndex * 100}%)` }}
      >
        {media.map((item) => (
          <div key={item.id} className="relative h-full w-full shrink-0">
            {item.type === 'VIDEO' ? (
              <video 
                src={item.url} 
                className="h-full w-full object-cover" 
                muted 
                playsInline 
                loop 
                autoPlay 
              />
            ) : (
              <img 
                src={item.url} 
                alt="Dish media" 
                className="h-full w-full object-cover" 
              />
            )}
          </div>
        ))}
      </div>

      {media.length > 1 && (
        <>
          <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-between px-2 opacity-0 transition-opacity group-hover/carousel:opacity-100">
            <button
              type="button"
              onClick={handlePrevious}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-background/80 text-foreground shadow-sm hover:bg-background"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1.5">
            {media.map((_, idx) => (
              <div
                key={idx}
                className={cn(
                  "h-1.5 rounded-full bg-white transition-all shadow-sm",
                  idx === currentIndex ? "w-4 opacity-100" : "w-1.5 opacity-50"
                )}
              />
            ))}
          </div>
        </>
      )}

      {media[currentIndex]?.type === 'VIDEO' && (
        <span
          className="absolute top-2 left-2 flex items-center gap-1 rounded bg-background/90 px-1.5 py-1 text-[10px] font-medium tracking-wide text-foreground shadow-sm"
          title="This dish has video"
        >
          <Film className="h-3 w-3" aria-hidden="true" />
          VIDEO
        </span>
      )}
    </div>
  )
}
