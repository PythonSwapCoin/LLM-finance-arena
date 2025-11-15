/**
 * Get the API base URL based on environment
 * In production (Vercel), automatically uses Render backend
 * In development, uses environment variable or localhost fallback
 */
export function getApiBaseUrl(): string {
  // Check if we have an explicit environment variable
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
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

