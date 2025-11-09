import { S_P500_TICKERS, INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, BENCHMARK_COLORS, TRADER_CONFIGS, AGENT_COLORS, UNIFIED_SYSTEM_PROMPT } from './types.js';
import { createInitialMarketData, generateNextDayMarketData, generateNextIntradayMarketData, advanceIntradayHour, isTradingAllowed, isHistoricalSimulationComplete } from './services/marketDataService.js';
import { getTradeDecisions } from './services/llmService.js';
import { calculateAllMetrics } from './utils/portfolioCalculations.js';

// Simulation state (shared across requests in serverless - will need persistence for production)
let simulationState = {
  day: 0,
  intradayHour: 0,
  isLoading: false
};

let marketData = {};
let agents = [];
let benchmarks = [];
let isInitialized = false;

// Initialize agents
const initializeAgents = () => {
  return TRADER_CONFIGS.map((config, index) => ({
    id: config.id,
    name: config.name,
    model: config.model,
    color: config.color || AGENT_COLORS[index % AGENT_COLORS.length],
    portfolio: {
      cash: INITIAL_CASH,
      positions: {}
    },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
    rationaleHistory: { 0: 'Awaiting first trading day.' },
    systemPrompt: config.systemPrompt || UNIFIED_SYSTEM_PROMPT,
    memory: {
      recentTrades: [],
      pastRationales: [],
      pastPerformance: [],
    }
  }));
};

// Initialize simulation
export const initializeSimulation = async () => {
  if (isInitialized) {
    return getSimulationState();
  }

  console.log('Initializing simulation...');
  marketData = await createInitialMarketData(S_P500_TICKERS);
  agents = initializeAgents();
  
  // Initialize agent performance history
  agents = agents.map(agent => {
    const initialMetrics = calculateAllMetrics(agent.portfolio, marketData, [], 0);
    return {
      ...agent,
      performanceHistory: [initialMetrics],
      memory: {
        recentTrades: [],
        pastRationales: [],
        pastPerformance: [initialMetrics],
      }
    };
  });

  // Initialize benchmarks
  const initialBenchmarkMetrics = calculateAllMetrics({cash: INITIAL_CASH, positions: {}}, marketData, [], 0);
  benchmarks = [
    { id: S_P500_BENCHMARK_ID, name: 'S&P 500', color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID], performanceHistory: [initialBenchmarkMetrics] },
    { id: AI_MANAGERS_INDEX_ID, name: 'AI Managers Index', color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID], performanceHistory: [initialBenchmarkMetrics] }
  ];

  simulationState = {
    day: 0,
    intradayHour: 0,
    isLoading: false
  };

  isInitialized = true;
  return getSimulationState();
};

