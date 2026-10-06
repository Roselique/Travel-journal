import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import Globe, { type GlobeMethods } from 'react-globe.gl'
import { compareContinents, locateCountry, COUNTRY_LABELS } from '../lib/geo'
import {
  arcAltitudeForKm,
  estimateHours,
  fetchWalkingRoute,
  formatDuration,
  formatKm,
  greatCircleMidpoint,
  haversineKm,
  TRAVEL_MODE_ARC_COLOR,
  TRAVEL_MODE_INFO,
  type RouteResult,
  type TravelMode,
} from '../lib/travel'
import { fileToCompressedDataUrl } from '../lib/image'
import {
  PIN_KIND_INFO,
  useTravelStore,
  VISITED_WITH_LABEL,
  type Pin,
  type PinKind,
  type VisitedWith,
} from '../store'

interface PendingPin {
  lat: number
  lng: number
}

// Route-arc label datum, distinguished from a Pin by the `__legLabel` tag so
// a single combined htmlElementsData array can hold both and createPinElement
// can branch on which one it's building. routeKey is 'live' for the route
// currently being built/edited in the popup, or a frozen route's id - it's
// how a click on the label knows which route to reopen.
interface LegLabelDatum {
  __legLabel: true
  id: string
  lat: number
  lng: number
  altitude: number
  text: string
  mode: TravelMode
  routeKey: string
}

// A route that was "kept" (its popup closed while the keep-route checkbox
// was on) - its arc/label stay drawn independently of whatever route is
// currently being built, so building a new route never appends to this one.
interface FrozenRoute {
  id: string
  pinIds: string[]
  mode: TravelMode
  animate: boolean
}

interface Leg {
  from: Pin
  to: Pin
  km: number
}

interface DisplayLeg extends Leg {
  hours: number
  routed: boolean
}

function legsForPinIds(pinIds: string[], pins: Pin[]): Leg[] {
  const routePins = pinIds
    .map((id) => pins.find((p) => p.id === id))
    .filter((p): p is Pin => !!p)
  const out: Leg[] = []
  for (let i = 0; i < routePins.length - 1; i++) {
    const from = routePins[i]
    const to = routePins[i + 1]
    out.push({ from, to, km: haversineKm(from.lat, from.lng, to.lat, to.lng) })
  }
  return out
}

function applyTravelMode(
  legs: Leg[],
  mode: TravelMode,
  walkingRoutes: Record<string, RouteResult>,
): DisplayLeg[] {
  return legs.map((leg) => {
    if (mode === 'walking') {
      const routed = walkingRoutes[`${leg.from.id}:${leg.to.id}`]
      if (routed) return { ...leg, km: routed.km, hours: routed.hours, routed: true }
    }
    return { ...leg, hours: estimateHours(mode, leg.km), routed: false }
  })
}

