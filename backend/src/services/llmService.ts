import type { Agent, MarketData, Trade, TradeAction } from '../../../shared/types';
import { MAX_POSITION_SIZE_PERCENT, UNIFIED_SYSTEM_PROMPT } from '../constants';
import { logger, LogLevel, LogCategory } from './logger';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!OPENROUTER_API_KEY) {
  console.warn('OPENROUTER_API_KEY is not set. LLM agents will not be able to make trading decisions.');
}

const getAgentPrompt = (agent: Agent): string => {
  return (agent as any).systemPrompt || UNIFIED_SYSTEM_PROMPT;
};

const withTimeout = <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => 
      setTimeout(() => reject(new Error(`Request timeout after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
};

const exponentialBackoff = async <T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on certain errors
      if (lastError.message.includes('404') || lastError.message.includes('401')) {
        throw lastError;
      }
      
      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 1000; // Add jitter
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  throw lastError || new Error('Max retries exceeded');
};

export const getTradeDecisions = async (
  agent: Agent,
  marketData: MarketData,
  day: number,
  timeoutMs: number = 30000
): Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[], rationale: string }> => {
  if (!OPENROUTER_API_KEY) {
    // Return empty trades gracefully instead of throwing
    logger.log(LogLevel.WARNING, LogCategory.LLM, 
      `OPENROUTER_API_KEY not set for ${agent.name}, returning empty trades`, { agent: agent.name });
    return { trades: [], rationale: 'API key not configured - holding positions.' };
  }

  const portfolioValue = Object.values(agent.portfolio.positions).reduce((acc, pos) => 
    acc + pos.quantity * (marketData[pos.ticker]?.price || 0), agent.portfolio.cash);
  
  const systemInstruction = getAgentPrompt(agent);

  const availableCash = agent.portfolio.cash;
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

  const availableTickers = Object.keys(marketData);
  
  if (availableTickers.length === 0) {
    console.error(`[${agent.name}] No market data available! Cannot make trading decisions.`);
    return { trades: [], rationale: "No market data available - cannot make trading decisions." };
  }

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

IMPORTANT:
- Only include trades you want to execute (don't include "hold" actions)
- For BUY: Make sure (quantity × price) ≤ available cash
- For SELL: Make sure you own at least that many shares
- If you have cash available, you should make buy trades to invest it
- Holding 100% cash is not acceptable - you are a portfolio manager, not a cash holder
- If you don't want to trade, return an empty trades array: {"rationale": "...", "trades": []}
`;

  const startTime = Date.now();
  
  try {
    const memoryContext = agent.memory ? `
=== YOUR TRADING HISTORY (for context) ===
Recent Trades (last 5):
${agent.memory.recentTrades.slice(-5).map(t => 
  `- Day ${Math.floor(t.timestamp)}: ${t.action.toUpperCase()} ${t.quantity} ${t.ticker} @ $${t.price.toFixed(2)}${t.justification ? ` - ${t.justification}` : ''}`
).join('\n') || 'No recent trades'}

Recent Performance:
${agent.memory.pastPerformance.slice(-3).map((p, i) => 
  `- ${i === agent.memory!.pastPerformance.length - 1 ? 'Current' : 'Previous'}: Portfolio Value: $${p.totalValue.toFixed(2)}, Return: ${(p.totalReturn * 100).toFixed(2)}%`
).join('\n') || 'No performance history'}

Recent Rationales:
${agent.memory.pastRationales.slice(-3).map((r, i) => `- ${r}`).join('\n') || 'No past rationales'}
` : '';
    
    const fetchFn = async () => {
      const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://llm-finance-arena.com',
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
      
      return response;
    };
    
    const response = await withTimeout(
      exponentialBackoff(fetchFn, 3, 1000),
      timeoutMs
    );

    if (!response.ok) {
      const errorData = await response.text();
      let errorMessage = errorData;
      
      try {
        const errorJson = JSON.parse(errorData);
        if (errorJson.error) {
          errorMessage = errorJson.error.message || JSON.stringify(errorJson.error);
        }
      } catch (e) {
        // If error data is not JSON, use it as-is
      }
      
      const responseTime = Date.now() - startTime;
      
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const error = new Error(`Rate limit exceeded. ${errorMessage}${retryAfter ? ` Retry after ${retryAfter} seconds.` : ''}`);
        logger.logLLMCall(agent.name, agent.model, false, undefined, responseTime, error);
        throw error;
      }
      
      if (response.status === 404) {
        const error = new Error(`Model not found: ${agent.model}. Please check the model identifier.`);
        logger.logLLMCall(agent.name, agent.model, false, undefined, responseTime, error);
        throw error;
      }
      
      const error = new Error(`OpenRouter API error: ${response.status} - ${errorMessage}`);
      logger.logLLMCall(agent.name, agent.model, false, undefined, responseTime, error);
      throw error;
    }

    const data = await response.json();
    const jsonText = data.choices[0]?.message?.content || '{}';
    const responseTime = Date.now() - startTime;
    const tokensUsed = data.usage?.total_tokens;
    
    if (!jsonText) {
      const error = new Error('No response content from OpenRouter');
      logger.logLLMCall(agent.name, agent.model, false, tokensUsed, responseTime, error);
      throw error;
    }
    
    logger.logLLMCall(agent.name, agent.model, true, tokensUsed, responseTime);

    // Parse and validate response
    let result: any;
    try {
      result = JSON.parse(jsonText);
    } catch (parseError) {
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[1]);
        } catch (e) {
          // Try to extract partial JSON
        }
      }
      
      if (!result) {
        const jsonStart = jsonText.indexOf('{');
        if (jsonStart !== -1) {
          let jsonCandidate = jsonText.substring(jsonStart);
          const openBraces = (jsonCandidate.match(/\{/g) || []).length;
          const closeBraces = (jsonCandidate.match(/\}/g) || []).length;
          
          if (openBraces > closeBraces) {
            const tradesMatch = jsonCandidate.match(/"trades"\s*:\s*\[/);
            if (tradesMatch && !jsonCandidate.includes(']')) {
              jsonCandidate = jsonCandidate.replace(/"trades"\s*:\s*\[([^\]]*)$/, '"trades": [$1]');
            }
            jsonCandidate += '}'.repeat(openBraces - closeBraces);
          }
          
          try {
            result = JSON.parse(jsonCandidate);
          } catch (e) {
            const rationaleMatch = jsonCandidate.match(/"rationale"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
            if (rationaleMatch) {
              result = {
                rationale: rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' '),
                trades: []
              };
            } else {
              throw new Error(`Invalid JSON response from AI model. Received: ${jsonText.substring(0, 300)}`);
            }
          }
        }
      }
      
      if (!result) {
        throw new Error(`Invalid JSON response from AI model. Received: ${jsonText.substring(0, 300)}`);
      }
    }
    
    // Validate and filter trades
    const validTrades = (result.trades || [])
      .filter((t: any) => {
        if (t.action === 'hold' || !['buy', 'sell'].includes(t.action)) {
          return false;
        }
        if (!Number.isInteger(t.quantity) || t.quantity <= 0) {
          return false;
        }
        if (!marketData[t.ticker]) {
          console.warn(`[${agent.name}] Ticker ${t.ticker} not found in market data.`);
          return false;
        }
        if (t.action === 'sell') {
          const position = agent.portfolio.positions[t.ticker];
          if (!position || position.quantity < t.quantity) {
            console.warn(`Cannot sell ${t.quantity} shares of ${t.ticker} - only own ${position?.quantity || 0}`);
            return false;
          }
        }
        if (t.action === 'buy') {
          const cost = t.quantity * marketData[t.ticker].price;
          if (cost > agent.portfolio.cash) {
            console.warn(`Cannot buy ${t.quantity} shares of ${t.ticker} - need $${cost.toFixed(2)} but only have $${agent.portfolio.cash.toFixed(2)}`);
            return false;
          }
        }
        return true;
      })
      .map((t: any) => {
        const trade: Omit<Trade, 'price' | 'timestamp'> = {
          ticker: t.ticker,
          action: t.action as TradeAction,
          quantity: t.quantity,
        };
        
        if (t.fairValue !== undefined && typeof t.fairValue === 'number' && t.fairValue > 0) {
          trade.fairValue = t.fairValue;
        }
        if (t.topOfBox !== undefined && typeof t.topOfBox === 'number' && t.topOfBox > 0) {
          trade.topOfBox = t.topOfBox;
        }
        if (t.bottomOfBox !== undefined && typeof t.bottomOfBox === 'number' && t.bottomOfBox > 0) {
          trade.bottomOfBox = t.bottomOfBox;
        }
        if (t.justification !== undefined && typeof t.justification === 'string' && t.justification.trim()) {
          trade.justification = t.justification.trim();
        }
        
        return trade;
      });

    return { trades: validTrades, rationale: result.rationale || "No rationale provided." };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.logLLMCall(agent.name, agent.model, false, undefined, responseTime, error);
    console.error("Error fetching trade decisions:", error);
    // Never throw past the service boundary - return empty trades instead
    return { trades: [], rationale: `Error communicating with AI model: ${error instanceof Error ? error.message : "Unknown error"}` };
  }
};

