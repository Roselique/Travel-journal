import countryBorders from '../data/countryBorders.json'
import { haversineKm } from './travel'

type Ring = [number, number][]
type Polygon = Ring[] // first ring is the outer boundary, rest are holes

interface CountryBorder {
  name: string
  continent: string
  type: 'Polygon' | 'MultiPolygon'
  coordinates: Polygon | Polygon[]
}

const borders = countryBorders as CountryBorder[]

const CONTINENT_ORDER = [
  'Europe',
  'Asia',
  'Africa',
  'North America',
  'South America',
  'Oceania',
  'Antarctica',
]

export function compareContinents(a: string, b: string): number {
  const ia = CONTINENT_ORDER.indexOf(a)
  const ib = CONTINENT_ORDER.indexOf(b)
  return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
}

function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersect =
      yi > lat !== yj > lat &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function pointInPolygon(lng: number, lat: number, polygon: Polygon): boolean {
  if (!pointInRing(lng, lat, polygon[0])) return false
  for (let i = 1; i < polygon.length; i++) {
    if (pointInRing(lng, lat, polygon[i])) return false // inside a hole
  }
  return true
}

function pointInBorder(lat: number, lng: number, border: CountryBorder): boolean {
  if (border.type === 'Polygon') {
    return pointInPolygon(lng, lat, border.coordinates as Polygon)
  }
  return (border.coordinates as Polygon[]).some((poly) =>
    pointInPolygon(lng, lat, poly),
  )
}

// Shoelace centroid + area of a single ring, in [lng, lat] coordinates.
function ringCentroidArea(ring: Ring): { lat: number; lng: number; area: number } {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < ring.length - 1; i++) {
    const [x0, y0] = ring[i]
    const [x1, y1] = ring[i + 1]
    const cross = x0 * y1 - x1 * y0
    area += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  area /= 2
  if (Math.abs(area) < 1e-9) {
    const n = ring.length - 1
    const [lng, lat] = ring
      .slice(0, n)
      .reduce((acc, [x, y]) => [acc[0] + x / n, acc[1] + y / n], [0, 0])
    return { lat, lng, area: 0 }
  }
  cx /= 6 * area
  cy /= 6 * area
  return { lng: cx, lat: cy, area: Math.abs(area) }
}

function borderCentroid(border: CountryBorder): { lat: number; lng: number } {
  const polys: Polygon[] =
    border.type === 'Polygon'
      ? [border.coordinates as Polygon]
      : (border.coordinates as Polygon[])
  let best: { lat: number; lng: number; area: number } | null = null
  for (const poly of polys) {
    const c = ringCentroidArea(poly[0])
    if (!best || c.area > best.area) best = c
  }
  return best!
}

// Computed once at module load and reused both for continent classification
// fallback and for the globe's country-name labels layer.
export const COUNTRY_LABELS: { name: string; continent: string; lat: number; lng: number }[] =
  borders
    .map((b) => {
      const { lat, lng } = borderCentroid(b)
      return { name: b.name, continent: b.continent, lat, lng }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

// Which country/continent a point falls in, via point-in-polygon testing
// against real country borders (not a nearest-centroid guess, which gets
// large countries badly wrong - e.g. a point in New York can sit closer to
// a neighboring country's centroid than to the US's own). Falls back to
// nearest country centroid only when no border actually contains the
// point (open ocean, or right on a coastline at this data's resolution).
export function locateCountry(
  lat: number,
  lng: number,
): { country: string; continent: string } {
  for (const border of borders) {
    if (pointInBorder(lat, lng, border)) {
      return { country: border.name, continent: border.continent }
    }
  }
  let best = COUNTRY_LABELS[0]
  let bestKm = Infinity
  for (const c of COUNTRY_LABELS) {
    const km = haversineKm(lat, lng, c.lat, c.lng)
    if (km < bestKm) {
      bestKm = km
      best = c
    }
  }
  return { country: best.name, continent: best.continent }
}
