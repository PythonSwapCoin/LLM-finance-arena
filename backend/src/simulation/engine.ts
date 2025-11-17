import type { Agent, Benchmark, MarketData, Trade, PerformanceMetrics, ChatState } from '../types.js';
import { S_P500_BENCHMARK_ID, INITIAL_CASH, TRADING_FEE_RATE, MIN_TRADE_FEE, TRADING_DAYS_PER_YEAR, RISK_FREE_RATE } from '../constants.js';
import { calculateAllMetrics } from '../utils/portfolioCalculations.js';
import { getTradeDecisions } from '../services/llmService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { applyAgentRepliesToChat, type AgentReplyInput } from '../services/chatService.js';
import { createRoundId } from '../utils/chatUtils.js';
import { priceLogService } from '../services/priceLogService.js';

const parseIntWithDefault = (value: string | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const manualSpacingMsRaw = parseIntWithDefault(process.env.LLM_REQUEST_SPACING_MS, -1);
const manualSpacingMs = manualSpacingMsRaw >= 0 ? manualSpacingMsRaw : -1;
const minSpacingMs = Math.max(0, parseIntWithDefault(process.env.LLM_MIN_REQUEST_SPACING_MS, 0));
const autoSpacingEnabled = process.env.LLM_AUTO_SPACING === 'true';
const maxConcurrentRequests = Math.max(0, parseIntWithDefault(process.env.LLM_MAX_CONCURRENT_REQUESTS, 0));
const realtimeIntervalMs = Math.max(0, parseIntWithDefault(process.env.REALTIME_SIM_INTERVAL_MS, 600000));
const simulatedIntervalMs = Math.max(0, parseIntWithDefault(process.env.SIM_INTERVAL_MS, 30000));

const getRequestSpacingMs = (mode: 'simulated' | 'realtime' | 'historical' | 'hybrid' | undefined, agentCount: number): number => {
  if (manualSpacingMs >= 0) {
    return manualSpacingMs;
  }
  if (!autoSpacingEnabled) {
    return 0;
  }
  const interval = mode === 'realtime' ? realtimeIntervalMs : simulatedIntervalMs;
  if (interval <= 0) {
    return minSpacingMs;
  }
  const spacing = Math.floor(interval / Math.max(agentCount, 1));
  if (spacing <= 0) {
    return minSpacingMs;
  }
  return Math.max(spacing, minSpacingMs);
};

const getMaxConcurrentRequests = (agentCount: number): number => {
  if (maxConcurrentRequests <= 0) {
    return agentCount;
  }
  return Math.max(1, Math.min(maxConcurrentRequests, agentCount));
};

const calculateExecutionFee = (notional: number): number => {
  const variableFee = notional * TRADING_FEE_RATE;
  return Math.max(variableFee, MIN_TRADE_FEE);
};

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

interface AgentChatContext {
  enabled: boolean;
  messages: Array<{ sender: string; content: string }>;
  maxReplyLength: number;
}

const processAgentsWithPacing = async <T>(
  agents: Agent[],
  mode: 'simulated' | 'realtime' | 'historical' | 'hybrid' | undefined,
  handler: (agent: Agent) => Promise<T>
): Promise<T[]> => {
  if (agents.length === 0) {
    return [];
  }

  const spacingMs = getRequestSpacingMs(mode, agents.length);

  if (spacingMs > 0) {
    const results: T[] = [];
    for (let index = 0; index < agents.length; index++) {
      const start = Date.now();
      results[index] = await handler(agents[index]);
      if (index < agents.length - 1) {
        const elapsed = Date.now() - start;
        const waitMs = Math.max(0, spacingMs - elapsed);
        if (waitMs > 0) {
          await delay(waitMs);
        }
      }
    }
    return results;
  }

  const concurrency = getMaxConcurrentRequests(agents.length);
  if (concurrency >= agents.length) {
    return Promise.all(agents.map(handler));
  }

  const results: T[] = new Array(agents.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const currentIndex = nextIndex++;
      if (currentIndex >= agents.length) {
        break;
      }
      results[currentIndex] = await handler(agents[currentIndex]);
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => runWorker()));
  return results;
};

