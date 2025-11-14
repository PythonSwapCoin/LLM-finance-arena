# Environment Variables Setup Guide

## Architecture Change

**Important**: With the backend architecture, API keys are now **server-side only** and should never be exposed to the browser.

## Frontend Setup (`.env.local`)

1. **Copy the example file:**
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env.local
   
   # Windows (Command Prompt) or Mac/Linux
   cp .env.example .env.local
   ```

2. **Edit `.env.local` and configure:**

### Required Configuration

```env
# Backend API URL
VITE_API_BASE=http://localhost:8080/api
```

**Note**: API keys are no longer needed in the frontend. They are configured server-side only.

## Backend Setup (`.env` in `/backend`)

See `BACKEND_SETUP.md` for complete backend configuration.

### Required Configuration

### LLM Provider (Required if ENABLE_LLM=true)
```env
OPENROUTER_API_KEY=your_openrouter_api_key_here
ENABLE_LLM=true  # Set to 'false' to use synthetic trades instead of LLM API calls
```
Get your key from: https://openrouter.ai/keys

**Important**: This key is server-side only and never sent to the browser.

**Testing Mode**: Set `ENABLE_LLM=false` to disable LLM API calls and use synthetic trades instead. This allows you to test the program without API costs. When disabled, `OPENROUTER_API_KEY` is not required.

## Backend Market Data Mode Selection

**Configure in backend `.env` file:**

### Mode 1: Simulated Data (Default)
**Best for:** Testing and development
**API Keys:** None needed

```env
MODE=simulated
```

### Mode 2: Real-Time Market Data
**Best for:** Live trading simulation
**API Keys:** Optional (Yahoo Finance works without keys)

```env
MODE=realtime
# Optional API keys (Yahoo Finance is used by default, no key needed):
ALPHA_VANTAGE_API_KEY=your_key_here
POLYGON_API_KEY=your_key_here

# Optional: Use 30-minute delayed data to avoid rate limits (recommended)
USE_DELAYED_DATA=true
DATA_DELAY_MINUTES=30
```

**Data Sources (in order):**
1. Yahoo Finance (default, no API key needed - used first)
2. Alpha Vantage (if key provided, fallback)
3. Polygon.io (if key provided, fallback)

**Delayed Data Mode (Recommended):**
- Set `USE_DELAYED_DATA=true` to use 30-minute delayed data
- Uses historical endpoints which are less rate-limited
- Data will be 30 minutes old (or whatever you set in `DATA_DELAY_MINUTES`)
- Helps avoid Yahoo Finance rate limits
- Set `DATA_DELAY_MINUTES=30` (or 15, 20, etc.) to customize the delay

### Mode 3: Historical Simulation
**Best for:** Backtesting with real historical data
**API Keys:** None needed

```env
MODE=historical
# Optional: Set custom start date (must be a Monday, defaults to first week of 2025)
HISTORICAL_SIMULATION_START_DATE=2025-01-06
```

**What it does:**
- Fetches real market data for a specific week (Mon-Fri)
- Default: First week of 2025 (Jan 6-10, 2025)
- Simulates trading as if starting at the beginning of that week
- Uses actual historical prices from Yahoo Finance
- Automatically stops after 5 days (completes the full week)

**Custom Date:**
- Set `HISTORICAL_SIMULATION_START_DATE=YYYY-MM-DD` to use a different week
- The date will be adjusted to the nearest Monday
- Example: `HISTORICAL_SIMULATION_START_DATE=2024-06-03` (will use June 3-7, 2024)

## Important Notes

- **API keys are server-side only** - Never put API keys in frontend `.env.local`
- **Only enable ONE mode at a time** in backend `.env`
- The backend console will show which mode is active when you start the server
- **After changing backend `.env`, you MUST restart the backend server**
- **After changing frontend `.env.local`, you MUST restart the frontend dev server**

## Example Configuration Files

### Frontend `.env.local`
```env
VITE_API_BASE=http://localhost:8080/api
```

### Backend `.env` (Simulated Mode)
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
MODE=simulated
OPENROUTER_API_KEY=sk-or-v1-xxxxx
```

### Backend `.env` (Real-Time Mode - with delayed data)
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
MODE=realtime
OPENROUTER_API_KEY=sk-or-v1-xxxxx
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key

# Use 30-minute delayed data to avoid rate limits (recommended)
USE_DELAYED_DATA=true
DATA_DELAY_MINUTES=30
```

### Backend `.env` (Historical Mode)
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
MODE=historical
OPENROUTER_API_KEY=sk-or-v1-xxxxx
HISTORICAL_SIMULATION_START_DATE=2025-01-06
```

### Persistence Options

- **File (default)**: Leave `PERSISTENCE_DRIVER=file` and ensure `PERSIST_PATH` points at a writable location or mounted volume.
- **Postgres**: Set `PERSISTENCE_DRIVER=postgres`, provide `DATABASE_URL` (or `POSTGRES_URL`), and optionally override `POSTGRES_SSL`, `POSTGRES_NAMESPACE`, or `POSTGRES_SNAPSHOT_ID`. The backend will create the required tables automatically.

## Security Notes

- ✅ API keys in backend `.env` - **Secure** (never sent to browser)
- ❌ API keys in frontend `.env.local` - **Insecure** (exposed in client bundle)
- Always use environment variables for sensitive data
- Never commit `.env` or `.env.local` files to version control

