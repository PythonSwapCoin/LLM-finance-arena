import { simulationManager } from './SimulationManager.js';
import { generateNextIntradayMarketData, generateNextDayMarketData, isTradingAllowed, isHistoricalSimulationComplete, getSimulationMode, prefetchRealtimeMarketData, type RealtimePrefetchResult } from '../services/marketDataService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { isMarketOpen, getNextMarketOpen, getETTime } from './marketHours.js';
import type { MarketData, Agent } from '../types.js';
import { calculateAllMetrics } from '../utils/portfolioCalculations.js';
import { getTradeDecisions } from '../services/llmService.js';
import { executeTrades } from './engine.js';
import { updateChatMessagesStatusForSimulation } from '../services/multiSimChatService.js';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Intervals - different for real-time vs simulated/historical
export const getSimInterval = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    return parseInt(process.env.REALTIME_SIM_INTERVAL_MS || '600000', 10); // 10 minutes default for real-time
  }
  return parseInt(process.env.SIM_INTERVAL_MS || '30000', 10); // 30 seconds default for simulated/historical
};

export const getTradeInterval = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    return parseInt(process.env.REALTIME_TRADE_INTERVAL_MS || '1800000', 10); // 30 minutes default for real-time
  }
  return parseInt(process.env.TRADE_INTERVAL_MS || '7200000', 10); // 2 hours default for simulated/historical
};

const getSimulatedMinutesPerTick = (): number => {
  const raw = parseInt(process.env.SIM_MARKET_MINUTES_PER_TICK || '30', 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 30;
};

const getFirstTradeHour = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    const intervalMs = parseInt(process.env.REALTIME_TRADE_INTERVAL_MS || '1800000', 10);
    return intervalMs / (60 * 60 * 1000);
  }
  const intervalMs = parseInt(process.env.TRADE_INTERVAL_MS || '7200000', 10);
  return intervalMs / (60 * 60 * 1000);
};

let priceTickInterval: NodeJS.Timeout | null = null;
let tradeWindowInterval: NodeJS.Timeout | null = null;
let realtimePriceLoopPromise: Promise<void> | null = null;
let realtimeLoopAbortController: { stop: boolean } | null = null;
let isRunning = false;
let firstTradeExecuted = false;

/**
 * Update portfolio valuations for a simulation instance
 */
const stepSimulation = async (simulationTypeId: string, marketData: MarketData): Promise<void> => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) return;

  const snapshot = instance.getSnapshot();
  const updatedAgents = snapshot.agents.map(agent => {
    const updatedMetrics = calculateAllMetrics(agent.portfolio, marketData, agent.tradeHistory, snapshot.day);
    const updatedHistory = [...agent.performanceHistory, updatedMetrics];
    return {
      ...agent,
      performanceHistory: updatedHistory,
      memory: {
        ...agent.memory,
        pastPerformance: updatedHistory,
      },
    };
  });

  const updatedBenchmarks = snapshot.benchmarks.map(benchmark => {
    let benchmarkMetrics;
    if (benchmark.id === 'sp500') {
      const spyPrice = marketData['SPY']?.price;
      const previousMetrics = benchmark.performanceHistory[benchmark.performanceHistory.length - 1];
      if (spyPrice !== undefined && previousMetrics) {
        const totalReturn = ((spyPrice - (previousMetrics.price || spyPrice)) / (previousMetrics.price || spyPrice)) * 100;
        benchmarkMetrics = {
          totalValue: spyPrice * 1000,
          totalReturn,
          cash: 0,
          stockValue: spyPrice * 1000,
          sharpeRatio: previousMetrics.sharpeRatio,
          maxDrawdown: previousMetrics.maxDrawdown,
          winRate: previousMetrics.winRate,
          price: spyPrice,
        };
      } else {
        benchmarkMetrics = benchmark.performanceHistory[benchmark.performanceHistory.length - 1];
      }
    } else {
      const avgPortfolioValue = updatedAgents.reduce((sum, a) => sum + a.portfolio.totalValue, 0) / updatedAgents.length;
      benchmarkMetrics = {
        totalValue: avgPortfolioValue,
        totalReturn: ((avgPortfolioValue - 100000) / 100000) * 100,
        cash: 0,
        stockValue: avgPortfolioValue,
        sharpeRatio: 0,
        maxDrawdown: 0,
        winRate: 0,
      };
    }
    return {
      ...benchmark,
      performanceHistory: [...benchmark.performanceHistory, benchmarkMetrics],
    };
  });

  instance.updateSnapshot({
    agents: updatedAgents,
    benchmarks: updatedBenchmarks,
    marketData,
  });
};

