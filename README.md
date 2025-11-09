<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# LLM Finance Arena

A web-based platform that benchmarks large-language models (LLMs) acting as autonomous equity portfolio managers. The system can use either simulated or real stock market data, allows each model to place trades under identical conditions, and displays a public leaderboard of performance metrics.


## Features

- **Multiple LLM Agents**: Compete different AI models (Gemini, Claude, Grok, DeepSeek, Qwen) as portfolio managers
- **Real or Simulated Market Data**: Switch between real-time market data and simulated data
- **Performance Metrics**: Track total return, Sharpe ratio, volatility, max drawdown, and turnover
- **Live Trading Simulation**: Watch agents make trading decisions in real-time
- **OpenRouter Integration**: Use OpenRouter API to access multiple LLM providers through a single interface

## Architecture

This application is split into **frontend** and **backend**:
- **Frontend**: React app that displays data from the API
- **Backend**: Node.js API (Vercel serverless functions) that handles market data, LLM calls, and calculations

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [BACKEND_SETUP.md](./BACKEND_SETUP.md) for detailed information.

## Run Locally

**Prerequisites:** Node.js (v18+), Vercel CLI (for backend)

### Quick Start (3 Steps)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   # Windows (PowerShell)
   Copy-Item .env.example .env.local
   
   # Windows (CMD) or Mac/Linux
   cp .env.example .env.local
   ```
   
   Then edit `.env.local` and add your OpenRouter API key:
   ```env
   VITE_OPENROUTER_API_KEY=your_key_here
   ```

3. **Run the app:**
   ```bash
   npm run dev
   ```
   
   Open `http://localhost:3000` in your browser.

**For detailed setup instructions, see [QUICK_START.md](./QUICK_START.md)**

### Full Setup (Real Market Data + OpenRouter)

1. Install dependencies:
   ```bash
   npm install
   ```

2. Copy the example environment file:
   ```bash
   cp .env.example .env.local
   ```

3. Get API keys:

   **For LLM Access (OpenRouter - Recommended):**
   - Sign up at [OpenRouter](https://openrouter.ai/)
   - Get your API key from [OpenRouter Keys](https://openrouter.ai/keys)
   - Set `VITE_OPENROUTER_API_KEY` in `.env.local`
   - Set `VITE_USE_OPENROUTER=true`


   **For Real Market Data:**
   - **Alpha Vantage** (Free tier available):
     - Sign up at [Alpha Vantage](https://www.alphavantage.co/support/#api-key)
     - Free tier: 5 API calls/minute, 500 calls/day
     - Set `VITE_ALPHA_VANTAGE_API_KEY` in `.env.local`
   
   - **OR Polygon.io** (Alternative):
     - Sign up at [Polygon.io](https://polygon.io/)
     - Free tier: 5 API calls/minute
     - Set `VITE_POLYGON_API_KEY` in `.env.local`

4. Configure environment variables in `.env.local`:
   
   **See [ENV_SETUP.md](./ENV_SETUP.md) for detailed instructions.**
   
   **Quick setup:**
   ```bash
   # Copy example file
   cp .env.example .env.local
   
   # Edit .env.local and add your OpenRouter API key
   # Then choose ONE mode (see ENV_SETUP.md for details):
   ```
   
   **Modes:**
   - **Mode 1 (Default):** Simulated data - no API keys needed
   - **Mode 2:** Real-time data - `VITE_USE_REAL_DATA=true`
   - **Mode 3:** Historical simulation - `VITE_USE_HISTORICAL_SIMULATION=true`
   
   The console will show which mode is active when you start the app.

5. Run the app:
   ```bash
   npm run dev
   ```

## Configuration Modes

### Simulated Mode (Default)
- No API keys required
- Uses randomly generated market data
- Perfect for testing and development
- Set `VITE_USE_REAL_DATA=false` or omit the variable

### Real Market Data Mode
- Uses cascade system: Yahoo Finance (default, no API key) → Alpha Vantage → Polygon.io
- Automatically falls back to next source if one fails
- Fetches real-time stock prices
- Set `VITE_USE_REAL_DATA=true`
- **Note**: Free tier APIs have rate limits (5 calls/minute)
- **Yahoo Finance**: Uses a TypeScript implementation of yfinance functionality (no API key needed, used by default)

### Historical Simulation Mode (New!)
- Uses real market data for a specific week (Mon-Fri)
- Default: First week of 2025 (Jan 6-10, 2025)
- Simulates trading as if starting at the beginning of that week
- Runs through the full week using actual historical prices
- Automatically stops after completing all 5 days
- Perfect for backtesting strategies with real data
- Set `VITE_USE_HISTORICAL_SIMULATION=true`
- Optional: Set `VITE_HISTORICAL_SIMULATION_START_DATE=YYYY-MM-DD` to use a different week
- **Note**: This mode fetches historical data from Yahoo Finance using yfinance-like service (no API key needed)

### LLM Provider: OpenRouter

This project uses **OpenRouter only** for LLM access:
- Access to multiple LLM providers (Gemini, Claude, Grok, DeepSeek, Qwen, GPT-4, etc.)
- Single API key for all models
- Set `VITE_OPENROUTER_API_KEY=your_key` in `.env.local`

## Model Mapping

The following models are available through OpenRouter:
- `gemini-2.5-pro` → `google/gemini-2.0-flash-exp:free`
- `gemini-2.5-flash` → `google/gemini-2.0-flash-exp:free`
- `claude-4.5-sonnet` → `anthropic/claude-3.5-sonnet`
- `grok-4` → `x-ai/grok-beta`
- `deepseek-v3.1` → `deepseek/deepseek-chat`
- `qwen-3-max` → `qwen/qwen-2.5-72b-instruct`

## Troubleshooting

- **"No API key configured"**: Make sure you've set `VITE_OPENROUTER_API_KEY` in `.env.local`
- **Rate limit errors**: Free tier APIs have rate limits. Consider upgrading or using simulated mode for testing
- **Market data errors**: If real data fails, the app will automatically fall back to simulated data
- **CORS errors**: Make sure you're running the app through the dev server (`npm run dev`), not opening the HTML file directly

## License

All trades are simulated and not financial advice.
