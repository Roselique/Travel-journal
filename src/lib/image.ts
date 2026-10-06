// Pin photos are persisted as data URLs in localStorage (no backend to
// upload to), which has a small quota (usually ~5-10MB total) - so every
// photo is downscaled and re-encoded as JPEG before being stored, rather
// than keeping the original file's full resolution/format.
const MAX_DIMENSION = 1000
const JPEG_QUALITY = 0.72

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = src
  })
}

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file)
  const img = await loadImage(original)
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale))
  const height = Math.max(1, Math.round(img.height * scale))

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return original

  ctx.drawImage(img, 0, 0, width, height)
  return canvas.toDataURL('image/jpeg', JPEG_QUALITY)
}
