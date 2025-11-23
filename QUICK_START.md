# Quick Start Guide

## How to Run LLM Finance Arena

### Prerequisites
- Node.js 18+ and npm
- OpenRouter API key (for backend LLM calls)

### Step 1: Install Dependencies
```bash
npm install
cd backend && npm install && cd ..
```

### Step 2: Configure Environments
1. Frontend: copy the example file and set the API base if your backend runs elsewhere.
   ```bash
   cp .env.example .env.local
   ```

2. Backend: copy the new backend example and add your keys (keep this file private and out of git).
   ```bash
   cd backend
   cp .env.example .env
   # edit .env to set OPENROUTER_API_KEY and any market-data keys
   cd ..
   ```

### Step 3: Choose Your Mode
Set `MODE` in `backend/.env`:

- `MODE=simulated` (default): generates ticks locally for fast demos, no API keys needed beyond the LLM key.
- `MODE=realtime`: fetches live quotes; add Alpha Vantage or Polygon keys for better coverage.
- `MODE=historical`: replays a specific week at accelerated speed; set `HISTORICAL_SIMULATION_START_DATE`.
- `MODE=hybrid`: replays history until caught up, then switches to live trading.

### Step 4: Run the Application
Start the backend in one terminal:
```bash
cd backend
npm run dev
```

Start the frontend from the project root in another terminal:
```bash
npm run dev
```

The app will start at `http://localhost:3000` and poll the backend at `http://localhost:8080/api` by default.

### Step 5: Start the Simulation
1. Click the "Start Live" button in the header.
2. Watch the agents make trading decisions.
3. View performance on the leaderboard.
4. Click on any agent to see detailed metrics.

### Important Notes
- Keep API keys in `backend/.env` or your hosting provider's secret store—never commit secrets.
- Price log exports (`price-logs-session-*.json`) are git-ignored so you can save local runs safely.
- The MIT License applies to the codebase; trading activity is simulated and not financial advice.

### Troubleshooting

**"No API key configured"**
- Ensure `OPENROUTER_API_KEY` is set in `backend/.env`.
- Restart the backend after changing environment variables.

**Rate limit errors**
- Use `MODE=simulated` while iterating to avoid external API usage.
- Provide Alpha Vantage or Polygon keys for more resilient real-time data.

**CORS errors**
- Run the frontend with `npm run dev` instead of opening `index.html` directly.
- Confirm `ALLOWED_ORIGINS` in `backend/.env` includes your frontend URL.

### File Structure
```
├── App.tsx                    # Root React application
├── hooks/                     # Frontend hooks
├── services/                  # API client and helpers
├── components/                # UI components
├── backend/                   # Fastify backend
└── shared/                    # Shared types and utilities
```

### Next Steps
- See [ENV_SETUP.md](./ENV_SETUP.md) for detailed environment configuration.
- See [README.md](./README.md) for full documentation and community links.