const handleTradeWindowAgent = async (
  agent: Agent,
  options: {
    marketData: MarketData;
    day: number;
    intradayHour: number;
    mode: 'simulated' | 'realtime' | 'historical' | 'hybrid' | undefined;
    timestamp: number;
    currentTimestamp?: number;
    chatContext?: AgentChatContext;
    previousFailedTrades?: Array<{ ticker: string; action: string; quantity: number; reason: string }>;
  }
): Promise<{ agent: Agent; reply?: string; failedTrades?: Array<{ ticker: string; action: string; quantity: number; reason: string }> }> => {
  const { marketData, day, intradayHour, mode, timestamp, currentTimestamp, chatContext, previousFailedTrades } = options;

  try {
    // Increased timeout to 60 seconds to account for retries and exponential backoff
    const timeoutMs = 60000;
    const tradeDecision = await Promise.race([
      getTradeDecisions(agent, marketData, day, timeoutMs, chatContext, previousFailedTrades),
      new Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[]; rationale: string; reply?: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Trade decision timeout')), timeoutMs)
      )
    ]).catch(error => {
      console.warn(`[${agent.name}] Trade decision timeout or error:`, error);
      logger.logSimulationEvent(`Trade decision error for ${agent.name}`, {
        agent: agent.name,
        day,
        hour: intradayHour,
        error: error instanceof Error ? error.message : String(error)
      });
      const fallbackReply = chatContext?.enabled ? 'Unable to provide an update right now.' : undefined;
      return {
        trades: [],
        rationale: `Trade decision unavailable - holding positions. ${error instanceof Error ? error.message : String(error)}`,
        reply: fallbackReply,
      };
    });

    const { trades: decidedTrades, rationale, reply: rawReply } = tradeDecision;
    
    // Log trade decision results for debugging
    if (decidedTrades.length === 0) {
      console.log(`[${agent.name}] No trades decided. Rationale: ${rationale.substring(0, 100)}...`);
    } else {
      console.log(`[${agent.name}] Decided ${decidedTrades.length} trade(s)`);
    }
    
    const trimmedReply = rawReply?.trim();
    const hasUserMessagesThisRound = Boolean(chatContext?.messages && chatContext.messages.length > 0);
    const shouldProvideFallbackReply = !trimmedReply && chatContext?.enabled && hasUserMessagesThisRound;
    const fallbackReply = 'Appreciate the update—keeping our strategy on track.';
    const reply = shouldProvideFallbackReply ? fallbackReply : trimmedReply;

    if (shouldProvideFallbackReply) {
      logger.logSimulationEvent('Generated fallback chat reply for agent', {
        agent: agent.name,
        day,
        intradayHour,
      });
    }
    
    // Track failed trades for prompt feedback
    const failedTrades: Array<{ ticker: string; action: string; quantity: number; reason: string }> = [];
    
    const newTradeHistory = [...agent.tradeHistory];
    const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };

    // Sort trades: execute sells first, then buys (so agents can sell to free up cash for buys)
    const sortedTrades = [...decidedTrades].sort((a, b) => {
      if (a.action === 'sell' && b.action === 'buy') return -1;
      if (a.action === 'buy' && b.action === 'sell') return 1;
      return 0; // Keep original order for same action type
    });

    sortedTrades.forEach(trade => {
      const tradePrice = marketData[trade.ticker]?.price;
      if (!tradePrice) {
        console.warn(`[${agent.name}] Skipping trade for ${trade.ticker} - price not available`);
        return;
      }

      if (trade.action === 'buy') {
        const notional = trade.quantity * tradePrice;
        const fees = calculateExecutionFee(notional);
        const totalCost = notional + fees;

        if (newPortfolio.cash >= totalCost) {
          newPortfolio.cash -= totalCost;
          const existingPosition = newPortfolio.positions[trade.ticker];
          if (existingPosition) {
            const aggregateCost = (existingPosition.averageCost * existingPosition.quantity) + notional;
            existingPosition.quantity += trade.quantity;
            existingPosition.averageCost = aggregateCost / existingPosition.quantity;
            if (trade.fairValue !== undefined) {
              existingPosition.lastFairValue = trade.fairValue;
              existingPosition.lastTopOfBox = trade.topOfBox;
              existingPosition.lastBottomOfBox = trade.bottomOfBox;
            }
          } else {
            newPortfolio.positions[trade.ticker] = {
              ticker: trade.ticker,
              quantity: trade.quantity,
              averageCost: tradePrice,
              lastFairValue: trade.fairValue,
              lastTopOfBox: trade.topOfBox,
              lastBottomOfBox: trade.bottomOfBox,
            };
          }
          newTradeHistory.push({
            ...trade,
            price: tradePrice,
            timestamp,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification,
            fees,
          });
          logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true, undefined, fees);
        } else {
          const errorMsg = `Insufficient cash: need $${totalCost.toFixed(2)} including fees, have $${newPortfolio.cash.toFixed(2)}`;
          console.warn(`[${agent.name}] Insufficient cash for ${trade.quantity} shares of ${trade.ticker}`);
          logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg, fees);
          failedTrades.push({
            ticker: trade.ticker,
            action: 'buy',
            quantity: trade.quantity,
            reason: errorMsg,
          });
        }
      } else if (trade.action === 'sell') {
        const existingPosition = newPortfolio.positions[trade.ticker];
        if (existingPosition && existingPosition.quantity > 0) {
          const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
          if (quantityToSell < trade.quantity) {
            console.warn(`[${agent.name}] Attempted to sell ${trade.quantity} shares of ${trade.ticker} but only owns ${existingPosition.quantity}. Selling ${quantityToSell} instead.`);
          }
          const notional = quantityToSell * tradePrice;
          const fees = quantityToSell > 0 ? calculateExecutionFee(notional) : 0;
          newPortfolio.cash += notional - fees;
          existingPosition.quantity -= quantityToSell;
          if (existingPosition.quantity === 0) {
            delete newPortfolio.positions[trade.ticker];
          }
          newTradeHistory.push({
            ...trade,
            quantity: quantityToSell,
            price: tradePrice,
            timestamp,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification,
            fees,
          });
          logger.logTrade(agent.name, trade.ticker, 'sell', quantityToSell, tradePrice, true, undefined, fees);
        } else {
          const errorMsg = existingPosition ? `only owns ${existingPosition.quantity}` : 'does not own this stock';
          console.warn(`[${agent.name}] Cannot sell ${trade.quantity} shares of ${trade.ticker} - ${errorMsg}`);
          logger.logTrade(agent.name, trade.ticker, 'sell', trade.quantity, tradePrice, false, errorMsg);
          failedTrades.push({
            ticker: trade.ticker,
            action: 'sell',
            quantity: trade.quantity,
            reason: errorMsg,
          });
        }
      }
    });

    const intradayTrades = newTradeHistory.filter(t => {
      if (mode === 'realtime' && currentTimestamp !== undefined) {
        const tradeTimestamp = currentTimestamp / 1000;
        return Math.abs(t.timestamp - tradeTimestamp) < 60;
      }
      const timestampDiff = Math.abs(t.timestamp - timestamp);
      return timestampDiff < 0.01;
    });
    const newMetrics = calculateAllMetrics(newPortfolio, marketData, agent.performanceHistory, timestamp, intradayTrades);
    newMetrics.intradayHour = intradayHour;

    const updatedMemory = {
      recentTrades: [...(agent.memory?.recentTrades || []), ...decidedTrades.map(t => {
        const executedPrice = marketData[t.ticker]?.price || 0;
        const estimatedNotional = t.quantity * executedPrice;
        const fees = executedPrice > 0 ? calculateExecutionFee(estimatedNotional) : undefined;
        return { ...t, price: executedPrice, timestamp, fees } as Trade;
      })].slice(-10),
      pastRationales: [...(agent.memory?.pastRationales || []), rationale].slice(-5),
      pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10),
      failedTrades: failedTrades, // Store failed trades for next round
    };

    return {
      agent: {
        ...agent,
        portfolio: newPortfolio,
        tradeHistory: newTradeHistory,
        performanceHistory: [...agent.performanceHistory, newMetrics],
        rationale,
        rationaleHistory: {
          ...agent.rationaleHistory,
          [day]: rationale
        },
        memory: updatedMemory,
      },
      reply,
      failedTrades,
    };
  } catch (error) {
    console.error(`Failed to process agent ${agent.name}:`, error);
    logger.logSimulationEvent(`Agent processing failed: ${agent.name}`, {
      agent: agent.name,
      day,
      hour: intradayHour,
      error: error instanceof Error ? error.message : String(error)
    });
    const errorRationale = `Error: Could not retrieve trade decision. Holding positions. ${error}`;
    const newMetrics = calculateAllMetrics(agent.portfolio, marketData, agent.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;
    return {
      agent: {
        ...agent,
        performanceHistory: [...agent.performanceHistory, newMetrics],
        rationale: errorRationale,
        rationaleHistory: {
          ...agent.rationaleHistory,
          [day]: errorRationale
        }
      },
      reply: chatContext?.enabled ? 'Unable to respond right now.' : undefined,
    };
  }
};

