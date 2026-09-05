# Quick Copy

A clipboard that lives in git. Paste text or drop an image and it is
committed straight to a GitHub repository you own — no server, no
database, no vendor. Refresh, switch machines, or open the repo on
github.com; it is all just files, with a history.

- **Static.** Deploys to GitHub Pages from a single Actions workflow.
- **No backend.** Reads and writes go directly from the browser to the
  GitHub REST API with the signed-in user's token.
- **Your data.** Items are plain JSON and ordinary image files in a repo
  you control. Delete the app and the data is still there and readable.

## How it stores things

Everything lands in a **separate data repository owned by whoever is
signed in** — by default `<you>/quick-copy-data`, created on first run.
This repository holds only the app itself.

```
quick-copy-data/
├── items/
│   ├── 20260904-091200-a1b2c3.json     one descriptor per item
│   └── 20260903-181400-d4e5f6.json
└── assets/
    └── 20260904-091200-a1b2c3/
        └── screenshot.png              the binary, beside its descriptor
```

A descriptor is small and hand-editable:

```json
{
  "v": 1,
  "id": "20260904-091200-a1b2c3",
  "kind": "image",
  "title": "Dashboard mock",
  "tags": ["design"],
  "createdAt": "2026-09-04T09:12:00.000Z",
  "asset": {
    "path": "assets/20260904-091200-a1b2c3/screenshot.png",
    "name": "screenshot.png",
    "mime": "image/png",
    "size": 184320,
    "width": 800,
    "height": 520
  }
}
```

Two decisions worth knowing about:

**There is no index file.** The listing is rebuilt from one recursive
`git/trees` call. An index would be a single file every device races to
rewrite; a tree read can't be clobbered, and it costs the same one
request.

**An item is one commit.** The image and the JSON that describes it go
in together through the git data API (blobs → tree → commit → ref), so a
half-written item is not a state the repo can be in. If the branch moved
underneath a save, the tree is rebuilt on the new head and retried.

Images are cached in IndexedDB by their git blob SHA — content-addressed,
so an entry can never be stale. The SHA is computed locally on save
(`sha1("blob <len>\0" + bytes)`), which is why a just-saved image paints
immediately instead of waiting for a round-trip.

## Running it

```sh
npm install
npm run dev
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server |
| `npm run build` | Typecheck, then build to `dist/` |
| `npm run preview` | Serve the built output at `/quick-copy/` |
| `npm run smoke` | End-to-end checks against a mocked GitHub API |

The smoke test drives a real browser through sign-in state, listing,
saving a note, saving an image, filtering and search. Playwright is not
a dependency — install it when you want to run the test:

```sh
npm i -D playwright && npx playwright install chromium
npm run build && npm run preview      # one terminal
npm run smoke                         # another
```

## Deploying

Push to `master`. The workflow in `.github/workflows/deploy.yml` builds
and publishes to Pages; enable it once under **Settings → Pages →
Source: GitHub Actions**. The site lands at
`https://<you>.github.io/quick-copy/`.

`VITE_BASE` controls the base path and the workflow sets it from the
repository name. For a custom domain (or a user page served from the
root), build with `VITE_BASE=/`.

## Sign-in

GitHub's token endpoint still requires a `client_secret` and sends no
CORS headers, so a pure-browser OAuth flow is impossible. Quick Copy
uses [lfkdsk-auth](https://github.com/lfkdsk/lfkdsk-auth), the shared
broker Worker that holds the secret for every project under the lfkdsk
umbrella:

```
Quick Copy ──▶ github.com/login/oauth/authorize
                  redirect_uri=auth.lfkdsk.org/quick-copy/callback
                        │
                        ▼
               auth.lfkdsk.org exchanges the code for a token
                        │
                        ▼
   https://lfkdsk.github.io/quick-copy/#oauth_token=…&state=…
```

The token comes back in the URL **fragment**, so it never reaches an
access log or a `Referer` header. The app checks the `state` it stashed
before redirecting, then strips the fragment out of the address bar.

Two things are worth being deliberate about:

- **Scope.** The sign-in screen offers `repo` (needed for a private data
  repository) or `public_repo`. Pick `public_repo` and anything you save
  is world-readable.
- **Where the token lives.** In this browser's `localStorage`, like every
  other client-only GitHub app. Sign out to clear it, and revoke it any
  time under [GitHub → Applications](https://github.com/settings/applications).

### Pointing it at a different deployment

The defaults in `src/lib/config.ts` target this project's Pages URL.
Override them at build time if you deploy somewhere else:

```sh
VITE_OAUTH_WORKER_URL=https://auth.lfkdsk.org/quick-copy-staging
VITE_DEFAULT_REPO=my-clips
```

A new origin also needs one line in the broker's `PROJECT_ORIGINS` map
(`lfkdsk/lfkdsk-auth` → `wrangler.toml`) — the allowlist there is what
stops a token being redirected to somewhere it should not go.

## Keyboard

| Key | |
| --- | --- |
| `n` | jump to the composer |
| `⌘`/`Ctrl` + `↵` | save |
| `⌘`/`Ctrl` + `V` | paste an image anywhere on the page |
| `/` | search |
| `Esc` | close the viewer or leave the search box |

Dropping an image anywhere on the window attaches it too.

## Limits

Images are capped at 20 MB client-side — the blobs API takes more, but
base64 in a JSON body is memory-hungry on both ends and anything past
that is a poor fit for a clipboard. The GitHub API allows 5,000 requests
an hour per user; a listing costs one request plus one per item not yet
in the local cache.
