import { useState } from 'react'
import type { LoadedItem } from '../lib/store'
import { parseTags } from '../lib/util'

interface EditDialogProps {
  item: LoadedItem
  busy: boolean
  onCancel: () => void
  onSave: (patch: { title: string; text: string; tags: string[] }) => void
}

export function EditDialog({ item, busy, onCancel, onSave }: EditDialogProps) {
  const [title, setTitle] = useState(item.title ?? '')
  const [text, setText] = useState(item.text ?? '')
  const [tags, setTags] = useState(item.tags.join(', '))

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
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              onSave({ title, text, tags: parseTags(tags) })
            }
          }}
          autoFocus
        />

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
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onSave({ title, text, tags: parseTags(tags) })}
            disabled={busy || (item.kind === 'text' && text.trim().length === 0)}
          >
            {busy ? <span className="spinner" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  )
}