const handleAdvanceDayAgent = async (
  agent: Agent,
  options: {
    nextDay: number;
    marketData: MarketData;
  }
): Promise<Agent> => {
  const { nextDay, marketData } = options;

  try {
    // Increased timeout to 60 seconds to account for retries and exponential backoff
    const timeoutMs = 60000;
    const { trades: decidedTrades, rationale } = await Promise.race([
      getTradeDecisions(agent, marketData, nextDay, timeoutMs),
      new Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[]; rationale: string }>((_, reject) =>
        setTimeout(() => reject(new Error('Trade decision timeout')), timeoutMs)
      )
    ]).catch(error => {
      console.warn(`[${agent.name}] Trade decision timeout or error:`, error);
      return { trades: [], rationale: `Trade decision unavailable - holding positions. ${error instanceof Error ? error.message : String(error)}` };
    });

    const newTradeHistory = [...agent.tradeHistory];
    const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };

    // Sort trades: execute sells first, then buys (so agents can sell to free up cash for buys)
    const sortedTrades = [...decidedTrades].sort((a, b) => {
      if (a.action === 'sell' && b.action === 'buy') return -1;
      if (a.action === 'buy' && b.action === 'sell') return 1;
      return 0; // Keep original order for same action type
    });

    sortedTrades.forEach(trade => {
      const tradePrice = marketData[trade.ticker]?.price;
      if (!tradePrice) {
        console.warn(`[${agent.name}] Skipping trade for ${trade.ticker} - price not available`);
        return;
      }

      if (trade.action === 'buy') {
        const notional = trade.quantity * tradePrice;
        const fees = calculateExecutionFee(notional);
        const totalCost = notional + fees;

        if (newPortfolio.cash >= totalCost) {
          newPortfolio.cash -= totalCost;
          const existingPosition = newPortfolio.positions[trade.ticker];
          if (existingPosition) {
            const aggregateCost = (existingPosition.averageCost * existingPosition.quantity) + notional;
            existingPosition.quantity += trade.quantity;
            existingPosition.averageCost = aggregateCost / existingPosition.quantity;
            if (trade.fairValue !== undefined) {
              existingPosition.lastFairValue = trade.fairValue;
              existingPosition.lastTopOfBox = trade.topOfBox;
              existingPosition.lastBottomOfBox = trade.bottomOfBox;
            }
          } else {
            newPortfolio.positions[trade.ticker] = {
              ticker: trade.ticker,
              quantity: trade.quantity,
              averageCost: tradePrice,
              lastFairValue: trade.fairValue,
              lastTopOfBox: trade.topOfBox,
              lastBottomOfBox: trade.bottomOfBox,
            };
          }
          newTradeHistory.push({
            ...trade,
            price: tradePrice,
            timestamp: nextDay,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification,
            fees,
          });
          logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true, undefined, fees);
        } else {
          const errorMsg = `Insufficient cash: need $${totalCost.toFixed(2)} including fees, have $${newPortfolio.cash.toFixed(2)}`;
          logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg, fees);
        }
      } else if (trade.action === 'sell') {
        const existingPosition = newPortfolio.positions[trade.ticker];
        if (existingPosition && existingPosition.quantity > 0) {
          const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
          const notional = quantityToSell * tradePrice;
          const fees = quantityToSell > 0 ? calculateExecutionFee(notional) : 0;
          newPortfolio.cash += notional - fees;
          existingPosition.quantity -= quantityToSell;
          if (existingPosition.quantity === 0) {
            delete newPortfolio.positions[trade.ticker];
          }
          newTradeHistory.push({
            ...trade,
            quantity: quantityToSell,
            price: tradePrice,
            timestamp: nextDay,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification,
            fees,
          });
          logger.logTrade(agent.name, trade.ticker, 'sell', quantityToSell, tradePrice, true, undefined, fees);
        } else {
          const errorMsg = existingPosition ? `only owns ${existingPosition.quantity}` : 'does not own this stock';
          logger.logTrade(agent.name, trade.ticker, 'sell', trade.quantity, tradePrice, false, errorMsg);
        }
      }
    });

    const dailyTrades = newTradeHistory.filter(t => Math.floor(t.timestamp) === nextDay);
    const newMetrics = calculateAllMetrics(newPortfolio, marketData, agent.performanceHistory, nextDay, dailyTrades);
    newMetrics.intradayHour = 0;

    const updatedMemory = {
      recentTrades: [...(agent.memory?.recentTrades || []), ...dailyTrades].slice(-10),
      pastRationales: [...(agent.memory?.pastRationales || []), rationale].slice(-5),
      pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10),
    };

    return {
      ...agent,
      portfolio: newPortfolio,
      tradeHistory: newTradeHistory,
      performanceHistory: [...agent.performanceHistory, newMetrics],
      rationale,
      rationaleHistory: {
        ...agent.rationaleHistory,
        [nextDay]: rationale
      },
      memory: updatedMemory,
    };
  } catch (error) {
    console.error(`Failed to process agent ${agent.name}:`, error);
    logger.logSimulationEvent(`Agent processing failed: ${agent.name}`, {
      agent: agent.name,
      day: nextDay,
      error: error instanceof Error ? error.message : String(error)
    });
    const errorRationale = `Error: Could not retrieve trade decision. Holding positions. ${error}`;
    const newMetrics = calculateAllMetrics(agent.portfolio, marketData, agent.performanceHistory, nextDay);
    return {
      ...agent,
      performanceHistory: [...agent.performanceHistory, newMetrics],
      rationale: errorRationale,
      rationaleHistory: {
        ...agent.rationaleHistory,
        [nextDay]: errorRationale
      }
    };
  }
};

