import { useEffect, useRef, useState } from 'react'
import { formatBytes, parseTags } from '../lib/util'
import { fileKey, LocalThumb } from './Attachments'
import { CloseIcon, FileIcon, PlusIcon } from './Icons'

export interface ComposerPayload {
  title: string
  text: string
  tags: string[]
  files: File[]
}

interface ComposerProps {
  attachments: File[]
  busy: boolean
  onAttach: (files: File[]) => void
  onRemove: (index: number) => void
  onClear: () => void
  onSave: (payload: ComposerPayload) => Promise<boolean>
}

export function Composer({
  attachments,
  busy,
  onAttach,
  onRemove,
  onClear,
  onSave,
}: ComposerProps) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Grow with the content instead of scrolling inside a fixed box.
  useEffect(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${node.scrollHeight}px`
  }, [text])

  // A composer that keeps focus after saving is a composer you can
  // dump five things into without touching the mouse.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (target?.isContentEditable) return
      event.preventDefault()
      textareaRef.current?.focus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  const canSave = !busy && (attachments.length > 0 || text.trim().length > 0)

  async function submit() {
    if (!canSave) return
    const saved = await onSave({
      title: title.trim(),
      text,
      tags: parseTags(tags),
      files: attachments,
    })
    if (!saved) return
    setText('')
    setTitle('')
    setTags('')
    onClear()
    textareaRef.current?.focus()
  }

  function handlePaste(event: React.ClipboardEvent) {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    event.preventDefault()
    onAttach(files)
  }

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    if (files.length === 0) return
    onAttach(files)
  }

  const only = attachments.length === 1 ? attachments[0] : undefined
  const totalBytes = attachments.reduce((sum, file) => sum + file.size, 0)

  return (
    <section className="composer glass" aria-label="New item">
      {attachments.length > 0 && (
        <div className="attachment">
          <ul className="thumbs">
            {attachments.map((file, index) => (
              <LocalThumb
                key={fileKey(file)}
                file={file}
                onRemove={() => onRemove(index)}
              />
            ))}
          </ul>
          <div>
            <strong>{only ? only.name || 'Pasted file' : `${attachments.length} attachments`}</strong>
            <small>
              {only ? `${only.type || 'file'} · ` : ''}
              {formatBytes(totalBytes)}
            </small>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClear}
            aria-label={only ? 'Remove attachment' : 'Remove all attachments'}
          >
            <CloseIcon size={16} />
          </button>
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={handlePaste}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
        placeholder={
          attachments.length > 1
            ? 'Write about them… (optional)'
            : attachments.length
              ? 'Add a caption… (optional)'
              : 'Type a note, paste images, or drop files anywhere…'
        }
        aria-label="Note text"
      />

      <div className="composer-row">
        <input
          className="field"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Title (optional)"
          aria-label="Title"
        />
        <input
          className="field"
          value={tags}
          onChange={(event) => setTags(event.target.value)}
          placeholder="tags, comma separated"
          aria-label="Tags"
        />
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={handlePick}
        />
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          <FileIcon size={16} />
          Attach
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!canSave}>
          {busy ? <span className="spinner" /> : <PlusIcon size={16} />}
          {busy ? 'Saving…' : 'Save'}
        </button>
        <span className="composer-hint">⌘ / Ctrl + Enter</span>
      </div>
    </section>
  )
}

