"use client"

import { useEffect, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import { searchAddresses } from "@/lib/geocode"

const MapComponent = dynamic(() => import("@/app/admin/driver/MapComponent"), { ssr: false })

const SEARCH_DEBOUNCE_MS = 400

type Suggestion = { label: string; lat: number; lon: number }

/**
 * Delivery-address text field with a Nominatim-backed autocomplete dropdown and a map preview
 * below it, shared by the order create dialog (OrderClient.tsx) and the order edit view
 * (OrderDetailsClient.tsx) — both previously hand-rolled this same input+map pairing separately,
 * with a wrapper height (h-48) that didn't match MapComponent's own min-h-100 floor, causing the
 * map to visually overflow its column. This owns the map's sizing in exactly one place instead.
 */
export function DeliveryAddressField({
  id = "deliveryAddress",
  name = "deliveryAddress",
  label = "Delivery Address (Optional)",
  value,
  onChange,
}: {
  id?: string
  name?: string
  label?: string
  value: string
  onChange: (value: string) => void
}) {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // No setSuggestions([]) here: the render below already requires value.trim().length >= 3
    // before showing the dropdown, so a stale suggestions array from a longer previous value
    // stays harmlessly masked rather than needing a synchronous reset.
    if (value.trim().length < 3) {
      return
    }

    let isMounted = true
    const timer = setTimeout(() => {
      searchAddresses(value).then((result) => {
        if (!isMounted) return
        if (result.ok) {
          setSuggestions(result.data)
          setShowSuggestions(result.data.length > 0)
        }
      })
    }, SEARCH_DEBOUNCE_MS)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [value])

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  function selectSuggestion(suggestion: Suggestion) {
    onChange(suggestion.label)
    setSuggestions([])
    setShowSuggestions(false)
    setHighlightedIndex(-1)
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div ref={containerRef} className="relative">
        <Input
          id={id}
          name={name}
          placeholder="123 Example St"
          autoComplete="off"
          value={value}
          onChange={(e) => {
            onChange(e.target.value)
            setHighlightedIndex(-1)
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowSuggestions(true)
          }}
          onKeyDown={(e) => {
            if (!showSuggestions || suggestions.length === 0) return
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setHighlightedIndex((i) => (i + 1) % suggestions.length)
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setHighlightedIndex((i) => (i - 1 + suggestions.length) % suggestions.length)
            } else if (e.key === "Enter" && highlightedIndex >= 0) {
              e.preventDefault()
              selectSuggestion(suggestions[highlightedIndex])
            } else if (e.key === "Escape") {
              setShowSuggestions(false)
            }
          }}
        />
        {showSuggestions && suggestions.length > 0 && value.trim().length >= 3 && (
          <ul
            id={`${id}-suggestions`}
            role="listbox"
            className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg"
          >
            {suggestions.map((suggestion, i) => (
              <li
                key={`${suggestion.lat}-${suggestion.lon}`}
                role="option"
                aria-selected={i === highlightedIndex}
                className={cn(
                  "cursor-pointer px-3 py-2 text-sm",
                  i === highlightedIndex ? "bg-muted" : "hover:bg-muted/60"
                )}
                // onMouseDown + preventDefault (not onClick) stops the browser's default
                // focus-shift, so clicking a suggestion doesn't blur the input first.
                onMouseDown={(e) => {
                  e.preventDefault()
                  selectSuggestion(suggestion)
                }}
                onMouseEnter={() => setHighlightedIndex(i)}
              >
                {suggestion.label}
              </li>
            ))}
          </ul>
        )}
      </div>
      {value && (
        // h-100 (not just relying on MapComponent's own min-h-100): Leaflet's inner
        // .leaflet-container uses height:100%, which only resolves against a parent with a
        // DEFINITE height. A parent sized purely via min-height doesn't count as definite, so
        // without an explicit height here the map measures 0px tall and renders blank — verified
        // by inspecting the live DOM (outer box correctly 400px, .leaflet-container 0px).
        <div className="w-full h-100 mt-2">
          <MapComponent address={value} />
        </div>
      )}
    </div>
  )
}
