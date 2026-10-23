import {
  ASSETS_DIR,
  ITEMS_DIR,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  MAX_IMAGE_BYTES,
  MAX_ITEM_BYTES,
} from './config'
import { GitHubClient, GitHubError, type RepoInfo } from './github'
import { cacheGet, cachePut, jsonCacheGet, jsonCachePut } from './blobCache'
import {
  blobToBase64,
  bytesToBase64,
  extensionFor,
  firstLine,
  formatBytes,
  imageSize,
  makeId,
  safeFileName,
  utf8ToBase64,
} from './util'

export interface QCAsset {
  path: string
  name: string
  mime: string
  size: number
  width?: number
  height?: number
}

/**
 * Exactly what lands in `items/<id>.json`. Versioned so the shape can move later.
 * One attachment is written as `asset`, as it always has been; two or
 * more go in `assets` instead, in the order they were added.
 */
export interface QCItem {
  v: 1
  id: string
  kind: 'text' | 'image' | 'file'
  title?: string
  text?: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  asset?: QCAsset
  assets?: QCAsset[]
}

/** An attachment plus the git SHA that lets us fetch and cache its bytes. */
export interface LoadedAsset extends QCAsset {
  sha?: string
}

/** A stored item with every attachment, however the descriptor spelled them. */
export interface LoadedItem extends Omit<QCItem, 'asset' | 'assets'> {
  sha: string
  assets: LoadedAsset[]
}

export interface LoadResult {
  items: LoadedItem[]
  /** Descriptors we could not read — surfaced instead of silently dropped. */
  skipped: number
}

/**
 * Shown inline as a picture rather than as a download tile. Big images
 * stay tiles so the grid and the image cache stay light.
 */
export function isInlineImage(asset: QCAsset): boolean {
  return asset.mime.startsWith('image/') && asset.size <= MAX_IMAGE_BYTES
}

/** Any picture makes it an image item; only attachments that are all files make a file item. */
export function kindFor(assets: QCAsset[]): QCItem['kind'] {
  if (assets.length === 0) return 'text'
  return assets.some(isInlineImage) ? 'image' : 'file'
}

const CONCURRENCY = 8

export async function loadItems(
  client: GitHubClient,
  repo: RepoInfo,
  signal?: AbortSignal,
): Promise<LoadResult> {
  const tree = await client.listTree(repo, signal)
  const shaByPath = new Map<string, string>()
  for (const entry of tree) {
    if (entry.type === 'blob') shaByPath.set(entry.path, entry.sha)
  }

  const descriptors = tree.filter(
    (entry) =>
      entry.type === 'blob' &&
      entry.path.startsWith(`${ITEMS_DIR}/`) &&
      entry.path.endsWith('.json'),
  )

  let skipped = 0
  const items = await mapLimit(descriptors, CONCURRENCY, async (entry): Promise<LoadedItem | null> => {
    try {
      let text = jsonCacheGet(entry.sha)
      if (text === null) {
        text = await client.getBlobText(repo, entry.sha, signal)
        jsonCachePut(entry.sha, text)
      }
      const parsed = normalise(JSON.parse(text) as QCItem, entry.path)
      if (!parsed) {
        skipped++
        return null
      }
      const assets = parsed.assets.map((asset) => ({ ...asset, sha: shaByPath.get(asset.path) }))
      return { ...parsed, sha: entry.sha, assets }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      skipped++
      return null
    }
  })

  const loaded = items.filter((item): item is LoadedItem => item !== null)
  loaded.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
  return { items: loaded, skipped }
}

/** Tolerates hand-edited files: anything essential missing gets a sane default. */
function normalise(
  raw: QCItem,
  path: string,
): (Omit<QCItem, 'asset' | 'assets'> & { assets: QCAsset[] }) | null {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || path.slice(ITEMS_DIR.length + 1, -'.json'.length)
  const listed = Array.isArray(raw.assets) ? raw.assets : raw.asset ? [raw.asset] : []
  const assets = listed
    .filter((asset) => asset && typeof asset.path === 'string' && asset.path)
    .map((asset) => ({
      ...asset,
      name: asset.name || asset.path.slice(asset.path.lastIndexOf('/') + 1),
      mime: asset.mime || 'application/octet-stream',
      size: Number(asset.size) || 0,
    }))
  if (assets.length === 0 && typeof raw.text !== 'string') return null
  return {
    v: 1,
    id,
    kind: kindFor(assets),
    title: typeof raw.title === 'string' ? raw.title : undefined,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    createdAt: raw.createdAt || new Date(0).toISOString(),
    updatedAt: raw.updatedAt,
    assets,
  }
}

export interface Admission {
  accepted: File[]
  /** Why some of the files were turned away, if any were. */
  refused?: string
}

/**
 * Decides which new files fit on an item that already holds `current`.
 * Checked before anything is read, so a refusal costs nothing.
 */