/**
 * Execute trading window for a simulation instance
 */
const tradeWindowSimulation = async (simulationTypeId: string): Promise<void> => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) return;

  const snapshot = instance.getSnapshot();
  const simType = instance.getSimulationType();

  // Update chat message status to "delivered" for this round (only for chat-enabled simulations)
  if (simType.chatEnabled) {
    updateChatMessagesStatusForSimulation(simulationTypeId, snapshot.day, snapshot.intradayHour);
  }

  logger.logSimulationEvent(`Trade window starting for ${simType.name}`, {
    simulationType: simulationTypeId,
    day: snapshot.day,
    intradayHour: snapshot.intradayHour,
  });

  const updatedAgents: Agent[] = [];

  for (const agent of snapshot.agents) {
    try {
      const decision = await getTradeDecisions(agent, snapshot.marketData, snapshot.day, snapshot.chat);

      if (decision.rationale) {
        agent.rationale = decision.rationale;
        agent.rationaleHistory[snapshot.day] = decision.rationale;
      }

      const updatedAgent = executeTrades(agent, decision.trades, snapshot.marketData, snapshot.day);
      updatedAgents.push(updatedAgent);
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
        `Failed to get trade decisions for agent ${agent.id} in simulation ${simulationTypeId}`, { error });
      updatedAgents.push(agent);
    }
  }

  instance.updateSnapshot({ agents: updatedAgents });

  logger.logSimulationEvent(`Trade window completed for ${simType.name}`, {
    simulationType: simulationTypeId,
    day: snapshot.day,
    intradayHour: snapshot.intradayHour,
  });
};

/**
 * Advance to next day for a simulation instance
 */
const advanceDaySimulation = async (simulationTypeId: string, marketData: MarketData): Promise<void> => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) return;

  const snapshot = instance.getSnapshot();
  const newDay = snapshot.day + 1;

  instance.updateSnapshot({
    day: newDay,
    intradayHour: 0,
    marketData,
  });

  logger.logSimulationEvent(`Advanced to day ${newDay} for simulation ${simulationTypeId}`, {
    simulationType: simulationTypeId,
    newDay,
  });
};

/**
 * Start the multi-simulation scheduler
 */
