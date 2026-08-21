"use client"

import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

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
    if (!address) {
      setLoading(false)
      return
    }

    let isMounted = true
    setLoading(true)
    setError(null)

    // Append a hint for Accra/Ghana to improve local geocoding accuracy if it's not present
    const searchQuery = address.toLowerCase().includes('ghana') ? address : `${address}, Ghana`

    fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(searchQuery)}`)
      .then(res => res.json())
      .then(data => {
        if (!isMounted) return
        if (data && data.length > 0) {
          setCoordinates([parseFloat(data[0].lat), parseFloat(data[0].lon)])
        } else {
          setError('Location not found')
        }
        setLoading(false)
      })
      .catch(err => {
        if (!isMounted) return
        setError('Geocoding failed')
        setLoading(false)
      })

    return () => { isMounted = false }
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
    <div className="w-full h-full relative rounded-lg overflow-hidden border border-border">
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
        className="absolute bottom-4 right-4 z-[400] bg-background/90 backdrop-blur-sm shadow-md border border-border rounded-full px-4 py-2 text-xs font-semibold hover:bg-background transition-colors"
      >
        Directions
      </a>
    </div>
  )
}
