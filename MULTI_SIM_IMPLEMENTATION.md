# Multi-Simulation Framework Implementation

## Overview
This document describes the multi-simulation framework that allows running multiple simulations simultaneously with different configurations.

## Architecture

### Backend

#### New Files Created:
1. **src/simulationTypes.ts** - Defines all simulation types and their configurations
   - Multi-Model Arena: 5 different AI models with chat enabled
   - Model Size Comparison: OpenAI models of different sizes
   - Investment Strategy Battle: Same model with 5 different investing prompts
   - Blind Model Test: Same as Multi-Model but with hidden identities

2. **src/simulation/SimulationManager.ts** - Manages multiple simulation instances
   - Each simulation has its own state and agents
   - All simulations share the same market data (yfinance)
   - Provides methods to initialize, reset, and manage simulations

3. **src/simulation/multiSimScheduler.ts** - Unified scheduler for all simulations
   - Updates shared market data
   - Runs step() and tradeWindow() for all simulations in parallel
   - Maintains consistent timing across all simulations

4. **src/api/multiSimRoutes.ts** - API routes for multi-simulation support
   - GET /api/simulations/types - List all simulation types
   - GET /api/simulations/:typeId/state - Get state for specific simulation
   - POST /api/simulations/start - Start all simulations
   - POST /api/simulations/stop - Stop all simulations
   - POST /api/simulations/:typeId/reset - Reset specific simulation
   - POST /api/simulations/:typeId/chat/messages - Send chat message to specific simulation

5. **src/services/multiSimChatService.ts** - Chat service for multi-simulation support

#### Modified Files:
1. **src/server.ts** - Updated to initialize and manage multiple simulations
2. **src/api/routes.ts** - Kept for backward compatibility

### Frontend

#### New Files Created:
1. **components/SimulationSelector.tsx** - Landing page to select simulation type
2. **components/SimulationView.tsx** - Simulation-specific view component
3. **hooks/useSimulationState.ts** - Hook to fetch and manage simulation-specific state

#### Modified Files:
1. **App.tsx** - Now contains routing logic (Routes)
2. **index.tsx** - Wrapped App with BrowserRouter
3. **components/Leaderboard.tsx** - Added `showModelNames` prop for blind mode
4. **components/AgentDetailView.tsx** - Added `showModelName` prop for blind mode

## Simulation Types

### 1. Multi-Model Arena (multi-model)
- **Agents**: 5 different AI models
- **Chat**: Enabled - users can chat with agents
- **Model Names**: Visible
- **Purpose**: Main simulation where users can interact with different AI models

### 2. OpenAI Model Size Comparison (model-sizes)
- **Agents**: 4 OpenAI models of different sizes
  - openai/gpt-5-nano
  - openai/gpt-5-mini
  - openai/gpt-5
  - openai/gpt-oss-120b:exacto
- **Chat**: Disabled
- **Model Names**: Visible
- **Purpose**: Compare performance across different model sizes

### 3. Investment Strategy Battle (prompt-strategies)
- **Agents**: 5 different investing strategies with same model (openai/gpt-5-nano)
  1. WallStreetBets Style - High-risk momentum trading
  2. Warren Buffett Style - Value investing
  3. Momentum Trader - Technical analysis and trends
  4. Dividend Growth - Income-focused investing
  5. Contrarian Investor - Buying fear, selling greed
- **Chat**: Disabled
- **Model Names**: Visible
- **Purpose**: Compare different investing philosophies

### 4. Blind Model Test (blind-test)
- **Agents**: Same 5 models as Multi-Model but named Agent A-E
- **Chat**: Disabled
- **Model Names**: Hidden
- **Purpose**: Unbiased performance comparison

## Key Features

1. **Shared Market Data**: All simulations use the same yfinance data to ensure fair comparison
2. **Independent State**: Each simulation maintains its own agent states, portfolios, and history
3. **Navigation**: Easy switching between different simulation views
4. **Chat Control**: Chat is only enabled for the Multi-Model Arena
5. **Blind Mode**: Option to hide model names for unbiased evaluation

## Status

✅ **All TypeScript compilation errors have been fixed!**

Both backend and frontend now compile successfully without errors.

### Fixes Applied:

1. **multiSimChatService.ts** - Fixed ChatMessage interface usage
   - Corrected field names to match types.ts: `sender`, `senderType`, `agentName`, `createdAt`
   - Added proper sanitization and validation using chat utils
   - Follows same patterns as existing chatService.ts

2. **multiSimScheduler.ts** - Fixed all function signatures and types
   - Now correctly uses `step()`, `tradeWindow()`, and `advanceDay()` from engine.ts
   - Fixed `generateNextIntradayMarketData` arguments: (marketData, day, intradayHour)
   - Fixed `generateNextDayMarketData` arguments: (marketData) - takes 1 arg not 2
   - Fixed `isMarketOpen` return type - returns boolean not object
   - Fixed `prefetchRealtimeMarketData` call with proper tickers and options
   - Removed `currentTimestamp` from `advanceDay` call (not in signature)

3. **App.tsx** - Removed non-existent index.css import

### Build Status:
- ✅ Backend: `npm run build` - Success
- ✅ Frontend: `npm run build` - Success (with chunk size warning, normal)

## Testing Plan

1. Start backend and verify all simulations initialize
2. Test navigation between simulations in frontend
3. Verify chat works only in Multi-Model Arena
4. Verify model names hidden in Blind Test
5. Verify all simulations share same market data
6. Test reset functionality for individual simulations

## Future Enhancements

1. Add persistence for multi-simulation state
2. Add comparison view to see all simulations side-by-side
3. Add export functionality for cross-simulation analysis
4. Add ability to start/stop individual simulations
5. Add performance leaderboard across all simulation types
