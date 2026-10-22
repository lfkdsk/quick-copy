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
const VALID_OWNER = /^[A-Za-z0-9-]{1,39}$/

interface RepoRef {
  owner: string
  name: string
}

/**
 * "name" means one of the user's own repos; "owner/name" (or a pasted
 * github.com URL) reaches anything else they can write to — a repo they
 * were invited to, or one in an org.
 */
function parseRepoRef(input: string, login: string): RepoRef | null {
  const cleaned = input
    .trim()
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  const parts = cleaned.split('/')
  const [owner, name] = parts.length === 1 ? [login, parts[0]!] : parts.length === 2 ? parts : []
  if (!owner || !name || !VALID_OWNER.test(owner) || !VALID_NAME.test(name)) return null
  return { owner, name }
}

function sameOwner(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

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
  const [name, setName] = useState(
    repo ? (sameOwner(repo.owner, user.login) ? repo.name : `${repo.owner}/${repo.name}`) : DEFAULT_REPO,
  )
  const [isPrivate, setIsPrivate] = useState(canWritePrivateRepos())
  const [busy, setBusy] = useState(false)
  const [missing, setMissing] = useState<RepoRef | null>(null)
  const [repos, setRepos] = useState<RepoInfo[] | null>(null)
  // The field opens pre-filled with the current repo; filtering the
  // list by that would hide every other choice. Narrow only once typed.
  const [typed, setTyped] = useState(false)

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
    const needle = typed ? name.trim().toLowerCase() : ''
    const matches = needle
      ? repos.filter((r) => `${r.owner}/${r.name}`.toLowerCase().includes(needle))
      : repos
    return matches.slice(0, 30)
  }, [repos, name, typed])

  async function connect(create: boolean) {
    const ref = parseRepoRef(name, user.login)
    if (!ref) {
      notify(
        'Use "name" or "owner/name". Repository names may only contain letters, numbers, ".", "-" and "_".',
        'error',
      )
      return
    }
    setBusy(true)
    setMissing(null)
    try {
      const existing = await client.getRepo(ref.owner, ref.name)
      if (existing) {
        if (!existing.canPush) {
          notify(`You can read ${existing.owner}/${existing.name} but not commit to it.`, 'error')
          return
        }
        onSelect(existing)
        return
      }
      // Only the user's own account is a place we create repos in.
      if (!create || !sameOwner(ref.owner, user.login)) {
        setMissing(ref)
        return
      }
      const created = await client.createRepo(ref.name, isPrivate && canGoPrivate)
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
                ? 'Everything you save is committed to a repository you can write to. Nothing is stored anywhere else.'
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
          {!name.includes('/') && <span className="owner">{user.login}/</span>}
          <input
            id="repo-name"
            className="field"
            value={name}
            onChange={(event) => {
              setName(event.target.value)
              setTyped(true)
              setMissing(null)
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
        <p className="hint">
          Type <code>owner/name</code> or paste a GitHub URL to use a repository under another
          account or an organisation you can push to.
        </p>

        {missing &&
          (sameOwner(missing.owner, user.login) ? (
            <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="grow">
                No repository named <b>{missing.name}</b> yet.
              </span>
              <button type="button" className="btn" onClick={() => connect(true)} disabled={busy}>
                Create it
              </button>
            </div>
          ) : (
            <div className="banner" style={{ marginTop: 12, marginBottom: 0 }}>
              <span className="grow">
                Can't find{' '}
                <b>
                  {missing.owner}/{missing.name}
                </b>
                . It may not exist, or this sign-in has no access to it
                {canGoPrivate ? '' : ' (private repositories need private access)'}.
              </span>
            </div>
          ))}

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
            <label>Repositories you can write to</label>
            <div className="repo-list">
              {suggestions.map((option) => (
                <button
                  key={`${option.owner}/${option.name}`}
                  type="button"
                  className="repo-option"
                  onClick={() => onSelect(option)}
                >
                  <RepoIcon size={15} />
                  <span>
                    {!sameOwner(option.owner, user.login) && (
                      <span className="repo-owner">{option.owner}/</span>
                    )}
                    <b>{option.name}</b>
                  </span>
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
