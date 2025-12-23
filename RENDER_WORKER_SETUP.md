# Background Worker Setup Guide

This guide explains how to set up the background worker both **locally** and on **Render** to keep your simulation running 24/7, even when no one visits the frontend.

## Overview

The background worker runs the simulation scheduler independently from the web server. This ensures:
- ✅ Backend keeps running even without visitors
- ✅ Timer continues accurately (doesn't reset on page refresh)
- ✅ Better rate limiting for yfinance calls
- ✅ More reliable simulation execution

## Architecture

- **Web Service**: Handles API requests from frontend
- **Background Worker**: Runs simulation scheduler continuously (optional for local dev, required for production)

Both services share the same codebase but run different entry points.

---

## Part 1: Local Development Setup

### Option A: Simple Setup (2 Terminals) - Recommended

The web server runs the scheduler by default, so you don't need a separate worker for local development.

**Terminal 1 - Backend:**
```bash
cd backend
npm install  # if you haven't already
npm run dev  # runs web server + scheduler
```

**Terminal 2 - Frontend:**
```bash
# In root directory
npm run dev  # runs frontend on localhost:3000
```

✅ **This works exactly as before** - no changes needed!

---

### Option B: Full Setup (3 Terminals) - For Testing Worker

If you want to test the worker separation locally (like production):

**Terminal 1 - Backend Web Server:**
```bash
cd backend
npm run build  # build first
npm start      # runs web server only
```

**Terminal 2 - Worker:**
```bash
cd backend
npm run worker:dev  # runs worker with scheduler
```

**Terminal 3 - Frontend:**
```bash
# In root directory
npm run dev
```

**Note:** For Option B, you can optionally set `DISABLE_SCHEDULER=true` in your backend `.env` to prevent the web server from also running the scheduler. This isn't necessary unless you're specifically testing worker separation.

---

## Part 2: Environment Variables

### Backend `.env` File (Local & Render)

Create or update `backend/.env` with these variables:

```env
# Server Configuration
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000,https://your-frontend.vercel.app

# Simulation Mode: simulated | realtime | historical
MODE=realtime

# Historical Simulation (only used if MODE=historical)
HISTORICAL_SIMULATION_START_DATE=2025-01-06
HISTORICAL_SIMULATION_END_DATE=

# API Keys
OPENROUTER_API_KEY=sk-or-v1-your-key-here
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here  # Optional fallback
POLYGON_API_KEY=your_polygon_key_here  # Optional fallback

# LLM Control
ENABLE_LLM=true
USE_UNIFIED_MODEL=false
UNIFIED_MODEL=google/gemini-2.5-flash-lite

# Simulation Intervals (in milliseconds)
# For simulated/historical mode:
SIM_INTERVAL_MS=30000  # Price tick interval (30 seconds)
TRADE_INTERVAL_MS=7200000  # Trade window interval (2 hours)
SIM_MARKET_MINUTES_PER_TICK=30

# For real-time mode (overrides above if MODE=realtime):
REALTIME_SIM_INTERVAL_MS=600000  # Price tick interval (10 minutes)
REALTIME_TRADE_INTERVAL_MS=1800000  # Trade window interval (30 minutes)

# Trading Costs
TRADING_FEE_BPS=5
MIN_TRADE_FEE=0.25

# LLM Pacing Controls
LLM_REQUEST_SPACING_MS=-1
LLM_MIN_REQUEST_SPACING_MS=0
LLM_AUTO_SPACING=false
LLM_MAX_CONCURRENT_REQUESTS=0

# Persistence
PERSISTENCE_DRIVER=file
PERSIST_PATH=./data/snapshot.json  # Local: relative path
# PERSIST_PATH=/var/lib/llm-finance-arena/snapshot.json  # Render: absolute path
SNAPSHOT_AUTOSAVE_INTERVAL_MS=900000

# Postgres persistence (optional)
# DATABASE_URL=postgres://user:password@host:5432/dbname
# POSTGRES_SSL=true
# POSTGRES_NAMESPACE=default
# POSTGRES_SNAPSHOT_ID=current

# Simulation Control
RESET_SIMULATION=false

# Worker Heartbeat (optional)
HEARTBEAT_INTERVAL_MS=300000  # Heartbeat log interval in milliseconds (default: 300000 = 5 minutes)

# Worker Control (optional - for testing worker separation)
DISABLE_SCHEDULER=false  # Set to 'true' to disable scheduler in web server

# Market Data Rate Limiting
USE_DELAYED_DATA=false  # Set to 'true' to use delayed data (30 min delay)
DATA_DELAY_MINUTES=30
PREFETCH_GUARD_MS=1000
PREFETCH_BATCH_SIZE=25
REALTIME_FETCH_GUARD_MS=5000
REALTIME_FETCH_BATCH_SIZE=8
REALTIME_FETCH_MIN_PAUSE_MS=150

# Logging
LOG_LEVEL=INFO
```

### New Environment Variables Explained

- **`DISABLE_SCHEDULER`**: Set to `true` if you want the web server to NOT run the scheduler (useful when using a separate worker). Default: `false`
- **`USE_DELAYED_DATA`**: Use delayed market data (30 min old) to avoid rate limits. Default: `false`
- **`DATA_DELAY_MINUTES`**: Minutes of delay when using delayed data. Default: `30`
- **`PREFETCH_BATCH_SIZE`**: Number of tickers to fetch in parallel. Default: `25`
- **`REALTIME_FETCH_BATCH_SIZE`**: Batch size for real-time fetches. Default: `8`
- **`REALTIME_FETCH_MIN_PAUSE_MS`**: Minimum pause between batches. Default: `150`

---

## Part 3: Render Production Setup

### Step 1: Build the Worker

The worker script is already created at `backend/src/worker.ts`. Make sure it's built:

```bash
cd backend
npm run build
```

This creates `backend/dist/worker.js` which the worker will run.

---

### Step 2: Update Your Web Service (Optional)

If you want the web service to NOT run the scheduler (since the worker handles it):

1. **Add environment variable** in your Render web service:
   ```
   DISABLE_SCHEDULER=true
   ```

2. **Update `backend/src/server.ts`** to check this variable:
   ```typescript
   if (process.env.DISABLE_SCHEDULER !== 'true') {
     await startMultiSimScheduler();
     initializeTimer();
   }
   ```

   **Note**: This is optional. Having both run the scheduler won't cause issues (the scheduler has guards against multiple instances), but it's cleaner to have only the worker run it.

---

### Step 3: Create Background Worker on Render

1. **Go to Render Dashboard** → Your Project → **New Background Worker**

2. **Configure the Background Worker:**

   - **Name**: `llm-finance-arena-worker` (or your preferred name)
   - **Project**: Select your existing project
   - **Environment**: `Production`
   - **Language**: `Node` ⚠️ **NOT Python** - your backend is Node.js/TypeScript
   - **Branch**: `main` (or your deployment branch)
   - **Root Directory**: Leave empty (or set to `backend` if your repo structure requires it)
   - **Build Command**: `cd backend && npm install && npm run build`
   - **Start Command**: `cd backend && npm run worker`
   - **Instance Type**: Choose based on your needs:
     - **Starter ($7/month)**: 512 MB RAM, 0.5 CPU - Good for testing
     - **Standard ($25/month)**: 2 GB RAM, 1 CPU - **Recommended for production**
     - **Pro ($85/month)**: 4 GB RAM, 2 CPU - For heavy workloads

3. **Environment Variables**: Add these environment variables (same as your web service, but worker doesn't need `BACKEND_PORT` or `ALLOWED_ORIGINS`):

   ```env
   # Simulation Mode
   MODE=realtime
   
   # API Keys
   OPENROUTER_API_KEY=sk-or-v1-your-key-here
   ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key_here
   POLYGON_API_KEY=your_polygon_key_here
   
   # LLM Control
   ENABLE_LLM=true
   USE_UNIFIED_MODEL=false
   UNIFIED_MODEL=google/gemini-2.5-flash-lite
   
   # Real-time Intervals
   REALTIME_SIM_INTERVAL_MS=600000
   REALTIME_TRADE_INTERVAL_MS=1800000
   
   # Persistence
   PERSISTENCE_DRIVER=file
   PERSIST_PATH=/var/lib/llm-finance-arena/snapshot.json
   SNAPSHOT_AUTOSAVE_INTERVAL_MS=900000
   
   # Market Data Rate Limiting
   USE_DELAYED_DATA=false
   DATA_DELAY_MINUTES=30
   PREFETCH_BATCH_SIZE=25
   REALTIME_FETCH_BATCH_SIZE=8
   REALTIME_FETCH_MIN_PAUSE_MS=150
   
   # Logging
   LOG_LEVEL=INFO
   ```

   **Important**: 
   - The worker doesn't need `BACKEND_PORT` or `ALLOWED_ORIGINS` since it doesn't run a web server
   - Make sure `PERSIST_PATH` points to a persistent volume path on Render
   - Use the same `PERSIST_PATH` as your web service if they share state

4. **Click "Create Background Worker"**

---

### Step 4: Verify Worker is Running

1. **Check the worker logs** in Render dashboard
2. **You should see messages like:**
   ```
   Background worker starting
   Initializing multi-simulation framework
   All simulations initialized
   Multi-simulation scheduler started
   Background worker running
   Worker heartbeat
   ```

3. **The worker will log a heartbeat every 5 minutes** to show it's alive

---

### Step 5: Test Timer Accuracy

1. Visit your frontend
2. Check the chat countdown timer
3. Refresh the page (Ctrl+F5)
4. **The timer should NOT reset** - it should continue from where it was

The timer now uses server-side tracking via the `/api/timer` endpoint, so it persists across page refreshes.

---

## Troubleshooting

### Worker Not Starting

- **Check build logs**: Ensure `npm run build` completes successfully
- **Check start command**: Should be `cd backend && npm run worker`
- **Check environment variables**: Ensure all required vars are set
- **Check logs**: Worker logs errors before crashing

### Timer Still Resets on Refresh

- **Verify the worker is running** (check logs)
- **Check browser console** for API errors
- **Verify `/api/timer` endpoint** returns data:
  ```bash
  curl https://your-backend.onrender.com/api/timer
  ```
- **Check web service**: Make sure web service is also running (timer endpoint is on web service, not worker)

### Rate Limiting Issues

The worker helps spread yfinance calls over time. If you still hit rate limits:

1. **Increase delays** via environment variables:
   ```
   REALTIME_FETCH_MIN_PAUSE_MS=300  # Increase from 150
   PREFETCH_BATCH_SIZE=10  # Smaller batches = more spreading
   REALTIME_FETCH_BATCH_SIZE=5
   ```

2. **Use delayed data mode**:
   ```
   USE_DELAYED_DATA=true
   DATA_DELAY_MINUTES=30
   ```

3. **Adjust batch sizes**:
   ```
   PREFETCH_BATCH_SIZE=10  # Smaller batches = more spreading
   REALTIME_FETCH_BATCH_SIZE=8
   ```

### Worker Keeps Restarting

- **Check memory usage**: Upgrade to a larger instance type
- **Check logs for errors**: Worker should log errors before crashing
- **Verify environment variables** are correct
- **Check persistence path**: Ensure `PERSIST_PATH` is writable

### Local Development Issues

- **Port conflicts**: Change `BACKEND_PORT` in `.env` if 8080 is taken
- **CORS errors**: Add your frontend origin to `ALLOWED_ORIGINS`
- **Timer not working**: Make sure backend is running and accessible

---

## Cost Considerations

- **Starter ($7/month)**: 512 MB RAM, 0.5 CPU - Good for testing
- **Standard ($25/month)**: 2 GB RAM, 1 CPU - **Recommended for production**
- **Pro ($85/month)**: 4 GB RAM, 2 CPU - For heavy workloads

The worker runs 24/7, so choose an instance type that fits your budget and needs.

---

## Benefits

✅ **Backend Always Running**: Simulation continues even without visitors  
✅ **Accurate Timer**: Server-side timer doesn't reset on refresh  
✅ **Better Rate Limiting**: Worker spreads API calls over time  
✅ **Reliability**: Worker keeps simulation running independently  
✅ **Scalability**: Can add more workers if needed  

---

## Quick Reference

### Local Development Commands

```bash
# Simple setup (2 terminals)
cd backend && npm run dev  # Terminal 1
npm run dev                # Terminal 2 (root)

# Full setup (3 terminals)
cd backend && npm run build && npm start  # Terminal 1
cd backend && npm run worker:dev          # Terminal 2
npm run dev                                # Terminal 3 (root)
```

### Render Commands

**Web Service:**
- Build: `cd backend && npm install && npm run build`
- Start: `cd backend && npm start`

**Worker:**
- Build: `cd backend && npm install && npm run build`
- Start: `cd backend && npm run worker`

---

## Next Steps

1. ✅ Set up local development (Option A - simple)
2. ✅ Deploy worker to Render
3. ✅ Monitor worker logs regularly
4. ✅ Set up alerts for worker failures (Render can email you)
5. ✅ Consider upgrading instance type if you see performance issues
6. ✅ Test timer accuracy after deployment

For more details, see `BACKEND_SETUP.md` and `WORKER_IMPLEMENTATION_SUMMARY.md`.
```

This guide covers:
- Local development (2 and 3 terminal options)
- Render production setup
- All environment variables (including new ones)
- Troubleshooting
- Quick reference commands

Should I update any other documentation files or add anything else?
