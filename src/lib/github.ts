const API = 'https://api.github.com'

export class GitHubError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly documentationUrl?: string,
  ) {
    super(message)
    this.name = 'GitHubError'
  }

  /** The token is gone, revoked, or missing the scope we need. */
  get isAuthFailure(): boolean {
    return this.status === 401
  }
}

export interface GitHubUser {
  login: string
  name: string | null
  avatarUrl: string
  htmlUrl: string
}

export interface RepoInfo {
  owner: string
  name: string
  isPrivate: boolean
  defaultBranch: string
  htmlUrl: string
  /**
   * Whether the signed-in user can commit here. Repos owned by someone
   * else (a collaborator invite, an org) can be read-only; saving to one
   * would only fail at the first commit.
   */
  canPush: boolean
}

export interface TreeEntry {
  path: string
  type: 'blob' | 'tree' | 'commit'
  sha: string
  size?: number
}

export interface FileWrite {
  path: string
  /** Base64 of the file's bytes — the only encoding the blobs API takes. */
  base64: string
}

export interface CommitSpec {
  message: string
  writes?: FileWrite[]
  deletes?: string[]
}

interface RequestOptions {
  method?: string
  body?: unknown
  /** Ask for the raw bytes instead of the JSON envelope (blobs API). */
  raw?: boolean
  signal?: AbortSignal
  /**
   * GitHub sends `Cache-Control: private, max-age=60`, so without this
   * the browser answers a re-read of a moving ref from its own cache.
   */
  cache?: RequestCache
}

export class GitHubClient {
  /** Commits run one at a time per repo, so our own saves never race each other. */
  private readonly queues = new Map<string, Promise<unknown>>()
  /** Repos known to have at least one commit, so the git data API works on them. */
  private readonly initialised = new Set<string>()
  /** The last commit we moved each branch to, and the head it replaced. */
  private readonly lastWrite = new Map<string, { parent: string | null; sha: string }>()

  constructor(private readonly token: string) {}

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const response = await fetch(path.startsWith('http') ? path : API + path, {
      method: options.method ?? 'GET',
      signal: options.signal,
      cache: options.cache,
      headers: {
        accept: options.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'x-github-api-version': '2022-11-28',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    })

    if (!response.ok) throw await toError(response)
    return response
  }