// Pure function: step the simulation forward with new prices
export const step = async (
  currentSnapshot: {
    day: number;
    intradayHour: number;
    marketData: MarketData;
    agents: Agent[];
    benchmarks: Benchmark[];
    chat: ChatState;
    mode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
    currentTimestamp?: number;
  },
  newMarketData: MarketData
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
  chat: ChatState;
}> => {
  const { day, intradayHour, agents, benchmarks, mode, currentTimestamp } = currentSnapshot;

  // Determine timestamp: for real-time mode use actual timestamp, otherwise use day-based timestamp
  // Always initialize timestamp to ensure it's never undefined
  let timestamp: number = day + (intradayHour / 10); // Default: day-based timestamp
  
  if (mode === 'realtime' && currentTimestamp !== undefined) {
    // For real-time mode: use actual timestamp (milliseconds since epoch)
    // Convert to seconds for consistency with performance history
    timestamp = currentTimestamp / 1000; // Convert to seconds
  }

  // Update agents with new market data (no trading, just portfolio valuation)
  const updatedAgents = agents.map(agent => {
    // Calculate metrics with the correct timestamp (includes intraday hour)
    const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;

    return {
      ...agent,
      performanceHistory: [...agent.performanceHistory, newMetrics],
    };
  });

  // Log prices and portfolio values for debugging
  try {
    if (newMarketData && Object.keys(newMarketData).length > 0 && updatedAgents.length > 0) {
      priceLogService.logPricesAndPortfolios(newMarketData, updatedAgents, day, intradayHour, timestamp);
    }
  } catch (error) {
    // Log error but don't break the simulation
    logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
      'Failed to log prices and portfolios', {
        error: error instanceof Error ? error.message : String(error),
        day,
        intradayHour,
        marketDataKeys: Object.keys(newMarketData).length,
        agentsCount: updatedAgents.length
      });
  }

  // Update benchmarks
  const updatedBenchmarks = benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      // Use ^GSPC (S&P 500 Index) - calculate return from stored previous price
      const gspcTicker = '^GSPC';
      const currentGspc = newMarketData[gspcTicker];
      const prevGspcPrice = b.metadata?.lastGspcPrice;

      if (currentGspc && currentGspc.price > 0) {
        if (prevGspcPrice && prevGspcPrice > 0) {
          // Calculate return from ^GSPC price change
          const marketReturn = (currentGspc.price - prevGspcPrice) / prevGspcPrice;

          if (!isNaN(marketReturn) && isFinite(marketReturn)) {
            newTotalValue = lastPerf.totalValue * (1 + marketReturn);

            // Debug logging to trace benchmark updates
            console.log(`[S&P500 Benchmark] Day ${day}, Hour ${intradayHour}: prevGSPC=${prevGspcPrice.toFixed(2)}, currentGSPC=${currentGspc.price.toFixed(2)}, return=${(marketReturn * 100).toFixed(4)}%, prevValue=$${lastPerf.totalValue.toFixed(2)}, newValue=$${newTotalValue.toFixed(2)}`);
          }
        } else {
          // First update - no previous price, so no change
          console.log(`[S&P500 Benchmark] Day ${day}, Hour ${intradayHour}: FIRST UPDATE - currentGSPC=${currentGspc.price.toFixed(2)}, value=$${newTotalValue.toFixed(2)}`);
        }
      } else {
        // Debug: log why update didn't happen
        console.log(`[S&P500 Benchmark] Day ${day}, Hour ${intradayHour}: UPDATE SKIPPED - currentGspc=${!!currentGspc}, currentPrice=${currentGspc?.price}`);
      }
    } else if (b.id === 'AIMI') {
      // AI Managers Index: Direct average of all agent portfolio values
      // This ensures AIMI exactly matches agents when they all have identical portfolios
      if (updatedAgents.length > 0) {
        let totalValue = 0;
        let validAgents = 0;

        updatedAgents.forEach(agent => {
          const agentHistory = agent.performanceHistory;
          if (agentHistory.length > 0) {
            const currPerf = agentHistory[agentHistory.length - 1];
            if (currPerf.totalValue > 0) {
              totalValue += currPerf.totalValue;
              validAgents++;
            }
          }
        });

        if (validAgents > 0) {
          // Direct average of portfolio values (not incremental returns)
          newTotalValue = totalValue / validAgents;
        }
      }
    }

    // For benchmarks, calculate metrics directly using the newTotalValue from market returns
    // We don't use calculateAllMetrics with a fake portfolio because we want to use the exact
    // totalValue we calculated from market returns, not recalculate it from a portfolio
    const dailyReturn = lastPerf.totalValue > 0 ? (newTotalValue / lastPerf.totalValue) - 1 : 0;
    const totalReturn = (newTotalValue / INITIAL_CASH) - 1;

    // Calculate volatility and other metrics from historical returns
    const allReturns = [...b.performanceHistory.map(h => h.dailyReturn), dailyReturn];
    const meanReturn = allReturns.reduce((a, b) => a + b, 0) / allReturns.length;
    const variance = allReturns.reduce((a, b) => a + Math.pow(b - meanReturn, 2), 0) / allReturns.length;
    const dailyVolatility = Math.sqrt(variance);
    const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

    const excessReturns = allReturns.map(r => r - (RISK_FREE_RATE / TRADING_DAYS_PER_YEAR));
    const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
    const sharpeRatio = dailyVolatility > 0 ? (avgExcessReturn / dailyVolatility) * Math.sqrt(TRADING_DAYS_PER_YEAR) : 0;

    // Calculate max drawdown
    const allValues = [...b.performanceHistory.map(h => h.totalValue), newTotalValue];
    let peak = -Infinity;
    let maxDrawdown = 0;
    allValues.forEach(value => {
      if (value > peak) peak = value;
      const drawdown = peak > 0 ? (peak - value) / peak : 0;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    const newMetrics: PerformanceMetrics = {
      totalValue: newTotalValue,
      totalReturn,
      dailyReturn,
      annualizedVolatility,
      sharpeRatio,
      maxDrawdown,
      turnover: 0, // Benchmarks don't trade
      timestamp,
      intradayHour,
    };

    // Update metadata with current ^GSPC price for next calculation
    const updatedMetadata = b.id === S_P500_BENCHMARK_ID && newMarketData['^GSPC']
      ? { ...b.metadata, lastGspcPrice: newMarketData['^GSPC'].price }
      : b.metadata;

    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics], metadata: updatedMetadata };
  });

  return {
    day,
    intradayHour,
    marketData: newMarketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
    chat: currentSnapshot.chat,
  };
};

