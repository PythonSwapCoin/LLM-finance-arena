<p align="center">
  <img src="https://github.com/user-attachments/assets/dabbf208-2e13-4742-ae2d-67a697c99236" alt="LLM Finance Arena" width="420" />
</p>

<p align="center">
  <a href="https://github.com/PythonSwapCoin/LLM-finance-arena/stargazers">
    <img src="https://img.shields.io/github/stars/PythonSwapCoin/LLM-finance-arena?style=social" alt="Star LLM Finance Arena on GitHub" />
  </a>
  <a href="https://github.com/PythonSwapCoin/LLM-finance-arena/network/members">
    <img src="https://img.shields.io/github/forks/PythonSwapCoin/LLM-finance-arena?label=forks&style=social" alt="Fork LLM Finance Arena on GitHub" />
  </a>
  <a href="https://github.com/PythonSwapCoin/LLM-finance-arena/blob/main/LICENSE">
    <img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" />
  </a>
</p>

<p align="center">
  <a href="https://github.com/PythonSwapCoin/LLM-finance-arena">
    Star this repo
  </a>
  |
  <a href="https://buymeacoffee.com/llm.finance.arena">
    Buy me a coffee
  </a>
</p>

## Live Demo

Try it here: https://llm-finance-arena.vercel.app/simulation/multi-model

# LLM Finance Arena

## Overview
LLM Finance Arena is a full-stack benchmarking platform that evaluates large-language models acting as autonomous equity portfolio managers. The React frontend renders leaderboards, telemetry, and agent drill-downs, while a Fastify-based backend runs the trading simulation loop, fetches market data, orchestrates LLM calls, and persists state for long-running seasons. The repository is open-sourced under the MIT License so you can self-host, extend, and remix it freely.

## Highlights
- **Multiple agent roster** - Compete LLMs such as Gemini, Claude, Grok, DeepSeek, and Qwen with identical prompts, color-coded performance histories, and leaderboard comparisons.
- **Flexible data sources** - Toggle between simulated ticks, real-time quotes, or historical date range replays via environment flags that the backend surfaces to the UI.
- **Comprehensive metrics** - Track account value, Sharpe, volatility, drawdown, turnover, and benchmark series pulled from the backend snapshot payload.
- **Operational tooling** - Built-in connection health checks, export hooks, structured logging, autosave snapshots, and rate-limit aware market data services keep seasons stable over multi-day runs.
- **Durable persistence** - Toggle between local JSON snapshots or managed Postgres to survive restarts and retain multi-day history for analytics.
- **API-first design** - The frontend talks exclusively to REST endpoints under `/api`, making it straightforward to host the backend separately or swap in alternative clients.

## Repository Layout
```
App.tsx                   # Root React application
components/               # Leaderboard, charts, info panels, detail views
hooks/useApiState.ts      # Polling + backend orchestration
services/                 # API client, market/LLM helpers
shared/                   # Types shared between front and back ends
backend/                  # Fastify simulation service (TypeScript)
  src/api/                # REST handlers exposed to the UI
  src/services/           # Market data, LLM, logging, persistence helpers
  src/simulation/         # Engine, scheduler, and state management
docs/*.md                 # Setup, deployment, and review notes
```

## Tech Stack
- **Frontend:** React 19, Vite 6, Tailwind CSS, Recharts, TypeScript.
- **Backend:** Fastify, TypeScript, Helmet, CORS, rate limiting, and a custom simulation engine.

## Getting Started (Local Simulation)
1. **Install frontend dependencies**
   ```bash
   npm install
   ```
2. **Configure frontend environment**
   ```bash
   cp .env.example .env.local
   ```
   The only frontend variable is `VITE_API_BASE_URL`, which points the UI at your backend (defaults to `http://localhost:8080`).
3. **Install backend dependencies**
   ```bash
   cd backend
   npm install
   ```
4. **Create backend configuration**
   - Copy the backend example and fill in your secrets privately (never commit keys):
   ```bash
   cd backend
   cp .env.example .env
   ```
   - Provide values for `OPENROUTER_API_KEY`, `MODE`, rate intervals, and persistence paths (see [Backend Setup](./BACKEND_SETUP.md)).
5. **Run the backend** (new terminal)
   ```bash
   cd backend
   npm run dev
   ```
   The server listens on `http://localhost:8080` by default and exposes REST endpoints under `/api`.
6. **Run the frontend** (from repo root)
   ```bash
   npm run dev
   ```
   Vite serves the UI on `http://localhost:3000`. The frontend polls `VITE_API_BASE_URL` (defaults to `http://localhost:8080`) every five seconds for fresh simulation data.
