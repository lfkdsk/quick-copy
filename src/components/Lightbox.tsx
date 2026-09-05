import { useEffect } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { fetchAsset, type LoadedItem } from '../lib/store'
import { useAssetUrl } from '../lib/useAsset'
import { copyImage, download, errorMessage, formatBytes, formatDate } from '../lib/util'
import type { Notify } from './Toasts'
import { CloseIcon, CopyIcon, DownloadIcon } from './Icons'

interface LightboxProps {
  item: LoadedItem
  client: GitHubClient
  repo: RepoInfo
  notify: Notify
  onClose: () => void
}

export function Lightbox({ item, client, repo, notify, onClose }: LightboxProps) {
  const asset = useAssetUrl(client, repo, item)

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  async function run(action: 'copy' | 'download') {
    try {
      const blob = await fetchAsset(client, repo, item)
      if (action === 'download') {
        download(blob, item.asset?.name || `${item.id}.bin`)
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

  return (
    <div
      className="lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={item.title || item.asset?.name || 'Image'}
      onClick={onClose}
    >
      <header onClick={(event) => event.stopPropagation()}>
        <div className="grow">
          <strong>{item.title || item.asset?.name}</strong>
          <small>
            {formatDate(item.createdAt)}
            {item.asset ? ` · ${formatBytes(item.asset.size)}` : ''}
            {item.asset?.width ? ` · ${item.asset.width}×${item.asset.height}` : ''}
          </small>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => run('copy')}>
          <CopyIcon size={16} /> Copy
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
            alt={item.title || item.asset?.name || ''}
            onClick={(event) => event.stopPropagation()}
          />
        ) : (
          <span className="spinner" />
        )}
      </div>
    </div>
  )
}