// Pure function: execute trade window (get LLM decisions and execute trades)
export const tradeWindow = async (
  currentSnapshot: {
    day: number;
    intradayHour: number;
    marketData: MarketData;
    agents: Agent[];
    benchmarks: Benchmark[];
    chat: ChatState;
    mode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
    currentTimestamp?: number;
  }
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
  chat: ChatState;
}> => {
  const { day, intradayHour, marketData, agents, benchmarks, chat, mode, currentTimestamp } = currentSnapshot;

  // Determine timestamp: for real-time mode use actual timestamp, otherwise use day-based timestamp
  // Always initialize timestamp to ensure it's never undefined
  let timestamp: number = day + (intradayHour / 10); // Default: day-based timestamp

  if (mode === 'realtime' && currentTimestamp !== undefined) {
    // For real-time mode: use actual timestamp (milliseconds since epoch)
    // Convert to seconds for consistency with performance history
    timestamp = currentTimestamp / 1000; // Convert to seconds
  }

  const roundId = createRoundId(day, intradayHour);

  // Mark messages as 'delivered' when they are sent to agents
  let chatWithDeliveredMessages = chat;
  if (chat.config.enabled) {
    const updatedMessages = chat.messages.map(message => {
      // Mark pending user messages as 'delivered' when processing them
      // Don't filter by roundId - process ALL pending messages
      if (
        message.senderType === 'user' &&
        message.status === 'pending'
      ) {
        return { ...message, status: 'delivered' as const, roundId };
      }
      return message;
    });
    chatWithDeliveredMessages = {
      ...chat,
      messages: updatedMessages,
    };
  }

  // Get previous failed trades from agent's last trade window
  const getPreviousFailedTrades = (agent: Agent): Array<{ ticker: string; action: string; quantity: number; reason: string }> => {
    // Get failed trades from agent's memory (stored in previous round)
    return (agent.memory as any)?.failedTrades || [];
  };

  const agentResults = await processAgentsWithPacing(agents, mode, agent => {
    const messages = chatWithDeliveredMessages.config.enabled
      ? chatWithDeliveredMessages.messages
        .filter(message =>
          message.status === 'delivered'
            && message.roundId === roundId
            && message.agentId === agent.id
            && message.senderType === 'user'
        )
        .slice(0, chatWithDeliveredMessages.config.maxMessagesPerAgent)
        .map(message => ({ sender: message.sender, content: message.content }))
      : [];

    // Get failed trades from previous round
    const previousFailedTrades = getPreviousFailedTrades(agent);

    return handleTradeWindowAgent(agent, {
      marketData,
      day,
      intradayHour,
      mode,
      timestamp,
      currentTimestamp,
      chatContext: {
        enabled: chatWithDeliveredMessages.config.enabled,
        messages,
        maxReplyLength: chatWithDeliveredMessages.config.maxMessageLength,
      },
      previousFailedTrades,
    });
  });

  const updatedAgents: Agent[] = agentResults.map(result => result.agent);

  // Collect all agents that processed this round (with or without replies)
  const allProcessedAgents = agentResults.map(result => result.agent);

  const agentReplies: AgentReplyInput[] = agentResults
    .filter(result => Boolean(result.reply && result.reply.trim()))
    .map(result => ({
      agent: result.agent,
      roundId,
      reply: result.reply,
    }));

  if (agentReplies.length > 0) {
    logger.logSimulationEvent('[CHAT] Agent replies generated', {
      count: agentReplies.length,
      agents: agentReplies.map(r => r.agent.name),
      roundId,
    });
  }

  const updatedChat = chatWithDeliveredMessages.config.enabled
    ? applyAgentRepliesToChat(chatWithDeliveredMessages, agentReplies, roundId, allProcessedAgents, currentSnapshot.mode)
    : chatWithDeliveredMessages;

  if (chat.config.enabled && agentReplies.length > 0) {
    logger.logSimulationEvent('[CHAT] Agent replies applied to chat', {
      messageCountBefore: chat.messages.length,
      messageCountAfter: updatedChat.messages.length,
      roundId,
    });
  }

  // Update benchmarks after trades
  const updatedBenchmarks = benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      // S&P 500 doesn't change during trade windows (market data unchanged)
      newTotalValue = lastPerf.totalValue;
    } else if (b.id === 'AIMI') {
      // AI Managers Index: Direct average of all agent portfolio values
      // This ensures AIMI exactly matches agents when they all have identical portfolios
      if (updatedAgents.length > 0) {
        let totalValue = 0;
        let validAgents = 0;

        updatedAgents.forEach(agent => {
          const agentHistory = agent.performanceHistory;
          if (agentHistory.length > 0) {
            const currPerf = agentHistory[agentHistory.length - 1];
            if (currPerf.totalValue > 0) {
              totalValue += currPerf.totalValue;
              validAgents++;
            }
          }
        });

        if (validAgents > 0) {
          // Direct average of portfolio values (not incremental returns)
          newTotalValue = totalValue / validAgents;
        }
      }
    }

    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, marketData, b.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;

    // Update metadata with current ^GSPC price for next calculation
    const updatedMetadata = b.id === S_P500_BENCHMARK_ID && marketData['^GSPC']
      ? { ...b.metadata, lastGspcPrice: marketData['^GSPC'].price }
      : b.metadata;

    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics], metadata: updatedMetadata };
  });

  return {
    day,
    intradayHour,
    marketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
    chat: updatedChat,
  };
};

