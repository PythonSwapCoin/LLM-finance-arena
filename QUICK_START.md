# Quick Start Guide

## How to Run LLM Finance Arena

### Prerequisites
- Node.js installed (v18 or higher recommended)
- OpenRouter API key (for LLM access)

### Step 1: Install Dependencies
```bash
npm install
```

### Step 2: Configure Environment
1. Copy the example environment file:
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env.local
   
   # Windows (CMD) or Mac/Linux
   cp .env.example .env.local
   ```

2. Edit `.env.local` and add your OpenRouter API key:
   ```env
   VITE_OPENROUTER_API_KEY=your_openrouter_api_key_here
   ```

3. Choose your mode (see below)

### Step 3: Choose Your Mode

#### Mode 1: Simulated Data (Default - Fast Testing)
- No additional configuration needed
- Uses randomly generated market data
- Perfect for testing the UI and functionality
- Runs fast (3 seconds per update)

#### Mode 2: Real-Time Market Data
Add to `.env.local`:
```env
VITE_USE_REAL_DATA=true
```
- Fetches real market data from Yahoo Finance (no API key needed)
- Falls back to Alpha Vantage or Polygon.io if you have keys
- Updates every 30 minutes (when running in real-time mode)
- LLMs trade every 2 hours (at market open, 10 AM, 12 PM, 2 PM ET)

#### Mode 3: Historical Simulation
Add to `.env.local`:
```env
VITE_USE_HISTORICAL_SIMULATION=true
```
- Uses real historical data for a specific week
- Default: First week of 2025 (Jan 6-10)
- Automatically stops after 5 days
- Perfect for backtesting

### Step 4: Run the Application
```bash
npm run dev
```

The app will start at `http://localhost:3000`

### Step 5: Start the Simulation
1. Click the "Start Live" button in the header
2. Watch the agents make trading decisions
3. View performance on the leaderboard
4. Click on any agent to see detailed metrics

### Important Notes

**For Real-Time Mode:**
- The simulation currently runs at 3-second intervals (fast mode)
- For actual 30-minute intervals, you'll need to modify `App.tsx` line 43
- Keep your browser/computer running for the entire week
- State is NOT persisted - if you close the browser, you'll lose progress

**For Historical Mode:**
- Runs automatically through 5 days
- Exports data when complete
- No need to keep running for a week

**Exporting Data:**
- Click "Stop & Export" to download simulation results
- Click "Logs" button to download system logs
- Files are saved to your Downloads folder

### Troubleshooting

**"No API key configured"**
- Make sure `VITE_OPENROUTER_API_KEY` is set in `.env.local`
- Restart the dev server after changing `.env.local`

**Rate limit errors**
- Free tier APIs have rate limits
- Use simulated mode for testing
- Consider upgrading API plans for production

**CORS errors**
- Make sure you're using `npm run dev`, not opening HTML directly
- The app must run through the Vite dev server

### File Structure
```
├── App.tsx                    # Main application component
├── hooks/
│   └── useSimulation.ts      # Simulation logic
├── services/
│   ├── marketDataService.ts  # Market data fetching
│   ├── geminiService.ts      # LLM API calls
│   ├── logger.ts              # Logging system
│   └── yfinanceService.ts    # Yahoo Finance integration
├── components/               # UI components
├── constants.ts              # Configuration
└── types.ts                 # TypeScript types
```

### Next Steps
- See [ENV_SETUP.md](./ENV_SETUP.md) for detailed environment configuration
- See [README.md](./README.md) for full documentation


