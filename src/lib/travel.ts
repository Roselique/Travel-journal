export type TravelMode = 'walking' | 'train' | 'airplane'

export const TRAVEL_MODE_INFO: Record<TravelMode, { label: string; icon: string }> = {
  walking: { label: 'Walking', icon: '🚶' },
  train: { label: 'Train', icon: '🚆' },
  airplane: { label: 'Airplane', icon: '✈️' },
}

const WALKING_SPEED_KMH = 5
const TRAIN_SPEED_KMH = 110

// Straight-line speed math alone badly understates flight time on shorter
// routes: a real flight spends a big, roughly fixed chunk of time taxiing,
// climbing and descending before/after reaching cruise speed, so shorter
// hops are dominated by that overhead rather than cruise speed. These
// constants are fitted against real scheduled flight times across a range
// of distances (Seoul-Tokyo ~1160km/~2h40m, LA-Chicago ~2800km/~4h,
// NY-London ~5570km/~7h, Amsterdam-Tokyo ~9300km/~11.5h) and land within
// about 15-25 minutes of each - real flights vary by that much anyway
// depending on wind, routing and airport congestion.
const FLIGHT_OVERHEAD_HOURS = 75 / 60
const FLIGHT_CRUISE_KMH = 900

// Great-circle distance between two lat/lng points, in kilometers.
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

// Estimated travel time for a given straight-line distance and mode. Trains
// and planes don't travel in a straight line, so this is necessarily a
// rough estimate for those two - real train routes in particular can
// meander a lot more than a flight path does.
export function estimateHours(mode: TravelMode, km: number): number {
  switch (mode) {
    case 'walking':
      return km / WALKING_SPEED_KMH
    case 'train':
      return km / TRAIN_SPEED_KMH
    case 'airplane':
      return FLIGHT_OVERHEAD_HOURS + km / FLIGHT_CRUISE_KMH
  }
}

export interface RouteResult {
  km: number
  hours: number
  routed: boolean // true when from a real routing service, false when it's the straight-line fallback
}

// Real walking distance/time via OSRM's free public routing server (no API
// key). Returns null if the service is unreachable or has no route between
// the two points (e.g. they're overseas from each other).
export async function fetchWalkingRoute(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
  signal?: AbortSignal,
): Promise<RouteResult | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/walking/${lng1},${lat1};${lng2},${lat2}?overview=false`
    const res = await fetch(url, { signal })
    if (!res.ok) return null
    const data = await res.json()
    const route = data?.routes?.[0]
    if (!route || typeof route.distance !== 'number') return null
    return { km: route.distance / 1000, hours: route.duration / 3600, routed: true }
  } catch {
    return null
  }
}

export function formatKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`
}

export function formatDuration(hours: number): string {
  const totalMinutes = Math.round(hours * 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
