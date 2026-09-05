// Every lfkdsk project shares one GitHub OAuth App and one broker
// Worker (see github.com/lfkdsk/lfkdsk-auth). The client_id is public
// by design — it travels in every authorize URL the browser builds —
// so it is checked in rather than injected at build time. Only the
// client_secret is private, and it never leaves the Worker.
export const OAUTH_CLIENT_ID =
  import.meta.env.VITE_OAUTH_CLIENT_ID || 'Ov23liCg29llKxJ7b0jv'

// The broker's per-project mount point. `${OAUTH_WORKER_URL}/callback`
// is the redirect_uri GitHub bounces back to; the Worker exchanges the
// code and 302s to this app with the token in the URL fragment.
export const OAUTH_WORKER_URL =
  import.meta.env.VITE_OAUTH_WORKER_URL || 'https://auth.lfkdsk.org/quick-copy'

// Where items land when the user has not picked a repo yet. Created on
// first save (private, auto-initialised) if it does not exist.
export const DEFAULT_REPO = import.meta.env.VITE_DEFAULT_REPO || 'quick-copy-data'

// Layout inside the storage repo. One JSON descriptor per item, with
// binaries beside it under a per-item directory:
//
//   items/20260905-084212-a1b2c3.json
//   assets/20260905-084212-a1b2c3/screenshot.png
//
// No index file: the listing comes from one recursive git-tree call,
// so two devices saving at the same time can never clobber each
// other's index.
export const ITEMS_DIR = 'items'
export const ASSETS_DIR = 'assets'

// GitHub's Contents/Blobs API accepts far more, but base64 in a JSON
// body is memory-hungry on both ends and anything past this is a poor
// fit for a clipboard. Enforced client-side with a friendly message.
export const MAX_ASSET_BYTES = 20 * 1024 * 1024
