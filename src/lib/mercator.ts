// Web Mercator (EPSG:3857) projection helpers for drawing a flat trip-route
// map: a single static satellite image (Esri's public World_Imagery export
// endpoint, no API key needed - the same provider already used for the
// globe's texture) with pins/route overlaid as SVG, positioned by the exact
// same projection the image itself was rendered in. Because the image is
// requested in bboxSR=imageSR=3857, the mapping from Mercator meters to
// image pixels is a single uniform affine transform (equal scale on both
// axes) - no further distortion to account for.

const EARTH_RADIUS_M = 6378137
const MAX_MERCATOR_LAT = 85.05112878

export function lonLatToMercator(lng: number, lat: number): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat))
  const x = (lng * Math.PI) / 180 * EARTH_RADIUS_M
  const y =
    EARTH_RADIUS_M * Math.log(Math.tan(Math.PI / 4 + (clampedLat * Math.PI) / 180 / 2))
  return { x, y }
}

export interface MercatorBBox {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

// Fits every point into a width x height image at a single uniform scale
// (meters/pixel equal on both axes, so the image is never stretched),
// centered on the points' bounding box with padding. A single point (or a
// tight cluster) still gets a sensible minimum extent instead of a
// zero-size bbox.
export function fitMercatorBBox(
  points: { lat: number; lng: number }[],
  width: number,
  height: number,
  paddingRatio = 0.2,
): MercatorBBox {
  const merc = points.map((p) => lonLatToMercator(p.lng, p.lat))
  const minX = Math.min(...merc.map((m) => m.x))
  const maxX = Math.max(...merc.map((m) => m.x))
  const minY = Math.min(...merc.map((m) => m.y))
  const maxY = Math.max(...merc.map((m) => m.y))
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2
  const MIN_SPAN_M = 20000 // ~20km, keeps a single destination from zooming in absurdly tight
  const spanX = Math.max(maxX - minX, 1) * (1 + paddingRatio * 2)
  const spanY = Math.max(maxY - minY, 1) * (1 + paddingRatio * 2)
  const paddedSpanX = Math.max(spanX, MIN_SPAN_M)
  const paddedSpanY = Math.max(spanY, MIN_SPAN_M)
  const scale = Math.max(paddedSpanX / width, paddedSpanY / height)
  const halfW = (scale * width) / 2
  const halfH = (scale * height) / 2
  return { minX: cx - halfW, maxX: cx + halfW, minY: cy - halfH, maxY: cy + halfH }
}

export function esriExportImageUrl(bbox: MercatorBBox, width: number, height: number): string {
  const params = new URLSearchParams({
    bbox: `${bbox.minX},${bbox.minY},${bbox.maxX},${bbox.maxY}`,
    bboxSR: '3857',
    imageSR: '3857',
    size: `${Math.round(width)},${Math.round(height)}`,
    format: 'jpg',
    f: 'image',
  })
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${params}`
}

// Projects a lat/lng into pixel coordinates within the given bbox/image
// size - image Y grows downward while Mercator Y grows north, hence the flip.
export function projectToPixel(
  lat: number,
  lng: number,
  bbox: MercatorBBox,
  width: number,
  height: number,
): { x: number; y: number } {
  const { x, y } = lonLatToMercator(lng, lat)
  const px = ((x - bbox.minX) / (bbox.maxX - bbox.minX)) * width
  const py = height - ((y - bbox.minY) / (bbox.maxY - bbox.minY)) * height
  return { x: px, y: py }
}
