# Backend Connection Testing Guide

## Quick Test Methods

### 1. Visual Indicator in UI
The frontend now displays a connection status indicator in the header:
- **GREEN "BACKEND"** = Connected ✅
- **RED "OFFLINE"** = Disconnected ❌

Hover over the indicator to see backend details (day, agent count, etc.)

### 2. Browser Console

#### Check Connection Status
Open browser console (F12) and you'll see connection status logs:
```
🔌 Backend Connection Status: {
  connected: true,
  lastChecked: "2025-11-11T10:00:00.000Z",
  backendInfo: {
    status: "connected",
    backend: "online",
    simulation: {
      mode: "realtime",
      day: 0,
      agentsCount: 5,
      tickersCount: 20,
      ...
    }
  }
}
```

#### Manual Connection Test
In the browser console, run:
```javascript
await testBackendConnection()
```

This will:
- Test the connection
- Log the result
- Return true/false

### 3. Direct API Calls

#### Test Status Endpoint
```bash
curl https://llm-finance-arena.onrender.com/api/status
```

Expected response:
```json
{
  "status": "connected",
  "backend": "online",
  "timestamp": "2025-11-11T10:00:00.000Z",
  "simulation": {
    "mode": "realtime",
    "day": 0,
    "intradayHour": 0,
    "agentsCount": 5,
    "tickersCount": 20,
    "lastUpdated": "2025-11-11T10:00:00.000Z"
  }
}
```

#### Test Health Endpoint
```bash
curl https://llm-finance-arena.onrender.com/healthz
```

Expected response:
```json
{
  "status": "ok",
  "timestamp": "2025-11-11T10:00:00.000Z"
}
```

#### Test Simulation State
```bash
curl https://llm-finance-arena.onrender.com/api/simulation/state
```

### 4. Browser Network Tab

1. Open browser DevTools (F12)
2. Go to Network tab
3. Filter by "simulation" or "api"
4. Look for requests to `/api/simulation/state` or `/api/status`
5. Check:
   - Status code should be `200`
   - Response should contain simulation data
   - No CORS errors

### 5. Verify Data is Updating

Even when the market is closed, you can verify the connection by checking:

1. **Agents count**: Should show 5 agents
2. **Tickers count**: Should show 20 tickers (when market data is available)
3. **Simulation mode**: Should match your backend configuration
4. **Day number**: Should be 0 or higher
5. **Last updated**: Should be recent (within last few minutes)

## Troubleshooting

### Connection Status Shows "OFFLINE"

1. **Check backend is running**:
   - Visit: `https://llm-finance-arena.onrender.com/healthz`
   - Should return `{"status":"ok"}`

2. **Check CORS configuration**:
   - Backend logs should show: `CORS allowed origins: https://llm-finance-arena.vercel.app`
   - If you see CORS errors in console, update `ALLOWED_ORIGINS` in Render

3. **Check environment variables**:
   - Verify `VITE_API_BASE_URL` in Vercel is set to your backend URL
   - Should be: `https://llm-finance-arena.onrender.com`

4. **Check browser console for errors**:
   - Look for network errors
   - Look for CORS errors
   - Look for API errors

### Market is Closed - How to Verify?

Even when the market is closed, the backend should:
- ✅ Respond to API requests
- ✅ Return simulation state (day 0, agents, etc.)
- ✅ Show connection status as "connected"
- ✅ Display agents and their portfolios
- ⚠️ Market data may be empty or stale (this is normal when market is closed)

### Testing When Market is Open

When the market is open (9:30 AM - 4:00 PM ET), you should see:
- Real-time price updates every 2 minutes
- Trade windows every 2 hours
- Portfolio values updating
- Agent performance metrics updating

## Expected Behavior

### On Page Load
1. Frontend connects to backend immediately
2. Status indicator shows "BACKEND" (green) within 1-2 seconds
3. Console shows connection status log
4. Simulation data loads (agents, benchmarks, market data)

### During Operation
1. Frontend polls backend every 5 seconds for updates
2. Connection status is checked every 30 seconds
3. Status indicator updates if connection is lost
4. Console logs connection status changes

### When Market is Closed
1. Backend still responds to API requests
2. Simulation state is available
3. No price updates (market is closed)
4. Connection status remains "connected"

## Manual Testing Checklist

- [ ] Status endpoint returns valid JSON
- [ ] Health endpoint returns `{"status":"ok"}`
- [ ] Simulation state endpoint returns data
- [ ] Frontend displays "BACKEND" indicator (green)
- [ ] Browser console shows connection status
- [ ] No CORS errors in console
- [ ] Network tab shows successful API requests
- [ ] Agents are displayed in the UI
- [ ] Market data is displayed (when available)
- [ ] `testBackendConnection()` function works in console

## API Endpoints Reference

- `GET /healthz` - Health check
- `GET /api/status` - Connection status and backend info
- `GET /api/simulation/state` - Full simulation state
- `GET /api/agents` - Agents list
- `GET /api/market-data` - Market data
- `GET /api/benchmarks` - Benchmarks
- `GET /api/simulation/history` - Performance history
- `GET /api/logs` - Server logs

