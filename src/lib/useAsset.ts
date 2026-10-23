import { useEffect, useRef, useState } from 'react'
import { cacheGet } from './blobCache'
import type { GitHubClient, RepoInfo } from './github'
import { fetchAsset, rawAssetUrl, type LoadedAsset } from './store'
import { errorMessage } from './util'

interface AssetState {
  url?: string
  error?: string
  loading: boolean
}

/**
 * Resolves an attached image to something an <img> can render, cheapest
 * route first: bytes already in the cache, then the public raw CDN,
 * then an authenticated blob fetch for private repos.
 */
export function useAssetUrl(
  client: GitHubClient,
  repo: RepoInfo,
  asset: LoadedAsset | undefined,
  enabled = true,
): AssetState {
  const [state, setState] = useState<AssetState>({ loading: true })
  const assetPath = asset?.path
  const assetSha = asset?.sha

  useEffect(() => {
    if (!enabled || !assetPath) return
    // Switching to another picture must not keep showing the last one.
    setState({ loading: true })
    let cancelled = false
    let objectUrl: string | null = null
    const controller = new AbortController()

    const revoke = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }

    void (async () => {
      try {
        if (assetSha) {
          const hit = await cacheGet(assetSha)
          if (cancelled) return
          if (hit) {
            objectUrl = URL.createObjectURL(hit)
            setState({ url: objectUrl, loading: false })
            return
          }
        }

        if (!repo.isPrivate) {
          setState({ url: rawAssetUrl(repo, assetPath), loading: false })
          return
        }

        const blob = await fetchAsset(client, repo, asset!, controller.signal)
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setState({ url: objectUrl, loading: false })
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        setState({ error: errorMessage(error), loading: false })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
      revoke()
    }
    // `asset` is intentionally not a dependency: its identity changes on
    // every list refresh, but only these two fields affect the bytes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, repo, assetPath, assetSha, enabled])

  return state
}

/** Defers image work until a card is close to the viewport. */
export function useInView<T extends HTMLElement>(rootMargin = '400px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [rootMargin])

  return { ref, inView }
}
