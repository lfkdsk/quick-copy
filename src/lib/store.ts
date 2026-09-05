import { ASSETS_DIR, ITEMS_DIR } from './config'
import { GitHubClient, GitHubError, type RepoInfo } from './github'
import { cacheGet, cachePut, jsonCacheGet, jsonCachePut } from './blobCache'
import {
  bytesToBase64,
  extensionFor,
  firstLine,
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

/** Exactly what lands in `items/<id>.json`. Versioned so the shape can move later. */
export interface QCItem {
  v: 1
  id: string
  kind: 'text' | 'image'
  title?: string
  text?: string
  tags: string[]
  createdAt: string
  updatedAt?: string
  asset?: QCAsset
}

/** A stored item plus the git SHAs that let us fetch and cache its bytes. */
export interface LoadedItem extends QCItem {
  sha: string
  assetSha?: string
}

export interface LoadResult {
  items: LoadedItem[]
  /** Descriptors we could not read — surfaced instead of silently dropped. */
  skipped: number
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
      const assetSha = parsed.asset ? shaByPath.get(parsed.asset.path) : undefined
      return { ...parsed, sha: entry.sha, assetSha }
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
function normalise(raw: QCItem, path: string): QCItem | null {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || path.slice(ITEMS_DIR.length + 1, -'.json'.length)
  const kind = raw.kind === 'image' ? 'image' : 'text'
  if (kind === 'text' && typeof raw.text !== 'string') return null
  if (kind === 'image' && !raw.asset?.path) return null
  return {
    v: 1,
    id,
    kind,
    title: typeof raw.title === 'string' ? raw.title : undefined,
    text: typeof raw.text === 'string' ? raw.text : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((t) => typeof t === 'string') : [],
    createdAt: raw.createdAt || new Date(0).toISOString(),
    updatedAt: raw.updatedAt,
    asset: raw.asset,
  }
}

export interface TextDraft {
  title?: string
  text: string
  tags: string[]
}

export async function saveText(
  client: GitHubClient,
  repo: RepoInfo,
  draft: TextDraft,
): Promise<LoadedItem> {
  const id = makeId()
  const item: QCItem = {
    v: 1,
    id,
    kind: 'text',
    title: draft.title?.trim() || undefined,
    text: draft.text,
    tags: draft.tags,
    createdAt: new Date().toISOString(),
  }
  const path = `${ITEMS_DIR}/${id}.json`
  const body = serialise(item)

  await client.commit(repo, {
    message: `Add note: ${item.title || firstLine(item.text ?? '', 50) || id}`,
    writes: [{ path, base64: utf8ToBase64(body) }],
  })

  return { ...item, sha: await gitBlobSha(new TextEncoder().encode(body)) }
}

export interface ImageDraft {
  title?: string
  text?: string
  tags: string[]
  file: File | Blob
  fileName?: string
}

export async function saveImage(
  client: GitHubClient,
  repo: RepoInfo,
  draft: ImageDraft,
): Promise<LoadedItem> {
  const id = makeId()
  const mime = draft.file.type || 'application/octet-stream'
  const suggested =
    draft.fileName ||
    (draft.file instanceof File ? draft.file.name : '') ||
    `pasted.${extensionFor(mime)}`
  const name = safeFileName(suggested, `image.${extensionFor(mime)}`)
  const assetPath = `${ASSETS_DIR}/${id}/${name}`

  const bytes = new Uint8Array(await draft.file.arrayBuffer())
  const dimensions = await imageSize(draft.file)

  const item: QCItem = {
    v: 1,
    id,
    kind: 'image',
    title: draft.title?.trim() || undefined,
    text: draft.text?.trim() || undefined,
    tags: draft.tags,
    createdAt: new Date().toISOString(),
    asset: {
      path: assetPath,
      name,
      mime,
      size: bytes.byteLength,
      width: dimensions?.width,
      height: dimensions?.height,
    },
  }

  const descriptor = serialise(item)
  await client.commit(repo, {
    message: `Add image: ${item.title || name}`,
    writes: [
      { path: assetPath, base64: bytesToBase64(bytes) },
      { path: `${ITEMS_DIR}/${id}.json`, base64: utf8ToBase64(descriptor) },
    ],
  })

  // Seed the cache with bytes we already hold so the new card paints
  // immediately instead of waiting on a round-trip to raw/blobs.
  const assetSha = await gitBlobSha(bytes)
  await cachePut(assetSha, new Blob([bytes as BlobPart], { type: mime }))

  return {
    ...item,
    sha: await gitBlobSha(new TextEncoder().encode(descriptor)),
    assetSha,
  }
}

export async function updateItem(
  client: GitHubClient,
  repo: RepoInfo,
  item: LoadedItem,
  patch: { title?: string; text?: string; tags?: string[] },
): Promise<LoadedItem> {
  const next: QCItem = {
    v: 1,
    id: item.id,
    kind: item.kind,
    title: (patch.title ?? item.title)?.trim() || undefined,
    text: patch.text ?? item.text,
    tags: patch.tags ?? item.tags,
    createdAt: item.createdAt,
    updatedAt: new Date().toISOString(),
    asset: item.asset,
  }
  const body = serialise(next)
  await client.commit(repo, {
    message: `Update ${next.kind}: ${next.title || firstLine(next.text ?? '', 50) || next.id}`,
    writes: [{ path: `${ITEMS_DIR}/${next.id}.json`, base64: utf8ToBase64(body) }],
  })
  return { ...next, sha: await gitBlobSha(new TextEncoder().encode(body)), assetSha: item.assetSha }
}

export async function deleteItem(
  client: GitHubClient,
  repo: RepoInfo,
  item: LoadedItem,
): Promise<void> {
  const deletes = [`${ITEMS_DIR}/${item.id}.json`]
  if (item.asset?.path) deletes.push(item.asset.path)
  await client.commit(repo, {
    message: `Delete ${item.kind}: ${item.title || item.id}`,
    deletes,
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

export async function fetchAsset(
  client: GitHubClient,
  repo: RepoInfo,
  item: LoadedItem,
  signal?: AbortSignal,
): Promise<Blob> {
  if (!item.asset) throw new Error('Item has no asset')
  const mime = item.asset.mime || 'application/octet-stream'

  if (item.assetSha) {
    const hit = await cacheGet(item.assetSha)
    if (hit) return hit
  }

  let blob: Blob | null = null
  if (!repo.isPrivate) {
    try {
      const response = await fetch(rawAssetUrl(repo, item.asset.path), { signal })
      // A brand-new file can 404 on the CDN for a beat; the API path
      // below is authoritative, so fall through rather than fail.
      if (response.ok) blob = new Blob([await response.arrayBuffer()], { type: mime })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error
    }
  }

  if (!blob) {
    if (!item.assetSha) {
      throw new GitHubError(404, 'The image file is missing from the repository')
    }
    const bytes = await client.getBlobBytes(repo, item.assetSha, signal)
    blob = new Blob([bytes], { type: mime })
  }

  if (item.assetSha) await cachePut(item.assetSha, blob)
  return blob
}

/** Pretty-printed and newline-terminated so git diffs stay readable. */
function serialise(item: QCItem): string {
  return `${JSON.stringify(item, null, 2)}\n`
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
