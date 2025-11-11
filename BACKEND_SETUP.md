# Backend Setup Guide

This guide explains how to set up and run the LLM Finance Arena backend.

## Overview

The backend is a single Node.js process that:
- Runs the simulation loop 24/7 using `setInterval`
- Persists state to JSON files (with Postgres adapter interface for Phase 2)
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

3. Create a `.env` file (copy from `.env.example`):
```bash
cp .env.example .env
```

4. Edit `.env` with your configuration:
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app

# Simulation Mode: simulated | realtime | historical
MODE=simulated

# Historical Simulation (only used if MODE=historical)
HISTORICAL_SIMULATION_START_DATE=2025-01-06

# API Keys (server-side only)
OPENROUTER_API_KEY=your_openrouter_api_key_here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here
POLYGON_API_KEY=your_polygon_key_here

# Simulation Intervals (in milliseconds)
# For simulated/historical mode:
SIM_INTERVAL_MS=30000  # Price tick interval (30 seconds)
TRADE_INTERVAL_MS=7200000  # Trade window interval (2 hours)

# For real-time mode (overrides above if MODE=realtime):
REALTIME_SIM_INTERVAL_MS=600000  # Price tick interval (10 minutes)
REALTIME_TRADE_INTERVAL_MS=1800000  # Trade window interval (30 minutes)

# Persistence
PERSIST_PATH=./data/snapshot.json

# Simulation Control
RESET_SIMULATION=false  # Set to 'true' to reset simulation on startup (deletes snapshot and starts from day 0)

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
- `OPENROUTER_API_KEY`: Your OpenRouter API key for LLM calls

### Optional
- `BACKEND_PORT`: Server port (default: 8080)
- `ALLOWED_ORIGINS`: Comma-separated list of allowed CORS origins
- `MODE`: Simulation mode - `simulated`, `realtime`, or `historical` (default: `simulated`)
- `HISTORICAL_SIMULATION_START_DATE`: Start date for historical mode (YYYY-MM-DD)
- `ALPHA_VANTAGE_API_KEY`: Alpha Vantage API key (fallback data source)
- `POLYGON_API_KEY`: Polygon.io API key (fallback data source)
- `SIM_INTERVAL_MS`: Price tick interval in milliseconds (default: 30000 = 30 seconds)
- `TRADE_INTERVAL_MS`: Trade window interval in milliseconds (default: 7200000 = 2 hours)
- `PERSIST_PATH`: Path to snapshot JSON file (default: `./data/snapshot.json`)
- `RESET_SIMULATION`: Set to `true` to reset simulation on startup (deletes snapshot, starts from day 0). Default: `false` (continues from saved state)
- `LOG_LEVEL`: Logging verbosity (default: INFO)

## Simulation Modes

### Simulated Mode
- Uses randomly generated market data
- No API keys required
- Good for testing

### Real-time Mode
- Fetches live market data from Yahoo Finance (primary), Alpha Vantage, or Polygon
- Requires API keys for fallback sources
- Respects market hours

### Historical Mode
- Uses real historical data from a specified week (Mon-Fri)
- Automatically stops after 5 trading days
- Requires Yahoo Finance access (no API key needed)

## Persistence

The backend automatically persists the simulation state to a JSON file after each:
- Price tick
- Trade window execution
- Day advancement

On startup, the backend:
- **By default**: Loads the last saved snapshot and continues from where it left off
- **If `RESET_SIMULATION=true`**: Deletes the snapshot and starts fresh from day 0
- **If no snapshot exists**: Initializes fresh simulation

You can also reset the simulation via API: `POST /api/simulation/reset`

## Deployment

### Render / Railway

1. Set environment variables in your deployment platform
2. Set build command: `cd backend && npm install && npm run build`
3. Set start command: `cd backend && npm start`
4. Ensure `PERSIST_PATH` points to a persistent volume (or use Postgres adapter in Phase 2)

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
Check that the directory specified in `PERSIST_PATH` is writable. The backend will create it if it doesn't exist.

## Architecture Notes

- **Single Process**: All simulation logic runs in one Node.js process
- **No Redis/BullMQ**: Uses in-memory state with JSON file persistence
- **Pure Engine**: `engine.ts` contains pure functions (no I/O)
- **Scheduler**: `scheduler.ts` owns the `setInterval` timers
- **State Management**: `state.ts` manages the in-memory snapshot
- **Service Layer**: Services handle I/O (LLM, market data, persistence)

## Phase 2 Extensions

The codebase is structured to support:
- Postgres persistence (adapter interface already defined)
- Redis/BullMQ for distributed processing
- WebSocket support for real-time updates
- Leaderboards and analytics

These can be added without changing the API surface.

