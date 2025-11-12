/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_OPENROUTER_API_KEY?: string;
  readonly VITE_USE_REAL_DATA?: string;
  readonly VITE_USE_HISTORICAL_SIMULATION?: string;
  readonly VITE_HISTORICAL_SIMULATION_START_DATE?: string;
  readonly VITE_ALPHA_VANTAGE_API_KEY?: string;
  readonly VITE_POLYGON_API_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

