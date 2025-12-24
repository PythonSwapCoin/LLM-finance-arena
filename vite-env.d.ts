/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_ENABLE_SNAPSHOT_TOOL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

