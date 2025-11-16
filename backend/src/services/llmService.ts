import type { Agent, MarketData, Trade, TradeAction } from '../types.js';
import { MAX_POSITION_SIZE_PERCENT, UNIFIED_SYSTEM_PROMPT, TRADING_FEE_RATE, MIN_TRADE_FEE } from '../constants.js';
import { sanitizeOutgoingMessage } from '../utils/chatUtils.js';
import { logger, LogLevel, LogCategory } from './logger.js';

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const ENABLE_LLM = (process.env.ENABLE_LLM ?? 'true').toLowerCase() === 'true';
const USE_UNIFIED_MODEL = (process.env.USE_UNIFIED_MODEL ?? 'false').toLowerCase() === 'true';
const UNIFIED_MODEL = process.env.UNIFIED_MODEL || 'google/gemini-2.5-flash-lite';

if (!OPENROUTER_API_KEY && ENABLE_LLM) {
  console.warn('OPENROUTER_API_KEY is not set. LLM agents will not be able to make trading decisions.');
}

if (!ENABLE_LLM) {
  console.log('⚠️ LLM mode is DISABLED. Using synthetic/simulated trades for testing.');
}

if (USE_UNIFIED_MODEL) {
  console.log(`⚠️ Unified model mode ENABLED. All agents will use: ${UNIFIED_MODEL}`);
  console.log('   (Frontend will still show original model names for display purposes)');
}

const getAgentPrompt = (agent: Agent): string => {
  return (agent as any).systemPrompt || UNIFIED_SYSTEM_PROMPT;
};

