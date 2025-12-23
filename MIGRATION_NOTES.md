# Migration Notes: Frontend to Backend Architecture

This document describes the changes made when migrating from a frontend-only simulation to a backend-driven architecture.

## Overview

The simulation logic has been extracted from the React frontend into a Node.js backend. The frontend now polls the backend API instead of running the simulation locally.

## Key Changes

### Frontend Changes

#### Removed
- `hooks/useSimulation.ts` - Replaced by `hooks/useApiState.ts`
- Direct LLM API calls (now server-side only)
- Direct market data fetching (now server-side only)
- Client-side simulation loop (`setInterval` in `App.tsx`)

#### Added
- `services/apiClient.ts` - HTTP client for backend API
- `hooks/useApiState.ts` - Polls backend every 5 seconds for state updates

#### Modified
- `App.tsx` - Now uses `useApiState` instead of `useSimulation`
  - Removed local `setInterval` for simulation advancement
  - Uses `startSimulation()` and `stopSimulation()` to control backend scheduler
- All UI components remain unchanged (they still receive the same data shape)

### Backend Structure

New `/backend` directory contains:

- `src/server.ts` - Fastify server bootstrap
- `src/api/routes.ts` - API endpoint definitions
- `src/api/dto.ts` - Request/response type definitions
- `src/simulation/engine.ts` - Pure simulation logic (no I/O)
- `src/simulation/scheduler.ts` - `setInterval` management
- `src/simulation/state.ts` - In-memory state management
- `src/simulation/marketHours.ts` - Market calendar logic
- `src/services/marketDataService.ts` - Market data fetching (moved from frontend)
- `src/services/llmService.ts` - OpenRouter LLM calls (moved from frontend)
- `src/services/logger.ts` - Server-side logging
- `src/services/yfinanceService.ts` - Yahoo Finance client
- `src/store/persistence.ts` - JSON file persistence (Postgres stub included)
- `src/utils/portfolioCalculations.ts` - Portfolio metrics (moved from frontend)
- `src/constants.ts` - Constants (moved from frontend)

### Shared Types

New `/shared` directory contains:
- `types.ts` - Types used by both frontend and backend

## API Compatibility

The backend API returns data in the same shape as the old `useSimulation` hook, ensuring UI components don't need changes:

```typescript
// Old hook return shape
{
  agents: Agent[];
  benchmarks: Benchmark[];
  simulationState: { day: number; intradayHour: number; isLoading: boolean };
  marketData: MarketData;
  advanceDay: () => Promise<void>;
  advanceIntraday: () => Promise<void>;
  exportSimulationData: () => void;
}

// New API state shape (compatible)
{
  agents: Agent[];
  benchmarks: Benchmark[];
  simulationState: { day: number; intradayHour: number; isLoading: boolean };
  marketData: MarketData;
  advanceDay: () => Promise<void>; // No-op, backend handles it
  advanceIntraday: () => Promise<void>; // No-op, backend handles it
  exportSimulationData: () => void; // Client-side only
  startSimulation: () => Promise<void>; // New
  stopSimulation: () => Promise<void>; // New
}
```

## Environment Variables

### Frontend (`.env.local`)
```env
VITE_API_BASE_URL=http://localhost:8080
```

### Backend (`.env`)
```env
BACKEND_PORT=8080
ALLOWED_ORIGINS=http://localhost:3000
MODE=simulated
OPENROUTER_API_KEY=...
# ... (see BACKEND_SETUP.md)
```

**Important**: API keys are now server-side only. The frontend no longer needs `VITE_OPENROUTER_API_KEY`, `VITE_ALPHA_VANTAGE_API_KEY`, or `VITE_POLYGON_API_KEY`.

## Simulation Flow

### Old (Frontend)
1. User clicks "Start"
2. Frontend `setInterval` calls `advanceIntraday()` every 3 seconds
3. Frontend makes LLM calls directly
4. Frontend fetches market data directly
5. State updates in React

### New (Backend)
1. User clicks "Start"
2. Frontend calls `POST /api/simulation/start`
3. Backend `setInterval` runs simulation loop:
   - Price tick every 30 seconds (configurable)
   - Trade window every 2 hours (configurable)
4. Backend makes LLM calls server-side
5. Backend fetches market data server-side
6. Frontend polls `GET /api/simulation/state` every 5 seconds
7. State updates in React from API response

## Benefits

1. **24/7 Operation**: Simulation continues even when no browsers are open
2. **Security**: API keys never exposed to client
3. **Performance**: Backend can handle rate limiting and retries more effectively
4. **Persistence**: State survives server restarts
5. **Scalability**: Foundation for multi-user, leaderboards, etc. (Phase 2)

## Breaking Changes

### For Developers
- `useSimulation` hook no longer exists - use `useApiState`
- `advanceDay()` and `advanceIntraday()` are now no-ops (backend handles timing)
- Market data service functions (`getSimulationMode`, `isHistoricalSimulationComplete`) should come from API state

### For Users
- None - UI remains identical

## Migration Checklist

- [x] Create backend structure
- [x] Move simulation logic to backend
- [x] Create API endpoints
- [x] Create frontend API client
- [x] Replace `useSimulation` with `useApiState`
- [x] Update `App.tsx` to use new hook
- [x] Test all three modes (simulated, realtime, historical)
- [x] Verify persistence works
- [x] Update documentation

## Testing

1. Start backend: `cd backend && npm run dev`
2. Start frontend: `npm run dev`
3. Verify simulation runs and updates appear in UI
4. Stop frontend - verify backend continues running
5. Restart backend - verify state is restored from snapshot
6. Test all three modes

## Known Issues / TODOs

- Export simulation data functionality needs to be reimplemented for API mode
- `getSimulationMode()` and `isHistoricalSimulationComplete()` in frontend should use API state
- Consider WebSocket support in Phase 2 to reduce polling overhead


