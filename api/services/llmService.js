import { MAX_POSITION_SIZE_PERCENT, UNIFIED_SYSTEM_PROMPT } from '../types.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn('OPENROUTER_API_KEY is not set. LLM agents will not be able to make trading decisions.');
}

// Helper to add timeout
const withTimeout = (promise, timeoutMs) => {
  return Promise.race([
    promise,
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

// Get trade decisions from LLM
export const getTradeDecisions = async (agent, marketData, day, timeoutMs = 30000) => {
  const portfolioValue = Object.values(agent.portfolio.positions).reduce((acc, pos) => 
    acc + pos.quantity * (marketData[pos.ticker]?.price || 0), agent.portfolio.cash
  );
  
  const systemInstruction = agent.systemPrompt || UNIFIED_SYSTEM_PROMPT;
  const availableCash = agent.portfolio.cash;
  const availableTickers = Object.keys(marketData);
  
  const currentPositions = Object.values(agent.portfolio.positions).map(p => {
    const currentPrice = marketData[p.ticker]?.price || 0;
    const positionValue = p.quantity * currentPrice;
    const positionPercent = portfolioValue > 0 ? (positionValue / portfolioValue) * 100 : 0;
    return {
      ticker: p.ticker,
      quantity: p.quantity,
      avgCost: p.averageCost,
      currentPrice,
      positionValue,
      positionPercent: positionPercent.toFixed(1),
      unrealizedGain: (currentPrice - p.averageCost) * p.quantity,
      unrealizedGainPercent: p.averageCost > 0 ? ((currentPrice - p.averageCost) / p.averageCost * 100).toFixed(2) : '0.00',
      lastFairValue: p.lastFairValue,
      lastTopOfBox: p.lastTopOfBox,
      lastBottomOfBox: p.lastBottomOfBox,
    };
  });

  const prompt = `
You are a portfolio manager making trading decisions for Day ${day}.

=== MARKET DATA ===
Available stocks with comprehensive financial data (ONLY trade these tickers):
${Object.values(marketData).map(d => {
  const peInfo = d.trailingPE ? `P/E: ${d.trailingPE.toFixed(2)}` : 'P/E: N/A';
  const pbInfo = d.priceToBook ? `P/B: ${d.priceToBook.toFixed(2)}` : 'P/B: N/A';
  const marketCapInfo = d.marketCap ? `Mkt Cap: $${(d.marketCap / 1e9).toFixed(1)}B` : 'Mkt Cap: N/A';
  const betaInfo = d.beta ? `Beta: ${d.beta.toFixed(2)}` : 'Beta: N/A';
  const divYieldInfo = d.dividendYield ? `Div Yield: ${(d.dividendYield * 100).toFixed(2)}%` : '';
  const sectorInfo = d.sector ? `Sector: ${d.sector}` : '';
  return `- ${d.ticker} (${d.longName || d.ticker}): $${d.price.toFixed(2)} | ${peInfo} | ${pbInfo} | ${marketCapInfo} | ${betaInfo}${divYieldInfo ? ` | ${divYieldInfo}` : ''}${sectorInfo ? ` | ${sectorInfo}` : ''} | Change: ${(d.dailyChangePercent * 100).toFixed(2)}%`;
}).join('\n')}

IMPORTANT: You can ONLY trade the tickers listed above. Do NOT suggest tickers that are not in this list.
Available tickers: ${availableTickers.join(', ')}

=== YOUR CURRENT PORTFOLIO ===
- Available Cash: $${availableCash.toFixed(2)}
- Total Portfolio Value: $${portfolioValue.toFixed(2)}
- Current Positions:
${currentPositions.length > 0 
  ? currentPositions.map(p => {
      const prevEst = p.lastFairValue !== undefined 
        ? ` | Your Previous Fair Value Estimate: $${p.lastFairValue.toFixed(2)} | Top=$${p.lastTopOfBox?.toFixed(2) ?? 'N/A'}, Bottom=$${p.lastBottomOfBox?.toFixed(2) ?? 'N/A'}`
        : '';
      const fairValueComparison = p.lastFairValue !== undefined 
        ? ` | Current price vs your fair value: ${p.currentPrice > p.lastFairValue ? 'OVERVALUED (price > fair value)' : p.currentPrice < p.lastFairValue ? 'UNDERVALUED (price < fair value)' : 'AT FAIR VALUE'}`
        : '';
      return `  - ${p.ticker}: ${p.quantity} shares @ avg $${p.avgCost.toFixed(2)} | Current: $${p.currentPrice.toFixed(2)} | Value: $${p.positionValue.toFixed(2)} (${p.positionPercent}%) | P&L: $${p.unrealizedGain.toFixed(2)} (${p.unrealizedGainPercent}%)${prevEst}${fairValueComparison}`;
    }).join('\n')
  : '  No positions held.'
}

=== TRADING RULES ===
1. You can only BUY if you have enough cash: quantity × current_price ≤ available_cash
2. You can only SELL if you own the stock: check your current positions
3. Maximum position size: ${MAX_POSITION_SIZE_PERCENT * 100}% of total portfolio value
4. No margin, no short selling
5. Quantity must be a positive integer (whole shares only)

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

IMPORTANT:
- Only include trades you want to execute (don't include "hold" actions)
- For BUY: Make sure (quantity × price) ≤ available cash
- For SELL: Make sure you own at least that many shares
- If you have cash available, you should make buy trades to invest it
- Holding 100% cash is not acceptable - you are a portfolio manager, not a cash holder
`;

  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set. Please configure your OpenRouter API key.');
  }

  try {
    const memoryContext = agent.memory ? `
=== YOUR TRADING HISTORY (for context) ===
Recent Trades (last 5):
${agent.memory.recentTrades.slice(-5).map(t => 
  `- Day ${Math.floor(t.timestamp) + 1}: ${t.action.toUpperCase()} ${t.quantity} ${t.ticker} @ $${t.price.toFixed(2)}${t.justification ? ` - ${t.justification}` : ''}`
).join('\n') || 'No recent trades'}

Recent Performance:
${agent.memory.pastPerformance.slice(-3).map((p, i) => 
  `- ${i === agent.memory.pastPerformance.length - 1 ? 'Current' : 'Previous'}: Portfolio Value: $${p.totalValue.toFixed(2)}, Return: ${(p.totalReturn * 100).toFixed(2)}%`
).join('\n') || 'No performance history'}
` : '';

    const fetchPromise = fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://llm-finance-arena.vercel.app',
        'X-Title': 'LLM Finance Arena',
      },
      body: JSON.stringify({
        model: agent.model,
        messages: [
          {
            role: 'system',
            content: systemInstruction
          },
          {
            role: 'user',
            content: memoryContext + prompt
          }
        ],
        response_format: {
          type: 'json_object'
        },
        temperature: 0.7,
        max_tokens: 2000,
      })
    });

    const response = await withTimeout(fetchPromise, timeoutMs);

    if (!response.ok) {
      const errorData = await response.text();
      throw new Error(`OpenRouter API error: ${response.status} - ${errorData}`);
    }

    const data = await response.json();
    const jsonText = data.choices[0]?.message?.content || '{}';
    
    if (!jsonText) {
      throw new Error('No response content from OpenRouter');
    }

    const result = JSON.parse(jsonText);

    // Validate and filter trades
    const validTrades = (result.trades || [])
      .filter(t => {
        if (t.action === 'hold' || !['buy', 'sell'].includes(t.action)) return false;
        if (!Number.isInteger(t.quantity) || t.quantity <= 0) return false;
        if (!marketData[t.ticker]) return false;
        if (t.action === 'sell') {
          const position = agent.portfolio.positions[t.ticker];
          if (!position || position.quantity < t.quantity) return false;
        }
        if (t.action === 'buy') {
          const cost = t.quantity * marketData[t.ticker].price;
          if (cost > agent.portfolio.cash) return false;
        }
        return true;
      })
      .map(t => ({
        ticker: t.ticker,
        action: t.action,
        quantity: t.quantity,
        price: 0, // Will be filled in simulation
        timestamp: day,
        fairValue: t.fairValue,
        topOfBox: t.topOfBox,
        bottomOfBox: t.bottomOfBox,
        justification: t.justification,
      }));

    return { trades: validTrades, rationale: result.rationale || 'No rationale provided.' };
  } catch (error) {
    console.error("Error fetching trade decisions:", error);
    return { trades: [], rationale: `Error communicating with AI model: ${error.message}` };
  }
};