// Plain functions (not hooks) so they can be called equally from a stable,
// memoized event handler (via refs holding the latest values) and from a
// freshly-created inline one, with no dependency-ordering constraints.
//
// Closing the live route: if "keep route" is on and there's a complete
// route with a mode picked, freeze it into its own kept arc/label and
// reset the live slot, so the next pin selection starts a brand new route
// instead of extending the frozen one. Otherwise, clear as before.
function freezeOrClearRoute(args: {
  keepRoute: boolean
  travelMode: TravelMode | null
  routeIds: string[]
  animateRoute: boolean
  setFrozenRoutes: Dispatch<SetStateAction<FrozenRoute[]>>
  setRouteIds: Dispatch<SetStateAction<string[]>>
  setTravelMode: Dispatch<SetStateAction<TravelMode | null>>
  setAnimateRoute: Dispatch<SetStateAction<boolean>>
  setRoutePopupOpen: Dispatch<SetStateAction<boolean>>
}) {
  const { keepRoute, travelMode, routeIds, animateRoute } = args
  if (keepRoute && travelMode && routeIds.length >= 2) {
    args.setFrozenRoutes((prev) => [
      ...prev,
      {
        id: `frozen-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        pinIds: routeIds,
        mode: travelMode,
        animate: animateRoute,
      },
    ])
    args.setRouteIds([])
    args.setTravelMode(null)
    args.setAnimateRoute(false)
  } else if (!keepRoute) {
    args.setRouteIds([])
    args.setTravelMode(null)
    args.setAnimateRoute(false)
  }
  args.setRoutePopupOpen(false)
}

// Pulls a kept route back into the live slot so its popup can be reopened
// (and, if closed again, re-frozen).
function reviveFrozenRoute(
  routeKey: string,
  frozenRoutes: FrozenRoute[],
  setFrozenRoutes: Dispatch<SetStateAction<FrozenRoute[]>>,
  setRouteIds: Dispatch<SetStateAction<string[]>>,
  setTravelMode: Dispatch<SetStateAction<TravelMode | null>>,
  setAnimateRoute: Dispatch<SetStateAction<boolean>>,
  setRoutePopupOpen: Dispatch<SetStateAction<boolean>>,
) {
  const found = frozenRoutes.find((r) => r.id === routeKey)
  if (!found) return
  setFrozenRoutes((prev) => prev.filter((r) => r.id !== routeKey))
  setRouteIds(found.pinIds)
  setTravelMode(found.mode)
  setAnimateRoute(found.animate)
  setRoutePopupOpen(true)
}

// Below this zoom level, show the colorful satellite basemap (continent/world
// view); above it, switch to the detailed English-labeled topo map.
const SATELLITE_MAX_LEVEL = 6

// Country name labels only make sense at the zoomed-out whole-globe view;
// hide them once the camera gets close enough that the basemap has its own labels.
const COUNTRY_LABEL_MIN_ALTITUDE = 0.8

const PIN_KINDS: PinKind[] = ['destination', 'activity', 'visited']
const TRAVEL_MODES: TravelMode[] = ['walking', 'train', 'airplane']
const VISITED_WITH_OPTIONS: VisitedWith[] = ['', 'solo', 'friends', 'family']

// Shape (dot/diamond/checkmark) and, for the checkmark, the text content
// that distinguishes each pin kind's glyph inside the circle head.
function pinGlyphFor(kind: PinKind): { className: string; text?: string } {
  switch (kind) {
    case 'activity':
      return { className: 'pin-glyph pin-glyph-diamond' }
    case 'visited':
      return { className: 'pin-glyph pin-glyph-check', text: '✓' }
    default:
      return { className: 'pin-glyph pin-glyph-dot' }
  }
}

// All pin kinds share the classic map-pin silhouette (what "make it look
// more like pins" asked for) — a circle head with a triangular tail; the
// glyph inside the head and the fill color are what actually tell them
// apart. Built from plain shapes (not SVG/filters) since that combination
// crashed the WebGL-overlaid marker when tested.
function PinGlyphIcon({ kind, color }: { kind: PinKind; color: string }) {
  const glyph = pinGlyphFor(kind)
  return (
    <span className="pin-glyph-icon">
      <span className="pin-circle" style={{ background: color }}>
        <span className={glyph.className}>{glyph.text}</span>
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

  const glyphInfo = pinGlyphFor(kind)
  const glyph = document.createElement('span')
  glyph.className = glyphInfo.className
  if (glyphInfo.text) glyph.textContent = glyphInfo.text
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
  onSave: (data: {
    name: string
    notes: string
    kind: PinKind
    visitDate: string
    visitedWith: VisitedWith
    photos: string[]
  }) => void
  onDelete?: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [kind, setKind] = useState<PinKind>(initial?.kind ?? 'destination')
  const [visitDate, setVisitDate] = useState(initial?.visitDate ?? '')
  const [visitedWith, setVisitedWith] = useState<VisitedWith>(
    initial?.visitedWith ?? '',
  )
  const [photos, setPhotos] = useState<string[]>(initial?.photos ?? [])
  const [photosLoading, setPhotosLoading] = useState(false)

  const handlePhotoFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setPhotosLoading(true)
    try {
      const compressed = await Promise.all(
        Array.from(files).map((f) => fileToCompressedDataUrl(f)),
      )
      setPhotos((prev) => [...prev, ...compressed])
    } finally {
      setPhotosLoading(false)
    }
  }

  return (
    <form
      className="pin-form"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim()) return
        onSave({ name: name.trim(), notes, kind, visitDate, visitedWith, photos })
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
      {kind === 'visited' && (
        <div className="visited-details">
          <label>
            When did you go?
            <input
              type="date"
              value={visitDate}
              onChange={(e) => setVisitDate(e.target.value)}
            />
          </label>
          <label>
            Who with?
            <select
              value={visitedWith}
              onChange={(e) => setVisitedWith(e.target.value as VisitedWith)}
            >
              {VISITED_WITH_OPTIONS.map((w) => (
                <option key={w} value={w}>
                  {VISITED_WITH_LABEL[w]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Photos
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={(e) => {
                handlePhotoFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {photosLoading && <p className="hint">Processing photo&hellip;</p>}
          {photos.length > 0 && (
            <div className="pin-photo-grid">
              {photos.map((src, i) => (
                <div key={i} className="pin-photo-thumb">
                  <img src={src} alt="" />
                  <button
                    type="button"
                    className="pin-photo-remove"
                    aria-label="Remove photo"
                    onClick={() =>
                      setPhotos((prev) => prev.filter((_, idx) => idx !== i))
                    }
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  // Off by default (a static dashed line); the viewer can opt into an
  // animated dash flowing from the first selected pin to the second.
  const [animateRoute, setAnimateRoute] = useState(false)
  // Off by default: clicking elsewhere on the map (empty space, another
  // pin) clears the route as before. When on, closing the popup "freezes"
  // the route into a kept arc/label instead of clearing it, and the next
  // pin selection starts a brand new route rather than extending it.
  const [keepRoute, setKeepRoute] = useState(false)
  const keepRouteRef = useRef(keepRoute)
  keepRouteRef.current = keepRoute

  const [routePopupOpen, setRoutePopupOpen] = useState(false)
  // Keyed by "continent:<name>" or "country:<continent>:<name>" so both
  // grouping levels share one collapse set.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  )

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

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

  const groupedPins = useMemo(() => {
    const continents = new Map<string, Map<string, Pin[]>>()
    for (const p of filteredPins) {
      const { continent, country } = locateCountry(p.lat, p.lng)
      let countries = continents.get(continent)
      if (!countries) {
        countries = new Map()
        continents.set(continent, countries)
      }
      const list = countries.get(country)
      if (list) list.push(p)
      else countries.set(country, [p])
    }
    return [...continents.entries()]
      .sort((a, b) => compareContinents(a[0], b[0]))
      .map(([continent, countries]) => ({
        continent,
        count: [...countries.values()].reduce((sum, l) => sum + l.length, 0),
        countries: [...countries.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([country, list]) => ({
            country,
            pins: [...list].sort((a, b) => a.name.localeCompare(b.name)),
          })),
      }))
  }, [filteredPins])

  const routePins = useMemo(
    () =>
      routeIds
        .map((id) => pins.find((p) => p.id === id))
        .filter((p): p is Pin => !!p),
    [routeIds, pins],
  )

  const legs = useMemo(() => legsForPinIds(routeIds, pins), [routeIds, pins])

  // Previously-closed, "kept" routes - each drawn as its own arc/label,
  // independent of whatever route is currently being built in routeIds.
  const [frozenRoutes, setFrozenRoutes] = useState<FrozenRoute[]>([])

  // Walking is the one mode with a free, keyless routing service (OSRM)
  // that can give a real path distance/time instead of a straight line, so
  // fetch it per leg when walking is selected and cache by pin pair. This
  // covers both the live route and any kept walking routes.
  const [walkingRoutes, setWalkingRoutes] = useState<Record<string, RouteResult>>({})

  const walkingLegsToFetch = useMemo(() => {
    const out: Leg[] = []
    if (travelMode === 'walking') out.push(...legs)
    for (const fr of frozenRoutes) {
      if (fr.mode === 'walking') out.push(...legsForPinIds(fr.pinIds, pins))
    }
    return out
  }, [travelMode, legs, frozenRoutes, pins])

  useEffect(() => {
    if (walkingLegsToFetch.length === 0) return
    const controller = new AbortController()
    walkingLegsToFetch.forEach((leg) => {
      const key = `${leg.from.id}:${leg.to.id}`
      if (walkingRoutes[key]) return
      fetchWalkingRoute(
        leg.from.lat,
        leg.from.lng,
        leg.to.lat,
        leg.to.lng,
        controller.signal,
      ).then((result) => {
        if (!result || controller.signal.aborted) return
        setWalkingRoutes((prev) => ({ ...prev, [key]: result }))
      })
    })
    return () => controller.abort()
    // Deliberately excluding walkingRoutes: it's only read here to skip
    // already-cached legs, and including it would re-run this effect (and
    // abort in-flight fetches for other legs) every time one leg resolves.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [walkingLegsToFetch])

  const displayLegs = useMemo(
    () => (travelMode ? applyTravelMode(legs, travelMode, walkingRoutes) : []),
    [legs, travelMode, walkingRoutes],
  )

  const totalKm = useMemo(
    () => displayLegs.reduce((sum, l) => sum + l.km, 0),
    [displayLegs],
  )
  const totalHours = useMemo(
    () => displayLegs.reduce((sum, l) => sum + l.hours, 0),
    [displayLegs],
  )
  const anyRouted = displayLegs.some((l) => l.routed)
  const anyUnrouted = displayLegs.some((l) => !l.routed)

  // Curved dashed arcs between route pins, drawn once a travel mode is
  // picked, each paired with a floating label (mode icon + time) placed
  // above the arc's peak via a 3D altitude offset rather than a CSS trick.
  // Combines the route currently being built (routeKey 'live') with every
  // kept/frozen route, each independent of the others.
  const routeGroups = useMemo(() => {
    const groups: { key: string; legs: DisplayLeg[]; mode: TravelMode; animate: boolean }[] = []
    if (travelMode && routePins.length >= 2) {
      groups.push({ key: 'live', legs: displayLegs, mode: travelMode, animate: animateRoute })
    }
    for (const fr of frozenRoutes) {
      groups.push({
        key: fr.id,
        legs: applyTravelMode(legsForPinIds(fr.pinIds, pins), fr.mode, walkingRoutes),
        mode: fr.mode,
        animate: fr.animate,
      })
    }
    return groups
  }, [travelMode, routePins.length, displayLegs, animateRoute, frozenRoutes, pins, walkingRoutes])

  const arcsData = useMemo(
    () =>
      routeGroups.flatMap((group) =>
        group.legs.map((leg) => ({
          startLat: leg.from.lat,
          startLng: leg.from.lng,
          endLat: leg.to.lat,
          endLng: leg.to.lng,
          altitude: arcAltitudeForKm(leg.km),
          mode: group.mode,
          animate: group.animate,
          routeKey: group.key,
        })),
      ),
    [routeGroups],
  )

  const legLabelData = useMemo<LegLabelDatum[]>(
    () =>
      routeGroups.flatMap((group) =>
        group.legs.map((leg, i) => {
          const mid = greatCircleMidpoint(leg.from.lat, leg.from.lng, leg.to.lat, leg.to.lng)
          return {
            __legLabel: true,
            id: `leg-${group.key}-${leg.from.id}-${leg.to.id}-${i}`,
            lat: mid.lat,
            lng: mid.lng,
            altitude: arcAltitudeForKm(leg.km) + 0.06,
            text: formatDuration(leg.hours),
            mode: group.mode,
            routeKey: group.key,
          }
        }),
      ),
    [routeGroups],
  )

  const markerElementsData = useMemo(
    () => [...pins, ...legLabelData],
    [pins, legLabelData],
  )

  // X button: always fully discards the live route, regardless of
  // keepRoute - an explicit delete, never a freeze.
  const clearRoute = useCallback(() => {
    setRouteIds([])
    setTravelMode(null)
    setAnimateRoute(false)
    setRoutePopupOpen(false)
  }, [])

  const [showCountryLabels, setShowCountryLabels] = useState(true)

  const flyTo = useCallback((lat: number, lng: number) => {
    // Re-center on the pin without ever zooming OUT: keep the current
    // altitude if already closer than 1.5, only zoom in to 1.5 when
    // starting from a wider view. A fixed altitude here would yank the
    // camera back out every time a pin is clicked while already zoomed in.
    const current = globeRef.current?.pointOfView()
    const altitude = current ? Math.min(current.altitude, 1.5) : 1.5
    globeRef.current?.pointOfView({ lat, lng, altitude }, 1000)
  }, [])

  // Stable across renders: three-globe rebuilds every HTML marker whenever
  // this function identity changes, so it must not depend on render-scoped
  // state (selection/route membership is applied afterwards via a DOM class
  // toggle instead).
  const createPinElement = useCallback(
    (d: object) => {
      if ('__legLabel' in d) {
        const label = d as LegLabelDatum
        const anchor = document.createElement('div')
        anchor.className = 'leg-label-anchor'
        const pill = document.createElement('div')
        pill.className = 'leg-label-pill'
        pill.style.borderColor = TRAVEL_MODE_ARC_COLOR[label.mode]
        pill.textContent = `${TRAVEL_MODE_INFO[label.mode].icon} ${label.text}`
        anchor.appendChild(pill)
        anchor.addEventListener('click', (e) => {
          e.stopPropagation()
          if (label.routeKey === 'live') {
            setRoutePopupOpen(true)
          } else {
            reviveFrozenRoute(
              label.routeKey,
              frozenRoutesRef.current,
              setFrozenRoutes,
              setRouteIds,
              setTravelMode,
              setAnimateRoute,
              setRoutePopupOpen,
            )
          }
        })
        return anchor
      }

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
          const next = routeIdsRef.current.includes(pin.id)
            ? routeIdsRef.current.filter((id) => id !== pin.id)
            : [...routeIdsRef.current, pin.id]
          setRouteIds(next)
          if (next.length >= 2) setRoutePopupOpen(true)
          return
        }
        freezeOrClearRoute({
          keepRoute: keepRouteRef.current,
          travelMode: travelModeRef.current,
          routeIds: routeIdsRef.current,
          animateRoute: animateRouteRef.current,
          setFrozenRoutes,
          setRouteIds,
          setTravelMode,
          setAnimateRoute,
          setRoutePopupOpen,
        })
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
  const pinsRef = useRef(pins)
  pinsRef.current = pins
  const travelModeRef = useRef(travelMode)
  travelModeRef.current = travelMode
  const animateRouteRef = useRef(animateRoute)
  animateRouteRef.current = animateRoute
  const frozenRoutesRef = useRef(frozenRoutes)
  frozenRoutesRef.current = frozenRoutes

  // Every DOM write here must be a no-op when nothing actually changed:
  // this function is also the MutationObserver's own callback below, so an
  // unconditional write (e.g. always reassigning textContent) re-triggers
  // the observer on itself and spins forever, freezing the tab.
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
        const label = String(routeIndex + 1)
        if (badge.textContent !== label) badge.textContent = label
      } else if (badge) {
        badge.remove()
      }

      // react-globe.gl never tears down a marker's old DOM node when the
      // underlying pin object is replaced (e.g. after an edit), so the
      // element handed to it at creation time can go stale. Re-apply the
      // current kind's color/glyph directly so edits are reflected even
      // when a fresh node wasn't actually created underneath.
      const pin = pinsRef.current.find((p) => p.id === pinId)
      if (!pin) return
      const kind: PinKind = pin.kind ?? 'destination'
      const color = PIN_KIND_INFO[kind].color
      const circle = icon.querySelector<HTMLElement>('.pin-circle')
      const tail = icon.querySelector<HTMLElement>('.pin-tail')
      const glyph = icon.querySelector<HTMLElement>('.pin-glyph')
      if (circle && circle.style.backgroundColor !== color) {
        circle.style.background = color
      }
      if (tail && tail.style.borderTopColor !== color) {
        tail.style.borderTopColor = color
      }
      if (glyph) {
        const glyphInfo = pinGlyphFor(kind)
        if (glyph.className !== glyphInfo.className) {
          glyph.className = glyphInfo.className
        }
        const text = glyphInfo.text ?? ''
        if (glyph.textContent !== text) glyph.textContent = text
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
          labelsData={showCountryLabels ? COUNTRY_LABELS : []}
          labelLat={(d) => (d as { lat: number }).lat}
          labelLng={(d) => (d as { lng: number }).lng}
          labelText={(d) => (d as { name: string }).name}
          labelSize={0.6}
          labelColor={() => 'rgba(255, 255, 255, 0.85)'}
          labelDotRadius={0}
          labelAltitude={0.005}
          labelsTransitionDuration={0}
          arcsData={arcsData}
          arcStartLat={(d) => (d as { startLat: number }).startLat}
          arcStartLng={(d) => (d as { startLng: number }).startLng}
          arcEndLat={(d) => (d as { endLat: number }).endLat}
          arcEndLng={(d) => (d as { endLng: number }).endLng}
          arcAltitude={(d) => (d as { altitude: number }).altitude}
          arcColor={(d: object) => TRAVEL_MODE_ARC_COLOR[(d as { mode: TravelMode }).mode]}
          arcStroke={0.15}
          arcDashLength={0.06}
          arcDashGap={0.045}
          arcDashAnimateTime={(d: object) => ((d as { animate: boolean }).animate ? 3000 : 0)}
          arcsTransitionDuration={300}
          onArcClick={(d: object) => {
            const routeKey = (d as { routeKey: string }).routeKey
            if (routeKey === 'live') {
              setRoutePopupOpen(true)
            } else {
              reviveFrozenRoute(
                routeKey,
                frozenRoutes,
                setFrozenRoutes,
                setRouteIds,
                setTravelMode,
                setAnimateRoute,
                setRoutePopupOpen,
              )
            }
          }}
          htmlElementsData={markerElementsData}
          htmlLat={(d) => (d as Pin | LegLabelDatum).lat}
          htmlLng={(d) => (d as Pin | LegLabelDatum).lng}
          htmlAltitude={(d) => ('__legLabel' in d ? (d as LegLabelDatum).altitude : 0)}
          htmlElement={createPinElement}
          onGlobeClick={({ lat, lng }) => {
            if (clickedMarkerRef.current) return
            // If a pin panel, new-pin form, or route popup is open, the
            // first click on empty space just dismisses it - it shouldn't
            // also immediately start creating a new pin at that spot.
            // Clicking empty space again afterward, with nothing open,
            // does start a new pin as usual. The route popup always
            // closes on an outside click; when "keep route" is on, the
            // arc/label themselves stay drawn and clicking either one
            // reopens the popup.
            const hadSomethingOpen =
              pending !== null || selectedId !== null || routePopupOpen
            freezeOrClearRoute({
              keepRoute,
              travelMode,
              routeIds,
              animateRoute,
              setFrozenRoutes,
              setRouteIds,
              setTravelMode,
              setAnimateRoute,
              setRoutePopupOpen,
            })
            setSelectedId(null)
            setPending(hadSomethingOpen ? null : { lat, lng })
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

        {routePins.length >= 2 && routePopupOpen && (
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
                  {formatKm(totalKm)} &bull; ~{formatDuration(totalHours)}
                </div>
                <label className="animate-route-toggle">
                  <input
                    type="checkbox"
                    checked={animateRoute}
                    onChange={(e) => setAnimateRoute(e.target.checked)}
                  />
                  Animate direction ({routePins[0]?.name} → {routePins[routePins.length - 1]?.name})
                </label>
                <label className="animate-route-toggle">
                  <input
                    type="checkbox"
                    checked={keepRoute}
                    onChange={(e) => setKeepRoute(e.target.checked)}
                  />
                  Keep line when clicking elsewhere
                </label>
                {displayLegs.length > 1 && (
                  <ul className="travel-legs">
                    {displayLegs.map((leg, i) => (
                      <li key={i}>
                        {leg.from.name} → {leg.to.name}: {formatKm(leg.km)}, ~
                        {formatDuration(leg.hours)}
                        {leg.routed && ' (real route)'}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="travel-disclaimer">
                  {travelMode === 'walking' ? (
                    anyRouted ? (
                      anyUnrouted ? (
                        <>
                          Real walking-route time where available; straight-line
                          estimate for the rest (no walking path found, likely
                          overseas).
                        </>
                      ) : (
                        <>Based on an actual walking route, not straight-line distance.</>
                      )
                    ) : (
                      <>Looking up the real walking route&hellip;</>
                    )
                  ) : (
                    <>
                      Estimate based on straight-line distance
                      {travelMode === 'airplane'
                        ? ', plus typical taxi/climb/descent time'
                        : ' at a typical train speed'}
                      &mdash; actual travel time will vary with real routes and
                      schedules.
                    </>
                  )}
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
              key="pending"
              coords={pending}
              onCancel={() => setPending(null)}
              onSave={({ name, notes, kind, visitDate, visitedWith, photos }) => {
                const id = addPin({
                  lat: pending.lat,
                  lng: pending.lng,
                  name,
                  notes,
                  kind,
                  color: PIN_KIND_INFO[kind].color,
                  visitDate,
                  visitedWith,
                  photos,
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
              key={selectedPin.id}
              initial={selectedPin}
              coords={selectedPin}
              onCancel={() => setSelectedId(null)}
              onSave={({ name, notes, kind, visitDate, visitedWith, photos }) => {
                updatePin(selectedPin.id, {
                  name,
                  notes,
                  kind,
                  color: PIN_KIND_INFO[kind].color,
                  visitDate,
                  visitedWith,
                  photos,
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
            {filteredPins.length === 0 && (
              <p className="empty">No pins yet.</p>
            )}
            {groupedPins.map(({ continent, count, countries }) => {
              const continentKey = `continent:${continent}`
              const continentCollapsed = collapsedGroups.has(continentKey)
              return (
                <div key={continent} className="pin-group">
                  <button
                    type="button"
                    className="pin-group-heading"
                    onClick={() => toggleGroup(continentKey)}
                    aria-expanded={!continentCollapsed}
                  >
                    <span
                      className={`chevron ${continentCollapsed ? 'collapsed' : ''}`}
                    >
                      ▾
                    </span>
                    {continent}
                    <span className="pin-group-count">{count}</span>
                  </button>
                  {!continentCollapsed &&
                    countries.map(({ country, pins: group }) => {
                      const countryKey = `country:${continent}:${country}`
                      const countryCollapsed = collapsedGroups.has(countryKey)
                      return (
                        <div key={country} className="country-group">
                          <button
                            type="button"
                            className="country-group-heading"
                            onClick={() => toggleGroup(countryKey)}
                            aria-expanded={!countryCollapsed}
                          >
                            <span
                              className={`chevron ${countryCollapsed ? 'collapsed' : ''}`}
                            >
                              ▾
                            </span>
                            {country}
                            <span className="pin-group-count">
                              {group.length}
                            </span>
                          </button>
                          {!countryCollapsed && (
                            <ul className="pin-list">
                              {group.map((p) => {
                                const kind = p.kind ?? 'destination'
                                return (
                                  <li
                                    key={p.id}
                                    className="pin-list-item"
                                    onClick={() => {
                                      freezeOrClearRoute({
                                        keepRoute,
                                        travelMode,
                                        routeIds,
                                        animateRoute,
                                        setFrozenRoutes,
                                        setRouteIds,
                                        setTravelMode,
                                        setAnimateRoute,
                                        setRoutePopupOpen,
                                      })
                                      setSelectedId(p.id)
                                      flyTo(p.lat, p.lng)
                                    }}
                                  >
                                    <span className="pin-list-icon">
                                      <PinGlyphIcon
                                        kind={kind}
                                        color={PIN_KIND_INFO[kind].color}
                                      />
                                    </span>
                                    <div>
                                      <div className="pin-name">{p.name}</div>
                                      {p.notes && (
                                        <div className="pin-notes">
                                          {p.notes}
                                        </div>
                                      )}
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                          )}
                        </div>
                      )
                    })}
                </div>
              )
            })}
          </>
        )}
      </aside>
    </div>
  )
}
