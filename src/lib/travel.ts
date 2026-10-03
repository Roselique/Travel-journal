export type TravelMode = 'walking' | 'train' | 'airplane'

export const TRAVEL_MODE_INFO: Record<
  TravelMode,
  { label: string; icon: string; speedKmh: number }
> = {
  walking: { label: 'Walking', icon: '🚶', speedKmh: 5 },
  train: { label: 'Train', icon: '🚆', speedKmh: 110 },
  airplane: { label: 'Airplane', icon: '✈️', speedKmh: 780 },
}

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
