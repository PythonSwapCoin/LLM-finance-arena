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
VITE_API_BASE_URL=http://localhost:8080
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

# Optional: Preload historical data when starting realtime mode
REALTIME_PRELOAD_HISTORICAL=true
HISTORICAL_PRELOAD_SNAPSHOT_ID=historical-preload  # Default snapshot ID
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
# Optional: Set custom start date (YYYY-MM-DD, defaults to first week of 2025)
HISTORICAL_SIMULATION_START_DATE=2025-01-06
# Optional: Set custom end date (YYYY-MM-DD)
HISTORICAL_SIMULATION_END_DATE=

# Optional: Save snapshot for preloading in realtime mode (default: true)
SAVE_HISTORICAL_PRELOAD=true
HISTORICAL_PRELOAD_SNAPSHOT_ID=historical-preload  # Default snapshot ID

# Optional: Set maximum simulation days (counts trading days only, weekends skipped)
MAX_SIMULATION_DAYS=20
```

**What it does:**
- Fetches real market data for a historical date range (trading days only)
- Default: First week of 2025 (Jan 6-10, 2025) when no end date or max days are provided
- Simulates trading as if starting at the beginning of that range
- Uses actual historical prices from Yahoo Finance
- **IMPORTANT:** MAX_SIMULATION_DAYS counts trading days only (weekends are automatically skipped)
- If both HISTORICAL_SIMULATION_END_DATE and MAX_SIMULATION_DAYS are set, the shorter window is used

**Custom Date:**
- Set `HISTORICAL_SIMULATION_START_DATE=YYYY-MM-DD` to use a different start date
- Optionally set `HISTORICAL_SIMULATION_END_DATE=YYYY-MM-DD` to cap the range
- Dates are adjusted to the nearest trading day when they fall on weekends or holidays
- Example: `HISTORICAL_SIMULATION_START_DATE=2024-06-03` and `HISTORICAL_SIMULATION_END_DATE=2024-07-31`

## Historical Data Preload Feature

**Use Case:** Run historical simulation first, then switch to realtime mode with the historical data already loaded.

### How It Works

1. **Run Historical Mode First:**
   ```env
   MODE=historical
   HISTORICAL_SIMULATION_START_DATE=2025-11-10
   HISTORICAL_SIMULATION_END_DATE=2025-12-06
   SAVE_HISTORICAL_PRELOAD=true
   ```

   - The simulation will run for the configured historical range using real data
   - When complete, it automatically saves a snapshot for preloading
   - Snapshot is saved to `./data/snapshot_historical-preload.json` (or database)

2. **Switch to Realtime Mode with Preload:**
   ```env
   MODE=realtime
   REALTIME_PRELOAD_HISTORICAL=true  # ⚠️ REQUIRED to load historical data!
   HISTORICAL_PRELOAD_SNAPSHOT_ID=historical-preload
   ```

   **⚠️ IMPORTANT:** You MUST set `REALTIME_PRELOAD_HISTORICAL=true` for realtime mode to load the historical data. Without this, realtime mode will start fresh without any historical data.

   - Realtime mode loads the historical snapshot
   - Historical data is interpolated to match realtime intervals
   - Charts show combined historical + realtime data seamlessly
   - Weekends are automatically filtered out (no weekend data points in charts)

### Data Interpolation

The system handles different tick intervals automatically:

- **Historical Mode:** Typically uses 30-minute market intervals per tick
  - Configured via `SIM_MARKET_MINUTES_PER_TICK=30`

- **Realtime Mode:** Uses actual time intervals (e.g., 10 minutes)
  - Configured via `REALTIME_SIM_INTERVAL_MS=600000` (10 minutes)

When preloading, each historical data point is expanded to match the realtime interval:
- Example: 30-min historical tick → 3 data points at 10-min intervals (with constant values)

### Weekend and Gap Handling

**Weekend Filtering:**
- All weekend timestamps (Saturday and Sunday) are automatically filtered out
- No data points are created for weekends in the interpolation
- Charts will NOT show any weekend dates

**Time Gap Handling:**
If there's a time gap between historical end and realtime start:

- The system fills the gap with constant values (assumes prices stayed the same)
- Weekends are automatically skipped (no data points added for Sat/Sun)
- Trading day boundaries are properly maintained

### Example Workflow

```bash
# Step 1: Run historical simulation for a custom range
# Set MODE=historical, HISTORICAL_SIMULATION_START_DATE=2025-11-10, HISTORICAL_SIMULATION_END_DATE=2025-12-06
npm run dev  # Frontend
npm run dev  # Backend (in backend directory)

# Wait for historical simulation to complete (shows "Historical simulation complete")

# Step 2: Switch to realtime mode with preload
# Update .env: MODE=realtime, REALTIME_PRELOAD_HISTORICAL=true
# Restart backend server

# Result: Charts show historical range data + current realtime data
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `SAVE_HISTORICAL_PRELOAD` | `true` | Save snapshot when historical mode completes |
| `REALTIME_PRELOAD_HISTORICAL` | `false` | Load historical data when realtime mode starts |
| `HISTORICAL_PRELOAD_SNAPSHOT_ID` | `historical-preload` | Snapshot ID for preload data |
| `SIM_MARKET_MINUTES_PER_TICK` | `30` | Market minutes per tick in historical mode |
| `REALTIME_SIM_INTERVAL_MS` | `600000` | Tick interval in realtime mode (10 minutes) |

## Important Notes

- **API keys are server-side only** - Never put API keys in frontend `.env.local`
- **Only enable ONE mode at a time** in backend `.env`
- The backend console will show which mode is active when you start the server
- **After changing backend `.env`, you MUST restart the backend server**
- **After changing frontend `.env.local`, you MUST restart the frontend dev server**

## Example Configuration Files

### Frontend `.env.local`
```env
VITE_API_BASE_URL=http://localhost:8080
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