// Pure function: advance to next day
export const advanceDay = async (
  currentSnapshot: {
    day: number;
    intradayHour: number;
    marketData: MarketData;
    agents: Agent[];
    benchmarks: Benchmark[];
    chat: ChatState;
    mode?: 'simulated' | 'realtime' | 'historical' | 'hybrid';
  },
  newMarketData: MarketData
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
  chat: ChatState;
}> => {
  const nextDay = currentSnapshot.day + 1;

  // Process agents with trades at start of day
  const updatedAgents: Agent[] = await processAgentsWithPacing(currentSnapshot.agents, currentSnapshot.mode, agent =>
    handleAdvanceDayAgent(agent, {
      nextDay,
      marketData: newMarketData,
    })
  );
  
  // Update benchmarks
  const updatedBenchmarks = currentSnapshot.benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      // Use ^GSPC (S&P 500 Index) - calculate return from stored previous price
      const gspcTicker = '^GSPC';
      const currentGspc = newMarketData[gspcTicker];
      const prevGspcPrice = b.metadata?.lastGspcPrice;

      if (currentGspc && currentGspc.price > 0) {
        if (prevGspcPrice && prevGspcPrice > 0) {
          // Calculate return from ^GSPC price change
          const marketReturn = (currentGspc.price - prevGspcPrice) / prevGspcPrice;

          if (!isNaN(marketReturn) && isFinite(marketReturn)) {
            newTotalValue = lastPerf.totalValue * (1 + marketReturn);

            // Debug logging to trace benchmark updates
            console.log(`[S&P500 Benchmark - advanceDay] Day ${nextDay}: prevGSPC=${prevGspcPrice.toFixed(2)}, currentGSPC=${currentGspc.price.toFixed(2)}, return=${(marketReturn * 100).toFixed(4)}%, prevValue=$${lastPerf.totalValue.toFixed(2)}, newValue=$${newTotalValue.toFixed(2)}`);
          }
        } else {
          // First update - no previous price, so no change
          console.log(`[S&P500 Benchmark - advanceDay] Day ${nextDay}: FIRST UPDATE - currentGSPC=${currentGspc.price.toFixed(2)}, value=$${newTotalValue.toFixed(2)}`);
        }
      } else {
        // Debug: log why update didn't happen
        console.log(`[S&P500 Benchmark - advanceDay] Day ${nextDay}: UPDATE SKIPPED - currentGspc=${!!currentGspc}, currentPrice=${currentGspc?.price}`);
      }
    } else if (b.id === 'AIMI') {
      // AI Managers Index: Direct average of all agent portfolio values
      // This ensures AIMI exactly matches agents when they all have identical portfolios
      if (updatedAgents.length > 0) {
        let totalValue = 0;
        let validAgents = 0;

        updatedAgents.forEach(agent => {
          const agentHistory = agent.performanceHistory;
          if (agentHistory.length > 0) {
            const currPerf = agentHistory[agentHistory.length - 1];
            if (currPerf.totalValue > 0) {
              totalValue += currPerf.totalValue;
              validAgents++;
            }
          }
        });

        if (validAgents > 0) {
          // Direct average of portfolio values (not incremental returns)
          newTotalValue = totalValue / validAgents;
        }
      }
    }

    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, b.performanceHistory, nextDay);
    newMetrics.intradayHour = 0;

    // Update metadata with current ^GSPC price for next calculation
    const updatedMetadata = b.id === S_P500_BENCHMARK_ID && newMarketData['^GSPC']
      ? { ...b.metadata, lastGspcPrice: newMarketData['^GSPC'].price }
      : b.metadata;

    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics], metadata: updatedMetadata };
  });

  return {
    day: nextDay,
    intradayHour: 0,
    marketData: newMarketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
    chat: currentSnapshot.chat,
  };
};

