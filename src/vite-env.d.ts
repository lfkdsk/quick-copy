/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OAUTH_CLIENT_ID?: string
  readonly VITE_OAUTH_WORKER_URL?: string
  readonly VITE_DEFAULT_REPO?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
