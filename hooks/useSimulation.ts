import { useState, useCallback, useEffect } from 'react';
import type { Agent, MarketData, Trade, PerformanceMetrics, Benchmark } from '../types';
import { INITIAL_AGENTS, S_P500_TICKERS, INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, BENCHMARK_COLORS } from '../constants';
import { generateNextDayMarketData, generateNextIntradayMarketData, createInitialMarketData, isHistoricalSimulationComplete, getHistoricalSimulationPeriod, advanceIntradayHour, getCurrentIntradayHour, isTradingAllowed } from '../services/marketDataService';
import { getTradeDecisions } from '../services/geminiService';
import { calculateAllMetrics } from '../utils/portfolioCalculations';
import { logger } from '../services/logger';

export const useSimulation = () => {
  const [simulationState, setSimulationState] = useState({ day: 0, intradayHour: 0, isLoading: false });
  const [marketData, setMarketData] = useState<MarketData>({});
  const [agents, setAgents] = useState<Agent[]>(INITIAL_AGENTS);
  const [benchmarks, setBenchmarks] = useState<Benchmark[]>([]);

  useEffect(() => {
    const initializeMarketData = async () => {
      logger.logSimulationEvent('Initializing simulation', { tickers: S_P500_TICKERS.length, agents: INITIAL_AGENTS.length });
      const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
      setMarketData(initialMarketData);
      
      const initialAgentStates = INITIAL_AGENTS.map(agent => {
          const initialMetrics = calculateAllMetrics(agent.portfolio, initialMarketData, [], 0);
          return { 
            ...agent, 
            performanceHistory: [initialMetrics],
            rationaleHistory: { 0: 'Initial state - no trades yet.' },
            memory: {
              recentTrades: [],
              pastRationales: [],
              pastPerformance: [initialMetrics],
            }
          };
      });
      setAgents(initialAgentStates);

      const initialBenchmarkMetrics = calculateAllMetrics({cash: INITIAL_CASH, positions: {}}, initialMarketData, [], 0);
      setBenchmarks([
          { id: S_P500_BENCHMARK_ID, name: 'S&P 500', color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID], performanceHistory: [initialBenchmarkMetrics] },
          { id: AI_MANAGERS_INDEX_ID, name: 'AI Managers Index', color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID], performanceHistory: [initialBenchmarkMetrics] }
      ]);
    };
    
    initializeMarketData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Advance intraday (every 30 minutes) - data updates every 30 min, trading only every 2 hours
  const advanceIntraday = useCallback(async () => {
    const { hour: nextHour, shouldAdvanceDay } = advanceIntradayHour();
    
    // If we should advance day, do that instead
    if (shouldAdvanceDay) {
      await advanceDay();
      return;
    }
    
    const canTrade = isTradingAllowed();
    logger.logSimulationEvent(`Advancing to intraday hour ${nextHour}`, { day: simulationState.day, hour: nextHour, canTrade });
    setSimulationState(prev => ({ ...prev, isLoading: true, intradayHour: nextHour }));
    const newMarketData = await generateNextIntradayMarketData(marketData, simulationState.day, nextHour);
    
    // Validate that we have market data before proceeding
    if (!newMarketData || Object.keys(newMarketData).length === 0) {
      console.error('No market data generated for intraday update, using previous data');
      logger.logSimulationEvent('No market data generated for intraday update', { day: simulationState.day, hour: nextHour });
      setSimulationState(prev => ({ ...prev, isLoading: false }));
      return; // Don't proceed if we have no market data
    }
    
    setMarketData(newMarketData);

    // Only allow trading every 2 hours (0, 2, 4, 6), but update portfolio values every 30 minutes
    const updatedAgents: Agent[] = await Promise.all(
      agents.map(async (agent) => {
        try {
          // Create a timestamp that includes intraday hour (e.g., 1.05 for day 1, hour 0.5)
          const intradayTimestamp = simulationState.day + (nextHour / 10);
          let decidedTrades: Omit<Trade, 'price' | 'timestamp'>[] = [];
          let rationale = agent.rationale; // Keep previous rationale if no trading window
          
          // Only fetch trade decisions if trading is allowed (every 2 hours) - don't call LLM otherwise to save API costs
          if (canTrade) {
            // Double-check that we have market data before making trading decisions
            if (!newMarketData || Object.keys(newMarketData).length === 0) {
              console.warn(`[${agent.name}] No market data available for trading decision, holding positions`);
              logger.logSimulationEvent(`No market data for ${agent.name} trading decision`, { agent: agent.name, day: simulationState.day, hour: nextHour, marketDataKeys: Object.keys(newMarketData || {}).length });
              rationale = 'No market data available - holding positions.';
            } else {
              try {
                const tradeDecision = await Promise.race([
                  getTradeDecisions(agent, newMarketData, simulationState.day, 30000), // 30 second timeout
                  new Promise<{ trades: Omit<Trade, 'price' | 'timestamp'>[], rationale: string }>((_, reject) =>
                    setTimeout(() => reject(new Error('Trade decision timeout')), 30000)
                  )
                ]);
                decidedTrades = tradeDecision.trades;
                rationale = tradeDecision.rationale;
              } catch (error) {
                console.warn(`[${agent.name}] Trade decision timeout or error, holding positions:`, error);
                logger.logSimulationEvent(`Trade decision error for ${agent.name}`, { agent: agent.name, day: simulationState.day, hour: nextHour, error: error instanceof Error ? error.message : String(error) });
                rationale = `Trade decision unavailable - holding positions. ${error instanceof Error ? error.message : String(error)}`;
              }
            }
          }
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
                if(newPortfolio.cash >= cost) {
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
                      timestamp: intradayTimestamp,
                      fairValue: trade.fairValue,
                      topOfBox: trade.topOfBox,
                      bottomOfBox: trade.bottomOfBox,
                      justification: trade.justification,
                    });
                    logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true);
                } else {
                  const errorMsg = `Insufficient cash: need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`;
                  console.warn(`[${agent.name}] Insufficient cash for ${trade.quantity} shares of ${trade.ticker} at $${tradePrice.toFixed(2)}. Need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`);
                  logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg);
                }
            } else if (trade.action === 'sell') {
                const existingPosition = newPortfolio.positions[trade.ticker];
                if(existingPosition && existingPosition.quantity > 0) {
                    const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
                    if (quantityToSell < trade.quantity) {
                      console.warn(`[${agent.name}] Attempted to sell ${trade.quantity} shares of ${trade.ticker} but only owns ${existingPosition.quantity}. Selling ${quantityToSell} instead.`);
                    }
                    newPortfolio.cash += quantityToSell * tradePrice;
                    existingPosition.quantity -= quantityToSell;
                    if(existingPosition.quantity === 0) {
                        delete newPortfolio.positions[trade.ticker];
                    }
                    newTradeHistory.push({ 
                      ...trade, 
                      quantity: quantityToSell, 
                      price: tradePrice, 
                      timestamp: intradayTimestamp,
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

          // Calculate metrics with intraday timestamp
          const intradayTrades = newTradeHistory.filter(t => Math.abs(t.timestamp - intradayTimestamp) < 0.01);
          const newMetrics = calculateAllMetrics(newPortfolio, newMarketData, agent.performanceHistory, intradayTimestamp, intradayTrades);
          newMetrics.intradayHour = nextHour;
          
          // Update agent memory
          const updatedMemory = {
            recentTrades: [...(agent.memory?.recentTrades || []), ...decidedTrades.map(t => ({ ...t, price: newMarketData[t.ticker]?.price || 0, timestamp: intradayTimestamp } as Trade))].slice(-10), // Keep last 10 trades
            pastRationales: [...(agent.memory?.pastRationales || []), rationale].slice(-5), // Keep last 5 rationales
            pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10), // Keep last 10 performance snapshots
          };
          
          return {
            ...agent,
            portfolio: newPortfolio,
            tradeHistory: newTradeHistory,
            performanceHistory: [...agent.performanceHistory, newMetrics],
            rationale: canTrade ? rationale : agent.rationale, // Only update rationale when trading is allowed
            rationaleHistory: {
              ...agent.rationaleHistory,
              [simulationState.day]: canTrade ? rationale : (agent.rationaleHistory[simulationState.day] || agent.rationale) // Only update if trading window
            },
            memory: updatedMemory,
          };
        } catch (error) {
          console.error(`Failed to process agent ${agent.name}:`, error);
          logger.logSimulationEvent(`Agent processing failed: ${agent.name}`, { agent: agent.name, day: simulationState.day, hour: nextHour, error: error instanceof Error ? error.message : String(error) });
          const errorRationale = `Error: Could not retrieve trade decision. Holding positions. ${error}`;
          const intradayTimestamp = simulationState.day + (nextHour / 10);
          const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, intradayTimestamp);
          newMetrics.intradayHour = nextHour;
          return { 
            ...agent, 
            performanceHistory: [...agent.performanceHistory, newMetrics], 
            rationale: errorRationale,
            rationaleHistory: {
              ...agent.rationaleHistory,
              [simulationState.day]: errorRationale
            }
          };
        }
      })
    );

    // Update Benchmarks for intraday
    const updatedBenchmarks = benchmarks.map(b => {
        const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
        let newTotalValue = lastPerf.totalValue;

        if (b.id === S_P500_BENCHMARK_ID) {
            // Calculate S&P 500 return based on average stock price changes
            // Compare current prices to previous prices to get actual return
            const tickers = Object.keys(newMarketData);
            let totalReturn = 0;
            let validReturns = 0;
            
            tickers.forEach(ticker => {
              const currentStock = newMarketData[ticker];
              const prevStock = marketData[ticker];
              
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
              // Fallback: use dailyChangePercent if available
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
        
        const newHistory = [...b.performanceHistory];
        const prevValue = lastPerf.totalValue;
        const newDailyReturn = prevValue > 0 ? (newTotalValue / prevValue) - 1 : 0;
        const intradayTimestamp = simulationState.day + (nextHour / 10);
        const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, newHistory, intradayTimestamp);
        newMetrics.intradayHour = nextHour;
        
        return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
    });

    setBenchmarks(updatedBenchmarks);
    setAgents(updatedAgents);
    setSimulationState(prev => ({ ...prev, isLoading: false }));
  }, [simulationState.day, marketData, agents, benchmarks]);

  const advanceDay = useCallback(async () => {
    const nextDay = simulationState.day + 1;
    
    // Check if historical simulation is complete (should stop after 5 days: days 0-4)
    // We want to process days 0, 1, 2, 3, 4 (5 days total)
    // So we stop when trying to go to day 5
    if (isHistoricalSimulationComplete(nextDay)) {
      console.log(`📊 Historical simulation complete (processed days 0-${simulationState.day}, total: ${simulationState.day + 1} days). Stopping simulation.`);
      logger.logSimulationEvent('Historical simulation complete', { totalDays: simulationState.day + 1, finalDay: simulationState.day });
      setSimulationState(prev => ({ ...prev, isLoading: false }));
      return; // Stop advancing
    }

    logger.logSimulationEvent(`Advancing to day ${nextDay}`, { currentDay: simulationState.day, nextDay });
    setSimulationState(prev => ({ ...prev, isLoading: true, intradayHour: 0 }));
    const newMarketData = await generateNextDayMarketData(marketData);
    setMarketData(newMarketData);

    // Process agents in parallel with timeout protection
    const updatedAgents: Agent[] = await Promise.all(
      agents.map(async (agent) => {
        try {
          // Use Promise.race for timeout protection
          const { trades: decidedTrades, rationale } = await Promise.race([
            getTradeDecisions(agent, newMarketData, nextDay, 30000), // 30 second timeout
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
                if(newPortfolio.cash >= cost) {
                    newPortfolio.cash -= cost;
                    const existingPosition = newPortfolio.positions[trade.ticker];
                    if (existingPosition) {
                        const totalCost = (existingPosition.averageCost * existingPosition.quantity) + cost;
                        existingPosition.quantity += trade.quantity;
                        existingPosition.averageCost = totalCost / existingPosition.quantity;
                        // Update estimations if provided
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
                      // Preserve valuation data if provided
                      fairValue: trade.fairValue,
                      topOfBox: trade.topOfBox,
                      bottomOfBox: trade.bottomOfBox,
                      justification: trade.justification,
                    });
                    logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, true);
                } else {
                  const errorMsg = `Insufficient cash: need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`;
                  console.warn(`[${agent.name}] Insufficient cash for ${trade.quantity} shares of ${trade.ticker} at $${tradePrice.toFixed(2)}. Need $${cost.toFixed(2)}, have $${newPortfolio.cash.toFixed(2)}`);
                  logger.logTrade(agent.name, trade.ticker, 'buy', trade.quantity, tradePrice, false, errorMsg);
                }
            } else if (trade.action === 'sell') {
                const existingPosition = newPortfolio.positions[trade.ticker];
                if(existingPosition && existingPosition.quantity > 0) {
                    const quantityToSell = Math.min(trade.quantity, existingPosition.quantity);
                    if (quantityToSell < trade.quantity) {
                      console.warn(`[${agent.name}] Attempted to sell ${trade.quantity} shares of ${trade.ticker} but only owns ${existingPosition.quantity}. Selling ${quantityToSell} instead.`);
                    }
                    newPortfolio.cash += quantityToSell * tradePrice;
                    existingPosition.quantity -= quantityToSell;
                    if(existingPosition.quantity === 0) {
                        delete newPortfolio.positions[trade.ticker];
                    }
                    newTradeHistory.push({ 
                      ...trade, 
                      quantity: quantityToSell, 
                      price: tradePrice, 
                      timestamp: nextDay,
                      // Preserve valuation data if provided
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

          const dailyTrades = newTradeHistory.filter(t => Math.floor(t.timestamp) === nextDay);
          const newMetrics = calculateAllMetrics(newPortfolio, newMarketData, agent.performanceHistory, nextDay, dailyTrades);
          newMetrics.intradayHour = 0; // Start of day
          
          // Update agent memory
          const updatedMemory = {
            recentTrades: [...(agent.memory?.recentTrades || []), ...dailyTrades].slice(-10), // Keep last 10 trades
            pastRationales: [...(agent.memory?.pastRationales || []), rationale].slice(-5), // Keep last 5 rationales
            pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10), // Keep last 10 performance snapshots
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
          logger.logSimulationEvent(`Agent processing failed: ${agent.name}`, { agent: agent.name, day: nextDay, error: error instanceof Error ? error.message : String(error) });
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
    
    // Update Benchmarks
    const updatedBenchmarks = benchmarks.map(b => {
        const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
        let newTotalValue = lastPerf.totalValue;

        if (b.id === S_P500_BENCHMARK_ID) {
            // At start of new day (market open), benchmark stays at previous day's close
            // It will update during intraday updates
            newTotalValue = lastPerf.totalValue;
        } else if (b.id === AI_MANAGERS_INDEX_ID) {
            const avgAgentReturn = updatedAgents.reduce((acc, agent) => acc + (agent.performanceHistory.slice(-1)[0]?.dailyReturn ?? 0), 0) / updatedAgents.length;
            newTotalValue *= (1 + avgAgentReturn);
        }
        
        const newHistory = [...b.performanceHistory];
        const prevValue = lastPerf.totalValue;
        const newDailyReturn = prevValue > 0 ? (newTotalValue / prevValue) - 1 : 0;
        
        const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, newHistory, nextDay);
        newMetrics.intradayHour = 0; // Start of day
        
        return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
    });

    setBenchmarks(updatedBenchmarks);
    setAgents(updatedAgents);
    setSimulationState({ day: nextDay, intradayHour: 0, isLoading: false });
  }, [simulationState.day, marketData, agents, benchmarks]);

  // Update positions with last estimations when trades are executed
  const updatePositionEstimations = useCallback((agent: Agent, trade: Trade) => {
    if (trade.action === 'buy' && trade.fairValue !== undefined) {
      const position = agent.portfolio.positions[trade.ticker];
      if (position) {
        position.lastFairValue = trade.fairValue;
        position.lastTopOfBox = trade.topOfBox;
        position.lastBottomOfBox = trade.bottomOfBox;
      }
    }
  }, []);

  // Export simulation data to JSON file
  const exportSimulationData = useCallback(() => {
    logger.logSimulationEvent('Exporting simulation data', { day: simulationState.day, agents: agents.length });
    // Collect market data history (we'll reconstruct it from current state)
    // For a full implementation, we'd need to store historical market data
    // For now, we'll export current state and all agent data
    
    const historicalPeriod = getHistoricalSimulationPeriod();
    
    const exportData = {
      simulation: {
        totalDays: simulationState.day + 1, // Days are 0-indexed, so add 1 for total count
        daysProcessed: simulationState.day + 1, // Days 0-4 = 5 days total
        finalDay: simulationState.day,
        timestamp: new Date().toISOString(),
        ...(historicalPeriod.start && historicalPeriod.end ? {
          historicalPeriod: {
            start: historicalPeriod.start.toISOString().split('T')[0],
            end: historicalPeriod.end.toISOString().split('T')[0],
            description: `Historical simulation using real market data from ${historicalPeriod.start.toISOString().split('T')[0]} to ${historicalPeriod.end.toISOString().split('T')[0]} (Mon-Fri)`,
            note: `Simulation processed days 0-${simulationState.day} (${simulationState.day + 1} trading days total)`
          }
        } : {}),
      },
      agents: agents.map(agent => ({
        id: agent.id,
        name: agent.name,
        model: agent.model,
        finalPortfolio: agent.portfolio,
        trades: agent.tradeHistory.map(trade => ({
          day: Math.floor(trade.timestamp),
          intradayHour: Math.round((trade.timestamp - Math.floor(trade.timestamp)) * 10),
          timestamp: trade.timestamp,
          ticker: trade.ticker,
          action: trade.action,
          quantity: trade.quantity,
          price: trade.price,
          value: trade.quantity * trade.price,
          fairValue: trade.fairValue,
          topOfBox: trade.topOfBox,
          bottomOfBox: trade.bottomOfBox,
          justification: trade.justification,
        })),
        valuationAnalysis: agent.tradeHistory
          .filter(trade => trade.fairValue !== undefined || trade.topOfBox !== undefined || trade.bottomOfBox !== undefined || trade.justification)
          .map(trade => ({
            day: Math.floor(trade.timestamp),
            intradayHour: Math.round((trade.timestamp - Math.floor(trade.timestamp)) * 10),
            timestamp: trade.timestamp,
            ticker: trade.ticker,
            action: trade.action,
            currentPrice: trade.price,
            fairValue: trade.fairValue,
            topOfBox: trade.topOfBox,
            bottomOfBox: trade.bottomOfBox,
            justification: trade.justification || 'No justification provided',
          })),
        dailyRationales: agent.rationaleHistory,
        performance: agent.performanceHistory.map(perf => ({
          day: Math.floor(perf.timestamp),
          intradayHour: perf.intradayHour ?? (Math.round((perf.timestamp - Math.floor(perf.timestamp)) * 10)),
          timestamp: perf.timestamp,
          totalValue: perf.totalValue,
          totalReturn: perf.totalReturn,
          dailyReturn: perf.dailyReturn,
          sharpeRatio: perf.sharpeRatio,
          maxDrawdown: perf.maxDrawdown,
          volatility: perf.annualizedVolatility,
          turnover: perf.turnover,
        })),
        summary: {
          totalTrades: agent.tradeHistory.length,
          finalValue: agent.performanceHistory[agent.performanceHistory.length - 1]?.totalValue || 0,
          totalReturn: agent.performanceHistory[agent.performanceHistory.length - 1]?.totalReturn || 0,
          finalSharpeRatio: agent.performanceHistory[agent.performanceHistory.length - 1]?.sharpeRatio || 0,
        }
      })),
      dailyBreakdown: Array.from({ length: simulationState.day + 1 }, (_, day) => {
        // Get all trades for this day (including intraday)
        const dayTrades = agents.flatMap(agent => 
          agent.tradeHistory
            .filter(t => Math.floor(t.timestamp) === day)
            .map(t => ({
              agentId: agent.id,
              agentName: agent.name,
              intradayHour: Math.round((t.timestamp - Math.floor(t.timestamp)) * 10),
              timestamp: t.timestamp,
              ticker: t.ticker,
              action: t.action,
              quantity: t.quantity,
              price: t.price,
              value: t.quantity * t.price,
              fairValue: t.fairValue,
              topOfBox: t.topOfBox,
              bottomOfBox: t.bottomOfBox,
              justification: t.justification,
            }))
        );
        
        const dayRationales = agents.map(agent => ({
          agentId: agent.id,
          agentName: agent.name,
          rationale: agent.rationaleHistory[day] || 'No rationale available',
        }));

        // Get all performance metrics for this day (including intraday)
        const dayMetrics = agents.map(agent => {
          const dayPerf = agent.performanceHistory.filter(p => Math.floor(p.timestamp) === day);
          return {
            agentId: agent.id,
            agentName: agent.name,
            metrics: dayPerf.map(p => ({
              intradayHour: p.intradayHour ?? (Math.round((p.timestamp - Math.floor(p.timestamp)) * 10)),
              timestamp: p.timestamp,
              portfolioValue: p.totalValue,
              dailyReturn: p.dailyReturn,
              totalReturn: p.totalReturn,
            })),
            finalPortfolioValue: dayPerf.length > 0 ? dayPerf[dayPerf.length - 1].totalValue : 0,
            finalDailyReturn: dayPerf.length > 0 ? dayPerf[dayPerf.length - 1].dailyReturn : 0,
            finalTotalReturn: dayPerf.length > 0 ? dayPerf[dayPerf.length - 1].totalReturn : 0,
          };
        });

        return {
          day,
          trades: dayTrades,
          rationales: dayRationales,
          agentPortfolios: dayMetrics,
        };
      }),
    };

    // Create and download JSON file
    const jsonStr = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `simulation-export-day-${simulationState.day}-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    // Create and download trade analysis file
    const tradeAnalysisData = agents.flatMap(agent => 
      agent.tradeHistory
        .filter(trade => trade.fairValue !== undefined || trade.topOfBox !== undefined || trade.bottomOfBox !== undefined || trade.justification)
        .map(trade => ({
          agentId: agent.id,
          agentName: agent.name,
          timestamp: trade.timestamp,
          day: Math.floor(trade.timestamp) + 1, // Convert to 1-indexed day
          intradayHour: Math.round((trade.timestamp - Math.floor(trade.timestamp)) * 10),
          ticker: trade.ticker,
          action: trade.action,
          price: trade.price,
          quantity: trade.quantity,
          fairValue: trade.fairValue ?? null,
          topOfBox: trade.topOfBox ?? null,
          bottomOfBox: trade.bottomOfBox ?? null,
          justification: trade.justification ?? 'No justification provided',
        }))
    );

    // Create CSV format
    const csvHeaders = 'Agent ID,Agent Name,Day,Intraday Hour,Ticker,Action,Price,Quantity,Fair Value,Top of Box,Bottom of Box,Justification\n';
    const csvRows = tradeAnalysisData.map(t => {
      return `${t.agentId},${t.agentName},${t.day},${t.intradayHour},${t.ticker},${t.action},${t.price.toFixed(2)},${t.quantity},${t.fairValue?.toFixed(2) ?? 'N/A'},${t.topOfBox?.toFixed(2) ?? 'N/A'},${t.bottomOfBox?.toFixed(2) ?? 'N/A'},"${t.justification.replace(/"/g, '""')}"`;
    }).join('\n');
    const csvContent = csvHeaders + csvRows;

    // Download CSV file
    const csvBlob = new Blob([csvContent], { type: 'text/csv' });
    const csvUrl = URL.createObjectURL(csvBlob);
    const csvLink = document.createElement('a');
    csvLink.href = csvUrl;
    csvLink.download = `trade-analysis-day-${simulationState.day}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(csvLink);
    csvLink.click();
    document.body.removeChild(csvLink);
    URL.revokeObjectURL(csvUrl);
  }, [agents, simulationState.day, marketData]);

  return { agents, benchmarks, simulationState, marketData, advanceDay, advanceIntraday, exportSimulationData };
};