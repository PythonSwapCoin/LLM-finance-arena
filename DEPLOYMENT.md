# Deployment Guide

This guide explains how to deploy the LLM Finance Arena to make it accessible online.

## Architecture Overview

- **Frontend**: React/Vite app (deploy to Vercel, Netlify, or similar)
- **Backend**: Node.js/Express server (deploy to Render, Railway, Fly.io, or similar)
- **State**: Persisted to JSON files or Postgres

## Prerequisites

- GitHub repository (or similar)
- Accounts on:
  - **Frontend hosting**: Vercel (recommended) or Netlify
  - **Backend hosting**: Render (recommended), Railway, or Fly.io

## Step 1: Deploy Backend

### Option A: Render (Recommended - Free Tier Available)

1. **Create a new Web Service** on [Render](https://render.com)
2. **Connect your GitHub repository**
3. **Configure the service:**
   - **Name**: `llm-finance-arena-backend`
   - **Root Directory**: `backend`
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or paid for better performance)

4. **Add Environment Variables** in Render dashboard:
 ```
  BACKEND_PORT=8080
  ALLOWED_ORIGINS=https://your-frontend.vercel.app
  MODE=simulated
  OPENROUTER_API_KEY=sk-or-v1-your-key-here
  SIM_INTERVAL_MS=30000
  TRADE_INTERVAL_MS=7200000
  PERSISTENCE_DRIVER=file
  PERSIST_PATH=/var/lib/llm-finance-arena/snapshot.json
  SNAPSHOT_AUTOSAVE_INTERVAL_MS=900000
  LOG_LEVEL=INFO
  # DATABASE_URL=postgres://user:password@host:5432/dbname  (set if using Postgres)
  ```

5. (Optional) **Attach Render Postgres**: Create a Render Postgres instance, copy the `DATABASE_URL`, set `PERSISTENCE_DRIVER=postgres`, and redeploy. See [Postgres Setup](./POSTGRES_SETUP.md) for the step-by-step workflow.

6. **Important**: Render free tier spins down after 15 minutes of inactivity. Consider:
   - Using a paid tier for 24/7 operation
   - Or use a cron job to ping the service every 10 minutes
   - Or use Railway/Fly.io which have better free tiers

### Option B: Railway (Better Free Tier)

1. **Create a new project** on [Railway](https://railway.app)
2. **Deploy from GitHub**
3. **Set root directory** to `backend`
4. **Configure:**
   - Build: `npm install && npm run build`
   - Start: `npm start`
5. **Add environment variables** (same as Render)
6. **Railway provides persistent storage** for the `data/` directory — point `PERSIST_PATH` at that mounted volume so restarts reuse the snapshot

### Option C: Fly.io (Good for 24/7)

1. **Install Fly CLI**: `curl -L https://fly.io/install.sh | sh`
2. **Login**: `fly auth login`
3. **Initialize**: `cd backend && fly launch`
4. **Configure** `fly.toml`:
   ```toml
   [env]
     BACKEND_PORT = "8080"
     ALLOWED_ORIGINS = "https://your-frontend.vercel.app"
   ```
5. **Set secrets**: `fly secrets set OPENROUTER_API_KEY=sk-or-v1-...`
6. **Deploy**: `fly deploy`

## Step 2: Deploy Frontend

### Option A: Vercel (Recommended)

1. **Import your GitHub repository** to [Vercel](https://vercel.com)
2. **Configure:**
   - **Framework Preset**: Vite
   - **Root Directory**: `.` (root of repo)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`

3. **Add Environment Variable:**
   ```
   VITE_API_BASE=https://your-backend.onrender.com/api
   ```
   (Replace with your actual backend URL)

4. **Deploy**

### Option B: Netlify

1. **Import repository** to [Netlify](https://netlify.com)
2. **Build settings:**
   - Build command: `npm run build`
   - Publish directory: `dist`
3. **Environment variables:**
   ```
   VITE_API_BASE=https://your-backend.onrender.com/api
   ```
4. **Deploy**

## Step 3: Update CORS

After deploying frontend, update backend `ALLOWED_ORIGINS` in Render dashboard:

```
ALLOWED_ORIGINS=https://llm-finance-arena.vercel.app
```

**Important Notes:**
- Use the full URL with `https://` protocol
- The backend now automatically allows all `*.vercel.app` domains (including preview deployments)
- **You MUST restart the backend service in Render after changing environment variables**
- To restart: Go to Render dashboard → Your service → Manual Deploy → Clear build cache & deploy

## Step 4: Verify Deployment

1. **Check backend health**: `https://your-backend.onrender.com/healthz`
2. **Check frontend**: Visit your Vercel/Netlify URL
3. **Verify API connection**: Open browser console, check for API errors

## Important Notes

### Backend Persistence

- **Render/Railway**: Either mount their persistent disk (`PERSISTENCE_DRIVER=file`) or attach a managed Postgres instance and set `PERSISTENCE_DRIVER=postgres`.
- Configure `SNAPSHOT_AUTOSAVE_INTERVAL_MS` (default 15 minutes) to control how frequently the backend flushes state in addition to the per-event saves.
- **Fly.io**: Volumes persist automatically; you can also bring your own Postgres.
- **Postgres**: Recommended for long-running or real-time seasons so simulation state survives restarts and multi-day history is captured.

### Free Tier Limitations

- **Render**: Spins down after 15 min inactivity (cold starts)
- **Railway**: $5/month free credit, then pay-as-you-go
- **Fly.io**: Generous free tier, good for 24/7

### Recommended Setup

For 24/7 operation:
- **Backend**: Railway or Fly.io (better free tiers)
- **Frontend**: Vercel (excellent free tier)

For development/testing:
- **Backend**: Render (free, but spins down)
- **Frontend**: Vercel

## Environment Variables Summary

### Backend (`.env` in deployment platform)
```
BACKEND_PORT=8080
ALLOWED_ORIGINS=https://your-frontend.vercel.app
MODE=simulated
OPENROUTER_API_KEY=sk-or-v1-...
SIM_INTERVAL_MS=30000
TRADE_INTERVAL_MS=7200000
TRADING_FEE_BPS=5
MIN_TRADE_FEE=0.25
LLM_AUTO_SPACING=false
LLM_REQUEST_SPACING_MS=-1
LLM_MAX_CONCURRENT_REQUESTS=0
PERSISTENCE_DRIVER=file
PERSIST_PATH=/var/lib/llm-finance-arena/snapshot.json
SNAPSHOT_AUTOSAVE_INTERVAL_MS=900000
LOG_LEVEL=INFO
# DATABASE_URL=postgres://user:password@host:5432/dbname
# POSTGRES_SSL=true
# POSTGRES_NAMESPACE=default
# POSTGRES_SNAPSHOT_ID=current
```

### Frontend (in Vercel/Netlify dashboard)
```
VITE_API_BASE=https://your-backend.onrender.com/api
```

## Troubleshooting

### Backend not responding
- Check if service is running (Render spins down on free tier)
- Verify environment variables are set
- Check logs in deployment dashboard

### CORS errors
- Update `ALLOWED_ORIGINS` with your frontend URL
- Restart backend after changing CORS settings

### API connection fails
- Verify `VITE_API_BASE` matches your backend URL
- Check backend logs for errors
- Ensure backend is accessible (not behind firewall)

## Next Steps (Phase 2)

- Add WebSocket support for real-time updates
- Add authentication/authorization
- Add leaderboards and analytics