export function admitFiles(current: Array<{ size: number }>, files: File[]): Admission {
  const accepted: File[] = []
  let total = current.reduce((sum, asset) => sum + asset.size, 0)
  let refused: string | undefined
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      refused = `Files must be under ${formatBytes(MAX_FILE_BYTES)} — GitHub's per-file limit.`
      continue
    }
    if (current.length + accepted.length >= MAX_ATTACHMENTS) {
      refused = `One item holds up to ${MAX_ATTACHMENTS} attachments.`
      break
    }
    if (total + file.size > MAX_ITEM_BYTES) {
      refused = `One item holds up to ${formatBytes(MAX_ITEM_BYTES)} in all.`
      continue
    }
    accepted.push(file)
    total += file.size
  }
  return { accepted, refused }
}

export interface Draft {
  title?: string
  text: string
  tags: string[]
  files: File[]
}

interface Upload {
  asset: LoadedAsset
  base64: string
}

/**
 * Turns picked files into the writes for one commit. Names are made
 * unique within the item's directory — two screenshots pasted in a row
 * are both called image.png.
 */
async function prepareUploads(id: string, files: File[], taken: Set<string>): Promise<Upload[]> {
  const uploads: Upload[] = []
  for (const file of files) {
    const mime = file.type || 'application/octet-stream'
    const image = mime.startsWith('image/') && file.size <= MAX_IMAGE_BYTES
    const fallback = image ? `image.${extensionFor(mime)}` : 'file.bin'
    const suggested = file.name || (image ? `pasted.${extensionFor(mime)}` : fallback)
    const name = uniqueName(safeFileName(suggested, fallback), taken)
    taken.add(name)
    const path = `${ASSETS_DIR}/${id}/${name}`

    const bytes = new Uint8Array(await file.arrayBuffer())
    const sha = await gitBlobSha(bytes)
    if (image) {
      const dimensions = await imageSize(file)
      // Seed the cache with bytes we already hold so the new card paints
      // immediately instead of waiting on a round-trip to raw/blobs.
      // Plain files never go in: a few large ones would crowd out every
      // thumbnail.
      await cachePut(sha, new Blob([bytes as BlobPart], { type: mime }))
      uploads.push({
        asset: {
          path,
          name,
          mime,
          size: bytes.byteLength,
          width: dimensions?.width,
          height: dimensions?.height,
          sha,
        },
        base64: bytesToBase64(bytes),
      })
    } else {
      uploads.push({
        asset: { path, name, mime, size: file.size, sha },
        base64: await blobToBase64(file),
      })
    }
  }
  return uploads
}

function uniqueName(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  const ext = dot > 0 ? name.slice(dot) : ''
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}${ext}`
    if (!taken.has(candidate)) return candidate
  }
}

/**
 * A note, an image, a file, or a diary-style entry with text and
 * several pictures — all one commit, so a half-written item is not a
 * state the repo can be in.
 */
export async function saveItem(
  client: GitHubClient,
  repo: RepoInfo,
  draft: Draft,
): Promise<LoadedItem> {
  const id = makeId()
  const uploads = await prepareUploads(id, draft.files, new Set())
  const assets = uploads.map((upload) => upload.asset)
  const item: LoadedItem = {
    v: 1,
    id,
    kind: kindFor(assets),
    title: draft.title?.trim() || undefined,
    // A caption under a picture has no use for stray blank lines; a note keeps them.
    text: assets.length ? draft.text.trim() || undefined : draft.text,
    tags: draft.tags,
    createdAt: new Date().toISOString(),
    sha: '',
    assets,
  }
  const body = serialise(item)

  await client.commit(repo, {
    message: `${addVerb(assets)}: ${label(item)}`,
    writes: [
      ...uploads.map((upload) => ({ path: upload.asset.path, base64: upload.base64 })),
      { path: `${ITEMS_DIR}/${id}.json`, base64: utf8ToBase64(body) },
    ],
  })

  return { ...item, sha: await gitBlobSha(new TextEncoder().encode(body)) }
}

function addVerb(assets: QCAsset[]): string {
  if (assets.length === 0) return 'Add note'
  if (assets.length > 1) return 'Add entry'
  return isInlineImage(assets[0]!) ? 'Add image' : 'Add file'
}

function label(item: LoadedItem): string {
  if (item.title) return item.title
  if (item.assets.length === 1) return item.assets[0]!.name
  const line = firstLine(item.text ?? '', 50)
  if (line) return line
  return item.assets.length ? `${item.assets.length} attachments` : item.id
}

export interface ItemPatch {
  title?: string
  text?: string
  tags?: string[]
  /** Paths of attachments to drop. */
  remove?: string[]
  /** New files to attach after the ones kept. */
  add?: File[]
}

export async function updateItem(
  client: GitHubClient,
  repo: RepoInfo,
  item: LoadedItem,
  patch: ItemPatch,
): Promise<LoadedItem> {
  const removed = new Set(patch.remove ?? [])
  const kept = item.assets.filter((asset) => !removed.has(asset.path))
  const taken = new Set(item.assets.map((asset) => asset.name))
  const uploads = await prepareUploads(item.id, patch.add ?? [], taken)
  const assets = [...kept, ...uploads.map((upload) => upload.asset)]

  const next: LoadedItem = {
    v: 1,
    id: item.id,
    kind: kindFor(assets),
    title: (patch.title ?? item.title)?.trim() || undefined,
    text: patch.text ?? item.text,
    tags: patch.tags ?? item.tags,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
    sha: '',
    assets,
  }
  if (assets.length === 0 && !next.text?.trim()) throw new Error('An item needs some text or an attachment')

  const body = serialise(next)
  await client.commit(repo, {
    message: `Update ${next.kind}: ${next.title || firstLine(next.text ?? '', 50) || next.id}`,
    writes: [
      ...uploads.map((upload) => ({ path: upload.asset.path, base64: upload.base64 })),
      { path: `${ITEMS_DIR}/${next.id}.json`, base64: utf8ToBase64(body) },
    ],
    deletes: item.assets.filter((asset) => removed.has(asset.path)).map((asset) => asset.path),
  })
  return { ...next, sha: await gitBlobSha(new TextEncoder().encode(body)) }
}

export async function deleteItem(
  client: GitHubClient,
  repo: RepoInfo,
  item: LoadedItem,
): Promise<void> {
  await client.commit(repo, {
    message: `Delete ${item.kind}: ${item.title || item.id}`,
    deletes: [`${ITEMS_DIR}/${item.id}.json`, ...item.assets.map((asset) => asset.path)],
  })
}

/**
 * Public repos serve straight off raw.githubusercontent.com — no token,
 * no API quota, and the browser caches it. Private repos have to go
 * through the authenticated blobs endpoint instead.
 */
export function rawAssetUrl(repo: RepoInfo, path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://raw.githubusercontent.com/${repo.owner}/${repo.name}/${repo.defaultBranch}/${encoded}`
}

