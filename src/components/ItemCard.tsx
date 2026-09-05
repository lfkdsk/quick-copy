import { useState } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { fetchAsset, type LoadedItem } from '../lib/store'
import { useAssetUrl, useInView } from '../lib/useAsset'
import {
  copyImage,
  copyText,
  download,
  errorMessage,
  formatBytes,
  formatDate,
  timeOfDay,
} from '../lib/util'
import type { Notify } from './Toasts'
import {
  CheckIcon,
  CopyIcon,
  DownloadIcon,
  EditIcon,
  ExpandIcon,
  ImageIcon,
  TrashIcon,
} from './Icons'

interface ItemCardProps {
  item: LoadedItem
  client: GitHubClient
  repo: RepoInfo
  notify: Notify
  onOpen: (item: LoadedItem) => void
  onEdit: (item: LoadedItem) => void
  onDelete: (item: LoadedItem) => void
  onTag: (tag: string) => void
}

export function ItemCard({
  item,
  client,
  repo,
  notify,
  onOpen,
  onEdit,
  onDelete,
  onTag,
}: ItemCardProps) {
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const { ref, inView } = useInView<HTMLDivElement>()
  const asset = useAssetUrl(client, repo, item, item.kind === 'image' && inView)

  function flashCopied() {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  async function handleCopy() {
    setBusy(true)
    try {
      if (item.kind === 'text') {
        await copyText(item.text ?? '')
        flashCopied()
        notify('Copied to clipboard', 'success')
        return
      }
      const blob = await fetchAsset(client, repo, item)
      const result = await copyImage(blob)
      flashCopied()
      notify(
        result === 'image'
          ? 'Image copied to clipboard'
          : 'This format cannot be copied as an image — use Download instead.',
        result === 'image' ? 'success' : 'info',
      )
    } catch (error) {
      notify(`Copy failed: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function handleDownload() {
    if (!item.asset) return
    setBusy(true)
    try {
      const blob = await fetchAsset(client, repo, item)
      download(blob, item.asset.name)
    } catch (error) {
      notify(`Download failed: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card glass" ref={ref}>
      {item.kind === 'image' && (
        <button
          type="button"
          className="card-media"
          onClick={() => onOpen(item)}
          aria-label={`Open ${item.title || item.asset?.name || 'image'}`}
          // Reserving the real aspect ratio keeps the masonry columns from
          // reflowing as each thumbnail arrives.
          style={
            item.asset?.width && item.asset?.height
              ? { aspectRatio: `${item.asset.width} / ${item.asset.height}` }
              : undefined
          }
        >
          {asset.url ? (
            <img
              src={asset.url}
              alt={item.title || item.asset?.name || 'Saved image'}
              loading="lazy"
              decoding="async"
            />
          ) : (
            <div className={`placeholder ${asset.error ? '' : 'shimmer'}`}>
              <ImageIcon size={22} />
            </div>
          )}
        </button>
      )}

      <div className="card-body">
        {item.title && <h3 className="card-title">{item.title}</h3>}
        {item.text && (
          <p
            className={`card-text ${expanded ? 'expanded' : ''}`}
            onClick={() => setExpanded((value) => !value)}
            title={expanded ? 'Click to collapse' : 'Click to expand'}
          >
            {item.text}
          </p>
        )}
        {item.tags.length > 0 && (
          <div className="card-tags">
            {item.tags.map((tag) => (
              <button key={tag} type="button" className="tag" onClick={() => onTag(tag)}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <footer className="card-foot">
        <span className="grow" title={formatDate(item.createdAt)}>
          {timeOfDay(item.createdAt)}
          {item.asset ? ` · ${formatBytes(item.asset.size)}` : ''}
        </span>
        <div className="card-actions">
          <button
            type="button"
            className={`card-action ${copied ? 'done' : ''}`}
            onClick={handleCopy}
            disabled={busy}
            title="Copy"
            aria-label="Copy"
          >
            {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
          </button>
          {item.kind === 'image' ? (
            <>
              <button
                type="button"
                className="card-action"
                onClick={() => onOpen(item)}
                title="Open"
                aria-label="Open"
              >
                <ExpandIcon size={15} />
              </button>
              <button
                type="button"
                className="card-action"
                onClick={handleDownload}
                disabled={busy}
                title="Download"
                aria-label="Download"
              >
                <DownloadIcon size={15} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="card-action"
              onClick={() => onEdit(item)}
              title="Edit"
              aria-label="Edit"
            >
              <EditIcon size={15} />
            </button>
          )}
          <button
            type="button"
            className="card-action danger"
            onClick={() => onDelete(item)}
            title="Delete"
            aria-label="Delete"
          >
            <TrashIcon size={15} />
          </button>
        </div>
      </footer>
    </article>
  )
}
