# Example OpenRouter API Prompt

This document shows an example of the prompts being sent to OpenRouter for each trading agent.

## Observations

### Current Prompt Structure (Default Mode)

The system currently sends prompts with the following structure:

```
================================================================================
PROMPT FOR [Agent Name] ([model-name])
================================================================================

--- SYSTEM PROMPT ---
[Agent's system prompt - defines trading philosophy and rules]

--- USER PROMPT ---

=== YOUR TRADING HISTORY (for context) ===
Recent Trades (last 5):
[Last 5 trades or "No recent trades"]

Recent Performance:
[Last 3 performance snapshots]

Recent Rationales:
[Last 3 trading rationales]


=== MARKET DATA ===
Available stocks with comprehensive financial data (ONLY trade these tickers):
[ALL 503 TICKERS WITH FULL DATA - This is the main inefficiency!]
- NVDA (NVDA): $101.98 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: 0.41%
- AAPL (AAPL): $272.36 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: -0.35%
... [500+ more tickers with same format]

IMPORTANT: You can ONLY trade the tickers listed above. Do NOT suggest tickers that are not in this list.
Available tickers: [comma-separated list of all 503 tickers]


=== YOUR CURRENT PORTFOLIO ===
- Available Cash: $X
- Total Portfolio Value: $X
- Current Positions:
  [List of positions with detailed stats]


=== TRADING RULES ===
1. You can only BUY if you have enough cash
2. You can only SELL if you own the stock
3. Maximum position size: 25% of total portfolio value
4. No margin, no short selling
5. Quantity must be a positive integer
6. Every trade pays transaction costs: [fee details]


=== WHAT YOU NEED TO PROVIDE ===
You must return a JSON object with:
1. "rationale": A 1-2 sentence explanation
2. "trades": Array of trade objects with ticker, action, quantity, fairValue, topOfBox, bottomOfBox, justification

[Example JSON response format]

CRITICAL JSON FORMAT REQUIREMENTS:
- Return ONLY valid JSON
- Complete the entire trades array
- No markdown or code blocks

IMPORTANT:
- Only include trades you want to execute
- For BUY: Make sure you have enough cash
- For SELL: Make sure you own the shares
- If you have cash available, you should invest it
- Holding 100% cash is not acceptable
```

## Efficiency Issues Identified

### 1. **Market Data Overload (BIGGEST ISSUE)**
   - **Problem**: Every prompt includes ALL 503 tickers with full financial data
   - **Current size**: ~50-100 KB per prompt just for market data
   - **Impact**:
     - High token cost (estimated 10,000-15,000 tokens just for market data)
     - Most agents only trade 5-10 stocks
     - 99% of the market data is never used
   - **Recommendation**:
     - Only include tickers that are relevant to the agent's current positions
     - Or limit to top 20-50 stocks by market cap
     - Or use the `SIMPLE_BOT_PROMPTS` mode which strips this down

### 2. **Missing Financial Data**
   - **Problem**: Most P/E, P/B, Market Cap, Beta values show as "N/A"
   - **Why**: Simulated mode doesn't include these metrics
   - **Impact**: The verbose format claims to show "comprehensive financial data" but most fields are empty
   - **Recommendation**: Either populate these fields or use a simpler format

### 3. **Repetitive Instructions**
   - Multiple "IMPORTANT" sections saying the same thing
   - Trading rules repeated in system prompt and user prompt
   - Could be consolidated

### 4. **Verbose JSON Instructions**
   - The JSON format instructions are very detailed (necessary for some models)
   - Could potentially be shortened for better-performing models

## SIMPLE_BOT_PROMPTS Mode

The codebase already has a `SIMPLE_BOT_PROMPTS` option that addresses some of these issues:

**When enabled (`SIMPLE_BOT_PROMPTS=true`):**
- Uses pure JSON format instead of verbose markdown
- Only includes ticker and price (strips P/E, P/B, etc.)
- Much more concise prompts
- Estimated 70-80% token reduction

**Example of SIMPLE mode:**
```json
{
  "marketData": [
    {"ticker": "AAPL", "price": 272.36},
    {"ticker": "MSFT", "price": 60.01},
    ...
  ],
  "portfolio": {
    "availableCash": 10000.00,
    "totalValue": 10000.00,
    "positions": []
  },
  "tradingRules": {
    "maxPositionSizePercent": 25,
    "tradingFee": "5.00 bps with $0.25 minimum"
  }
}
```

## Recommendations for Efficiency

1. **Enable `SIMPLE_BOT_PROMPTS=true` in .env** - Immediate 70-80% token reduction
2. **Limit market data to relevant tickers** - Only show:
   - Current portfolio positions
   - Top 20-50 stocks by market cap
   - Or allow agents to "request" specific tickers
3. **Remove empty/N/A financial metrics** - Don't show fields that are always empty
4. **Consider caching system prompts** - Some providers support caching
5. **Batch similar agents** - If multiple agents use same data, structure prompts to maximize cache hits

## Token Usage Estimates

**Current (default verbose mode):**
- System prompt: ~500 tokens
- Market data (503 tickers): ~10,000-15,000 tokens
- Portfolio + rules + instructions: ~1,000 tokens
- **Total: ~11,500-16,500 tokens per call**

**With SIMPLE_BOT_PROMPTS=true:**
- System prompt: ~200 tokens
- Market data (503 tickers, minimal): ~3,000 tokens
- Portfolio + rules: ~500 tokens
- **Total: ~3,700 tokens per call** (77% reduction)

**Optimal (SIMPLE + limited tickers to 50):**
- System prompt: ~200 tokens
- Market data (50 tickers, minimal): ~300 tokens
- Portfolio + rules: ~500 tokens
- **Total: ~1,000 tokens per call** (94% reduction)

## How to Test Different Modes

Add to `backend/.env`:
```bash
# Enable simple/compact prompts
SIMPLE_BOT_PROMPTS=true

# Limit number of tickers (future enhancement)
# ARENA_TICKER_COUNT=50
```

The logging I added will show you the exact prompts being sent.
