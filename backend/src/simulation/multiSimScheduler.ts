import { simulationManager } from './SimulationManager.js';
import { step, tradeWindow, advanceDay } from './engine.js';
import { generateNextIntradayMarketData, generateNextDayMarketData, isHistoricalSimulationComplete, getSimulationMode, prefetchRealtimeMarketData, type RealtimePrefetchResult } from '../services/marketDataService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { isMarketOpen as checkMarketOpen, getNextMarketOpen, getETTime } from './marketHours.js';
import type { MarketData } from '../types.js';
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
const stepSimulation = async (simulationTypeId: string, newMarketData: MarketData): Promise<void> => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) return;

  const snapshot = instance.getSnapshot();

  try {
    const result = await step(
      {
        day: snapshot.day,
        intradayHour: snapshot.intradayHour,
        marketData: snapshot.marketData,
        agents: snapshot.agents,
        benchmarks: snapshot.benchmarks,
        chat: snapshot.chat,
        mode: snapshot.mode,
        currentTimestamp: snapshot.currentTimestamp,
      },
      newMarketData
    );

    instance.updateSnapshot({
      agents: result.agents,
      benchmarks: result.benchmarks,
      marketData: result.marketData,
      chat: result.chat,
    });
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
      `Failed to step simulation ${simulationTypeId}`, { error });
  }
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

  try {
    const result = await tradeWindow({
      day: snapshot.day,
      intradayHour: snapshot.intradayHour,
      marketData: snapshot.marketData,
      agents: snapshot.agents,
      benchmarks: snapshot.benchmarks,
      chat: snapshot.chat,
      mode: snapshot.mode,
      currentTimestamp: snapshot.currentTimestamp,
    });

    instance.updateSnapshot({
      agents: result.agents,
      benchmarks: result.benchmarks,
      chat: result.chat,
      marketData: result.marketData,
    });

    logger.logSimulationEvent(`Trade window completed for ${simType.name}`, {
      simulationType: simulationTypeId,
      day: snapshot.day,
      intradayHour: snapshot.intradayHour,
    });
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
      `Failed to execute trade window for simulation ${simulationTypeId}`, { error });
  }
};

/**
 * Advance to next day for a simulation instance
 */
const advanceDaySimulation = async (simulationTypeId: string, newMarketData: MarketData): Promise<void> => {
  const instance = simulationManager.getSimulation(simulationTypeId);
  if (!instance) return;

  const snapshot = instance.getSnapshot();
  const newDay = snapshot.day + 1;

  try {
    const result = await advanceDay(
      {
        day: snapshot.day,
        intradayHour: snapshot.intradayHour,
        marketData: snapshot.marketData,
        agents: snapshot.agents,
        benchmarks: snapshot.benchmarks,
        chat: snapshot.chat,
        mode: snapshot.mode,
      },
      newMarketData
    );

    instance.updateSnapshot({
      day: newDay,
      intradayHour: 0,
      agents: result.agents,
      benchmarks: result.benchmarks,
      marketData: result.marketData,
      chat: result.chat,
    });

    logger.logSimulationEvent(`Advanced to day ${newDay} for simulation ${simulationTypeId}`, {
      simulationType: simulationTypeId,
      newDay,
    });
  } catch (error) {
    logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
      `Failed to advance day for simulation ${simulationTypeId}`, { error });
  }
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

      // Update intraday hour for simulated/historical mode
      if (mode !== 'realtime') {
        const minutesPerTick = getSimulatedMinutesPerTick();
        const newIntradayHour = snapshot.intradayHour + (minutesPerTick / 60);

        // Check if we should advance to next day (after market close at 4pm ET = 16:00)
        const MARKET_CLOSE_HOUR = 16;
        const shouldAdvanceDay = newIntradayHour >= MARKET_CLOSE_HOUR;

        if (shouldAdvanceDay) {
          // Advance to next day
          const nextDayData = await generateNextDayMarketData(currentMarketData);
          simulationManager.updateSharedMarketData(nextDayData);

          const advancePromises = Array.from(simulations.keys()).map(typeId =>
            advanceDaySimulation(typeId, nextDayData)
          );
          await Promise.all(advancePromises);
        } else {
          // Regular price tick
          const newMarketData = await generateNextIntradayMarketData(currentMarketData, snapshot.day, snapshot.intradayHour);
          simulationManager.updateSharedMarketData(newMarketData);

          // Update all simulations with new intraday hour
          for (const [_, instance] of simulations) {
            instance.updateSnapshot({ intradayHour: newIntradayHour });
          }

          // Step all simulations
          const stepPromises = Array.from(simulations.keys()).map(typeId =>
            stepSimulation(typeId, newMarketData)
          );
          await Promise.all(stepPromises);
        }
      } else {
        // Real-time mode
        let newMarketData: MarketData;
        if (prefetchedRealtimeData?.marketData) {
          newMarketData = prefetchedRealtimeData.marketData;
        } else {
          newMarketData = await generateNextIntradayMarketData(currentMarketData, snapshot.day, snapshot.intradayHour);
        }

        // Update shared market data
        simulationManager.updateSharedMarketData(newMarketData);

        // Step all simulations
        const stepPromises = Array.from(simulations.keys()).map(typeId =>
          stepSimulation(typeId, newMarketData)
        );
        await Promise.all(stepPromises);
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
        const now = getETTime();
        const isOpen = checkMarketOpen(now);
        if (!isOpen) {
          const nextOpen = getNextMarketOpen();
          const msUntilOpen = nextOpen.getTime() - now.getTime();
          logger.logSimulationEvent('Market closed, waiting for next open', {
            nextOpen: nextOpen.toISOString(),
            waitTimeMinutes: Math.round(msUntilOpen / 60000),
          });
          await sleep(Math.min(msUntilOpen, 60000));
          continue;
        }

        const currentMarketData = simulationManager.getSharedMarketData();
        if (currentMarketData) {
          const tickers = Object.keys(currentMarketData);
          const guardMs = Math.max(0, parseInt(process.env.PREFETCH_GUARD_MS || '1000', 10));
          const batchSize = Math.max(1, parseInt(process.env.PREFETCH_BATCH_SIZE || '25', 10));

          const prefetchResult = await prefetchRealtimeMarketData(tickers, {
            intervalMs: simInterval,
            guardMs,
            batchSize,
          });
          await priceTickHandler(prefetchResult);
        } else {
          await priceTickHandler();
        }

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
