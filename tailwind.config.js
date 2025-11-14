/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        'arena-bg': '#0D0D0D',
        'arena-surface': '#1A1A1A',
        'arena-border': '#262626',
        'arena-text-primary': '#F5F5F5',
        'arena-text-secondary': '#A3A3A3',
        'arena-text-tertiary': '#737373',
        'brand-positive': '#22C55E',
        'brand-negative': '#EF4444',
      },
    },
  },
  plugins: [],
};

