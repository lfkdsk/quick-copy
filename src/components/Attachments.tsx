import { useEffect, useState } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { isInlineImage, type LoadedAsset } from '../lib/store'
import { useAssetUrl } from '../lib/useAsset'
import { fileBadge, formatBytes } from '../lib/util'
import { CloseIcon, FileIcon } from './Icons'

/** A file picked or pasted but not saved yet. */
export function LocalThumb({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    if (!file.type.startsWith('image/')) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  return (
    <Thumb
      name={file.name || 'Pasted file'}
      detail={`${file.type || 'file'} · ${formatBytes(file.size)}`}
      preview={preview}
      onRemove={onRemove}
    />
  )
}

interface StoredThumbProps {
  client: GitHubClient
  repo: RepoInfo
  asset: LoadedAsset
  removed: boolean
  onToggle: () => void
}

/** An attachment already in the repo, which an edit can mark for removal. */
export function StoredThumb({ client, repo, asset, removed, onToggle }: StoredThumbProps) {
  const image = useAssetUrl(client, repo, asset, isInlineImage(asset))
  return (
    <Thumb
      name={asset.name}
      detail={removed ? 'removed on save' : formatBytes(asset.size)}
      preview={isInlineImage(asset) ? (image.url ?? null) : null}
      removed={removed}
      onRemove={onToggle}
    />
  )
}

interface ThumbProps {
  name: string
  detail: string
  preview: string | null
  removed?: boolean
  onRemove: () => void
}

function Thumb({ name, detail, preview, removed, onRemove }: ThumbProps) {
  return (
    <li className={`thumb ${removed ? 'removed' : ''}`} title={`${name} — ${detail}`}>
      {preview ? (
        <img src={preview} alt="" />
      ) : (
        <span className="file-thumb">
          <FileIcon size={20} />
          <em>{fileBadge(name)}</em>
        </span>
      )}
      <button
        type="button"
        className="thumb-remove"
        onClick={onRemove}
        aria-label={removed ? `Keep ${name}` : `Remove ${name}`}
      >
        <CloseIcon size={12} />
      </button>
    </li>
  )
}

// Files have no id of their own, and an index key would remount every
// later thumbnail (and re-decode its preview) when one is removed.
const fileKeys = new WeakMap<File, number>()
let nextFileKey = 0
export function fileKey(file: File): number {
  let key = fileKeys.get(file)
  if (key === undefined) {
    key = nextFileKey++
    fileKeys.set(file, key)
  }
  return key
}
