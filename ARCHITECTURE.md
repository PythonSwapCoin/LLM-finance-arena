# Architecture: Frontend + Backend Split

## Overview

The application has been successfully split into a **frontend** (React) and **backend** (Node.js API on Vercel).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                      Frontend (React)                        │
│  - Displays UI (charts, leaderboard, agent details)         │
│  - Fetches data from API                                     │
│  - No business logic                                         │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP Requests
                       │ GET /api/simulation/state
                       │ POST /api/simulation/advance
┌──────────────────────┴──────────────────────────────────────┐
│                  Backend API (Vercel)                        │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  API Endpoints                                        │   │
│  │  - GET /api/simulation/state                          │   │
│  │  - POST /api/simulation/advance                       │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Simulation Engine                                    │   │
│  │  - Manages agents, portfolios, trades                 │   │
│  │  - Calculates performance metrics                     │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Services                                             │   │
│  │  - Market Data Service (Yahoo Finance)                │   │
│  │  - LLM Service (OpenRouter)                           │   │
│  │  - Portfolio Calculations                             │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
                       │
                       │ External APIs
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼────┐   ┌────▼────┐   ┌────▼────┐
   │  Yahoo  │   │OpenRouter│   │  Alpha  │
   │ Finance │   │   API    │   │ Vantage │
   └─────────┘   └──────────┘   └─────────┘
```

## File Structure

### Frontend
```
├── App.tsx                          # Main React component
├── hooks/
│   └── useSimulation.ts            # Fetches from API (no business logic)
├── components/                      # UI components
├── types.ts                        # TypeScript types
└── package.json                    # Frontend dependencies
```

### Backend
```
api/
├── simulation.js                   # Main simulation logic
├── types.js                        # Constants and types
├── services/
│   ├── marketDataService.js       # Yahoo Finance, Alpha Vantage, Polygon
│   └── llmService.js              # OpenRouter API calls
├── utils/
│   └── portfolioCalculations.js   # Performance metrics
└── simulation/
    ├── state.js                   # GET /api/simulation/state
    └── advance.js                 # POST /api/simulation/advance
```

## Data Flow

### 1. Initial Load
```
Frontend → GET /api/simulation/state
Backend → Initialize simulation (if needed)
Backend → Return { simulationState, marketData, agents, benchmarks }
Frontend → Display data in UI
```

### 2. Advance Simulation
```
Frontend → POST /api/simulation/advance { type: "intraday" | "day" }
Backend → Fetch market data
Backend → Call LLM APIs for trade decisions
Backend → Update portfolios
Backend → Calculate metrics
Backend → Return updated state
Frontend → Update UI with new data
```

## Key Changes

### Frontend Changes
- ✅ Removed all business logic (market data fetching, LLM calls, calculations)
- ✅ `useSimulation` hook now only fetches from API
- ✅ No direct API calls to Yahoo Finance or OpenRouter
- ✅ No portfolio calculations in frontend
- ✅ Simplified codebase (removed ~500 lines of logic)

### Backend Changes
- ✅ All simulation logic moved to backend
- ✅ Market data fetching in backend
- ✅ LLM API calls in backend
- ✅ Portfolio calculations in backend
- ✅ API endpoints for state and advance

## Benefits

1. **Security**: API keys stored on server, not exposed to browser
2. **Performance**: Backend can cache data, optimize API calls
3. **Scalability**: Backend can be scaled independently
4. **Maintainability**: Clear separation of concerns
5. **Testing**: Backend API can be tested independently

## Limitations

### Current Implementation
- ⚠️ **State Persistence**: State is stored in memory (not persisted)
- ⚠️ **Serverless**: Each function invocation is stateless
- ⚠️ **Cold Starts**: First request may be slow

### Production Recommendations
1. **Add Database**: Use Vercel Postgres or Redis for state persistence
2. **Add Caching**: Cache market data and LLM responses
3. **Add Rate Limiting**: Prevent abuse of API endpoints
4. **Add Authentication**: Protect API endpoints if needed
5. **Add Monitoring**: Track errors and performance

## Environment Variables

### Frontend (.env.local)
```env
VITE_API_URL=http://localhost:3000/api  # For local development
```

### Backend (Vercel)
```env
OPENROUTER_API_KEY=your_key
USE_REAL_DATA=true
USE_HISTORICAL_SIMULATION=false
ALPHA_VANTAGE_API_KEY=your_key (optional)
POLYGON_API_KEY=your_key (optional)
```

## Deployment

### Vercel
1. Push code to GitHub
2. Connect repository to Vercel
3. Set environment variables in Vercel dashboard
4. Deploy

### Local Development
1. Run backend: `vercel dev`
2. Run frontend: `npm run dev`
3. Frontend will call `http://localhost:3000/api`

## Testing

### Test API Endpoints
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

## Next Steps

1. **Add Database**: Persist simulation state
2. **Add Authentication**: Protect API endpoints
3. **Add Rate Limiting**: Prevent abuse
4. **Add Logging**: Track errors and performance
5. **Add Monitoring**: Set up alerts

