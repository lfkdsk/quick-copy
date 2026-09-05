import { OAUTH_CLIENT_ID, OAUTH_WORKER_URL } from './config'

const STATE_KEY = 'qc.oauth.state'
const TOKEN_KEY = 'qc.oauth.token'
const SCOPE_KEY = 'qc.oauth.scope'

/**
 * `public_repo` is enough to write to a public repo and is the smaller
 * grant; `repo` is required for a private one. The login screen lets
 * the user choose, because "my clipboard lives in a public repo" is a
 * decision only they can make.
 */
export type OAuthScope = 'repo' | 'public_repo'

export interface OAuthResult {
  token?: string
  scope?: string
  error?: string
}

export function beginLogin(scope: OAuthScope): void {
  const state = crypto.randomUUID().replace(/-/g, '')
  // sessionStorage, not localStorage: the state is only meaningful for
  // the tab that started the round-trip, and it should not outlive it.
  sessionStorage.setItem(STATE_KEY, state)

  const url = new URL('https://github.com/login/oauth/authorize')
  url.searchParams.set('client_id', OAUTH_CLIENT_ID)
  url.searchParams.set('redirect_uri', `${OAUTH_WORKER_URL}/callback`)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  window.location.assign(url.toString())
}

/**
 * The broker sends us back to `/#oauth_token=…&state=…` (fragment, so
 * the token never reaches a server log or a Referer header). Read it,
 * check the state, then scrub the fragment out of the address bar and
 * the history entry.
 */
export function consumeRedirect(): OAuthResult | null {
  const hash = window.location.hash.replace(/^#/, '')
  if (!hash) return null

  const params = new URLSearchParams(hash)
  const token = params.get('oauth_token')
  const error = params.get('oauth_error')
  if (!token && !error) return null

  const expected = sessionStorage.getItem(STATE_KEY)
  sessionStorage.removeItem(STATE_KEY)
  clearHash()

  if (!expected || params.get('state') !== expected) {
    return { error: 'Sign-in state did not match. Please try again.' }
  }
  if (error) return { error }

  const scope = params.get('oauth_scope') || ''
  storeSession(token!, scope)
  return { token: token!, scope }
}

function clearHash(): void {
  const { pathname, search } = window.location
  window.history.replaceState(null, '', pathname + search)
}

export function storeSession(token: string, scope: string): void {
  localStorage.setItem(TOKEN_KEY, token)
  localStorage.setItem(SCOPE_KEY, scope)
}

export function storedToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function storedScope(): string {
  return localStorage.getItem(SCOPE_KEY) || ''
}

export function canWritePrivateRepos(): boolean {
  return storedScope().split(/[\s,]+/).includes('repo')
}

export function signOut(): void {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(SCOPE_KEY)
}
