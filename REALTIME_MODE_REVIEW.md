# Real-Time Mode Review & Testing Guide

## Summary of Changes

I've reviewed and updated the real-time mode implementation to ensure it works correctly with actual market hours and real-time data.

## Key Changes Made

### 1. **Day Advancement in Real-Time Mode**
- **Before**: Days advanced every 6.5 hours (simulated time)
- **After**: Days only advance when the market actually closes and reopens
- Days are tracked by actual calendar date, not simulated hours

### 2. **Market Hours Checking**
- **Added**: Real-time mode now checks if market is open before processing
- **Behavior**: Skips all processing (price ticks, trades) when market is closed
- **Market Hours**: 9:30 AM - 4:00 PM ET, Monday-Friday

### 3. **Intraday Hour Mapping**
- **Real-time mode**: Maps actual market time to intraday hours
  - 9:30 AM ET = intraday hour 0
  - 4:00 PM ET = intraday hour 6.5
  - Progresses in real-time based on actual clock time

### 4. **Trading Windows**
- **Real-time mode**: Trading windows align with actual market hours
  - Trading windows: Every 30 minutes (9:30, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 1:00, 1:30, 2:00, 2:30, 3:00, 3:30, 4:00)
  - Only executes trades when market is open and at trading window times
- **Simulated/Historical mode**: Trading windows every 2 hours (0, 2, 4, 6 hours)
  - **Day 0 trading**: Agents can now trade from the initial day (day 0) at hours 0, 2, 4, 6

### 5. **Data Fetching**
- Real-time mode fetches live market data from:
  1. Yahoo Finance (primary, no API key needed)
  2. Alpha Vantage (fallback, requires API key)
  3. Polygon.io (fallback, requires API key)

## Important Notes

### ⚠️ Timezone Handling
The current `isMarketOpen` function uses UTC hours as a simplification. For production, you should:
- Use a proper timezone library (e.g., `date-fns-tz` or `luxon`)
- Convert server time to ET timezone before checking market hours
- Handle daylight saving time transitions

**Current behavior**: Assumes server is running in ET timezone or adjust the hours accordingly.

### 📊 How Real-Time Mode Works

1. **Market Closed**: 
   - No price ticks
   - No trades
   - Simulation pauses

2. **Market Opens (9:30 AM ET)**:
   - Day advances (if new trading day)
   - Agents make trading decisions
   - Price ticks start updating every `SIM_INTERVAL_MS` (default: 30 seconds)

3. **During Market Hours**:
   - Price ticks update with real market data
   - Trading windows execute at 9:30 AM, 11:30 AM, 1:30 PM, 3:30 PM
   - Intraday hours map to actual market time

4. **Market Closes (4:00 PM ET)**:
   - Processing stops
   - Simulation pauses until next market open

## Testing Checklist

Before deploying to production, test:

- [ ] **Market Open Detection**: Verify simulation starts when market opens
- [ ] **Day Advancement**: Verify days only advance when market closes/reopens
- [ ] **Market Closed**: Verify no processing happens when market is closed
- [ ] **Price Updates**: Verify prices update with real market data
- [ ] **Trading Windows**: Verify trades execute at correct times (9:30, 11:30, 1:30, 3:30)
- [ ] **Intraday Hours**: Verify intraday hours map correctly to market time
- [ ] **Weekend Handling**: Verify simulation pauses on weekends
- [ ] **Holiday Handling**: Verify simulation pauses on market holidays
- [ ] **Data Fetching**: Verify fallback data sources work if primary fails
- [ ] **Error Handling**: Verify graceful handling of API failures

## Configuration

Set in `backend/.env`:
```env
MODE=realtime
REALTIME_SIM_INTERVAL_MS=600000  # Price tick interval (10 minutes)
REALTIME_TRADE_INTERVAL_MS=1800000  # Trade window interval (30 minutes)
```

Note: The intervals are automatically set based on mode:
- **Real-time mode**: Uses `REALTIME_SIM_INTERVAL_MS` and `REALTIME_TRADE_INTERVAL_MS`
- **Simulated/Historical mode**: Uses `SIM_INTERVAL_MS` and `TRADE_INTERVAL_MS`

### API pacing options

- `LLM_REQUEST_SPACING_MS`: Staggers agent calls sequentially with a fixed delay between each request.
- `LLM_AUTO_SPACING`: When set to `true`, derives a delay automatically from the active simulation interval (e.g. `REALTIME_SIM_INTERVAL_MS / number_of_agents`).
- `LLM_MIN_REQUEST_SPACING_MS`: Guarantees a minimum delay when auto spacing is enabled.
- `LLM_MAX_CONCURRENT_REQUESTS`: Limits the number of concurrent LLM calls when spacing is disabled but you still need to cap bursts.

These knobs make it straightforward to trade API tickets for latency. In practice, a good starting point is `LLM_AUTO_SPACING=true` with `LLM_MIN_REQUEST_SPACING_MS=2000`, which spaces decisions across a 10-minute `REALTIME_SIM_INTERVAL_MS` while still finishing before the next tick.

## Expected Behavior

### During Market Hours (9:30 AM - 4:00 PM ET)
- Price ticks every 10 minutes (or `REALTIME_SIM_INTERVAL_MS`)
- Trading windows every 30 minutes (9:30, 10:00, 10:30, 11:00, 11:30, 12:00, 12:30, 1:00, 1:30, 2:00, 2:30, 3:00, 3:30, 4:00)
- Real market data fetched and used
- Intraday hours progress from 0 to 6.5

### Outside Market Hours
- No processing
- Simulation pauses
- Waits for next market open

### Day Advancement
- Only happens when market closes and reopens
- Tracks actual calendar dates
- Agents make trading decisions at start of each new trading day
- **Day 0 Trading**: Agents can trade from the initial day (day 0) - no need to wait for day 1

## Known Limitations

1. **Timezone**: Currently assumes server timezone matches ET or uses UTC
2. **Holiday Calendar**: Basic holiday checking (New Year's, July 4th, Christmas)
3. **Pre-Market/After-Hours**: Not currently supported (only regular trading hours)

## Recommendations for Production

1. **Add timezone library**: Use `date-fns-tz` or `luxon` for proper ET timezone handling
2. **Expand holiday calendar**: Use a proper market calendar API or library
3. **Add pre-market/after-hours support**: If needed for your use case
4. **Monitor API rate limits**: Ensure fallback data sources are configured
5. **Add health checks**: Monitor if market data fetching is working correctly