const estimateTradeFee = (notional: number): number => {
  const variableFee = notional * TRADING_FEE_RATE;
  return Math.max(variableFee, MIN_TRADE_FEE);
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

      // Don't retry on certain errors (auth failures, not found, insufficient credits)
      if (lastError.message.includes('404') ||
          lastError.message.includes('401') ||
          lastError.message.includes('402') ||
          lastError.message.includes('Insufficient credits')) {
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

interface ChatPromptContext {
  enabled: boolean;
  messages: Array<{ sender: string; content: string }>;
  maxReplyLength: number;
}

/**
 * Generate synthetic trades for testing when LLM is disabled
 */
const generateSyntheticTrades = (
  agent: Agent,
  marketData: MarketData,
  day: number,
  chatContext?: ChatPromptContext
): { trades: Omit<Trade, 'price' | 'timestamp'>[]; rationale: string; reply?: string } => {
  const portfolioValue = Object.values(agent.portfolio.positions).reduce((acc, pos) => 
    acc + pos.quantity * (marketData[pos.ticker]?.price || 0), agent.portfolio.cash);
  
  const availableCash = agent.portfolio.cash;
  const availableTickers = Object.keys(marketData);
  const currentPositions = Object.keys(agent.portfolio.positions);
  
  const trades: Omit<Trade, 'price' | 'timestamp'>[] = [];
  let remainingCash = availableCash;
  
  // Determine if we should buy or sell based on portfolio state
  const totalPositionValue = portfolioValue - availableCash;
  const cashPercent = portfolioValue > 0 ? (availableCash / portfolioValue) : 1;
  
  // If we have significant cash (>30%), try to buy stocks
  if (cashPercent > 0.3 && availableTickers.length > 0) {
    // Find stocks with positive momentum or good fundamentals
    const buyCandidates = availableTickers
      .filter(ticker => {
        const stock = marketData[ticker];
        const position = agent.portfolio.positions[ticker];
        const positionValue = position ? position.quantity * stock.price : 0;
        const positionPercent = portfolioValue > 0 ? (positionValue / portfolioValue) : 0;
        
        // Don't exceed max position size
        if (positionPercent >= MAX_POSITION_SIZE_PERCENT) {
          return false;
        }
        
        // Prefer stocks with positive momentum or reasonable P/E
        const hasPositiveMomentum = stock.dailyChangePercent > -0.02; // Not down more than 2%
        const hasReasonablePE = !stock.trailingPE || stock.trailingPE < 50;
        
        return hasPositiveMomentum && hasReasonablePE;
      })
      .sort((a, b) => {
        // Sort by momentum (positive change first)
        return marketData[b].dailyChangePercent - marketData[a].dailyChangePercent;
      })
      .slice(0, 3); // Consider top 3 candidates
    
    // Buy up to 2-3 stocks
    for (const ticker of buyCandidates.slice(0, Math.min(2, buyCandidates.length))) {
      const stock = marketData[ticker];
      const currentPrice = stock.price;
      const position = agent.portfolio.positions[ticker];
      const positionValue = position ? position.quantity * currentPrice : 0;
      const maxPositionValue = portfolioValue * MAX_POSITION_SIZE_PERCENT;
      const availableForPosition = maxPositionValue - positionValue;
      
      // Calculate how much we can spend on this stock
      const maxSpend = Math.min(remainingCash * 0.4, availableForPosition); // Use up to 40% of remaining cash per stock
      
      if (maxSpend > currentPrice * 10) { // Only buy if we can afford at least 10 shares
        const notional = Math.min(maxSpend, remainingCash * 0.5);
        const quantity = Math.floor((notional - estimateTradeFee(notional)) / currentPrice);
        
        if (quantity > 0) {
          const fairValue = currentPrice * (0.95 + Math.random() * 0.1); // Fair value within 95-105% of current price
          const volatility = Math.abs(stock.dailyChangePercent) || 0.02;
          const topOfBox = fairValue * (1 + Math.max(0.05, volatility * 1.5));
          const bottomOfBox = fairValue * (1 - Math.max(0.05, volatility * 1.5));
          
          trades.push({
            ticker,
            action: 'buy',
            quantity,
            fairValue: Math.round(fairValue * 100) / 100,
            topOfBox: Math.round(topOfBox * 100) / 100,
            bottomOfBox: Math.round(bottomOfBox * 100) / 100,
            justification: `${ticker} shows positive momentum and reasonable valuation. Building position for diversification.`,
            fees: estimateTradeFee(quantity * currentPrice),
          });
          
          remainingCash -= (quantity * currentPrice + estimateTradeFee(quantity * currentPrice));
        }
      }
    }
  }
  
  // If we have positions and need to rebalance or take profits, consider selling
  if (currentPositions.length > 0 && cashPercent < 0.2) {
    // Find positions to potentially trim
    const sellCandidates = currentPositions
      .map(ticker => {
        const position = agent.portfolio.positions[ticker];
        const stock = marketData[ticker];
        const currentPrice = stock.price;
        const unrealizedGain = (currentPrice - position.averageCost) * position.quantity;
        const unrealizedGainPercent = position.averageCost > 0 
          ? ((currentPrice - position.averageCost) / position.averageCost) 
          : 0;
        
        return {
          ticker,
          position,
          stock,
          unrealizedGain,
          unrealizedGainPercent,
        };
      })
      .filter(candidate => {
        // Consider selling if:
        // 1. Large gain (>10%) - take profits
        // 2. Large loss (>5%) - cut losses
        // 3. Negative momentum
        return candidate.unrealizedGainPercent > 0.10 || 
               candidate.unrealizedGainPercent < -0.05 ||
               candidate.stock.dailyChangePercent < -0.03;
      })
      .sort((a, b) => {
        // Prioritize taking profits on winners
        if (a.unrealizedGainPercent > 0.10 && b.unrealizedGainPercent <= 0.10) return -1;
        if (b.unrealizedGainPercent > 0.10 && a.unrealizedGainPercent <= 0.10) return 1;
        // Then prioritize cutting losses
        return a.unrealizedGainPercent - b.unrealizedGainPercent;
      })
      .slice(0, 1); // Sell at most 1 position per round
    
    for (const candidate of sellCandidates) {
      const { ticker, position, stock } = candidate;
      // Sell 30-50% of the position
      const sellPercent = 0.3 + Math.random() * 0.2;
      const quantity = Math.max(1, Math.floor(position.quantity * sellPercent));
      
      if (quantity > 0 && quantity <= position.quantity) {
        const currentPrice = stock.price;
        const fairValue = currentPrice * (0.95 + Math.random() * 0.1);
        const volatility = Math.abs(stock.dailyChangePercent) || 0.02;
        const topOfBox = fairValue * (1 + Math.max(0.05, volatility * 1.5));
        const bottomOfBox = fairValue * (1 - Math.max(0.05, volatility * 1.5));
        
        const reason = candidate.unrealizedGainPercent > 0.10 
          ? `Taking profits on ${ticker} after strong performance.`
          : candidate.unrealizedGainPercent < -0.05
          ? `Cutting losses on ${ticker} to preserve capital.`
          : `Rebalancing portfolio by trimming ${ticker} position.`;
        
        trades.push({
          ticker,
          action: 'sell',
          quantity,
          fairValue: Math.round(fairValue * 100) / 100,
          topOfBox: Math.round(topOfBox * 100) / 100,
          bottomOfBox: Math.round(bottomOfBox * 100) / 100,
          justification: reason,
          fees: estimateTradeFee(quantity * currentPrice),
        });
      }
    }
  }
  
  // Generate rationale
  let rationale: string;
  if (trades.length === 0) {
    rationale = `Maintaining current positions. Portfolio is well-balanced with ${(cashPercent * 100).toFixed(1)}% cash.`;
  } else {
    const buyCount = trades.filter(t => t.action === 'buy').length;
    const sellCount = trades.filter(t => t.action === 'sell').length;
    rationale = `Executing ${buyCount > 0 ? `${buyCount} buy${buyCount > 1 ? 's' : ''}` : ''}${buyCount > 0 && sellCount > 0 ? ' and ' : ''}${sellCount > 0 ? `${sellCount} sell${sellCount > 1 ? 's' : ''}` : ''} to ${buyCount > 0 ? 'deploy cash into positions with positive momentum' : ''}${buyCount > 0 && sellCount > 0 ? ' and ' : ''}${sellCount > 0 ? 'rebalance portfolio by taking profits and cutting losses' : ''}.`;
  }
  
  // Generate chat reply if needed
  let reply: string | undefined;
  if (chatContext?.enabled && chatContext.messages.length > 0) {
    const genericReplies = [
      'Thanks for the update—staying focused on our strategy.',
      'Appreciate the feedback—keeping our positions aligned with market conditions.',
      'Noted—maintaining our disciplined approach to portfolio management.',
    ];
    reply = genericReplies[Math.floor(Math.random() * genericReplies.length)];
  }
  
  return { trades, rationale, reply };
};

export const getTradeDecisions = async (
  agent: Agent,
  marketData: MarketData,
  day: number,
  timeoutMs: number = 30000,
  chatContext?: ChatPromptContext,
  previousFailedTrades?: Array<{ ticker: string; action: string; quantity: number; reason: string }>
): Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[]; rationale: string; reply?: string }> => {
  // Determine which model will be used (for logging)
  const modelToUse = USE_UNIFIED_MODEL ? UNIFIED_MODEL : agent.model;
  const displayModel = USE_UNIFIED_MODEL ? `${agent.model} (→ ${UNIFIED_MODEL})` : agent.model;
  console.log(`[${agent.name}] Starting trade decision request (model: ${displayModel})`);
  
  // If LLM is disabled, use synthetic trades
  if (!ENABLE_LLM) {
    console.log(`[${agent.name}] Using synthetic trades (LLM disabled)`);
    logger.log(LogLevel.INFO, LogCategory.LLM,
      `Using synthetic trades for ${agent.name} (ENABLE_LLM=false)`, { agent: agent.name });
    return generateSyntheticTrades(agent, marketData, day, chatContext);
  }
  
  if (!OPENROUTER_API_KEY) {
    // Return empty trades gracefully instead of throwing
    logger.log(LogLevel.WARNING, LogCategory.LLM,
      `OPENROUTER_API_KEY not set for ${agent.name}, returning empty trades`, { agent: agent.name });
    const communityMessages = chatContext?.messages ?? [];
    const fallbackReply = (chatContext?.enabled && communityMessages.length > 0) ? 'Unable to respond right now.' : undefined;
    return { trades: [], rationale: 'API key not configured - holding positions.', reply: fallbackReply };
  }

  const portfolioValue = Object.values(agent.portfolio.positions).reduce((acc, pos) => 
    acc + pos.quantity * (marketData[pos.ticker]?.price || 0), agent.portfolio.cash);
  
  const systemInstruction = getAgentPrompt(agent);
  
  // Check if agent is allowed to hold all cash (e.g., Big Short Guy)
  const allowAllCash = agent.id === 'big-short-guy' || 
    systemInstruction.toLowerCase().includes('all cash is') ||
    systemInstruction.toLowerCase().includes('holding 100% cash is allowed');

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
    const communityMessages = chatContext?.messages ?? [];
    const fallbackReply = (chatContext?.enabled && communityMessages.length > 0) ? 'Unable to respond right now.' : undefined;
    return { trades: [], rationale: "No market data available - cannot make trading decisions.", reply: fallbackReply };
  }

  const tradingFeeBpsDisplay = (TRADING_FEE_RATE * 10000).toFixed(2);
  const tradingFeePercentDisplay = (TRADING_FEE_RATE * 100).toFixed(3);
  const minFeeDisplay = MIN_TRADE_FEE.toFixed(2);
  const tradingCostLine = TRADING_FEE_RATE > 0
    ? `${tradingFeeBpsDisplay} bps (${tradingFeePercentDisplay}% of notional) with a $${minFeeDisplay} minimum`
    : `$${minFeeDisplay} per trade`;

  const communityMessages = chatContext?.messages ?? [];
  // Only include chat section if there are actual messages to reply to
  const chatSection = chatContext?.enabled && communityMessages.length > 0
    ? `
=== COMMUNITY LIVE CHAT ===
You have received the following messages from community members this round:
${communityMessages.map((message, index) => `${index + 1}. ${message.sender}: ${message.content}`).join('\n')}

You may provide a reply (optional). If you choose to reply, it must be one sentence, at most ${chatContext.maxReplyLength} characters, and must not contain links or promotional content.
`
    : '';

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

${previousFailedTrades && previousFailedTrades.length > 0 ? `
=== PREVIOUS TRADE RESULTS ===
Some of your previous trades failed to execute:
${previousFailedTrades.map(ft => `- ${ft.action.toUpperCase()} ${ft.quantity} ${ft.ticker}: FAILED - ${ft.reason}`).join('\n')}
Please adjust your strategy accordingly. For BUY orders, ensure you have enough cash. For SELL orders, ensure you own the stock.
` : ''}

${chatSection}

=== TRADING RULES ===
1. You can only BUY if you have enough cash: quantity × current_price ≤ available_cash
2. You can only SELL if you own the stock: check your current positions
3. Maximum position size: ${MAX_POSITION_SIZE_PERCENT * 100}% of total portfolio value
4. No margin, no short selling
5. Quantity must be a positive integer (whole shares only)
6. Every trade pays transaction costs: ${tradingCostLine}. Keep enough cash to cover fees.

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
   - "justification": A one sentence explanation for this specific trade${communityMessages.length > 0 ? `
3. "reply": A short (single sentence) public message responding to the community members who messaged you (${chatContext?.maxReplyLength ?? 140} characters max, no links)` : ''}

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
  ]${communityMessages.length > 0 ? `,
  "reply": "Thanks for the support—staying nimble today."` : ''}
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
- For SELL: Make sure you own at least that many shares${allowAllCash ? '' : `
- If you have cash available, you should make buy trades to invest it
- Holding 100% cash is not acceptable - you are a portfolio manager, not a cash holder`}
- If you don't want to trade, return an empty trades array: {"rationale": "...", "trades": []}${communityMessages.length > 0 ? `
- Your reply must be respectful, one sentence, and contain no URLs or promotional content` : ''}

Remember: Return ONLY valid JSON. No markdown, no code blocks, no explanations outside the JSON.
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
      // Use unified model if enabled, otherwise use agent's configured model
      const modelToUse = USE_UNIFIED_MODEL ? UNIFIED_MODEL : agent.model;
      
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
          model: modelToUse,
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
          max_tokens: 3000, // Increased for Gemini Pro which may generate longer responses
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
        logger.logLLMCall(agent.name, modelToUse, false, undefined, responseTime, error);
        throw error;
      }
      
      if (response.status === 404) {
        const error = new Error(`Model not found: ${modelToUse}. Please check the model identifier.`);
        logger.logLLMCall(agent.name, modelToUse, false, undefined, responseTime, error);
        throw error;
      }
      
      const error = new Error(`OpenRouter API error: ${response.status} - ${errorMessage}`);
      logger.logLLMCall(agent.name, modelToUse, false, undefined, responseTime, error);
      throw error;
    }

    const data = await response.json() as any;
    const jsonText = data.choices?.[0]?.message?.content || '{}';
    const responseTime = Date.now() - startTime;
    const tokensUsed = data.usage?.total_tokens;
    
    if (!jsonText) {
      const error = new Error('No response content from OpenRouter');
      logger.logLLMCall(agent.name, modelToUse, false, tokensUsed, responseTime, error);
      console.error(`[${agent.name}] No response content from OpenRouter`);
      throw error;
    }
    
    console.log(`[${agent.name}] Received response (${responseTime}ms, ${tokensUsed} tokens). JSON length: ${jsonText.length}`);
    logger.logLLMCall(agent.name, modelToUse, true, tokensUsed, responseTime);

    // Parse and validate response with improved JSON repair
    let result: any;
    try {
      result = JSON.parse(jsonText);
    } catch (parseError) {
      console.warn(`[${agent.name}] Initial JSON parse failed, attempting repair. Error: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      // Try to extract JSON from markdown code blocks
      const jsonMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*\})\s*```/);
      if (jsonMatch) {
        try {
          result = JSON.parse(jsonMatch[1]);
        } catch (e) {
          // Continue to repair logic
        }
      }
      
      if (!result) {
        // Find the start of JSON
        const jsonStart = jsonText.indexOf('{');
        if (jsonStart !== -1) {
          let jsonCandidate = jsonText.substring(jsonStart);
          
          // Count braces to detect incomplete JSON
          const openBraces = (jsonCandidate.match(/\{/g) || []).length;
          const closeBraces = (jsonCandidate.match(/\}/g) || []).length;
          const openBrackets = (jsonCandidate.match(/\[/g) || []).length;
          const closeBrackets = (jsonCandidate.match(/\]/g) || []).length;
          
          // Repair incomplete JSON structure
          if (openBraces > closeBraces || openBrackets > closeBrackets) {
            // Check if trades array is incomplete
            const tradesArrayStart = jsonCandidate.indexOf('"trades"');
            if (tradesArrayStart !== -1) {
              const tradesSection = jsonCandidate.substring(tradesArrayStart);
              const tradesArrayMatch = tradesSection.match(/"trades"\s*:\s*\[/);
              
              if (tradesArrayMatch) {
                // Find where the trades array should end
                let arrayContent = tradesSection.substring(tradesArrayMatch.index! + tradesArrayMatch[0].length);
                
                // If array is incomplete, try to close it properly
                if (!arrayContent.includes(']') || (arrayContent.match(/\[/g) || []).length > (arrayContent.match(/\]/g) || []).length) {
                  // Find the last complete trade object
                  const tradeObjects = arrayContent.match(/\{[^}]*"ticker"[^}]*\}/g);
                  if (tradeObjects && tradeObjects.length > 0) {
                    // Use only complete trade objects
                    const completeTrades = tradeObjects.filter(t => {
                      try {
                        JSON.parse(t);
                        return true;
                      } catch {
                        return false;
                      }
                    });
                    
                    // Reconstruct JSON with only complete trades
                    const rationaleMatch = jsonCandidate.match(/"rationale"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                    const rationale = rationaleMatch ? rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 500) : 'Trading decision made.';
                    
                    result = {
                      rationale: rationale,
                      trades: completeTrades.map(t => {
                        try {
                          return JSON.parse(t);
                        } catch {
                          return null;
                        }
                      }).filter(t => t !== null)
                    };
                    
                    // Add reply if present
                    const replyMatch = jsonCandidate.match(/"reply"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                    if (replyMatch) {
                      result.reply = replyMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 200);
                    }
                  }
                }
              }
            }
            
            // If still no result, try basic repair
            if (!result) {
              // Close incomplete strings in rationale
              const rationaleMatch = jsonCandidate.match(/"rationale"\s*:\s*"([^"]*)/);
              if (rationaleMatch && !jsonCandidate.includes(rationaleMatch[0] + '"')) {
                const rationale = rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 500);
                jsonCandidate = jsonCandidate.replace(/"rationale"\s*:\s*"[^"]*/, `"rationale": "${rationale.replace(/"/g, '\\"')}"`);
              }
              
              // Close brackets and braces
              if (openBrackets > closeBrackets) {
                jsonCandidate += ']'.repeat(openBrackets - closeBrackets);
              }
              if (openBraces > closeBraces) {
                jsonCandidate += '}'.repeat(openBraces - closeBraces);
              }
              
              try {
                result = JSON.parse(jsonCandidate);
              } catch (e) {
                // Last resort: extract rationale and return empty trades
                const rationaleMatch = jsonCandidate.match(/"rationale"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
                if (rationaleMatch) {
                  result = {
                    rationale: rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 500),
                    trades: []
                  };
                }
              }
            }
          } else {
            // JSON structure seems complete, try parsing as-is
            try {
              result = JSON.parse(jsonCandidate);
            } catch (e) {
              // Extract rationale as fallback
              const rationaleMatch = jsonCandidate.match(/"rationale"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
              if (rationaleMatch) {
                result = {
                  rationale: rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 500),
                  trades: []
                };
              }
            }
          }
        }
      }
      
      // Final fallback: extract rationale and return empty trades
      if (!result) {
        const rationaleMatch = jsonText.match(/"rationale"\s*:\s*"([^"]*(?:\\.[^"]*)*)"/);
        if (rationaleMatch) {
          console.warn(`[${agent.name}] JSON repair failed, using fallback: extracted rationale only`);
          result = {
            rationale: rationaleMatch[1].replace(/\\"/g, '"').replace(/\\n/g, ' ').substring(0, 500),
            trades: []
          };
        } else {
          console.error(`[${agent.name}] Complete JSON parse failure. First 500 chars: ${jsonText.substring(0, 500)}`);
          throw new Error(`Invalid JSON response from AI model. Received: ${jsonText.substring(0, 300)}...`);
        }
      } else {
        console.log(`[${agent.name}] JSON repair successful`);
      }
    }
    
    // Validate and filter trades
    const rawTrades = result.trades || [];
    if (rawTrades.length === 0 && result.rationale) {
      // Log when agent returns empty trades (might be intentional or a problem)
      console.log(`[${agent.name}] Returned ${rawTrades.length} trades. Rationale: ${result.rationale.substring(0, 150)}...`);
    } else if (rawTrades.length > 0) {
      console.log(`[${agent.name}] Returned ${rawTrades.length} trade(s)`);
    }
    
    const validTrades = rawTrades
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
          const price = marketData[t.ticker].price;
          const notional = t.quantity * price;
          const fees = estimateTradeFee(notional);
          const totalCost = notional + fees;
          if (totalCost > agent.portfolio.cash) {
            console.warn(`Cannot buy ${t.quantity} shares of ${t.ticker} - need $${totalCost.toFixed(2)} including fees but only have $${agent.portfolio.cash.toFixed(2)}`);
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

        const referencePrice = marketData[t.ticker]?.price ?? 0;
        if (referencePrice > 0) {
          trade.fees = estimateTradeFee(trade.quantity * referencePrice);
        }

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

    // Only process reply if the agent received messages to reply to
    let reply: string | undefined;
    if (chatContext?.enabled && communityMessages.length > 0) {
      if (result.reply && result.reply.trim()) {
        const sanitized = sanitizeOutgoingMessage(result.reply, chatContext.maxReplyLength);
        reply = sanitized || undefined;
      }
    }

    return { trades: validTrades, rationale: result.rationale || "No rationale provided.", reply };

  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    const modelToUse = USE_UNIFIED_MODEL ? UNIFIED_MODEL : agent.model;
    logger.logLLMCall(agent.name, modelToUse, false, undefined, responseTime, errorMessage);
    console.error("Error fetching trade decisions:", error);
    // Never throw past the service boundary - return empty trades instead
    const communityMessages = chatContext?.messages ?? [];
    const fallbackReply = (chatContext?.enabled && communityMessages.length > 0) ? 'Unable to respond right now.' : undefined;
    return { trades: [], rationale: `Error communicating with AI model: ${errorMessage}`, reply: fallbackReply };
  }
};