export const startMultiSimScheduler = async (): Promise<void> => {
  if (isRunning) {
    logger.logSimulationEvent('Multi-simulation scheduler already running', {});
    return;
  }

  isRunning = true;
  const simInterval = getSimInterval();
  const tradeInterval = getTradeInterval();
  const mode = getSimulationMode();
  const firstTradeHour = getFirstTradeHour();

  // Check if any simulation has reached the first trade hour
  const simulations = simulationManager.getAllSimulations();
  if (simulations.size > 0) {
    const firstSim = simulations.values().next().value;
    const snapshot = firstSim.getSnapshot();
    firstTradeExecuted = snapshot.intradayHour >= firstTradeHour;
  }

  logger.logSimulationEvent('Starting multi-simulation scheduler', {
    mode,
    simInterval,
    tradeInterval,
    simulationCount: simulations.size,
  });

  // Price tick handler
  const priceTickHandler = async (prefetchedRealtimeData?: RealtimePrefetchResult | null) => {
    try {
      // Get current market data (shared across all simulations)
      const currentMarketData = simulationManager.getSharedMarketData();
      if (!currentMarketData) {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 'No market data available for price tick', {});
        return;
      }

      // Check if we need to advance to next day
      const firstSim = simulations.values().next().value;
      if (!firstSim) return;

      const snapshot = firstSim.getSnapshot();

      // Check if historical simulation is complete
      if (isHistoricalSimulationComplete(snapshot.day)) {
        logger.logSimulationEvent('Historical simulation complete, stopping scheduler', {
          totalDays: snapshot.day + 1,
          finalDay: snapshot.day,
        });
        await stopMultiSimScheduler();
        return;
      }

      // Generate new market data
      let newMarketData: MarketData;
      let shouldAdvanceDay = false;

      if (mode === 'realtime') {
        if (prefetchedRealtimeData?.marketData) {
          newMarketData = prefetchedRealtimeData.marketData;
        } else {
          const result = await generateNextIntradayMarketData(currentMarketData, snapshot.intradayHour, snapshot.day);
          newMarketData = result.marketData;
        }
      } else {
        const result = await generateNextIntradayMarketData(currentMarketData, snapshot.intradayHour, snapshot.day);
        newMarketData = result.marketData;
        shouldAdvanceDay = result.shouldAdvanceDay;

        // Update intraday hour for simulated mode
        const minutesPerTick = getSimulatedMinutesPerTick();
        const newIntradayHour = snapshot.intradayHour + (minutesPerTick / 60);

        // Update all simulations with new intraday hour
        for (const [_, instance] of simulations) {
          const instanceSnapshot = instance.getSnapshot();
          instance.updateSnapshot({ intradayHour: newIntradayHour });
        }
      }

      // Update shared market data
      simulationManager.updateSharedMarketData(newMarketData);

      // Step all simulations
      const stepPromises = Array.from(simulations.keys()).map(typeId =>
        stepSimulation(typeId, newMarketData)
      );
      await Promise.all(stepPromises);

      // Advance day if needed
      if (shouldAdvanceDay) {
        const nextDayData = await generateNextDayMarketData(newMarketData, snapshot.day);
        simulationManager.updateSharedMarketData(nextDayData);

        const advancePromises = Array.from(simulations.keys()).map(typeId =>
          advanceDaySimulation(typeId, nextDayData)
        );
        await Promise.all(advancePromises);
      }
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 'Price tick handler error', { error });
    }
  };

  // Trade window handler
  const tradeWindowHandler = async () => {
    try {
      if (!firstTradeExecuted) {
        const firstSim = simulations.values().next().value;
        if (firstSim) {
          const snapshot = firstSim.getSnapshot();
          if (snapshot.intradayHour >= firstTradeHour) {
            firstTradeExecuted = true;
          } else {
            logger.logSimulationEvent('Skipping trade window - first trade hour not reached', {
              currentHour: snapshot.intradayHour,
              firstTradeHour,
            });
            return;
          }
        }
      }

      // Execute trade window for all simulations
      const tradePromises = Array.from(simulations.keys()).map(typeId =>
        tradeWindowSimulation(typeId)
      );
      await Promise.all(tradePromises);
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 'Trade window handler error', { error });
    }
  };

  // Start intervals
  if (mode === 'realtime') {
    // Real-time mode with prefetching
    realtimeLoopAbortController = { stop: false };
    const abortController = realtimeLoopAbortController;

    realtimePriceLoopPromise = (async () => {
      while (!abortController.stop) {
        const marketOpenInfo = isMarketOpen();
        if (!marketOpenInfo.isOpen) {
          const nextOpen = getNextMarketOpen();
          const now = getETTime();
          const msUntilOpen = nextOpen.getTime() - now.getTime();
          logger.logSimulationEvent('Market closed, waiting for next open', {
            nextOpen: nextOpen.toISOString(),
            waitTimeMinutes: Math.round(msUntilOpen / 60000),
          });
          await sleep(Math.min(msUntilOpen, 60000));
          continue;
        }

        const prefetchResult = await prefetchRealtimeMarketData();
        await priceTickHandler(prefetchResult);
        await sleep(simInterval);
      }
    })();
  } else {
    // Simulated/historical mode with simple intervals
    priceTickInterval = setInterval(() => priceTickHandler(), simInterval);
  }

  tradeWindowInterval = setInterval(tradeWindowHandler, tradeInterval);

  logger.logSimulationEvent('Multi-simulation scheduler started', {
    mode,
    simulationCount: simulations.size,
  });
};

/**
 * Stop the multi-simulation scheduler
 */
export const stopMultiSimScheduler = async (): Promise<void> => {
  if (!isRunning) {
    logger.logSimulationEvent('Multi-simulation scheduler not running', {});
    return;
  }

  isRunning = false;

  if (priceTickInterval) {
    clearInterval(priceTickInterval);
    priceTickInterval = null;
  }

  if (tradeWindowInterval) {
    clearInterval(tradeWindowInterval);
    tradeWindowInterval = null;
  }

  if (realtimeLoopAbortController) {
    realtimeLoopAbortController.stop = true;
    realtimeLoopAbortController = null;
  }

  if (realtimePriceLoopPromise) {
    await realtimePriceLoopPromise;
    realtimePriceLoopPromise = null;
  }

  logger.logSimulationEvent('Multi-simulation scheduler stopped', {});
};

/**
 * Check if scheduler is running
 */
export const isSchedulerRunning = (): boolean => {
  return isRunning;
};
