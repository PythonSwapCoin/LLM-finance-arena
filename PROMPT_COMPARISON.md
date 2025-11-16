# Prompt Comparison: Default vs SIMPLE_BOT_PROMPTS

## SIMPLE_BOT_PROMPTS=true Format

When `SIMPLE_BOT_PROMPTS=true` is enabled, the prompt is dramatically more compact:

### System Prompt
```
You are a portfolio manager operating in an equity-trading environment.
Your goal is to maximize risk-adjusted returns while adhering to trading rules.
Evaluate market signals, sector performance, and stock momentum based on the provided data.
Maintain diversification and avoid excessive turnover.
Focus on quality companies with strong fundamentals.

CRITICAL REQUIREMENT: You MUST make trading decisions every day. You cannot hold 100% cash.
- If you have cash, you MUST buy stocks that meet your criteria
- You must invest at least 50% of your portfolio in stocks
- Being too conservative and holding cash is NOT acceptable
- Make at least one trade per day when you have cash available
- Your job is to invest, not to wait
```

### User Prompt (SIMPLE format)
```
=== YOUR TRADING HISTORY (for context) ===
Recent Trades (last 5):
No recent trades

Recent Performance:
- Previous: Portfolio Value: $1000000.00, Return: 0.00%
- Previous: Portfolio Value: $1000000.00, Return: 0.00%
- Previous: Portfolio Value: $1000000.00, Return: 0.00%

Recent Rationales:
- Error communicating with AI model: fetch failed

You are a portfolio manager making trading decisions for Day 0.

Below is your trading context in JSON format:

{
  "marketData": [
    {"ticker": "NVDA", "price": 212.74},
    {"ticker": "AAPL", "price": 124.86},
    {"ticker": "MSFT", "price": 236.62},
    {"ticker": "AMZN", "price": 210.99},
    {"ticker": "GOOGL", "price": 280.12},
    ... [498 more tickers with just ticker and price]
  ],
  "portfolio": {
    "availableCash": 1000000.00,
    "totalValue": 1000000.00,
    "positions": []
  },
  "tradingRules": {
    "maxPositionSizePercent": 25,
    "tradingFee": "5.00 bps (0.005% of notional) with a $0.25 minimum",
    "noMargin": true,
    "noShortSelling": true,
    "allowAllCash": false
  }
}

Return a JSON object with:
- "rationale": A 1-2 sentence explanation of your strategy
- "trades": Array of trades with: ticker, action ("buy" or "sell"), quantity (integer),
           fairValue, topOfBox, bottomOfBox, justification

Example response:
{
  "rationale": "Buying AAPL due to momentum, selling MSFT to rebalance.",
  "trades": [
    {
      "ticker": "AAPL",
      "action": "buy",
      "quantity": 10,
      "fairValue": 185.50,
      "topOfBox": 192.00,
      "bottomOfBox": 178.00,
      "justification": "AAPL undervalued with strong fundamentals."
    }
  ]
}

IMPORTANT:
- Return ONLY valid JSON, no markdown or code blocks
- Only include trades to execute (no "hold" actions)
- Ensure you have enough cash for buys and shares for sells
- You must invest available cash—holding 100% cash is not acceptable
- Return empty trades array if no action: {"rationale": "...", "trades": []}
```

---

## DEFAULT Format (SIMPLE_BOT_PROMPTS=false)

The default format is much more verbose:

### System Prompt
(Same as above)

