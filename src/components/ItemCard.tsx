import { useState } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { fetchAsset, isInlineImage, itemUrl, type LoadedAsset, type LoadedItem } from '../lib/store'
import { useAssetUrl, useInView } from '../lib/useAsset'
import {
  copyImage,
  copyText,
  download,
  errorMessage,
  fileBadge,
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
  FileIcon,
  ImageIcon,
  LinkIcon,
  TrashIcon,
} from './Icons'

interface ItemCardProps {
  item: LoadedItem
  client: GitHubClient
  repo: RepoInfo
  notify: Notify
  onOpen: (item: LoadedItem, index: number) => void
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

  const images = item.assets.filter(isInlineImage)
  const files = item.assets.filter((asset) => !isInlineImage(asset))
  const only = item.assets.length === 1 ? item.assets[0] : undefined
  const totalBytes = item.assets.reduce((sum, asset) => sum + asset.size, 0)
  // A lone picture copies as the picture; anything with more to it copies
  // its words, and the lightbox copies any one picture on its own.
  const copyTarget: 'text' | 'image' | null =
    only && isInlineImage(only)
      ? 'image'
      : item.text
        ? 'text'
        : images.length
          ? 'image'
          : null

  function flashCopied() {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  async function handleCopy() {
    setBusy(true)
    try {
      if (copyTarget === 'text') {
        await copyText(item.text ?? '')
        flashCopied()
        notify('Copied to clipboard', 'success')
        return
      }
      const blob = await fetchAsset(client, repo, images[0]!)
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

  async function handleCopyLink() {
    try {
      await copyText(itemUrl(repo, item))
      notify(
        repo.isPrivate
          ? 'Link copied — it opens only for accounts with access to this private repo.'
          : 'Link copied to clipboard',
        'success',
      )
    } catch (error) {
      notify(`Copy failed: ${errorMessage(error)}`, 'error')
    }
  }

  async function handleDownload(asset: LoadedAsset) {
    setBusy(true)
    try {
      const blob = await fetchAsset(client, repo, asset)
      download(blob, asset.name)
    } catch (error) {
      notify(`Download failed: ${errorMessage(error)}`, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="card glass" ref={ref}>
      {images.length === 1 && (
        <button
          type="button"
          className="card-media"
          onClick={() => onOpen(item, 0)}
          aria-label={`Open ${item.title || images[0]!.name}`}
          // Reserving the real aspect ratio keeps the masonry columns from
          // reflowing as each thumbnail arrives.
          style={
            images[0]!.width && images[0]!.height
              ? { aspectRatio: `${images[0]!.width} / ${images[0]!.height}` }
              : undefined
          }
        >
          <CardImage
            client={client}
            repo={repo}
            asset={images[0]!}
            enabled={inView}
            alt={item.title || images[0]!.name}
          />
        </button>
      )}

      {images.length > 1 && (
        <div className={`card-gallery count-${Math.min(images.length, GALLERY_CELLS)}`}>
          {images.slice(0, GALLERY_CELLS).map((asset, index) => {
            const hidden = index === GALLERY_CELLS - 1 ? images.length - GALLERY_CELLS : 0
            return (
              <button
                key={asset.path}
                type="button"
                className="card-media"
                onClick={() => onOpen(item, index)}
                aria-label={`Open ${asset.name}`}
              >
                <CardImage client={client} repo={repo} asset={asset} enabled={inView} alt={asset.name} />
                {hidden > 0 && <span className="gallery-more">+{hidden}</span>}
              </button>
            )
          })}
        </div>
      )}

      {files.map((asset) => (
        <button
          key={asset.path}
          type="button"
          className="card-file"
          onClick={() => void handleDownload(asset)}
          disabled={busy}
          aria-label={`Download ${asset.name}`}
        >
          <span className="file-thumb">
            {busy && only ? <span className="spinner" /> : <FileIcon size={20} />}
            <em>{fileBadge(asset.name)}</em>
          </span>
          <span className="card-file-name">
            <strong>{asset.name}</strong>
            <small>{only ? asset.mime : `${asset.mime} · ${formatBytes(asset.size)}`}</small>
          </span>
        </button>
      ))}

      {(item.title || item.text || item.tags.length > 0) && (
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
      )}

      <footer className="card-foot">
        <span className="grow" title={formatDate(item.createdAt)}>
          {timeOfDay(item.createdAt)}
          {item.assets.length ? ` · ${formatBytes(totalBytes)}` : ''}
        </span>
        <div className="card-actions">
          {copyTarget && (
            <button
              type="button"
              className={`card-action ${copied ? 'done' : ''}`}
              onClick={handleCopy}
              disabled={busy}
              title={copyTarget === 'image' ? 'Copy image' : 'Copy text'}
              aria-label="Copy"
            >
              {copied ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
            </button>
          )}
          <button
            type="button"
            className="card-action"
            onClick={handleCopyLink}
            title="Copy link"
            aria-label="Copy link"
          >
            <LinkIcon size={15} />
          </button>
          {images.length > 0 && (
            <button
              type="button"
              className="card-action"
              onClick={() => onOpen(item, 0)}
              title="Open"
              aria-label="Open"
            >
              <ExpandIcon size={15} />
            </button>
          )}
          {only && (
            <button
              type="button"
              className="card-action"
              onClick={() => void handleDownload(only)}
              disabled={busy}
              title="Download"
              aria-label="Download"
            >
              <DownloadIcon size={15} />
            </button>
          )}
          <button
            type="button"
            className="card-action"
            onClick={() => onEdit(item)}
            title="Edit"
            aria-label="Edit"
          >
            <EditIcon size={15} />
          </button>
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

/** Past this many, the last cell says how many more the lightbox holds. */
const GALLERY_CELLS = 4

interface CardImageProps {
  client: GitHubClient
  repo: RepoInfo
  asset: LoadedAsset
  enabled: boolean
  alt: string
}

function CardImage({ client, repo, asset, enabled, alt }: CardImageProps) {
  const image = useAssetUrl(client, repo, asset, enabled)
  return image.url ? (
    <img src={image.url} alt={alt} loading="lazy" decoding="async" />
  ) : (
    <div className={`placeholder ${image.error ? '' : 'shimmer'}`}>
      <ImageIcon size={22} />
    </div>
  )
}
