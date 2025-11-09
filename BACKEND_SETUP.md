# Backend API Setup Guide

## Overview

The application has been split into frontend and backend:
- **Frontend**: React app that displays data from the API
- **Backend**: Node.js API (Vercel serverless functions) that handles:
  - Market data fetching (Yahoo Finance)
  - LLM API calls (OpenRouter)
  - Portfolio calculations
  - Simulation logic

## API Structure

### Endpoints

1. **GET /api/simulation/state**
   - Returns current simulation state (agents, benchmarks, market data)
   - Initializes simulation if not already initialized

2. **POST /api/simulation/advance**
   - Body: `{ "type": "intraday" | "day" }`
   - Advances simulation by one step (intraday or day)
   - Returns updated simulation state

## Backend Files

```
api/
├── simulation.js              # Main simulation logic
├── types.js                   # Constants and types
├── services/
│   ├── marketDataService.js   # Market data fetching
│   └── llmService.js          # LLM API calls
├── utils/
│   └── portfolioCalculations.js # Portfolio metrics
└── simulation/
    ├── state.js               # GET /api/simulation/state
    └── advance.js             # POST /api/simulation/advance
```

## Environment Variables (Vercel)

Set these in your Vercel project settings:

- `OPENROUTER_API_KEY` - Your OpenRouter API key
- `USE_REAL_DATA` - Set to `"true"` for real-time data
- `USE_HISTORICAL_SIMULATION` - Set to `"true"` for historical mode
- `ALPHA_VANTAGE_API_KEY` - (Optional) Alpha Vantage API key
- `POLYGON_API_KEY` - (Optional) Polygon.io API key
- `HISTORICAL_SIMULATION_START_DATE` - (Optional) Start date for historical mode (YYYY-MM-DD)

## Local Development

### Running Backend Locally

The backend runs as Vercel serverless functions. To test locally:

1. Install Vercel CLI:
   ```bash
   npm i -g vercel
   ```

2. Run development server:
   ```bash
   vercel dev
   ```

3. The API will be available at `http://localhost:3000/api/...`

### Running Frontend Locally

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set up environment variables:
   ```bash
   # Create .env.local
   VITE_API_URL=http://localhost:3000/api
   ```

3. Run frontend:
   ```bash
   npm run dev
   ```

## Deployment to Vercel

1. **Install Vercel CLI** (if not already installed):
   ```bash
   npm i -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   vercel
   ```

4. **Set Environment Variables**:
   - Go to your Vercel project dashboard
   - Navigate to Settings → Environment Variables
   - Add all required environment variables (see above)

5. **Redeploy** after adding environment variables:
   ```bash
   vercel --prod
   ```

## Important Notes

### State Persistence

⚠️ **Current Limitation**: The backend uses in-memory state (shared across serverless function instances). This means:
- State is **NOT persisted** between deployments
- State is **NOT shared** across different serverless function instances
- For production, you'll need to add a database (e.g., Vercel Postgres, Redis) for state persistence

### Serverless Function Limitations

- Each function has a timeout (10 seconds for Hobby plan, 60 seconds for Pro)
- Cold starts may occur on first request
- State is not shared between function invocations (need external storage)

## Frontend Changes

The frontend (`hooks/useSimulation.ts`) now:
- Fetches state from `/api/simulation/state` on mount
- Calls `/api/simulation/advance` to advance simulation
- No longer runs simulation logic locally
- No longer makes direct API calls to Yahoo Finance or OpenRouter

## Testing

1. **Test API endpoints**:
   ```bash
   # Get state
   curl http://localhost:3000/api/simulation/state

   # Advance intraday
   curl -X POST http://localhost:3000/api/simulation/advance \
     -H "Content-Type: application/json" \
     -d '{"type":"intraday"}'

   # Advance day
   curl -X POST http://localhost:3000/api/simulation/advance \
     -H "Content-Type: application/json" \
     -d '{"type":"day"}'
   ```

2. **Test frontend**:
   - Open `http://localhost:5173` (or your Vite dev server port)
   - Click "Start Live" to begin simulation
   - Watch agents make trading decisions

## Troubleshooting

### CORS Errors
- Make sure CORS headers are set in API endpoints (already included)

### API Key Errors
- Verify environment variables are set in Vercel
- Check that `OPENROUTER_API_KEY` is correctly set

### State Not Persisting
- This is expected with in-memory state
- Add database for production use

### Function Timeout
- Increase timeout in Vercel project settings (Pro plan required)
- Optimize LLM API calls (reduce timeout, parallelize)

## Next Steps

1. **Add Database**: Use Vercel Postgres or Redis for state persistence
2. **Add Authentication**: Protect API endpoints if needed
3. **Add Rate Limiting**: Prevent abuse of API endpoints
4. **Add Logging**: Use Vercel's logging or external service
5. **Add Monitoring**: Set up error tracking (Sentry, etc.)

