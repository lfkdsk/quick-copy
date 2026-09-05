import { useEffect, useRef, useState } from 'react'
import { formatBytes, parseTags } from '../lib/util'
import { CloseIcon, ImageIcon, PlusIcon } from './Icons'

export interface ComposerPayload {
  title: string
  text: string
  tags: string[]
  file: File | null
}

interface ComposerProps {
  attachment: File | null
  busy: boolean
  onAttach: (file: File | null) => void
  onSave: (payload: ComposerPayload) => Promise<boolean>
  onError: (message: string) => void
}

export function Composer({ attachment, busy, onAttach, onSave, onError }: ComposerProps) {
  const [text, setText] = useState('')
  const [title, setTitle] = useState('')
  const [tags, setTags] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!attachment) {
      setPreview(null)
      return
    }
    const url = URL.createObjectURL(attachment)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [attachment])

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

  const canSave = !busy && (attachment !== null || text.trim().length > 0)

  async function submit() {
    if (!canSave) return
    const saved = await onSave({
      title: title.trim(),
      text,
      tags: parseTags(tags),
      file: attachment,
    })
    if (!saved) return
    setText('')
    setTitle('')
    setTags('')
    onAttach(null)
    textareaRef.current?.focus()
  }

  function handlePaste(event: React.ClipboardEvent) {
    const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'))
    if (!file) return
    event.preventDefault()
    onAttach(file)
  }

  function handlePick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!file.type.startsWith('image/')) {
      onError('Only image files can be attached right now.')
      return
    }
    onAttach(file)
  }

  return (
    <section className="composer glass" aria-label="New item">
      {attachment && preview && (
        <div className="attachment">
          <img src={preview} alt="" />
          <div>
            <strong>{attachment.name || 'Pasted image'}</strong>
            <small>
              {attachment.type || 'image'} · {formatBytes(attachment.size)}
            </small>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={() => onAttach(null)}
            aria-label="Remove attachment"
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
          attachment
            ? 'Add a caption for this image… (optional)'
            : 'Type a note, paste an image, or drop a file anywhere…'
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
          accept="image/*"
          className="sr-only"
          onChange={handlePick}
        />
        <button
          type="button"
          className="btn"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
        >
          <ImageIcon size={16} />
          Image
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
