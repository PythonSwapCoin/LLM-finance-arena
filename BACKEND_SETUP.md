# Backend Setup Guide

This guide explains how to set up and run the LLM Finance Arena backend.

## Overview

The backend is a single Node.js process that:
- Runs the simulation loop 24/7 using `setInterval`
- Persists state to JSON files or Postgres (configurable)
- Exposes a REST API for the frontend to poll
- Handles all LLM calls and market data fetching server-side

## Prerequisites

- Node.js 18+ and npm
- TypeScript
- API keys (OpenRouter, optionally Alpha Vantage and Polygon)

## Installation

1. Navigate to the backend directory:
```bash
cd backend
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file (copy from `.env.example` — the file is git-ignored so secrets stay private):
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app

# Simulation Mode: simulated | realtime | historical | hybrid
MODE=simulated

# Historical Simulation (only used if MODE=historical or MODE=hybrid)
HISTORICAL_SIMULATION_START_DATE=2025-01-06

# Optional: Maximum number of simulation days before auto-stop (works for all modes)
# If not set, simulation runs indefinitely until manually stopped
# MAX_SIMULATION_DAYS=5

# API Keys (server-side only)
OPENROUTER_API_KEY=your_openrouter_api_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here
POLYGON_API_KEY=your_polygon_key_here

# LLM Control
ENABLE_LLM=true  # Set to 'false' to use synthetic/simulated trades instead of calling LLM APIs (useful for testing without API costs)
USE_UNIFIED_MODEL=false  # Set to 'true' to make all agents use the same model (useful for testing with cheaper models)
UNIFIED_MODEL=google/gemini-2.5-flash-lite  # Model to use when USE_UNIFIED_MODEL=true (default: google/gemini-2.5-flash-lite)
SIMPLE_BOT_PROMPTS=false  # Set to 'true' to use simplified JSON prompts with only ticker and price (reduces token usage significantly)

# Simulation Intervals (in milliseconds)
# For simulated/historical mode:
SIM_INTERVAL_MS=30000  # Price tick interval (30 seconds)
TRADE_INTERVAL_MS=7200000  # Trade window interval (2 hours)
SIM_MARKET_MINUTES_PER_TICK=30  # Minutes of market time that pass per price tick (default: 30 minutes)

# For real-time mode (overrides above if MODE=realtime):
REALTIME_SIM_INTERVAL_MS=600000  # Price tick interval (10 minutes)
REALTIME_TRADE_INTERVAL_MS=1800000  # Trade window interval (30 minutes)

# Trading costs (defaults: 5 bps of notional with a $0.25 minimum)
TRADING_FEE_BPS=5
MIN_TRADE_FEE=0.25

# Optional LLM pacing controls
# Set LLM_REQUEST_SPACING_MS to a positive value to stagger requests sequentially
# or enable automatic spacing derived from REALTIME_SIM_INTERVAL_MS by setting LLM_AUTO_SPACING=true
LLM_REQUEST_SPACING_MS=-1
LLM_MIN_REQUEST_SPACING_MS=0
LLM_AUTO_SPACING=false
LLM_MAX_CONCURRENT_REQUESTS=0

# Persistence
# Choose between file-based JSON snapshots or Postgres
PERSISTENCE_DRIVER=file
# Point this to a persistent volume or mounted path so data survives restarts
PERSIST_PATH=/var/lib/llm-finance-arena/snapshot.json
SNAPSHOT_AUTOSAVE_INTERVAL_MS=900000

# Postgres persistence (optional)
# DATABASE_URL=postgres://user:password@hostname:5432/database
# POSTGRES_SSL=true
# POSTGRES_NAMESPACE=default
# POSTGRES_SNAPSHOT_ID=current

# Trading Universe Configuration
# Control how many S&P 500 companies are included in the simulation
# This limits both: (1) the number of companies we fetch data for from yfinance, and (2) the number of companies sent to agents in prompts
# Default: uses all available tickers (from S_P500_TICKERS or DEFAULT_TICKERS)
# Example: ARENA_TICKER_COUNT=20  # Only use the first 20 companies
ARENA_TICKER_COUNT=  # Optional: limit number of tickers (reduces API calls and prompt size)

# Custom Ticker List (optional)
# If you want to use a custom list of tickers instead of the default S&P 500 list:
# S_P500_TICKERS=AAPL,MSFT,GOOGL,AMZN,TSLA  # Comma-separated list of ticker symbols

# Simulation Control
RESET_SIMULATION=false  # Set to 'true' to reset simulation on startup (deletes snapshot and starts from day 0)

# Worker Heartbeat (optional)
HEARTBEAT_INTERVAL_MS=300000  # Heartbeat log interval in milliseconds (default: 300000 = 5 minutes)

# Logging
LOG_LEVEL=INFO
```