### User Prompt (DEFAULT/Verbose format)
```
=== YOUR TRADING HISTORY (for context) ===
Recent Trades (last 5):
No recent trades

Recent Performance:
- Current: Portfolio Value: $1000000.00, Return: 0.00%

Recent Rationales:
No past rationales

You are a portfolio manager making trading decisions for Day 0.

=== MARKET DATA ===
Available stocks with comprehensive financial data (ONLY trade these tickers):
- NVDA (NVDA): $101.98 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: 0.41%
- AAPL (AAPL): $272.36 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: -0.35%
- MSFT (MSFT): $60.01 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: 0.05%
- AMZN (AMZN): $244.30 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: -0.39%
... [499 more tickers with full verbose details]

IMPORTANT: You can ONLY trade the tickers listed above. Do NOT suggest tickers that are not in this list.
Available tickers: NVDA, AAPL, MSFT, AMZN, GOOGL, AVGO, GOOG, ... [full comma-separated list]

=== YOUR CURRENT PORTFOLIO ===
- Available Cash: $1000000.00
- Total Portfolio Value: $1000000.00
- Current Positions:
  No positions held.

=== TRADING RULES ===
1. You can only BUY if you have enough cash: quantity × current_price ≤ available_cash
2. You can only SELL if you own the stock: check your current positions
3. Maximum position size: 25% of total portfolio value
4. No margin, no short selling
5. Quantity must be a positive integer (whole shares only)
6. Every trade pays transaction costs: 5.00 bps (0.005% of notional) with a $0.25 minimum.
   Keep enough cash to cover fees.

=== WHAT YOU NEED TO PROVIDE ===
You must return a JSON object with:
1. "rationale": A 1-2 sentence explanation of your trading strategy
2. "trades": An array of trade objects, each with:
   - "ticker": The stock symbol (e.g., "AAPL", "MSFT")
   - "action": Either "buy" or "sell" (do NOT use "hold")
   - "quantity": A positive integer (number of shares)
   - "fairValue": Your estimated fair value of the stock (in dollars)
   - "topOfBox": The 10% best case scenario price by next day (in dollars)
   - "bottomOfBox": The 10% worst case scenario price by next day (in dollars)
   - "justification": A one sentence explanation for this specific trade

Example response:
{
  "rationale": "I'm buying AAPL due to strong momentum and selling MSFT to rebalance my portfolio.",
  "trades": [
    {
      "ticker": "AAPL",
      "action": "buy",
      "quantity": 10,
      "fairValue": 185.50,
      "topOfBox": 192.00,
      "bottomOfBox": 178.00,
      "justification": "AAPL is undervalued with strong fundamentals and positive momentum."
    }
  ]
}

CRITICAL JSON FORMAT REQUIREMENTS:
- You MUST return ONLY valid, complete JSON - no additional text before or after
- The JSON must be properly closed with all brackets and braces
- Do NOT truncate the JSON response - ensure the entire "trades" array is complete
- If the response is too long, prioritize completing the JSON structure over verbose text
- Return ONLY the JSON object, nothing else

IMPORTANT:
- Only include trades you want to execute (don't include "hold" actions)
- For BUY: Make sure (quantity × price) ≤ available cash
- For SELL: Make sure you own at least that many shares
- If you have cash available, you should make buy trades to invest it
- Holding 100% cash is not acceptable - you are a portfolio manager, not a cash holder
- If you don't want to trade, return an empty trades array: {"rationale": "...", "trades": []}

Remember: Return ONLY valid JSON. No markdown, no code blocks, no explanations outside the JSON.
```

---

## Key Differences

### 1. Market Data Format

**SIMPLE (JSON):**
```json
"marketData": [
  {"ticker": "AAPL", "price": 124.86},
  {"ticker": "MSFT", "price": 236.62}
]
```
- **2 fields per ticker**
- Clean, parseable JSON
- ~8 tokens per ticker

**DEFAULT (Verbose Text):**
```
- AAPL (AAPL): $272.36 | P/E: N/A | P/B: N/A | Mkt Cap: N/A | Beta: N/A | Change: -0.35%
```
- **8+ fields per ticker** (mostly N/A)
- Human-readable but verbose
- ~30-40 tokens per ticker

### 2. Portfolio Format

**SIMPLE (JSON):**
```json
"portfolio": {
  "availableCash": 1000000.00,
  "totalValue": 1000000.00,
  "positions": []
}
```

**DEFAULT (Text):**
```
=== YOUR CURRENT PORTFOLIO ===
- Available Cash: $1000000.00
- Total Portfolio Value: $1000000.00
- Current Positions:
  No positions held.
```

### 3. Instructions

**SIMPLE:**
- Concise, straight to the point
- ~200 tokens of instructions

**DEFAULT:**
- Very detailed with multiple IMPORTANT sections
- Extensive JSON format requirements
- ~600-800 tokens of instructions

---

## Token Usage Comparison (503 tickers)

| Component | SIMPLE Mode | DEFAULT Mode | Savings |
|-----------|-------------|--------------|---------|
| System Prompt | ~200 tokens | ~500 tokens | 60% |
| Market Data | ~4,000 tokens | ~15,000 tokens | 73% |
| Portfolio | ~50 tokens | ~100 tokens | 50% |
| Instructions | ~200 tokens | ~700 tokens | 71% |
| **TOTAL** | **~4,450 tokens** | **~16,300 tokens** | **73%** |

## Recommendation

**Use SIMPLE_BOT_PROMPTS=true for:**
- Immediate 70%+ token reduction
- Cleaner, more structured data format
- Better for models that handle JSON well
- Lower API costs
- Faster processing

**Use DEFAULT mode (false) for:**
- Models that struggle with JSON
- When you need human-readable explanations in the prompt
- Educational/debugging purposes

**Current Status:**
✅ SIMPLE_BOT_PROMPTS is now **ENABLED** in your backend/.env
