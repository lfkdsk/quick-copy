import { useEffect, useMemo, useState } from 'react'
import { cacheClear, pruneJsonCache } from '../lib/blobCache'
import { DEFAULT_REPO } from '../lib/config'
import type { GitHubClient, GitHubUser, RepoInfo } from '../lib/github'
import { canWritePrivateRepos } from '../lib/oauth'
import { errorMessage } from '../lib/util'
import type { Notify } from './Toasts'
import { CloseIcon, LockIcon, LogOutIcon, RepoIcon } from './Icons'

interface SettingsDialogProps {
  client: GitHubClient
  user: GitHubUser
  repo: RepoInfo | null
  /** No repo connected yet — the dialog becomes the setup step. */
  firstRun: boolean
  notify: Notify
  onSelect: (repo: RepoInfo) => void
  onClose: () => void
  onSignOut: () => void
}

const VALID_NAME = /^[A-Za-z0-9._-]{1,100}$/

export function SettingsDialog({
  client,
  user,
  repo,
  firstRun,
  notify,
  onSelect,
  onClose,
  onSignOut,
}: SettingsDialogProps) {
  const [name, setName] = useState(repo?.name ?? DEFAULT_REPO)
  const [isPrivate, setIsPrivate] = useState(canWritePrivateRepos())
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState(false)
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)

  const canGoPrivate = canWritePrivateRepos()

  useEffect(() => {
    let cancelled = false
    void client
      .listRepos()
      .then((list) => !cancelled && setRepos(list))
      .catch(() => !cancelled && setRepos([]))
    return () => {
      cancelled = true
    }
  }, [client])

  const suggestions = useMemo(() => {
    if (!repos) return []
    const needle = name.trim().toLowerCase()
    const matches = needle ? repos.filter((r) => r.name.toLowerCase().includes(needle)) : repos
    return matches.slice(0, 30)
  }, [repos, name])

  async function connect(create: boolean) {
    const trimmed = name.trim()
    if (!VALID_NAME.test(trimmed)) {
      notify('Repository names may only contain letters, numbers, ".", "-" and "_".', 'error')
      return
    }
    setBusy(true)
    setMissing(false)
    try {
      const existing = await client.getRepo(user.login, trimmed)
      if (existing) {
        onSelect(existing)
        return
      }
      if (!create) {
        setMissing(true)
        return
      }
      const created = await client.createRepo(trimmed, isPrivate && canGoPrivate)
      notify(`Created ${created.owner}/${created.name}`, 'success')
      onSelect(created)
    } catch (error) {
      notify(errorMessage(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  async function clearCaches() {
    await cacheClear()
    pruneJsonCache()
    notify('Local cache cleared', 'success')
  }

  return (
    <div className="backdrop" onClick={firstRun ? undefined : onClose}>
      <div
        className="dialog glass"
        role="dialog"
        aria-modal="true"
        aria-label="Storage settings"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row">
          <div style={{ flex: 1 }}>
            <h2>{firstRun ? 'Pick a home for your clips' : 'Storage'}</h2>
            <p style={{ margin: '4px 0 0' }}>
              {firstRun
                ? 'Everything you save is committed to a repository you own. Nothing is stored anywhere else.'
                : `Signed in as ${user.login}. Items live as files in this repository.`}
            </p>
          </div>
          {!firstRun && (
            <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
              <CloseIcon size={18} />
            </button>
          )}
        </div>

        <label htmlFor="repo-name">Repository</label>
        <div className="row">
          <span className="owner">{user.login}/</span>
          <input
            id="repo-name"
            className="field"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setMissing(false)
            }}
            onKeyDown={(event) => event.key === 'Enter' && void connect(false)}
            placeholder={DEFAULT_REPO}
            spellCheck={false}
            autoFocus
          />
          <button type="button" className="btn btn-primary" onClick={() => connect(false)} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            Connect
          </button>
        </div>

        {missing && (
          <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
            <span className="grow">
              No repository named <b>{name.trim()}</b> yet.
            </span>
            <button type="button" className="btn" onClick={() => connect(true)} disabled={busy}>
              Create it
            </button>
          </div>
        )}

        <label className="switch" title={canGoPrivate ? undefined : 'Sign in again with private access to use this'}>
          <input
            type="checkbox"
            checked={isPrivate && canGoPrivate}
            disabled={!canGoPrivate}
            onChange={(event) => setIsPrivate(event.target.checked)}
          />
          <span className="track" />
          <span>
            Create new repositories as private
          </span>
        </label>
        {!canGoPrivate && (
          <p className="hint">
            This session was authorised for public repositories only. Sign out and back in with
            private access to keep clips out of public view.
          </p>
        )}

        {suggestions.length > 0 && (
          <>
            <label>Your repositories</label>
            <div className="repo-list">
              {suggestions.map((option) => (
                <button
                  key={`${option.owner}/${option.name}`}
                  type="button"
                  className="repo-option"
                  onClick={() => onSelect(option)}
                >
                  <RepoIcon size={15} />
                  <b>{option.name}</b>
                  {option.isPrivate && <LockIcon size={12} />}
                  <small>{option.defaultBranch}</small>
                </button>
              ))}
            </div>
          </>
        )}

        <div className="actions">
          <button type="button" className="btn btn-ghost" onClick={clearCaches}>
            Clear local cache
          </button>
          <button type="button" className="btn btn-danger" onClick={onSignOut}>
            <LogOutIcon size={16} />
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
