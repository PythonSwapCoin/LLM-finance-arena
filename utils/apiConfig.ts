/**
 * Get the API base URL based on environment
 * In production (Vercel), automatically uses Render backend
 * In development, uses environment variable or localhost fallback
 */
export function getApiBaseUrl(): string {
  const normalizeApiBase = (raw: string): string => {
    const trimmed = raw.trim().replace(/\/+$/, '');
    return trimmed.replace(/\/api\/?$/, '');
  };

  // Check if we have an explicit environment variable (support legacy name)
  if (import.meta.env.VITE_API_BASE_URL) {
    return normalizeApiBase(import.meta.env.VITE_API_BASE_URL);
  }
  if (import.meta.env.VITE_API_BASE) {
    return normalizeApiBase(import.meta.env.VITE_API_BASE);
  }

  // Check if we're running on Vercel (production)
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname.includes('vercel.app')) {
      // Use Render backend URL for Vercel deployments
      return 'https://llm-finance-arena.onrender.com';
    }
  }

  // Development fallback
  return 'http://localhost:8080';
}

