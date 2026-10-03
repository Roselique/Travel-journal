import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import countryLabels from '../data/countryLabels.json'
import {
  formatDuration,
  formatKm,
  haversineKm,
  TRAVEL_MODE_INFO,
  type TravelMode,
} from '../lib/travel'
import { PIN_KIND_INFO, useTravelStore, type Pin, type PinKind } from '../store'

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

const PIN_KINDS: PinKind[] = ['destination', 'activity']
const TRAVEL_MODES: TravelMode[] = ['walking', 'train', 'airplane']

// Both pin kinds share the classic map-pin silhouette (what "make it look
// more like pins" asked for) — a circle head with a triangular tail; the
// glyph inside the head and the fill color are what actually tell a
// destination pin apart from an activity pin. Built from plain shapes
// (not SVG/filters) since that combination crashed the WebGL-overlaid
// marker when tested.
function PinGlyphIcon({ kind, color }: { kind: PinKind; color: string }) {
  return (
    <span className="pin-glyph-icon">
      <span className="pin-circle" style={{ background: color }}>
        <span
          className={`pin-glyph ${kind === 'activity' ? 'pin-glyph-diamond' : 'pin-glyph-dot'}`}
        />
      </span>
      <span className="pin-tail" style={{ borderTopColor: color }} />
    </span>
  )
}

