// The connected repository lives in the address — `/<owner>/<name>` —
// so each tab can hold a different one and a link opens the same view.
// The bare root falls back to whatever was picked last.

const BASE = import.meta.env.BASE_URL

/** `owner/name` from the address bar, or null at the root. */
export function repoFromPath(pathname = window.location.pathname): string | null {
  if (!pathname.startsWith(BASE)) return null
  const [owner, name] = pathname.slice(BASE.length).split('/').filter(Boolean)
  if (!owner || !name) return null
  try {
    return `${decodeURIComponent(owner)}/${decodeURIComponent(name)}`
  } catch {
    return null
  }
}

export function pathForRepo(repo: { owner: string; name: string } | null): string {
  if (!repo) return BASE
  return `${BASE}${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`
}

/** Points the address bar at a repo without adding a history entry. */
export function showRepoInPath(repo: { owner: string; name: string } | null): void {
  const path = pathForRepo(repo)
  if (window.location.pathname === path) return
  window.history.replaceState(null, '', path + window.location.search)
}