## Running

### Development Mode

```bash
npm run dev
```

This uses `tsx watch` to automatically restart on file changes.

### Production Mode

1. Build the TypeScript code:
```bash
npm run build
```

2. Start the server:
```bash
npm start
```

## API Endpoints

### Health Check
```
GET /healthz
```
Returns: `{ status: "ok", timestamp: "..." }`

### Simulation State
```
GET /api/simulation/state
```
Returns the current simulation snapshot and loading state.

### Agents
```
GET /api/agents
```
Returns all agent data.

### Market Data
```
GET /api/market-data
```
Returns current market prices and metadata.

### Benchmarks
```
GET /api/benchmarks
```
Returns benchmark performance data.

### Simulation History
```
GET /api/simulation/history
```
Returns historical performance timeseries.

### Start Simulation
```
POST /api/simulation/start
```
Starts the simulation scheduler (idempotent).

### Stop Simulation
```
POST /api/simulation/stop
```
Stops the simulation scheduler.

### Reset simulation
```
POST /api/simulation/reset
```
Resets the simulation to day 0 (deletes snapshot and restarts from scratch).

### Logs
```
GET /api/logs?level=INFO&limit=200
```
Returns log entries. Query parameters:
- `level`: Filter by log level (INFO, WARNING, ERROR, SUCCESS)
- `limit`: Maximum number of log entries to return

## Environment Variables

### Required
- `OPENROUTER_API_KEY`: Your OpenRouter API key for LLM calls (only required if `ENABLE_LLM=true`)

### Optional
- `ENABLE_LLM`: Enable or disable LLM API calls. When set to `false`, the system generates synthetic/simulated trades instead of calling LLM APIs. This is useful for testing without incurring API costs. Default: `true`
- `USE_UNIFIED_MODEL`: When set to `true`, all agents will use the same model specified in `UNIFIED_MODEL` for API calls, while the frontend still displays their original model names. Useful for testing with cheaper models. Default: `false`
- `UNIFIED_MODEL`: The model identifier to use when `USE_UNIFIED_MODEL=true`. Default: `google/gemini-2.5-flash-lite`
- `SIMPLE_BOT_PROMPTS`: When set to `true`, uses simplified JSON-formatted prompts that only include ticker and price (no P/E, market cap, sector, etc.). This significantly reduces token usage and can lower API costs. Default: `false`
- `BACKEND_PORT`: Server port (default: 8080)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `MODE`: Simulation mode - `simulated`, `realtime`, `historical`, or `hybrid` (default: `simulated`)
- `HISTORICAL_SIMULATION_START_DATE`: Start date for historical or hybrid mode (YYYY-MM-DD)
- `MAX_SIMULATION_DAYS`: Maximum number of simulation days before auto-stop (works for all modes). If not set or set to a non-numeric value, the simulation runs indefinitely until manually stopped. Default: none (runs forever)
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key (fallback data source)
- `POLYGON_API_KEY`: Polygon.io API key (fallback data source)
- `SIM_INTERVAL_MS`: Price tick interval in milliseconds (default: 30000 = 30 seconds)
- `TRADE_INTERVAL_MS`: Trade window interval in milliseconds (default: 7200000 = 2 hours)
- `TRADING_FEE_BPS`: Per-trade percentage fee in basis points (default: 5 bps / 0.05%)
- `MIN_TRADE_FEE`: Minimum per-trade fee in dollars (default: 0.25)
- `PERSIST_PATH`: Path to snapshot JSON file (default: `./data/snapshot.json` – override to point at persistent storage in prod)
- `SNAPSHOT_AUTOSAVE_INTERVAL_MS`: Additional autosave interval in milliseconds (default: 900000 = 15 minutes). Set to `0` or negative to disable.
- `RESET_SIMULATION`: Set to `true` to reset simulation on startup (deletes snapshot, starts from day 0). Default: `false` (continues from saved state)
- `LOG_LEVEL`: Logging verbosity (default: INFO)
- `LLM_REQUEST_SPACING_MS`: Force sequential LLM calls with a fixed delay between agents (milliseconds, default: disabled)
- `LLM_MIN_REQUEST_SPACING_MS`: Floor applied when auto spacing is enabled (default: 0)
- `LLM_AUTO_SPACING`: When `true`, derives a pacing delay from the active simulation interval (default: `false`)
- `LLM_MAX_CONCURRENT_REQUESTS`: Caps simultaneous LLM calls when spacing is disabled (default: unlimited)

