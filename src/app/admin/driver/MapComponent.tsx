"use client"

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { geocodeAddress } from '@/lib/geocode'

// Address changes fire on every keystroke (deliveryAddressInput's onChange in OrderClient.tsx /
// OrderDetailsClient.tsx) — without this delay, typing a full address fires a geocode lookup per
// character. Also gives Nominatim's server-side rate limiter (see geocode.ts) far less to do.
const GEOCODE_DEBOUNCE_MS = 600

// Fix for default Leaflet icon missing in Next.js
const DefaultIcon = L.icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  tooltipAnchor: [16, -28],
  shadowSize: [41, 41]
})
L.Marker.prototype.options.icon = DefaultIcon

function MapUpdater({ center }: { center: [number, number] }) {
  const map = useMap()
  useEffect(() => {
    map.setView(center, map.getZoom())
  }, [center, map])
  return null
}

export default function MapComponent({ address }: { address: string }) {
  const [coordinates, setCoordinates] = useState<[number, number] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // No setLoading(false) here: the `!address` render branch below returns before `loading` is
    // ever read, so resetting it would be a no-op state update purely for its own sake.
    if (!address) {
      return
    }

    let isMounted = true

    // Debounced: fires once typing pauses, not on every keystroke — see GEOCODE_DEBOUNCE_MS above.
    // loading/error reset happens inside the timeout (not synchronously here) so the map keeps
    // showing the last resolved pin while the user keeps typing, rather than flashing
    // "Locating..." on every keystroke.
    const timer = setTimeout(() => {
      if (!isMounted) return
      setLoading(true)
      setError(null)
      geocodeAddress(address)
        .then(result => {
          if (!isMounted) return
          if (result.ok) {
            setCoordinates([result.data.lat, result.data.lon])
          } else {
            setError(result.error)
          }
          setLoading(false)
        })
        .catch(() => {
          if (!isMounted) return
          setError('Geocoding failed')
          setLoading(false)
        })
    }, GEOCODE_DEBOUNCE_MS)

    return () => {
      isMounted = false
      clearTimeout(timer)
    }
  }, [address])

  if (!address) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/20 text-muted-foreground rounded-lg border border-border text-sm">
        No delivery address provided
      </div>
    )
  }

  if (loading) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-muted/20 rounded-lg border border-border text-sm animate-pulse">
        Locating address...
      </div>
    )
  }

  if (error || !coordinates) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-muted/20 text-muted-foreground rounded-lg border border-border text-sm p-4 text-center">
        <p>Could not map the address:</p>
        <p className="font-medium mt-1 text-foreground">{address}</p>
        <a 
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 text-primary hover:underline"
        >
          Open in Google Maps
        </a>
      </div>
    )
  }

  return (
    <div className="w-full h-full min-h-100 relative rounded-lg overflow-hidden border border-border">
      <MapContainer 
        center={coordinates} 
        zoom={15} 
        style={{ width: '100%', height: '100%' }}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={coordinates}>
          <Popup>
            <div className="font-sans text-sm">
              <strong>Delivery Address</strong><br/>
              {address}
            </div>
          </Popup>
        </Marker>
        <MapUpdater center={coordinates} />
      </MapContainer>
      
      {/* Quick link button overlaid on map */}
      <a 
        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-4 right-4 z-400 bg-background/90 backdrop-blur-sm shadow-md border border-border rounded-full px-4 py-2 text-xs font-semibold hover:bg-background transition-colors"
      >
        Directions
      </a>
    </div>
  )
}
