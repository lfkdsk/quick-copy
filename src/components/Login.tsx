import { useState } from 'react'
import { beginLogin, type OAuthScope } from '../lib/oauth'
import { AlertIcon, GithubIcon } from './Icons'

export function Login({ error }: { error?: string }) {
  const [scope, setScope] = useState<OAuthScope>('repo')
  const [leaving, setLeaving] = useState(false)

  return (
    <div className="login">
      <div className="login-card glass">
        <span className="kicker">A clipboard kept in git</span>
        <h1>
          Quick <em>Copy</em>
        </h1>
        <p>
          Paste text or drop an image and it is committed straight to a repository you own. Refresh,
          switch machines, or open the repo on GitHub — it is all just files, with a history.
        </p>

        {error && (
          <div className="banner">
            <AlertIcon size={16} />
            <span className="grow">{error}</span>
          </div>
        )}

        <div className="scope-toggle" role="group" aria-label="Access level">
          <button type="button" aria-pressed={scope === 'repo'} onClick={() => setScope('repo')}>
            Private repos
          </button>
          <button
            type="button"
            aria-pressed={scope === 'public_repo'}
            onClick={() => setScope('public_repo')}
          >
            Public only
          </button>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          disabled={leaving}
          onClick={() => {
            setLeaving(true)
            beginLogin(scope)
          }}
        >
          {leaving ? <span className="spinner" /> : <GithubIcon size={18} />}
          {leaving ? 'Redirecting…' : 'Sign in with GitHub'}
        </button>

        <p className="scope-note">
          {scope === 'repo'
            ? 'The repo scope lets Quick Copy keep your clips in a private repository.'
            : 'Public-only access — anything you save will be readable by anyone.'}{' '}
          The token is exchanged by{' '}
          <a href="https://github.com/lfkdsk/lfkdsk-auth" target="_blank" rel="noreferrer">
            lfkdsk-auth
          </a>{' '}
          and stays in this browser.
        </p>
      </div>
    </div>
  )
}