## Simulation Modes

### Simulated Mode
- Uses randomly generated market data
- No API keys required
- Good for testing
- Runs indefinitely until manually stopped (or until `MAX_SIMULATION_DAYS` if configured)

### Real-time Mode
- Fetches live market data from Yahoo Finance (primary), Alpha Vantage, or Polygon
- Requires API keys for fallback sources
- Respects market hours
- Runs indefinitely until manually stopped (or until `MAX_SIMULATION_DAYS` if configured)

### Historical Mode
- Uses real historical data from a specified week (Mon-Fri)
- Runs at accelerated speed (configurable via `SIM_MARKET_MINUTES_PER_TICK`)
- Can be configured to auto-stop after a set number of days via `MAX_SIMULATION_DAYS`, or run indefinitely if not set
- Requires Yahoo Finance access (no API key needed)

### Hybrid Mode
- **NEW**: Combines historical and real-time modes
- Starts at a specified historical date (`HISTORICAL_SIMULATION_START_DATE`)
- Runs in accelerated mode (like historical) until it catches up to current time
- Automatically transitions to real-time mode when caught up
- After transition, uses real-time intervals and market hours
- Perfect for backtesting from a historical date and then continuing live
- Runs indefinitely until manually stopped (or until `MAX_SIMULATION_DAYS` if configured)

## Trading Costs

The engine now charges transaction costs on every executed order to better approximate brokerage friction:

- **Default**: 5 basis points (0.05%) of trade notional with a **$0.25 minimum** per execution
- **Buys**: Cash must cover both the notional and the fee; orders that exceed available cash after fees are rejected
- **Sells**: Proceeds are reduced by the fee before being added to cash
- **Visibility**: Fees are logged, included in the trade history payload, and exported alongside trades

Override the defaults with `TRADING_FEE_BPS` and `MIN_TRADE_FEE` in `.env` if your deployment uses different assumptions.

## LLM Control and Testing

### Disabling LLM Calls for Testing

Set `ENABLE_LLM=false` in your `.env` file to disable actual LLM API calls. When disabled, the system generates synthetic trades based on:
- Portfolio state (cash levels, existing positions)
- Market data (momentum, valuations)
- Trading rules (position limits, fees)

This allows you to test the simulation engine, UI, and trading logic without incurring API costs. Synthetic trades include realistic fair value estimates, top/bottom of box scenarios, and rationales.

**Note**: When `ENABLE_LLM=false`, the `OPENROUTER_API_KEY` is not required.

## LLM Request Pacing

