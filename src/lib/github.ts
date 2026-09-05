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
}

export class GitHubClient {
  constructor(private readonly token: string) {}

  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const response = await fetch(path.startsWith('http') ? path : API + path, {
      method: options.method ?? 'GET',
      signal: options.signal,
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

  /** Owner-affiliated repos, freshest first — for the repo picker. */
  async listRepos(): Promise<RepoInfo[]> {
    const raw = await this.json<unknown[]>(
      '/user/repos?per_page=100&sort=updated&affiliation=owner',
    )
    return raw.map(toRepoInfo)
  }

  // ------------------------------------------------------------- contents

  /**
   * One recursive call returns the whole storage layout, which is what
   * lets the app rebuild its listing without an index file to keep in
   * sync. An empty repo 404s here; that is a valid state, not an error.
   */
  async listTree(repo: RepoInfo, signal?: AbortSignal): Promise<TreeEntry[]> {
    try {
      const data = await this.json<{ tree: TreeEntry[]; truncated: boolean }>(
        `/repos/${repo.owner}/${repo.name}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`,
        { signal },
      )
      return data.tree ?? []
    } catch (error) {
      if (error instanceof GitHubError && error.status === 404) return []
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
  async commit(repo: RepoInfo, spec: CommitSpec): Promise<string> {
    const writes = spec.writes ?? []
    const deletes = spec.deletes ?? []
    if (writes.length === 0 && deletes.length === 0) {
      throw new Error('Nothing to commit')
    }

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

    for (let attempt = 0; attempt < 3; attempt++) {
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
        return commit.sha
      } catch (error) {
        // 422 here means the branch advanced between our read and our
        // write. The blobs are still good, so rebuild the tree on the
        // new head instead of failing the user's save.
        const raced =
          error instanceof GitHubError && (error.status === 422 || error.status === 409)
        if (!raced || attempt === 2) throw error
      }
    }

    throw new Error('Could not update the branch after several attempts')
  }

  private async headSha(repo: RepoInfo): Promise<string | null> {
    try {
      const ref = await this.json<{ object: { sha: string } }>(
        `/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(repo.defaultBranch)}`,
      )
      return ref.object.sha
    } catch (error) {
      // A repo with no commits has no ref yet; the first commit creates it.
      if (error instanceof GitHubError && (error.status === 404 || error.status === 409)) {
        return null
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

function toRepoInfo(raw: any): RepoInfo {
  return {
    owner: raw.owner?.login ?? '',
    name: raw.name,
    isPrivate: Boolean(raw.private),
    defaultBranch: raw.default_branch || 'main',
    htmlUrl: raw.html_url,
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