/**
 * A shareable link to a file in the data repo. Public repos get the raw
 * CDN URL, which works anywhere — curl, <img>, another app.
 * raw.githubusercontent.com refuses private repos without a token, so
 * those get github.com's /raw/ route instead: it redirects a signed-in
 * browser to a short-lived tokenised raw URL, and 404s for everyone else.
 */
export function fileUrl(repo: RepoInfo, path: string): string {
  if (!repo.isPrivate) return rawAssetUrl(repo, path)
  const encoded = path.split('/').map(encodeURIComponent).join('/')
  return `https://github.com/${repo.owner}/${repo.name}/raw/${encodeURIComponent(repo.defaultBranch)}/${encoded}`
}

/**
 * The item's link: its attachment when it has exactly one, otherwise
 * the JSON descriptor, which lists every attachment by path.
 */
export function itemUrl(repo: RepoInfo, item: LoadedItem): string {
  const only = item.assets.length === 1 ? item.assets[0] : undefined
  return fileUrl(repo, only?.path ?? `${ITEMS_DIR}/${item.id}.json`)
}

export async function fetchAsset(
  client: GitHubClient,
  repo: RepoInfo,
  asset: LoadedAsset,
  signal?: AbortSignal,
): Promise<Blob> {
  const mime = asset.mime || 'application/octet-stream'

  if (asset.sha) {
    const hit = await cacheGet(asset.sha)
    if (hit) return hit
  }

  let blob: Blob | null = null
  if (!repo.isPrivate) {
    try {
      const response = await fetch(rawAssetUrl(repo, asset.path), { signal })
      // A brand-new file can 404 on the CDN for a beat; the API path
      // below is authoritative, so fall through rather than fail.
      if (response.ok) blob = new Blob([await response.arrayBuffer()], { type: mime })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }

  if (!blob) {
    if (!asset.sha) {
      throw new GitHubError(404, 'The file is missing from the repository')
    }
    const bytes = await client.getBlobBytes(repo, asset.sha, signal)
    blob = new Blob([bytes], { type: mime })
  }

  if (asset.sha && isInlineImage(asset)) await cachePut(asset.sha, blob)
  return blob
}

/**
 * Pretty-printed and newline-terminated so git diffs stay readable.
 * Local SHAs are dropped: git already knows them, and they would go
 * stale the moment a file is replaced by hand.
 */
function serialise(item: LoadedItem): string {
  const assets = item.assets.map(({ sha: _sha, ...asset }) => asset)
  const descriptor: QCItem = {
    v: 1,
    id: item.id,
    kind: item.kind,
    title: item.title,
    text: item.text,
    tags: item.tags,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    ...(assets.length === 1 ? { asset: assets[0] } : assets.length > 1 ? { assets } : {}),
  }
  return `${JSON.stringify(descriptor, null, 2)}\n`
}

/**
 * git's object id: sha1("blob <bytelength>\0" + content). Computing it
 * locally lets a just-saved image be found in the cache by the same key
 * the next listing will use, so nothing re-downloads after a save.
 */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const header = new TextEncoder().encode(`blob ${bytes.length}\0`)
  const payload = new Uint8Array(header.length + bytes.length)
  payload.set(header)
  payload.set(bytes, header.length)
  const digest = await crypto.subtle.digest('SHA-1', payload as BufferSource)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await fn(items[index]!)
    }
  })
  await Promise.all(workers)
  return results
}
