import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MAX_ASSET_BYTES } from './lib/config'
import { GitHubClient, GitHubError, type GitHubUser, type RepoInfo } from './lib/github'
import { consumeRedirect, signOut, storedToken } from './lib/oauth'
import {
  deleteItem,
  loadItems,
  saveImage,
  saveText,
  updateItem,
  type LoadedItem,
} from './lib/store'
import { errorMessage, formatBytes, pad2 } from './lib/util'
import { Composer, type ComposerPayload } from './components/Composer'
import { EditDialog } from './components/EditDialog'
import { ItemCard } from './components/ItemCard'
import { Lightbox } from './components/Lightbox'
import { Login } from './components/Login'
import { SettingsDialog } from './components/SettingsDialog'
import { TopBar } from './components/TopBar'
import { Toasts, useToasts } from './components/Toasts'
import { AlertIcon } from './components/Icons'

type Phase = 'booting' | 'anon' | 'ready'
type KindFilter = 'all' | 'text' | 'image'
type Theme = 'dark' | 'light'

const REPO_KEY = 'qc.repo'
const THEME_KEY = 'qc.theme'

function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('booting')
  const [authError, setAuthError] = useState<string | undefined>()
  const [client, setClient] = useState<GitHubClient | null>(null)
  const [user, setUser] = useState<GitHubUser | null>(null)
  const [repo, setRepo] = useState<RepoInfo | null>(null)

  const [items, setItems] = useState<LoadedItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | undefined>()
  const [skipped, setSkipped] = useState(0)

  const [saving, setSaving] = useState(false)
  const [attachment, setAttachment] = useState<File | null>(null)
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<KindFilter>('all')
  const [tag, setTag] = useState<string | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<LoadedItem | null>(null)
  const [viewing, setViewing] = useState<LoadedItem | null>(null)
  const [dragging, setDragging] = useState(false)
  const [theme, setTheme] = useState<Theme>(initialTheme)

  const { toasts, notify, dismiss } = useToasts()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem(THEME_KEY, theme)
  }, [theme])

  const resetToAnon = useCallback((message?: string) => {
    signOut()
    setClient(null)
    setUser(null)
    setRepo(null)
    setItems([])
    setAuthError(message)
    setPhase('anon')
  }, [])

  /** A dead token should drop us to the login screen, not spam toasts. */
  const reportError = useCallback(
    (error: unknown) => {
      if (error instanceof GitHubError && error.isAuthFailure) {
        resetToAnon('Your GitHub session expired. Please sign in again.')
        return
      }
      notify(errorMessage(error), 'error')
    },
    [notify, resetToAnon],
  )

  // ------------------------------------------------------------ boot

  useEffect(() => {
    const redirect = consumeRedirect()
    if (redirect?.error) {
      setAuthError(redirect.error)
      setPhase('anon')
      return
    }

    const token = redirect?.token ?? storedToken()
    if (!token) {
      setPhase('anon')
      return
    }

    const api = new GitHubClient(token)
    let cancelled = false

    void (async () => {
      try {
        const me = await api.me()
        if (cancelled) return
        setClient(api)
        setUser(me)

        const saved = localStorage.getItem(REPO_KEY)
        if (saved) {
          const [owner, name] = saved.includes('/') ? saved.split('/') : [me.login, saved]
          const found = await api.getRepo(owner!, name!)
          if (cancelled) return
          if (found) setRepo(found)
          else localStorage.removeItem(REPO_KEY)
        }
        setPhase('ready')
      } catch (error) {
        if (cancelled) return
        if (error instanceof GitHubError && error.isAuthFailure) {
          resetToAnon('Your GitHub session expired. Please sign in again.')
          return
        }
        setAuthError(errorMessage(error))
        setPhase('anon')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [resetToAnon])

  // ------------------------------------------------------- item loading

  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!client || !repo) return
      setLoading(true)
      setLoadError(undefined)
      try {
        const result = await loadItems(client, repo, signal)
        if (signal?.aborted) return
        setItems(result.items)
        setSkipped(result.skipped)
      } catch (error) {
        if (signal?.aborted) return
        if (error instanceof GitHubError && error.isAuthFailure) {
          resetToAnon('Your GitHub session expired. Please sign in again.')
          return
        }
        setLoadError(errorMessage(error))
      } finally {
        if (!signal?.aborted) setLoading(false)
      }
    },
    [client, repo, resetToAnon],
  )

  useEffect(() => {
    if (!client || !repo) return
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [client, repo, refresh])

  // First run: no repo connected, so the setup dialog is the whole UI.
  useEffect(() => {
    if (phase === 'ready' && !repo) setSettingsOpen(true)
  }, [phase, repo])

  // ------------------------------------------------- paste & drop anywhere

  const dragDepth = useRef(0)

  useEffect(() => {
    if (phase !== 'ready') return

    const isTyping = (node: EventTarget | null) => {
      const element = node as HTMLElement | null
      return Boolean(
        element && (/^(INPUT|TEXTAREA)$/.test(element.tagName) || element.isContentEditable),
      )
    }

    const onPaste = (event: ClipboardEvent) => {
      // The composer has its own handler; this covers the rest of the page.
      if (isTyping(event.target) || !event.clipboardData) return
      const file = Array.from(event.clipboardData.files).find((f) => f.type.startsWith('image/'))
      if (!file) return
      event.preventDefault()
      setAttachment(file)
      notify('Image attached — add a caption or hit Save', 'info')
    }

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return
      dragDepth.current++
      setDragging(true)
    }
    const onDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault()
    }
    const onDragLeave = () => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const file = Array.from(event.dataTransfer?.files ?? []).find((f) =>
        f.type.startsWith('image/'),
      )
      if (file) setAttachment(file)
      else notify('Only image files can be dropped here.', 'error')
    }

    window.addEventListener('paste', onPaste)
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('paste', onPaste)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [phase, notify])

  // ---------------------------------------------------------- mutations

  async function handleSave(payload: ComposerPayload): Promise<boolean> {
    if (!client || !repo) {
      setSettingsOpen(true)
      return false
    }
    if (payload.file && payload.file.size > MAX_ASSET_BYTES) {
      notify(`Images must be under ${formatBytes(MAX_ASSET_BYTES)}.`, 'error')
      return false
    }

    setSaving(true)
    try {
      const saved = payload.file
        ? await saveImage(client, repo, {
            title: payload.title,
            text: payload.text,
            tags: payload.tags,
            file: payload.file,
          })
        : await saveText(client, repo, {
            title: payload.title,
            text: payload.text,
            tags: payload.tags,
          })
      setItems((current) => [saved, ...current])
      notify(`Saved to ${repo.owner}/${repo.name}`, 'success')
      return true
    } catch (error) {
      reportError(error)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function handleUpdate(patch: { title: string; text: string; tags: string[] }) {
    if (!client || !repo || !editing) return
    setSaving(true)
    try {
      const next = await updateItem(client, repo, editing, patch)
      setItems((current) => current.map((item) => (item.id === next.id ? next : item)))
      setEditing(null)
      notify('Updated', 'success')
    } catch (error) {
      reportError(error)
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(item: LoadedItem) {
    if (!client || !repo) return
    const label = item.title || item.asset?.name || 'this item'
    if (!window.confirm(`Delete ${label}? This commits a removal to ${repo.name}.`)) return
    const snapshot = items
    setItems((current) => current.filter((entry) => entry.id !== item.id))
    try {
      await deleteItem(client, repo, item)
      notify('Deleted', 'success')
    } catch (error) {
      setItems(snapshot)
      reportError(error)
    }
  }

  function selectRepo(next: RepoInfo) {
    localStorage.setItem(REPO_KEY, `${next.owner}/${next.name}`)
    setRepo(next)
    setItems([])
    setSettingsOpen(false)
  }

  // ------------------------------------------------------------ filtering

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (kind !== 'all' && item.kind !== kind) return false
      if (tag && !item.tags.includes(tag)) return false
      if (!needle) return true
      const haystack = [item.title, item.text, item.asset?.name, ...item.tags]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [items, query, kind, tag])

  const counts = useMemo(
    () => ({
      all: items.length,
      text: items.filter((item) => item.kind === 'text').length,
      image: items.filter((item) => item.kind === 'image').length,
    }),
    [items],
  )

  // -------------------------------------------------------------- render

  if (phase === 'booting') {
    return (
      <>
        <Grain />
        <div className="center-screen">
          <span className="spinner" />
          <span>Checking your GitHub session…</span>
        </div>
      </>
    )
  }

  if (phase === 'anon' || !client || !user) {
    return (
      <>
        <Grain />
        <Login error={authError} />
        <Toasts toasts={toasts} dismiss={dismiss} />
      </>
    )
  }

  return (
    <>
      <Grain />
      <TopBar
        user={user}
        repo={repo}
        query={query}
        refreshing={loading}
        theme={theme}
        onQuery={setQuery}
        onRefresh={() => void refresh()}
        onSettings={() => setSettingsOpen(true)}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      />
      <div className="shell">
        <Composer
          attachment={attachment}
          busy={saving}
          onAttach={setAttachment}
          onSave={handleSave}
          onError={(message) => notify(message, 'error')}
        />

        {loadError && (
          <div className="banner">
            <AlertIcon size={16} />
            <span className="grow">{loadError}</span>
            <button type="button" className="btn btn-ghost" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}

        {skipped > 0 && (
          <div className="banner">
            <AlertIcon size={16} />
            <span className="grow">
              {skipped} file{skipped === 1 ? '' : 's'} in <code>items/</code> could not be read and
              {skipped === 1 ? ' was' : ' were'} skipped.
            </span>
          </div>
        )}

        <div className="filters">
          {(['all', 'text', 'image'] as const).map((value) => (
            <button
              key={value}
              type="button"
              className="filter"
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {value === 'all' ? 'Everything' : value === 'text' ? 'Notes' : 'Images'}
              <em>{pad2(counts[value])}</em>
            </button>
          ))}
          {tag && (
            <button
              type="button"
              className="filter filter-tag"
              aria-pressed
              onClick={() => setTag(null)}
            >
              #{tag} &times;
            </button>
          )}
          <span className="count">
            {visible.length === items.length
              ? `${pad2(items.length)} item${items.length === 1 ? '' : 's'}`
              : `${pad2(visible.length)} of ${pad2(items.length)}`}
          </span>
        </div>

        {loading && items.length === 0 ? (
          <div className="grid">
            {Array.from({ length: 8 }, (_, index) => (
              <div
                key={index}
                className="skeleton shimmer"
                style={{ height: 110 + ((index * 47) % 130) }}
              />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <EmptyState hasItems={items.length > 0} hasRepo={Boolean(repo)} />
        ) : (
          <div className="grid">
            {visible.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                client={client}
                repo={repo!}
                notify={notify}
                onOpen={setViewing}
                onEdit={setEditing}
                onDelete={(target) => void handleDelete(target)}
                onTag={setTag}
              />
            ))}
          </div>
        )}
      </div>

      {dragging && (
        <div className="dropzone">
          <div>
            <strong>Drop to attach</strong>
            <small>png · jpeg · gif · webp · svg</small>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDialog
          client={client}
          user={user}
          repo={repo}
          firstRun={!repo}
          notify={notify}
          onSelect={selectRepo}
          onClose={() => setSettingsOpen(false)}
          onSignOut={() => resetToAnon()}
        />
      )}

      {editing && (
        <EditDialog
          item={editing}
          busy={saving}
          onCancel={() => setEditing(null)}
          onSave={(patch) => void handleUpdate(patch)}
        />
      )}

      {viewing && repo && (
        <Lightbox
          item={viewing}
          client={client}
          repo={repo}
          notify={notify}
          onClose={() => setViewing(null)}
        />
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />
    </>
  )
}

function Grain() {
  return <div className="grain" aria-hidden="true" />
}

function EmptyState({ hasItems, hasRepo }: { hasItems: boolean; hasRepo: boolean }) {
  if (!hasRepo) {
    return (
      <div className="empty">
        <h2>Nowhere to keep things yet.</h2>
        <p>Choose a repository and everything you save gets committed there.</p>
      </div>
    )
  }
  if (hasItems) {
    return (
      <div className="empty">
        <h2>Nothing matches.</h2>
        <p>Try another search, or clear the filters above.</p>
      </div>
    )
  }
  return (
    <div className="empty">
      <h2>An empty shelf.</h2>
      <p>
        Write a note above, press <kbd>⌘V</kbd> with a screenshot on the clipboard, or drop an image
        anywhere on this page. Every save is a commit.
      </p>
    </div>
  )
}