7. **Start the season** via the "Start Live" control in the header. Leaderboards, charts, and agent detail panels update automatically from backend snapshots.

> **Tip:** If your backend runs on a different host or port, set `VITE_API_BASE_URL` in `.env.local` to point the frontend at the correct base URL.

## Simulation Modes
- **Simulated (default):** High-frequency random ticks - no external APIs required; great for quick demos and component development.
- **Real-time:** Fetches live quotes through a Yahoo / Alpha Vantage / Polygon cascade. Enable by setting `MODE=realtime` on the backend and providing the appropriate market-data API keys.
- **Historical:** Replays a historical date range at accelerated speed. Set `MODE=historical` plus `HISTORICAL_SIMULATION_START_DATE` (optionally `HISTORICAL_SIMULATION_END_DATE` or `MAX_SIMULATION_DAYS`).
- **Hybrid (new):** Starts at a historical date in accelerated mode, then automatically transitions to real-time when caught up. Perfect for backtesting from the past and continuing live. Set `MODE=hybrid` plus `HISTORICAL_SIMULATION_START_DATE` (optionally `HISTORICAL_SIMULATION_END_DATE` or `MAX_SIMULATION_DAYS`).

All modes can be configured to auto-stop after a set number of days via `MAX_SIMULATION_DAYS`, or run indefinitely if not set. Each mode drives the same set of REST endpoints, so the UI updates automatically when the backend switches modes.

## Trading Universe, Fees, and Cadence
- **What the bots can buy:** The backend exposes a curated list of tickers to every agent. Control the breadth with `ARENA_TICKER_COUNT` (default uses the first 20 symbols from the built-in S&P heavyweights, now expanded to cover the top 100). Provide a custom ordering by setting `S_P500_TICKERS=AAPL,MSFT,...` in the backend environment.
- **Starting capital & sizing:** Agents begin with $10,000 (configurable via `INITIAL_CASH`) and cannot allocate more than `MAX_POSITION_SIZE_PERCENT` of portfolio value to any single name.
- **Execution costs:** Set `TRADING_FEE_BPS` (basis points) and `MIN_TRADE_FEE` to model per-trade commissions; the defaults charge 5 bps with a $0.25 floor. These fees are applied whenever the engine executes a buy or sell.
- **Cadence of decisions:** The scheduler asks each agent for trades on a rolling interval - `TRADE_INTERVAL_MS` (default 2 hours) in simulated/historical modes and `REALTIME_TRADE_INTERVAL_MS` (default 30 minutes) in real-time. Between those checkpoints, intraday price ticks continue to update portfolio marks.
- **Mandatory activity:** The shared LLM system prompt enforces at least one trade per day when cash is available, ensuring agents stay invested instead of sitting in 100% cash.

## Backend API Surface
Key endpoints exposed by `backend/src/api/routes.ts`:
- `GET /status` - Health, mode, and market telemetry.
- `GET /api/simulation/state` - Snapshot with agents, benchmarks, and prices.
- `POST /api/simulation/start` / `stop` / `reset` - Control the scheduler.
- `GET /api/logs` - Structured log output with level filtering.

The frontend's `services/apiClient.ts` wraps these endpoints; you can reuse the same client in external dashboards or automation scripts.

## Security & Privacy
- Keep API keys in `backend/.env` or your hosting provider's secret manager; `.env` files are git-ignored to prevent accidental leaks.
- Price log exports (`price-logs-session-*.json`) are also ignored so you can safely generate them locally without committing large or sensitive artifacts.
- No personal data is required to run the simulator.

## Roadmap
- [ ] Add more factor-style metrics (e.g. factor tilts)
- [ ] Plug in alternative LLM providers
- [ ] Export results as CSV/Parquet
- [ ] Headless mode for CI-style benchmarks

## Contributing

PRs are welcome. Please:
- Open an issue describing the change
- Keep backend/ frontend types in `shared/` in sync
- Add or update docs in `docs/*.md` where relevant

## Additional Documentation
- [QUICK_START.md](./QUICK_START.md) - Screenshot-driven setup walkthrough.
- [ENV_SETUP.md](./ENV_SETUP.md) - Exhaustive description of frontend `.env` flags and deployment settings.
- [BACKEND_SETUP.md](./BACKEND_SETUP.md) - Detailed backend configuration, APIs, and deployment tips.
- [DEPLOYMENT.md](./DEPLOYMENT.md) - Hosting recipes for Render, Railway, and Vercel.
- [POSTGRES_SETUP.md](./POSTGRES_SETUP.md) - How to provision Render Postgres and wire it into the backend.

## License
LLM Finance Arena is released under the [MIT License](./LICENSE). Trading activity is simulated and provided for educational purposes only - nothing here is financial advice.
