# Price Logging Feature

This feature logs individual stock prices and portfolio values for each time step, allowing you to debug issues with portfolio calculations and price movements.

## What Gets Logged

For each price tick (every time the simulation steps forward), the system logs:

1. **Stock Prices**: For each ticker in the market:
   - Current price
   - Daily change (absolute)
   - Daily change percent
   - Timestamp, day, and intraday hour

2. **Portfolio Values**: For each agent:
   - Agent ID and name
   - Cash balance
   - All positions (ticker, quantity, average cost, current price, position value)
   - Total portfolio value
   - Previous value (for comparison)
   - Value change and change percent (compared to previous step)

## How to Export Price Logs

### Automatic Export

Price logs are **automatically exported** in the following situations:

1. **Daily Export**: When a new trading day starts (at the start of each day)
2. **On Simulation Stop**: When you stop the simulation scheduler
3. **On Completion**: When a historical simulation completes

Exported files are saved to `./data/logs/` with filenames like:
`price-logs-session-{timestamp}-{date}.json`

### Manual Export

#### Windows (PowerShell)

**Option 1: Use the provided PowerShell script**
```powershell
.\export-price-logs.ps1
```

Or specify a custom backend URL:
```powershell
.\export-price-logs.ps1 http://localhost:8080
```

**Option 2: Use the batch file (double-click or run from command prompt)**
```cmd
export-price-logs.bat
```

**Option 3: Use PowerShell directly**
```powershell
Invoke-RestMethod -Uri "http://localhost:8080/api/price-logs/export" -Method Post
```

#### Via API Endpoint (Any Platform)

**Export all price logs:**
```bash
POST /api/price-logs/export
```

**Get price movement summary:**
```bash
GET /api/price-logs/summary
GET /api/price-logs/summary?day=5  # For a specific day
```

#### Using curl (if available)

```bash
curl -X POST http://localhost:8080/api/price-logs/export
```

### Export File Structure

The exported JSON file contains:

```json
{
  "sessionId": "session-1234567890",
  "exportTimestamp": "2025-01-11T12:00:00.000Z",
  "summary": {
    "totalEntries": 1000,
    "daysCovered": 5,
    "dayRange": { "min": 0, "max": 4 },
    "tickers": ["AAPL", "MSFT", ...],
    "agents": ["agent-1", "agent-2", ...]
  },
  "logsByDay": {
    "0": [/* all log entries for day 0 */],
    "1": [/* all log entries for day 1 */],
    ...
  },
  "allLogs": [/* chronological list of all log entries */]
}
```

Each log entry contains:
- `timestamp`: Unix timestamp
- `day`: Day number
- `intradayHour`: Hour within the day (0-16)
- `stockPrices`: Array of stock price data
- `portfolioValues`: Array of portfolio value data

## Analyzing the Logs

### Finding Large Portfolio Movements

Look for entries where `valueChangePercent` is unusually large (positive or negative). This indicates a sudden change in portfolio value.

### Comparing Stock Prices vs Portfolio Values

For each agent, you can:
1. Find their positions in `portfolioValues[].positions`
2. Check the corresponding stock prices in `stockPrices[]`
3. Verify that `totalValue = cash + sum(positionValue)` where `positionValue = quantity * currentPrice`

### Day-by-Day Analysis

Use `logsByDay` to focus on a specific day, or use the summary endpoint with `?day=X` to get aggregated statistics for that day.

## Example: Debugging Large Movements

If you see portfolios jumping around:

1. Export the logs: `POST /api/price-logs/export`
2. Open the JSON file
3. Search for entries with large `valueChangePercent` values
4. For those entries, check:
   - What stocks changed price (`stockPrices`)
   - What positions the agent holds (`portfolioValues[].positions`)
   - Whether the calculation is correct: `totalValue = cash + sum(quantity * currentPrice)`

## Log Retention

- Logs are kept in memory (up to 10,000 entries by default)
- Logs persist until the server restarts
- Export logs regularly if you need to keep historical data
- Logs are automatically cleared when the server restarts

## Performance Impact

Price logging has minimal performance impact:
- Logging happens asynchronously
- If logging fails, it won't break the simulation
- Memory usage is limited to 10,000 entries

