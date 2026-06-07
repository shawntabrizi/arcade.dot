/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Set to "1" by the Playwright e2e build (item 15) to inject the in-memory
  // fake reads instead of the real chain reads. Unset in production.
  readonly VITE_ARCADE_FAKE_READS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
