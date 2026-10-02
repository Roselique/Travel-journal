import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import countryLabels from '../data/countryLabels.json'
import { PIN_COLORS, useTravelStore, type Pin } from '../store'

interface PendingPin {
  lat: number
  lng: number
}

// Below this zoom level, show the colorful satellite basemap (continent/world
// view); above it, switch to the detailed English-labeled topo map.
const SATELLITE_MAX_LEVEL = 6

// Country name labels only make sense at the zoomed-out whole-globe view;
// hide them once the camera gets close enough that the basemap has its own labels.
const COUNTRY_LABEL_MIN_ALTITUDE = 0.8

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

  const [showCountryLabels, setShowCountryLabels] = useState(true)

  const flyTo = useCallback((lat: number, lng: number) => {
    globeRef.current?.pointOfView({ lat, lng, altitude: 1.5 }, 1000)
  }, [])

  // Stable across renders: three-globe rebuilds every HTML marker whenever
  // this function identity changes, so it must not depend on render-scoped
  // state (pin selection is applied afterwards via a DOM class toggle instead).
  const createPinElement = useCallback(
    (d: object) => {
      const pin = d as Pin
      const anchor = document.createElement('div')
      anchor.className = 'pin-marker-anchor'
      anchor.dataset.pinId = pin.id

      const dot = document.createElement('div')
      dot.className = 'pin-marker'
      dot.style.background = pin.color
      dot.title = pin.name
      anchor.appendChild(dot)

      anchor.addEventListener('click', () => {
        setSelectedId(pin.id)
        setPending(null)
        flyTo(pin.lat, pin.lng)
      })

      return anchor
    },
    [flyTo],
  )

  // Reflect the current selection onto marker DOM nodes (recreating them on
  // every selection change would defeat the point of keeping createPinElement
  // stable). A brand-new marker's DOM node is created asynchronously by the
  // globe's own render loop, arbitrarily later than the React commit that
  // added it to htmlElementsData, so a MutationObserver re-applies the
  // current selection whenever markers actually appear, instead of assuming
  // a fixed number of frames have passed.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  const applySelectedClass = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('.pin-marker-anchor').forEach((node) => {
      node
        .querySelector('.pin-marker')
        ?.classList.toggle('selected', node.dataset.pinId === selectedIdRef.current)
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new MutationObserver(applySelectedClass)
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [applySelectedClass])

  // react-globe.gl's own click-to-raycast handler (which drives onGlobeClick)
  // is bound in the capture phase on its internal container, an element
  // between this wrapper div and the marker nodes — so it always fires
  // alongside a marker's own click, and stopPropagation() from the marker
  // can't reach back far enough to stop it. Instead, record on pointerdown
  // whether the press started on a marker, and have onGlobeClick ignore
  // itself in that case, so clicking a pin never also opens the "new pin"
  // flow underneath it.
  const clickedMarkerRef = useRef(false)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onPointerDown = (e: PointerEvent) => {
      clickedMarkerRef.current = !!(e.target as HTMLElement).closest(
        '.pin-marker-anchor',
      )
    }
    el.addEventListener('pointerdown', onPointerDown, { capture: true })
    return () =>
      el.removeEventListener('pointerdown', onPointerDown, { capture: true })
  }, [])

  useEffect(applySelectedClass, [selectedId, applySelectedClass])

  return (
    <div className="map-tab">
      <div className="globe-container" ref={containerRef}>
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          globeTileEngineUrl={(x, y, l) => {
            if (l <= SATELLITE_MAX_LEVEL) {
              return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`
            }
            // CARTO's raster basemap serves @2x ("retina") tiles with
            // double the pixel density for the same map area, so text
            // labels stay crisp on high-DPI screens instead of a 256px
            // tile being stretched across more physical pixels.
            const retina = window.devicePixelRatio > 1 ? '@2x' : ''
            return `https://basemaps.cartocdn.com/rastertiles/voyager/${l}/${x}/${y}${retina}.png`
          }}
          backgroundImageUrl={`${import.meta.env.BASE_URL}globe/night-sky.png`}
          showAtmosphere
          atmosphereColor="#6fb8ff"
          atmosphereAltitude={0.18}
          onZoom={({ altitude }) => {
            const show = altitude > COUNTRY_LABEL_MIN_ALTITUDE
            setShowCountryLabels((prev) => (prev === show ? prev : show))
          }}
          labelsData={showCountryLabels ? countryLabels : []}
          labelLat={(d) => (d as { lat: number }).lat}
          labelLng={(d) => (d as { lng: number }).lng}
          labelText={(d) => (d as { name: string }).name}
          labelSize={0.6}
          labelColor={() => 'rgba(255, 255, 255, 0.85)'}
          labelDotRadius={0}
          labelAltitude={0.005}
          labelsTransitionDuration={0}
          htmlElementsData={pins}
          htmlLat={(d) => (d as Pin).lat}
          htmlLng={(d) => (d as Pin).lng}
          htmlElement={createPinElement}
          onGlobeClick={({ lat, lng }) => {
            if (clickedMarkerRef.current) return
            setSelectedId(null)
            setPending({ lat, lng })
          }}
        />
        <div className="map-attribution">
          Imagery &copy; Esri &mdash; Map &copy;{' '}
          <a href="https://carto.com/attributions" target="_blank" rel="noreferrer">
            CARTO
          </a>
          ,{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noreferrer"
          >
            OpenStreetMap
          </a>{' '}
          contributors
        </div>
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