Heavy real-time trading can burst API calls at the start of each tick. Use the pacing controls to smooth that demand:

- Set `LLM_REQUEST_SPACING_MS` to stagger agent decisions sequentially with a fixed delay
- Alternatively, flip `LLM_AUTO_SPACING=true` to derive a delay from the active simulation interval (e.g. `REALTIME_SIM_INTERVAL_MS / agent_count`)
- `LLM_MIN_REQUEST_SPACING_MS` enforces a floor when auto spacing is enabled
- `LLM_MAX_CONCURRENT_REQUESTS` caps in-flight decisions when spacing is disabled but you still want to throttle concurrency

These options make it easier to stay within OpenRouter ticket limits or rate limits without pausing the simulation.

## Persistence

The backend supports two persistence drivers controlled by `PERSISTENCE_DRIVER`:

- `file` (default): Persists snapshots to a JSON document on disk. Point `PERSIST_PATH` at a mounted volume in production.
- `postgres`: Stores the latest snapshot to Render Postgres (or any compatible Postgres instance). Historical writes have been disabled to reduce database churn, but the legacy table remains available if you previously used it.

Regardless of driver, the engine flushes state to storage after every price tick, trade window, day advancement, and the autosave interval (`SNAPSHOT_AUTOSAVE_INTERVAL_MS`, default 15 minutes).

When Postgres is enabled, the service maintains the `simulation_snapshots` table, keeping the most recent snapshot per namespace so the engine can resume instantly after restarts. The `simulation_snapshot_history` table is no longer written to by default, but existing deployments can continue to query any data already stored there.

Startup behavior:

- **Normal boot**: Load the last saved snapshot and continue from where the engine left off.
- **`RESET_SIMULATION=true`**: Clear the configured persistence target (file removal or Postgres truncate) and start from day 0.
- **No snapshot available**: Create a fresh simulation and immediately persist it.

You can also reset the simulation via API: `POST /api/simulation/reset`. The endpoint now clears the active persistence target and restarts the scheduler automatically.

## Deployment

### Render / Railway

1. Set environment variables in your deployment platform
2. Set build command: `cd backend && npm install && npm run build`
3. Set start command: `cd backend && npm start`
4. Configure persistence: either mount a volume and leave `PERSISTENCE_DRIVER=file`, or set `PERSISTENCE_DRIVER=postgres` with the Render Postgres connection URL (see [Postgres Setup](./POSTGRES_SETUP.md))

### Docker (Example)

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY backend/package*.json ./backend/
RUN cd backend && npm install
COPY backend ./backend
WORKDIR /app/backend
RUN npm run build
EXPOSE 8080
CMD ["npm", "start"]
```

## Troubleshooting

### Port Already in Use
Change `BACKEND_PORT` in `.env` or kill the process using port 8080.

### CORS Errors
Add your frontend origin to `ALLOWED_ORIGINS` in `.env`.

### API Key Errors
Ensure `OPENROUTER_API_KEY` is set correctly. Check logs for specific error messages.

### Persistence Issues
- **File driver**: Check that the directory specified in `PERSIST_PATH` is writable. The backend will create it if it doesn't exist.
- **Postgres driver**: Verify `DATABASE_URL`/`POSTGRES_URL` and SSL settings. The backend logs any connection or migration errors during startup.

## Architecture Notes

- **Single Process**: All simulation logic runs in one Node.js process
- **No Redis/BullMQ**: Uses in-memory state with pluggable persistence (JSON file or Postgres)
- **Pure Engine**: `engine.ts` contains pure functions (no I/O)
- **Scheduler**: `scheduler.ts` owns the `setInterval` timers
- **State Management**: `state.ts` manages the in-memory snapshot
- **Service Layer**: Services handle I/O (LLM, market data, persistence)

## Phase 2 Extensions

The codebase is structured to support:
- Redis/BullMQ for distributed processing
- WebSocket support for real-time updates
- Leaderboards and analytics

These can be added without changing the API surface.