// Advance intraday
export const advanceIntraday = async () => {
  if (!isInitialized) {
    await initializeSimulation();
  }

  const { hour: nextHour, shouldAdvanceDay } = advanceIntradayHour();
  
  if (shouldAdvanceDay) {
    return await advanceDay();
  }

  simulationState.isLoading = true;
  simulationState.intradayHour = nextHour;
  
  const canTrade = isTradingAllowed();
  const newMarketData = await generateNextIntradayMarketData(marketData, simulationState.day, nextHour);
  marketData = newMarketData;

  // Update agents
  const updatedAgents = await Promise.all(
    agents.map(async (agent) => {
      try {
        const intradayTimestamp = simulationState.day + (nextHour / 10);
        let decidedTrades = [];
        let rationale = agent.rationale;

        if (canTrade) {
          if (Object.keys(newMarketData).length > 0) {
            try {
              const tradeDecision = await Promise.race([
                getTradeDecisions(agent, newMarketData, simulationState.day, 30000),
                new Promise((_, reject) =>
                  setTimeout(() => reject(new Error('Trade decision timeout')), 30000)
                )
              ]).catch(error => {
                console.warn(`[${agent.name}] Trade decision error:`, error);
                return { trades: [], rationale: `Trade decision unavailable - holding positions. ${error.message}` };
              });
              decidedTrades = tradeDecision.trades;
              rationale = tradeDecision.rationale;
            } catch (error) {
              rationale = `Trade decision unavailable - holding positions. ${error.message}`;
            }
          }
        }

        const newTradeHistory = [...agent.tradeHistory];
        const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };

        decidedTrades.forEach(trade => {
          const tradePrice = newMarketData[trade.ticker]?.price;
          if (!tradePrice) return;

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
                timestamp: intradayTimestamp,
              });
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
                timestamp: intradayTimestamp,
              });
            }
          }
        });

        const intradayTrades = newTradeHistory.filter(t => Math.abs(t.timestamp - intradayTimestamp) < 0.01);
        const newMetrics = calculateAllMetrics(newPortfolio, newMarketData, agent.performanceHistory, intradayTimestamp, intradayTrades);
        newMetrics.intradayHour = nextHour;

        const updatedMemory = {
          recentTrades: [...(agent.memory?.recentTrades || []), ...decidedTrades.map(t => ({ ...t, price: newMarketData[t.ticker]?.price || 0, timestamp: intradayTimestamp }))].slice(-10),
          pastRationales: [...(agent.memory?.pastRationales || []), rationale].slice(-5),
          pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10),
        };

        return {
          ...agent,
          portfolio: newPortfolio,
          tradeHistory: newTradeHistory,
          performanceHistory: [...agent.performanceHistory, newMetrics],
          rationale: canTrade ? rationale : agent.rationale,
          rationaleHistory: {
            ...agent.rationaleHistory,
            [simulationState.day]: canTrade ? rationale : (agent.rationaleHistory[simulationState.day] || agent.rationale)
          },
          memory: updatedMemory,
        };
      } catch (error) {
        console.error(`Failed to process agent ${agent.name}:`, error);
        const intradayTimestamp = simulationState.day + (nextHour / 10);
        const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, intradayTimestamp);
        newMetrics.intradayHour = nextHour;
        return {
          ...agent,
          performanceHistory: [...agent.performanceHistory, newMetrics],
          memory: {
            recentTrades: agent.memory?.recentTrades || [],
            pastRationales: [...(agent.memory?.pastRationales || []), `Error: ${error.message}`].slice(-5),
            pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10),
          }
        };
      }
    })
  );

  // Update benchmarks
  benchmarks = benchmarks.map(b => {
    const lastPerf = b.performanceHistory[b.performanceHistory.length - 1];
    let newTotalValue = lastPerf.totalValue;

    if (b.id === S_P500_BENCHMARK_ID) {
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
    const intradayTimestamp = simulationState.day + (nextHour / 10);
    const newMetrics = calculateAllMetrics({cash: newTotalValue, positions: {}}, newMarketData, newHistory, intradayTimestamp);
    newMetrics.intradayHour = nextHour;

    return { ...b, performanceHistory: [...b.performanceHistory, newMetrics] };
  });

  agents = updatedAgents;
  simulationState.isLoading = false;

  return getSimulationState();
};

// Advance day
export const advanceDay = async () => {
  if (!isInitialized) {
    await initializeSimulation();
  }

  const nextDay = simulationState.day + 1;

  if (isHistoricalSimulationComplete(nextDay)) {
    console.log(`Historical simulation complete (processed days 0-${simulationState.day})`);
    simulationState.isLoading = false;
    return getSimulationState();
  }

  simulationState.isLoading = true;
  simulationState.day = nextDay;
  simulationState.intradayHour = 0;

  const newMarketData = await generateNextDayMarketData(marketData);
  marketData = newMarketData;

  // Process agents
  const updatedAgents = await Promise.all(
    agents.map(async (agent) => {
      try {
        const { trades: decidedTrades, rationale } = await Promise.race([
          getTradeDecisions(agent, newMarketData, nextDay, 30000),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Trade decision timeout')), 30000)
          )
        ]).catch(error => {
          console.warn(`[${agent.name}] Trade decision error:`, error);
          return { trades: [], rationale: `Trade decision unavailable - holding positions. ${error.message}` };
        });

        const newTradeHistory = [...agent.tradeHistory];
        const newPortfolio = { ...agent.portfolio, positions: { ...agent.portfolio.positions } };

        decidedTrades.forEach(trade => {
          const tradePrice = newMarketData[trade.ticker]?.price;
          if (!tradePrice) return;

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
              });
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
              });
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
        const newMetrics = calculateAllMetrics(agent.portfolio, newMarketData, agent.performanceHistory, nextDay);
        return {
          ...agent,
          performanceHistory: [...agent.performanceHistory, newMetrics],
          rationale: `Error: Could not retrieve trade decision. Holding positions. ${error.message}`,
          rationaleHistory: {
            ...agent.rationaleHistory,
            [nextDay]: `Error: Could not retrieve trade decision. Holding positions. ${error.message}`
          },
          memory: {
            recentTrades: agent.memory?.recentTrades || [],
            pastRationales: [...(agent.memory?.pastRationales || []), `Error: ${error.message}`].slice(-5),
            pastPerformance: [...(agent.memory?.pastPerformance || []), newMetrics].slice(-10),
          }
        };
      }
    })
  );

  // Update benchmarks
  benchmarks = benchmarks.map(b => {
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

  agents = updatedAgents;
  simulationState.isLoading = false;

  return getSimulationState();
};

// Get current simulation state
export const getSimulationState = () => {
  return {
    simulationState,
    marketData,
    agents,
    benchmarks
  };
};
