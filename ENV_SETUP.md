# Environment Variables Setup Guide

## Quick Start

1. **Copy the example file:**
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env.local
   
   # Windows (Command Prompt) or Mac/Linux
   cp .env.example .env.local
   ```

2. **Edit `.env.local` and configure:**

## Required Configuration

### LLM Provider (Required)
```env
VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
```
Get your key from: https://openrouter.ai/keys

## Market Data Mode Selection

**Choose ONE mode by uncommenting the appropriate line:**

### Mode 1: Simulated Data (Default)
**Best for:** Testing and development
**API Keys:** None needed

```env
# Leave both variables commented/omitted
# VITE_USE_REAL_DATA=false
# VITE_USE_HISTORICAL_SIMULATION=false
```

### Mode 2: Real-Time Market Data
**Best for:** Live trading simulation
**API Keys:** Optional (Yahoo Finance works without keys)

```env
VITE_USE_REAL_DATA=true
# Optional API keys (Yahoo Finance is used by default, no key needed):
# VITE_ALPHA_VANTAGE_API_KEY=your_key_here
# VITE_POLYGON_API_KEY=your_key_here
```

**Data Sources (in order):**
1. Yahoo Finance (default, no API key needed - used first)
2. Alpha Vantage (if key provided, fallback)
3. Polygon.io (if key provided, fallback)

### Mode 3: Historical Simulation
**Best for:** Backtesting with real historical data
**API Keys:** None needed

```env
VITE_USE_HISTORICAL_SIMULATION=true
# Optional: Set custom start date (must be a Monday, defaults to first week of 2025)
# VITE_HISTORICAL_SIMULATION_START_DATE=2025-01-06
```

**What it does:**
- Fetches real market data for a specific week (Mon-Fri)
- Default: First week of 2025 (Jan 6-10, 2025)
- Simulates trading as if starting at the beginning of that week
- Uses actual historical prices from Yahoo Finance
- Automatically stops after 5 days (completes the full week)

**Custom Date:**
- Set `VITE_HISTORICAL_SIMULATION_START_DATE=YYYY-MM-DD` to use a different week
- The date will be adjusted to the nearest Monday
- Example: `VITE_HISTORICAL_SIMULATION_START_DATE=2024-06-03` (will use June 3-7, 2024)

## Important Notes

- **Only enable ONE mode at a time**
- If both `VITE_USE_REAL_DATA` and `VITE_USE_HISTORICAL_SIMULATION` are enabled, historical mode takes precedence
- The console will show which mode is active when you start the app
- **After changing `.env.local`, you MUST restart the dev server** (Vite reads env variables at startup)
- Check the browser console for environment variable detection logs to verify your settings

## Example `.env.local` Files

### Simulated Mode (Default)
```env
VITE_OPENROUTER_API_KEY=sk-or-v1-xxxxx
# No other variables needed
```

### Real-Time Mode
```env
VITE_OPENROUTER_API_KEY=sk-or-v1-xxxxx
VITE_USE_REAL_DATA=true
VITE_ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
```

### Historical Simulation Mode
```env
VITE_OPENROUTER_API_KEY=sk-or-v1-xxxxx
VITE_USE_HISTORICAL_SIMULATION=true
```

