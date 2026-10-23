import { useRef, useState } from 'react'
import type { GitHubClient, RepoInfo } from '../lib/github'
import { admitFiles, type ItemPatch, type LoadedItem } from '../lib/store'
import { parseTags } from '../lib/util'
import { fileKey, LocalThumb, StoredThumb } from './Attachments'
import type { Notify } from './Toasts'
import { FileIcon } from './Icons'

interface EditDialogProps {
  item: LoadedItem
  client: GitHubClient
  repo: RepoInfo
  busy: boolean
  notify: Notify
  onCancel: () => void
  onSave: (patch: ItemPatch) => void
}

export function EditDialog({ item, client, repo, busy, notify, onCancel, onSave }: EditDialogProps) {
  const [title, setTitle] = useState(item.title ?? '')
  const [text, setText] = useState(item.text ?? '')
  const [tags, setTags] = useState(item.tags.join(', '))
  const [removed, setRemoved] = useState<Set<string>>(() => new Set())
  const [added, setAdded] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  const kept = item.assets.filter((asset) => !removed.has(asset.path))
  const empty = kept.length + added.length === 0 && text.trim().length === 0

  function add(files: File[]) {
    const { accepted, refused } = admitFiles([...kept, ...added], files)
    if (refused) notify(refused, 'error')
    if (accepted.length) setAdded((current) => [...current, ...accepted])
  }

  function toggle(path: string) {
    setRemoved((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  function save() {
    if (busy || empty) return
    onSave({ title, text, tags: parseTags(tags), remove: [...removed], add: added })
  }

  return (
    <div className="backdrop" onClick={onCancel}>
      <div
        className="dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label="Edit item"
        onClick={(event) => event.stopPropagation()}
      >
        <h2>Edit</h2>
        <p>Saving writes a new commit to the storage repository.</p>

        <label htmlFor="edit-title">Title</label>
        <input
          id="edit-title"
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Optional"
        />

        <label htmlFor="edit-text">Text</label>
        <textarea
          id="edit-text"
          className="field"
          value={text}
          rows={9}
          style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12.5, lineHeight: 1.7 }}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files)
            if (files.length === 0) return
            event.preventDefault()
            add(files)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') save()
          }}
          autoFocus
        />

        <label>Attachments</label>
        <div className="edit-attachments">
          {(item.assets.length > 0 || added.length > 0) && (
            <ul className="thumbs">
              {item.assets.map((asset) => (
                <StoredThumb
                  key={asset.path}
                  client={client}
                  repo={repo}
                  asset={asset}
                  removed={removed.has(asset.path)}
                  onToggle={() => toggle(asset.path)}
                />
              ))}
              {added.map((file) => (
                <LocalThumb
                  key={fileKey(file)}
                  file={file}
                  onRemove={() => setAdded((current) => current.filter((f) => f !== file))}
                />
              ))}
            </ul>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? [])
              event.target.value = ''
              add(files)
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <FileIcon size={16} />
            Add files
          </button>
        </div>

        <label htmlFor="edit-tags">Tags</label>
        <input
          id="edit-tags"
          className="field"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="comma separated"
        />

        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || empty}>
            {busy ? <span className="spinner" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
