import { useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { PIN_COLORS, useTravelStore, type Pin } from '../store'

interface PendingPin {
  lat: number
  lng: number
}

function PinForm({
  initial,
  coords,
  onCancel,
  onSave,
  onDelete,
}: {
  initial?: Pin
  coords: { lat: number; lng: number }
  onCancel: () => void
  onSave: (data: { name: string; notes: string; color: string }) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [color, setColor] = useState(initial?.color ?? PIN_COLORS[0])

  return (
    <form
      className="pin-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSave({ name: name.trim(), notes, color })
      }}
    >
      <div className="pin-form-coords">
        {coords.lat.toFixed(3)}, {coords.lng.toFixed(3)}
      </div>
      <label>
        Name
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Kyoto"
          maxLength={80}
        />
      </label>
      <label>
        Notes
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Why here? What to remember?"
          rows={5}
        />
      </label>
      <div className="color-row">
        {PIN_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            className={`swatch ${color === c ? 'selected' : ''}`}
            style={{ background: c }}
            onClick={() => setColor(c)}
            aria-label={`color ${c}`}
          />
        ))}
      </div>
      <div className="pin-form-actions">
        <button type="submit" className="primary">
          {initial ? 'Save' : 'Drop pin'}
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {initial && onDelete && (
          <button type="button" className="danger" onClick={onDelete}>
            Delete
          </button>
        )}
      </div>
    </form>
  )
}

export default function MapTab() {
  const pins = useTravelStore((s) => s.pins)
  const addPin = useTravelStore((s) => s.addPin)
  const updatePin = useTravelStore((s) => s.updatePin)
  const deletePin = useTravelStore((s) => s.deletePin)

  const globeRef = useRef<GlobeMethods | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 800, height: 600 })

  const [pending, setPending] = useState<PendingPin | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      setSize({ width, height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const selectedPin = useMemo(
    () => pins.find((p) => p.id === selectedId) ?? null,
    [pins, selectedId],
  )

  const filteredPins = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return pins
    return pins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) || p.notes.toLowerCase().includes(q),
    )
  }, [pins, search])

  const flyTo = (lat: number, lng: number) => {
    globeRef.current?.pointOfView({ lat, lng, altitude: 1.5 }, 1000)
  }

  return (
    <div className="map-tab">
      <div className="globe-container" ref={containerRef}>
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          globeImageUrl="/globe/earth-blue-marble.jpg"
          bumpImageUrl="/globe/earth-topology.png"
          backgroundImageUrl="/globe/night-sky.png"
          showAtmosphere
          atmosphereColor="#6fb8ff"
          atmosphereAltitude={0.18}
          pointsData={pins}
          pointLat={(d) => (d as Pin).lat}
          pointLng={(d) => (d as Pin).lng}
          pointColor={(d) => (d as Pin).color}
          pointAltitude={(d) =>
            (d as Pin).id === selectedId ? 0.04 : 0.015
          }
          pointRadius={(d) => ((d as Pin).id === selectedId ? 0.55 : 0.35)}
          pointLabel={(d) => `${(d as Pin).name}`}
          onPointClick={(d) => {
            const pin = d as Pin
            setSelectedId(pin.id)
            setPending(null)
            flyTo(pin.lat, pin.lng)
          }}
          onGlobeClick={({ lat, lng }) => {
            setSelectedId(null)
            setPending({ lat, lng })
          }}
        />
      </div>

      <aside className="side-panel">
        {pending ? (
          <>
            <h3>New pin</h3>
            <PinForm
              coords={pending}
              onCancel={() => setPending(null)}
              onSave={({ name, notes, color }) => {
                const id = addPin({
                  lat: pending.lat,
                  lng: pending.lng,
                  name,
                  notes,
                  color,
                })
                setPending(null)
                setSelectedId(id)
              }}
            />
          </>
        ) : selectedPin ? (
          <>
            <h3>Edit pin</h3>
            <PinForm
              initial={selectedPin}
              coords={selectedPin}
              onCancel={() => setSelectedId(null)}
              onSave={(data) => {
                updatePin(selectedPin.id, data)
                setSelectedId(null)
              }}
              onDelete={() => {
                deletePin(selectedPin.id)
                setSelectedId(null)
              }}
            />
          </>
        ) : (
          <>
            <h3>Pinned places</h3>
            <p className="hint">Click anywhere on the globe to drop a pin.</p>
            <input
              className="search"
              placeholder="Search pins..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <ul className="pin-list">
              {filteredPins.length === 0 && (
                <li className="empty">No pins yet.</li>
              )}
              {filteredPins.map((p) => (
                <li
                  key={p.id}
                  className="pin-list-item"
                  onClick={() => {
                    setSelectedId(p.id)
                    flyTo(p.lat, p.lng)
                  }}
                >
                  <span className="dot" style={{ background: p.color }} />
                  <div>
                    <div className="pin-name">{p.name}</div>
                    {p.notes && <div className="pin-notes">{p.notes}</div>}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
