import { useEffect, useState } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { fetchAsset, fileUrl, isInlineImage, type LoadedItem } from '../lib/store'
import { useAssetUrl } from '../lib/useAsset'
import { copyImage, copyText, download, errorMessage, formatBytes, formatDate } from '../lib/util'
import type { Notify } from './Toasts'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  CopyIcon,
  DownloadIcon,
  LinkIcon,
} from './Icons'

interface LightboxProps {
  item: LoadedItem
  /** Which of the item's pictures to show first. */
  start: number
  client: GitHubClient
  repo: RepoInfo
  notify: Notify
  onClose: () => void
}

export function Lightbox({ item, start, client, repo, notify, onClose }: LightboxProps) {
  const images = item.assets.filter(isInlineImage)
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), images.length - 1))
  const current = images[index]
  const asset = useAssetUrl(client, repo, current)
  const many = images.length > 1

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') setIndex((i) => (i - 1 + images.length) % images.length)
      if (event.key === 'ArrowRight') setIndex((i) => (i + 1) % images.length)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose, images.length])

  if (!current) return null

  async function run(action: 'copy' | 'link' | 'download') {
    if (!current) return
    try {
      if (action === 'link') {
        await copyText(fileUrl(repo, current.path))
        notify(
          repo.isPrivate
            ? 'Link copied — it opens only for accounts with access to this private repo.'
            : 'Link copied to clipboard',
          'success',
        )
        return
      }
      const blob = await fetchAsset(client, repo, current)
      if (action === 'download') {
        download(blob, current.name)
        return
      }
      const result = await copyImage(blob)
      notify(
        result === 'image' ? 'Image copied to clipboard' : 'This format cannot be copied directly.',
        result === 'image' ? 'success' : 'info',
      )
    } catch (error) {
      notify(errorMessage(error), 'error')
    }
  }

  const step = (delta: number) => (event: React.MouseEvent) => {
    event.stopPropagation()
    setIndex((i) => (i + delta + images.length) % images.length)
  }

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.title || current.name}
      onClick={onClose}
    >
      <header onClick={(event) => event.stopPropagation()}>
        <div className="grow">
          <strong>{item.title || current.name}</strong>
          <small>
            {many ? `${index + 1} / ${images.length} · ` : ''}
            {formatDate(item.createdAt)} · {formatBytes(current.size)}
            {current.width ? ` · ${current.width}×${current.height}` : ''}
          </small>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => run('copy')}>
          <CopyIcon size={16} /> Copy
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => run('link')}>
          <LinkIcon size={16} /> Copy link
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => run('download')}>
          <DownloadIcon size={16} /> Download
        </button>
        <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
          <CloseIcon size={18} />
        </button>
      </header>
      <div className="stage" onClick={onClose}>
        {asset.url ? (
          <img
            src={asset.url}
            alt={current.name}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="spinner" />
        )}
        {many && (
          <>
            <button
              type="button"
              className="stage-nav prev btn btn-ghost btn-icon"
              onClick={step(-1)}
              aria-label="Previous image"
            >
              <ChevronLeftIcon size={22} />
            </button>
            <button
              type="button"
              className="stage-nav next btn btn-ghost btn-icon"
              onClick={step(1)}
              aria-label="Next image"
            >
              <ChevronRightIcon size={22} />
            </button>
          </>
        )}
      </div>
      {item.text && (
        <p className="lightbox-caption" onClick={(event) => event.stopPropagation()}>
          {item.text}
        </p>
      )}
    </div>
  )
}