function buildPinGlyphElement(kind: PinKind, color: string): HTMLElement {
  const icon = document.createElement('span')
  icon.className = 'pin-glyph-icon'

  const circle = document.createElement('span')
  circle.className = 'pin-circle'
  circle.style.background = color

  const glyph = document.createElement('span')
  glyph.className = `pin-glyph ${kind === 'activity' ? 'pin-glyph-diamond' : 'pin-glyph-dot'}`
  circle.appendChild(glyph)

  const tail = document.createElement('span')
  tail.className = 'pin-tail'
  tail.style.borderTopColor = color

  icon.appendChild(circle)
  icon.appendChild(tail)
  return icon
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
  onSave: (data: { name: string; notes: string; kind: PinKind }) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [kind, setKind] = useState<PinKind>(initial?.kind ?? 'destination')

  return (
    <form
      className="pin-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSave({ name: name.trim(), notes, kind })
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
      <div className="kind-row">
        {PIN_KINDS.map((k) => (
          <button
            type="button"
            key={k}
            className={`kind-btn ${kind === k ? 'selected' : ''}`}
            onClick={() => setKind(k)}
          >
            <span className="kind-icon">
              <PinGlyphIcon kind={k} color={PIN_KIND_INFO[k].color} />
            </span>
            {PIN_KIND_INFO[k].label}
          </button>
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
  const [routeIds, setRouteIds] = useState<string[]>([])
  const [travelMode, setTravelMode] = useState<TravelMode | null>(null)

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

  const routePins = useMemo(
    () =>
      routeIds
        .map((id) => pins.find((p) => p.id === id))
        .filter((p): p is Pin => !!p),
    [routeIds, pins],
  )

  const legs = useMemo(() => {
    const out: { from: Pin; to: Pin; km: number }[] = []
    for (let i = 0; i < routePins.length - 1; i++) {
      const from = routePins[i]
      const to = routePins[i + 1]
      out.push({
        from,
        to,
        km: haversineKm(from.lat, from.lng, to.lat, to.lng),
      })
    }
    return out
  }, [routePins])

  const totalKm = useMemo(() => legs.reduce((sum, l) => sum + l.km, 0), [legs])

  const clearRoute = useCallback(() => {
    setRouteIds([])
    setTravelMode(null)
  }, [])

  const [showCountryLabels, setShowCountryLabels] = useState(true)

  const flyTo = useCallback((lat: number, lng: number) => {
    globeRef.current?.pointOfView({ lat, lng, altitude: 1.5 }, 1000)
  }, [])

  // Stable across renders: three-globe rebuilds every HTML marker whenever
  // this function identity changes, so it must not depend on render-scoped
  // state (selection/route membership is applied afterwards via a DOM class
  // toggle instead).
  const createPinElement = useCallback(
    (d: object) => {
      const pin = d as Pin
      const kind: PinKind = pin.kind ?? 'destination'
      const color = PIN_KIND_INFO[kind].color

      const anchor = document.createElement('div')
      anchor.className = 'pin-marker-anchor'
      anchor.dataset.pinId = pin.id

      const iconWrap = document.createElement('div')
      iconWrap.className = 'pin-icon-wrap'
      iconWrap.title = pin.name
      iconWrap.appendChild(buildPinGlyphElement(kind, color))
      anchor.appendChild(iconWrap)

      anchor.addEventListener('click', (e) => {
        if (e.shiftKey) {
          setSelectedId(null)
          setPending(null)
          setRouteIds((prev) =>
            prev.includes(pin.id)
              ? prev.filter((id) => id !== pin.id)
              : [...prev, pin.id],
          )
          return
        }
        setRouteIds([])
        setTravelMode(null)
        setSelectedId(pin.id)
        setPending(null)
        flyTo(pin.lat, pin.lng)
      })

      return anchor
    },
    [flyTo],
  )

  // Reflect the current selection/route membership onto marker DOM nodes
  // (recreating them on every change would defeat the point of keeping
  // createPinElement stable). A brand-new marker's DOM node is created
  // asynchronously by the globe's own render loop, arbitrarily later than
  // the React commit that added it to htmlElementsData, so a
  // MutationObserver re-applies state whenever markers actually appear,
  // instead of assuming a fixed number of frames have passed.
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const routeIdsRef = useRef(routeIds)
  routeIdsRef.current = routeIds

  const syncMarkerState = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    el.querySelectorAll<HTMLElement>('.pin-marker-anchor').forEach((node) => {
      const icon = node.querySelector<HTMLElement>('.pin-icon-wrap')
      if (!icon) return
      const pinId = node.dataset.pinId ?? ''
      icon.classList.toggle('selected', pinId === selectedIdRef.current)
      const routeIndex = routeIdsRef.current.indexOf(pinId)
      icon.classList.toggle('in-route', routeIndex !== -1)

      let badge = node.querySelector<HTMLElement>('.pin-badge')
      if (routeIndex !== -1) {
        if (!badge) {
          badge = document.createElement('div')
          badge.className = 'pin-badge'
          node.appendChild(badge)
        }
        badge.textContent = String(routeIndex + 1)
      } else if (badge) {
        badge.remove()
      }
    })
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const observer = new MutationObserver(syncMarkerState)
    observer.observe(el, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [syncMarkerState])

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

  useEffect(syncMarkerState, [selectedId, routeIds, syncMarkerState])

  return (
    <div className="map-tab">
      <div className="globe-container" ref={containerRef}>
        <Globe
          ref={globeRef}
          width={size.width}
          height={size.height}
          globeTileEngineUrl={(x, y, l) =>
            l <= SATELLITE_MAX_LEVEL
              ? `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${l}/${y}/${x}`
              : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/${l}/${y}/${x}`
          }
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
            setRouteIds([])
            setTravelMode(null)
            setSelectedId(null)
            setPending({ lat, lng })
          }}
        />
        <div className="map-attribution">
          Basemap &copy;{' '}
          <a
            href="https://www.esri.com/en-us/legal/terms/data-attributions"
            target="_blank"
            rel="noreferrer"
          >
            Esri
          </a>
          , HERE, Garmin, OpenStreetMap contributors
        </div>

        {routePins.length >= 2 && (
          <div className="travel-popup">
            <div className="travel-popup-header">
              <strong>{routePins.map((p) => p.name).join(' → ')}</strong>
              <button
                type="button"
                className="close-btn"
                onClick={clearRoute}
                aria-label="Clear route selection"
              >
                ✕
              </button>
            </div>
            <div className="travel-mode-row">
              {TRAVEL_MODES.map((mode) => (
                <button
                  type="button"
                  key={mode}
                  className={`travel-mode-btn ${travelMode === mode ? 'active' : ''}`}
                  onClick={() => setTravelMode(mode)}
                >
                  <span>{TRAVEL_MODE_INFO[mode].icon}</span>
                  {TRAVEL_MODE_INFO[mode].label}
                </button>
              ))}
            </div>
            {travelMode && (
              <div className="travel-result">
                <div className="travel-total">
                  {formatKm(totalKm)} &bull; ~
                  {formatDuration(
                    totalKm / TRAVEL_MODE_INFO[travelMode].speedKmh,
                  )}
                </div>
                {legs.length > 1 && (
                  <ul className="travel-legs">
                    {legs.map((leg, i) => (
                      <li key={i}>
                        {leg.from.name} → {leg.to.name}: {formatKm(leg.km)}, ~
                        {formatDuration(
                          leg.km / TRAVEL_MODE_INFO[travelMode].speedKmh,
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="travel-disclaimer">
                  Estimate based on straight-line distance at a typical{' '}
                  {TRAVEL_MODE_INFO[travelMode].label.toLowerCase()} speed
                  &mdash; actual travel time will vary with real routes and
                  schedules.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      <aside className="side-panel">
        {pending ? (
          <>
            <h3>New pin</h3>
            <PinForm
              coords={pending}
              onCancel={() => setPending(null)}
              onSave={({ name, notes, kind }) => {
                const id = addPin({
                  lat: pending.lat,
                  lng: pending.lng,
                  name,
                  notes,
                  kind,
                  color: PIN_KIND_INFO[kind].color,
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
              onSave={({ name, notes, kind }) => {
                updatePin(selectedPin.id, {
                  name,
                  notes,
                  kind,
                  color: PIN_KIND_INFO[kind].color,
                })
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
            <p className="hint">
              Click anywhere on the globe to drop a pin. Shift-click two or
              more pins to compare travel time between them.
            </p>
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
              {filteredPins.map((p) => {
                const kind = p.kind ?? 'destination'
                return (
                  <li
                    key={p.id}
                    className="pin-list-item"
                    onClick={() => {
                      setRouteIds([])
                      setTravelMode(null)
                      setSelectedId(p.id)
                      flyTo(p.lat, p.lng)
                    }}
                  >
                    <span className="pin-list-icon">
                      <PinGlyphIcon kind={kind} color={PIN_KIND_INFO[kind].color} />
                    </span>
                    <div>
                      <div className="pin-name">{p.name}</div>
                      {p.notes && <div className="pin-notes">{p.notes}</div>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </aside>
    </div>
  )
}
