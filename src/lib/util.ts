export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/** Chunked so we never blow the argument limit on big images. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ''))
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/** btoa() is latin1-only; text items are UTF-8. */
export function utf8ToBase64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
]

export function timeAgo(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000
  if (seconds < 45) return 'just now'
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return RELATIVE.format(-Math.round(seconds / size), unit)
  }
  return RELATIVE.format(-Math.round(seconds), 'second')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * Filenames end up as git paths, so strip anything that would need
 * escaping or could walk out of the assets directory.
 */
export function safeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/^[-.]+/, '')
    .slice(0, 80)
  return cleaned || fallback
}

/** Sortable, collision-resistant, and readable in a git log. */
export function makeId(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const stamp =
    `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
  const rand = Math.random().toString(36).slice(2, 8)
  return `${stamp}-${rand}`
}

export function extensionFor(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/avif': 'avif',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  }
  return map[mime] || 'bin'
}

export function firstLine(text: string, max = 60): string {
  const line = text.trim().split('\n', 1)[0] ?? ''
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/**
 * Clipboard image support is PNG-only in every current browser, so
 * anything else is transcoded through a canvas first. SVG has no
 * intrinsic size to draw from, hence the explicit fallback.
 */
export async function copyImage(blob: Blob): Promise<'image' | 'fallback'> {
  const supported = typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write
  if (supported && blob.type === 'image/png') {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
    return 'image'
  }
  if (supported && blob.type !== 'image/svg+xml') {
    const png = await transcodeToPng(blob)
    if (png) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      return 'image'
    }
  }
  return 'fallback'
}

async function transcodeToPng(blob: Blob): Promise<Blob | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    return await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = src
  })
}

export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  const url = URL.createObjectURL(blob)
  try {
    const img = await loadImage(url)
    return { width: img.naturalWidth, height: img.naturalHeight }
  } catch {
    return null
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function parseTags(input: string): string[] {
  return Array.from(
    new Set(
      input
        .split(/[,\n]/)
        .map((t) => t.trim().replace(/^#/, '').toLowerCase())
        .filter(Boolean)
        .slice(0, 12),
    ),
  )
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * Recent items read better as "3 hours ago"; older ones as a date you
 * can scan in a column. The cut-over is a week.
 */
export function smartDate(iso: string): string {
  const age = Date.now() - new Date(iso).getTime()
  if (age < 7 * 86400_000) return timeAgo(iso)
  return new Date(iso)
    .toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
    .replace(/,/g, '')
}

/** Catalogue-style zero padding for the counters in the chrome. */
export function pad2(n: number): string {
  return String(n).padStart(2, '0')
}
