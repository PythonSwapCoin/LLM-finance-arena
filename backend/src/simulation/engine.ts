import type { Agent, Benchmark, MarketData, Trade, PerformanceMetrics } from '../types';
import { S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, INITIAL_CASH } from '../constants';
import { calculateAllMetrics } from '../utils/portfolioCalculations';
import { getTradeDecisions } from '../services/llmService';
import { logger } from '../services/logger';

// Pure function: step the simulation forward with new prices
export const step = async (
  currentSnapshot: {
    day: number;
    intradayHour: number;
    marketData: MarketData;
    agents: Agent[];
    benchmarks: Benchmark[];
    mode?: 'simulated' | 'realtime' | 'historical';
    currentTimestamp?: number;
  },
  newMarketData: MarketData
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
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
    const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;
    
    return {
      ...agent,
      performanceHistory: [...agent.performanceHistory, newMetrics],
    };
  });

  // Update benchmarks
  const updatedBenchmarks = benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      const tickers = Object.keys(newMarketData);
      let totalReturn = 0;
      let validReturns = 0;
      
      tickers.forEach(ticker => {
        const currentStock = newMarketData[ticker];
        const prevStock = currentSnapshot.marketData[ticker];
        
        if (prevStock && prevStock.price > 0 && currentStock.price > 0) {
          const stockReturn = (currentStock.price - prevStock.price) / prevStock.price;
          totalReturn += stockReturn;
          validReturns++;
        }
      });
      
      if (validReturns > 0) {
        const marketReturn = totalReturn / validReturns;
        newTotalValue *= (1 + marketReturn);
      } else {
        const marketReturn = Object.values(newMarketData).reduce((acc, stock) => {
          return acc + (stock.dailyChangePercent || 0);
        }, 0) / Object.values(newMarketData).length;
        newTotalValue *= (1 + marketReturn);
      }
    } else if (b.id === AI_MANAGERS_INDEX_ID) {
      const avgAgentReturn = updatedAgents.reduce((acc, agent) => {
        const lastMetric = agent.performanceHistory[agent.performanceHistory.length - 1];
        const prevMetric = agent.performanceHistory[agent.performanceHistory.length - 2];
        if (prevMetric) {
          const intradayReturn = (lastMetric.totalValue / prevMetric.totalValue) - 1;
          return acc + intradayReturn;
        }
        return acc;
      }, 0) / updatedAgents.length;
      newTotalValue *= (1 + avgAgentReturn);
    }
    
    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, b.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;
    
    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
  });

  return {
    day,
    intradayHour,
    marketData: newMarketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
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
    mode?: 'simulated' | 'realtime' | 'historical';
    currentTimestamp?: number;
  }
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
}> => {
  const { day, intradayHour, marketData, agents, benchmarks, mode, currentTimestamp } = currentSnapshot;
  
  // Determine timestamp: for real-time mode use actual timestamp, otherwise use day-based timestamp
  // Always initialize timestamp to ensure it's never undefined
  let timestamp: number = day + (intradayHour / 10); // Default: day-based timestamp
  
  if (mode === 'realtime' && currentTimestamp !== undefined) {
    // For real-time mode: use actual timestamp (milliseconds since epoch)
    // Convert to seconds for consistency with performance history
    timestamp = currentTimestamp / 1000; // Convert to seconds
  }

  // Process agents in parallel
  const updatedAgents: Agent[] = await Promise.all(
    agents.map(async (agent) => {
      try {
        const tradeDecision = await Promise.race([
          getTradeDecisions(agent, marketData, day, 30000),
          new Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[], rationale: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Trade decision timeout')), 30000)
          )
        ]).catch(error => {
          console.warn(`[${agent.name}] Trade decision timeout or error:`, error);
          logger.logSimulationEvent(`Trade decision error for ${agent.name}`, { 
            agent: agent.name, 
            day, 
            hour: intradayHour, 
            error: error instanceof Error ? error.message : String(error) 
          });
          return { trades: [], rationale: `Trade decision unavailable - holding positions. ${error instanceof Error ? error.message : String(error)}` };
        });

        const { trades: decidedTrades, rationale } = tradeDecision;
        const newTradeHistory = [...agent.tradeHistory];
        const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };
        
        decidedTrades.forEach(trade => {
          const tradePrice = marketData[trade.ticker]?.price;
          if (!tradePrice) {
            console.warn(`[${agent.name}] Skipping trade for ${trade.ticker} - price not available`);
            return;
          }

          if (trade.action === 'buy') {
            const cost = trade.quantity * tradePrice;
            if (newPortfolio.cash >= cost) {
              newPortfolio.cash -= cost;
              const existingPosition = newPortfolio.positions[trade.ticker];
              if (existingPosition) {
                const totalCost = (existingPosition.averageCost * existingPosition.quantity) + cost;
                existingPosition.quantity += trade.quantity;
                existingPosition.averageCost = totalCost / existingPosition.quantity;
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
                timestamp: timestamp,
                fairValue: trade.fairValue,
                topOfBox: trade.topOfBox,
                bottomOfBox: trade.bottomOfBox,
                justification: trade.justification,
              });
              logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true);
            } else {
              const errorMsg = `Insufficient cash: need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`;
              console.warn(`[${agent.name}] Insufficient cash for ${trade.quantity} shares of ${trade.ticker}`);
              logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg);
            }
          } else if (trade.action === 'sell') {
            const existingPosition = newPortfolio.positions[trade.ticker];
            if (existingPosition && existingPosition.quantity > 0) {
              const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
              if (quantityToSell < trade.quantity) {
                console.warn(`[${agent.name}] Attempted to sell ${trade.quantity} shares of ${trade.ticker} but only owns ${existingPosition.quantity}. Selling ${quantityToSell} instead.`);
              }
              newPortfolio.cash += quantityToSell * tradePrice;
              existingPosition.quantity -= quantityToSell;
              if (existingPosition.quantity === 0) {
                delete newPortfolio.positions[trade.ticker];
              }
              newTradeHistory.push({ 
                ...trade, 
                quantity: quantityToSell, 
                price: tradePrice, 
                timestamp: timestamp,
                fairValue: trade.fairValue,
                topOfBox: trade.topOfBox,
                bottomOfBox: trade.bottomOfBox,
                justification: trade.justification,
              });
              logger.logTrade(agent.name, trade.ticker, 'sell', quantityToSell, tradePrice, true);
            } else {
              const errorMsg = existingPosition ? `only owns ${existingPosition.quantity}` : 'does not own this stock';
              console.warn(`[${agent.name}] Cannot sell ${trade.quantity} shares of ${trade.ticker} - ${errorMsg}`);
              logger.logTrade(agent.name, trade.ticker, 'sell', trade.quantity, tradePrice, false, errorMsg);
            }
          }
        });

        const intradayTrades = newTradeHistory.filter(t => {
          if (mode === 'realtime' && currentTimestamp !== undefined) {
            const tradeTimestamp = currentTimestamp / 1000;
            return Math.abs(t.timestamp - tradeTimestamp) < 60; // Within 60 seconds for real-time
          }
          // For simulated/historical: check if trade is within current timestamp window
          const timestampDiff = Math.abs(t.timestamp - timestamp);
          return timestampDiff < 0.01; // Within 0.01 of current timestamp
        });
        const newMetrics = calculateAllMetrics(newPortfolio, marketData, agent.performanceHistory, timestamp, intradayTrades);
        newMetrics.intradayHour = intradayHour;
        
        const updatedMemory = {
          recentTrades: [...(agent.memory?.recentTrades || []), ...decidedTrades.map(t => ({ ...t, price: marketData[t.ticker]?.price || 0, timestamp: timestamp } as Trade))].slice(-10),
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
            [day]: rationale
          },
          memory: updatedMemory,
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
          ...agent, 
          performanceHistory: [...agent.performanceHistory, newMetrics], 
          rationale: errorRationale,
          rationaleHistory: {
            ...agent.rationaleHistory,
            [day]: errorRationale
          }
        };
      }
    })
  );

  // Update benchmarks after trades
  const updatedBenchmarks = benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      // S&P 500 benchmark updates based on market data changes (already handled in step)
      newTotalValue = lastPerf.totalValue;
    } else if (b.id === AI_MANAGERS_INDEX_ID) {
      const avgAgentReturn = updatedAgents.reduce((acc, agent) => {
        const lastMetric = agent.performanceHistory[agent.performanceHistory.length - 1];
        const prevMetric = agent.performanceHistory[agent.performanceHistory.length - 2];
        if (prevMetric) {
          const intradayReturn = (lastMetric.totalValue / prevMetric.totalValue) - 1;
          return acc + intradayReturn;
        }
        return acc;
      }, 0) / updatedAgents.length;
      newTotalValue *= (1 + avgAgentReturn);
    }
    
    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, marketData, b.performanceHistory, timestamp);
    newMetrics.intradayHour = intradayHour;
    
    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
  });

  return {
    day,
    intradayHour,
    marketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
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
  },
  newMarketData: MarketData
): Promise<{
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
}> => {
  const nextDay = currentSnapshot.day + 1;

  // Process agents with trades at start of day
  const updatedAgents: Agent[] = await Promise.all(
    currentSnapshot.agents.map(async (agent) => {
      try {
        const { trades: decidedTrades, rationale } = await Promise.race([
          getTradeDecisions(agent, newMarketData, nextDay, 30000),
          new Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[], rationale: string }>((_, reject) =>
            setTimeout(() => reject(new Error('Trade decision timeout')), 30000)
          )
        ]).catch(error => {
          console.warn(`[${agent.name}] Trade decision timeout or error:`, error);
          return { trades: [], rationale: `Trade decision unavailable - holding positions. ${error instanceof Error ? error.message : String(error)}` };
        });

        const newTradeHistory = [...agent.tradeHistory];
        const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };
        
        decidedTrades.forEach(trade => {
          const tradePrice = newMarketData[trade.ticker]?.price;
          if (!tradePrice) {
            console.warn(`[${agent.name}] Skipping trade for ${trade.ticker} - price not available`);
            return;
          }

          if (trade.action === 'buy') {
            const cost = trade.quantity * tradePrice;
            if (newPortfolio.cash >= cost) {
              newPortfolio.cash -= cost;
              const existingPosition = newPortfolio.positions[trade.ticker];
              if (existingPosition) {
                const totalCost = (existingPosition.averageCost * existingPosition.quantity) + cost;
                existingPosition.quantity += trade.quantity;
                existingPosition.averageCost = totalCost / existingPosition.quantity;
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
              });
              logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true);
            } else {
              const errorMsg = `Insufficient cash: need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`;
              logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg);
            }
          } else if (trade.action === 'sell') {
            const existingPosition = newPortfolio.positions[trade.ticker];
            if (existingPosition && existingPosition.quantity > 0) {
              const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
              newPortfolio.cash += quantityToSell * tradePrice;
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
              });
              logger.logTrade(agent.name, trade.ticker, 'sell', quantityToSell, tradePrice, true);
            } else {
              const errorMsg = existingPosition ? `only owns ${existingPosition.quantity}` : 'does not own this stock';
              logger.logTrade(agent.name, trade.ticker, 'sell', trade.quantity, tradePrice, false, errorMsg);
            }
          }
        });

        const dailyTrades = newTradeHistory.filter(t => Math.floor(t.timestamp) === nextDay);
        const newMetrics = calculateAllMetrics(newPortfolio, newMarketData, agent.performanceHistory, nextDay, dailyTrades);
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
        const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, nextDay);
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
    })
  );
  
  // Update benchmarks
  const updatedBenchmarks = currentSnapshot.benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
      newTotalValue = lastPerf.totalValue;
    } else if (b.id === AI_MANAGERS_INDEX_ID) {
      const avgAgentReturn = updatedAgents.reduce((acc, agent) => acc + (agent.performanceHistory.slice(-1)[0]?.dailyReturn ?? 0), 0) / updatedAgents.length;
      newTotalValue *= (1 + avgAgentReturn);
    }
    
    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, b.performanceHistory, nextDay);
    newMetrics.intradayHour = 0;
    
    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
  });

  return {
    day: nextDay,
    intradayHour: 0,
    marketData: newMarketData,
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
  };
};

