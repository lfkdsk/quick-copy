import { useEffect, useRef } from 'react'
import type { GitHubUser, RepoInfo } from '../lib/github'
import { LockIcon, MoonIcon, RefreshIcon, RepoIcon, SearchIcon, SunIcon } from './Icons'

interface TopBarProps {
  user: GitHubUser
  repo: RepoInfo | null
  query: string
  refreshing: boolean
  theme: 'dark' | 'light'
  onQuery: (value: string) => void
  onRefresh: () => void
  onSettings: () => void
  onToggleTheme: () => void
}

export function TopBar({
  user,
  repo,
  query,
  refreshing,
  theme,
  onQuery,
  onRefresh,
  onSettings,
  onToggleTheme,
}: TopBarProps) {
  const searchRef = useRef<HTMLInputElement>(null)
  const barRef = useRef<HTMLElement>(null)

  // Day headings stick directly beneath this bar, and the bar wraps to
  // two or three rows on a narrow screen — so publish its measured
  // height rather than hard-coding an offset that phones would get wrong.
  useEffect(() => {
    const node = barRef.current
    if (!node) return
    const publish = () =>
      document.documentElement.style.setProperty('--topbar-h', `${node.offsetHeight}px`)
    publish()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(publish)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  // "/" to search is the one shortcut every app of this shape has.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing =
        (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) || target?.isContentEditable
      if (event.key === '/' && !typing) {
        event.preventDefault()
        searchRef.current?.focus()
      }
      if (event.key === 'Escape' && document.activeElement === searchRef.current) {
        searchRef.current?.blur()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <header className="topbar" ref={barRef}>
      <div className="topbar-inner">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Quick Copy</span>
          <span className="brand-repo">{repo ? `${repo.owner}/${repo.name}` : 'unconnected'}</span>
        </div>

        <label className="search">
          <SearchIcon size={16} />
          <span className="sr-only">Search saved items</span>
          <input
            ref={searchRef}
            className="field"
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search notes, tags, filenames…"
            type="search"
          />
          {!query && <kbd>/</kbd>}
        </label>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onRefresh}
          disabled={refreshing || !repo}
          title="Refresh from GitHub"
          aria-label="Refresh from GitHub"
        >
          {refreshing ? <span className="spinner" /> : <RefreshIcon size={17} />}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={onToggleTheme}
          title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
          aria-label="Toggle colour theme"
        >
          {theme === 'dark' ? <SunIcon size={17} /> : <MoonIcon size={17} />}
        </button>

        <button type="button" className="repo-pill" onClick={onSettings} title="Storage settings">
          <RepoIcon size={15} />
          <span>{repo ? repo.name : 'Connect a repo'}</span>
          {repo?.isPrivate && <LockIcon size={12} />}
        </button>

        <img className="avatar" src={user.avatarUrl} alt={user.login} title={user.login} />
      </div>
    </header>
  )
}