  private async json<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return (await this.request(path, options)).json() as Promise<T>
  }

  // ---------------------------------------------------------------- user

  async me(): Promise<GitHubUser> {
    const raw = await this.json<{
      login: string
      name: string | null
      avatar_url: string
      html_url: string
    }>('/user')
    return { login: raw.login, name: raw.name, avatarUrl: raw.avatar_url, htmlUrl: raw.html_url }
  }

  // ---------------------------------------------------------------- repos

  async getRepo(owner: string, name: string): Promise<RepoInfo | null> {
    try {
      return toRepoInfo(await this.json(`/repos/${owner}/${name}`))
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return null
      throw error
    }
  }

  async createRepo(name: string, isPrivate: boolean): Promise<RepoInfo> {
    return toRepoInfo(
      await this.json('/user/repos', {
        method: 'POST',
        body: {
          name,
          private: isPrivate,
          description: 'Saved by Quick Copy — text and images, versioned in git.',
          // Gives us a default branch with one commit on it, so the very
          // first save is an ordinary fast-forward like every later one.
          auto_init: true,
        },
      }),
    )
  }

  /**
   * Every repo the user can commit to — their own, ones they were
   * invited to, and their orgs' — freshest first, for the repo picker.
   */
  async listRepos(): Promise<RepoInfo[]> {
    const raw = await this.json<unknown[]>(
      '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member',
    )
    return raw.map(toRepoInfo).filter((repo) => repo.canPush)
  }

  // ------------------------------------------------------------- contents

  /**
   * One recursive call returns the whole storage layout, which is what
   * lets the app rebuild its listing without an index file to keep in
   * sync. An empty repo answers 409 ("Git Repository is empty") or
   * 404 here; that is a valid state, not an error.
   */
  async listTree(repo: RepoInfo, signal?: AbortSignal): Promise<TreeEntry[]> {
    try {
      const data = await this.json<{ tree: TreeEntry[]; truncated: boolean }>(
        `/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`,
        { signal, cache: 'no-cache' },
      )
      return data.tree ?? []
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) return []
      throw error
    }
  }

  async getBlobBytes(repo: RepoInfo, sha: string, signal?: AbortSignal): Promise<ArrayBuffer> {
    const response = await this.request(`/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`, {
      raw: true,
      signal,
    })
    return response.arrayBuffer()
  }

  async getBlobText(repo: RepoInfo, sha: string, signal?: AbortSignal): Promise<string> {
    const response = await this.request(`/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`, {
      raw: true,
      signal,
    })
    return response.text()
  }

  // --------------------------------------------------------------- commits

  /**
   * Writes and deletes land in a single commit through the git data
   * API, so an image and the JSON that describes it can never exist
   * without each other. Blobs are uploaded once; the tree/commit/ref
   * dance is retried if someone else moved the branch underneath us.
   */
  commit(repo: RepoInfo, spec: CommitSpec): Promise<string> {
    const key = repoKey(repo)
    const run = (this.queues.get(key) ?? Promise.resolve())
      .catch(() => undefined)
      .then(() => this.commitNow(repo, spec))
    this.queues.set(key, run)
    return run
  }

  private async commitNow(repo: RepoInfo, spec: CommitSpec): Promise<string> {
    const writes = spec.writes ?? []
    const deletes = spec.deletes ?? []
    if (writes.length === 0 && deletes.length === 0) {
      throw new Error('Nothing to commit')
    }

    await this.ensureInitialised(repo)

    const base = `/repos/${repo.owner}/${repo.name}`
    const blobs = await Promise.all(
      writes.map(async (file) => {
        const { sha } = await this.json<{ sha: string }>(`${base}/git/blobs`, {
          method: 'POST',
          body: { content: file.base64, encoding: 'base64' },
        })
        return { path: file.path, sha }
      }),
    )

    for (let attempt = 0; attempt < COMMIT_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(300 * 2 ** (attempt - 1))
      const head = await this.headSha(repo)
      const baseTree = head ? await this.treeShaOf(repo, head) : undefined

      const entries: Array<Record<string, unknown>> = blobs.map((blob) => ({
        path: blob.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      }))
      // A null sha against a base tree is the git data API's way of
      // spelling "remove this path". Meaningless without a base tree.
      if (baseTree) {
        for (const path of deletes) {
          entries.push({ path, mode: '100644', type: 'blob', sha: null })
        }
      }

      const tree = await this.json<{ sha: string }>(`${base}/git/trees`, {
        method: 'POST',
        body: baseTree ? { base_tree: baseTree, tree: entries } : { tree: entries },
      })

      const commit = await this.json<{ sha: string }>(`${base}/git/commits`, {
        method: 'POST',
        body: { message: spec.message, tree: tree.sha, parents: head ? [head] : [] },
      })

      try {
        await this.moveRef(repo, commit.sha, head === null)
        this.lastWrite.set(repoKey(repo), { parent: head, sha: commit.sha })
        return commit.sha
      } catch (error) {
        // 422 ("not a fast forward") means the branch advanced between
        // our read and our write. The blobs are still good, so rebuild
        // the tree on the new head instead of failing the user's save.
        const raced =
          error instanceof GitHubError && (error.status === 422 || error.status === 409)
        if (!raced || attempt === COMMIT_ATTEMPTS - 1) throw error
      }
    }

    throw new Error('Could not update the branch after several attempts')
  }

  /**
   * The git data API refuses a repo with no commits at all — even
   * creating a blob answers 409 "Git Repository is empty". A repo made
   * on github.com without "Add a README" is exactly that. The contents
   * API is the one write that works there, so it lays down a README as
   * the root commit; everything after is an ordinary fast-forward.
   */
  private async ensureInitialised(repo: RepoInfo): Promise<void> {
    const key = repoKey(repo)
    if (this.initialised.has(key)) return
    if ((await this.headSha(repo)) === null) {
      try {
        await this.request(`/repos/${repo.owner}/${repo.name}/contents/README.md`, {
          method: 'PUT',
          body: {
            message: 'Initialise Quick Copy storage',
            content: btoa(README),
          },
        })
      } catch (error) {
        // 422: another device initialised it between our read and write.
        if (!(error instanceof GitHubError && error.status === 422)) throw error
      }
    }
    this.initialised.add(key)
  }

  private async headSha(repo: RepoInfo): Promise<string | null> {
    try {
      const ref = await this.json<{ object: { sha: string } }>(
        `/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
        { cache: 'no-store' },
      )
      // Right after a write GitHub can still serve the ref from a replica
      // that has not caught up. If it hands back the head our last commit
      // replaced, that commit is the real tip; building on the old one
      // is a guaranteed "not a fast forward".
      const last = this.lastWrite.get(repoKey(repo))
      if (last && last.parent === ref.object.sha) return last.sha
      return ref.object.sha
    } catch (error) {
      // A repo with no commits has no ref yet; the first commit creates it.
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) {
        return this.lastWrite.get(repoKey(repo))?.sha ?? null
      }
      throw error
    }
  }

  private async treeShaOf(repo: RepoInfo, commitSha: string): Promise<string> {
    const commit = await this.json<{ tree: { sha: string } }>(
      `/repos/${repo.owner}/${repo.name}/git/commits/${commitSha}`,
    )
    return commit.tree.sha
  }

  private async moveRef(repo: RepoInfo, sha: string, create: boolean): Promise<void> {
    const base = `/repos/${repo.owner}/${repo.name}/git`
    if (create) {
      await this.request(`${base}/refs`, {
        method: 'POST',
        body: { ref: `refs/heads/${repo.defaultBranch}`, sha },
      })
      return
    }
    await this.request(`${base}/refs/heads/${encodeURIComponent(repo.defaultBranch)}`, {
      method: 'PATCH',
      body: { sha, force: false },
    })
  }
}

const COMMIT_ATTEMPTS = 5

const README = `# Quick Copy data

Saved by [Quick Copy](https://quick-copy.lfkdsk.org): one JSON
descriptor per item under \`items/\`, attachments beside it under
\`assets/<id>/\`.
`

function repoKey(repo: RepoInfo): string {
  return `${repo.owner}/${repo.name}@${repo.defaultBranch}`.toLowerCase()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function toRepoInfo(raw: any): RepoInfo {
  return {
    owner: raw.owner?.login ?? '',
    name: raw.name,
    isPrivate: Boolean(raw.private),
    defaultBranch: raw.default_branch || 'main',
    htmlUrl: raw.html_url,
    // `permissions` only comes back on authenticated requests; treat its
    // absence as "unknown" and let the first commit be the judge.
    canPush: raw.permissions?.push !== false,
  }
}

async function toError(response: Response): Promise<GitHubError> {
  let message = `${response.status} ${response.statusText}`
  let documentationUrl: string | undefined

  try {
    const body = (await response.json()) as {
      message?: string
      errors?: Array<{ message?: string }>
      documentation_url?: string
    }
    if (body.message) message = body.message
    const detail = body.errors?.map((e) => e.message).filter(Boolean).join('; ')
    if (detail) message += ` (${detail})`
    documentationUrl = body.documentation_url
  } catch {
    /* non-JSON error body — the status line is all we get */
  }

  // Secondary rate limits come back as 403 with a wall of prose; the
  // useful part for the user is simply "wait a moment".
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    const reset = Number(response.headers.get('x-ratelimit-reset') ?? 0) * 1000
    const minutes = Math.max(1, Math.ceil((reset - Date.now()) / 60000))
    message = `GitHub API rate limit reached. Try again in about ${minutes} minute(s).`
  }

  return new GitHubError(response.status, message, documentationUrl)
}
