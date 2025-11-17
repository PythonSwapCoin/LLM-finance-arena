import { simulationManager } from './SimulationManager.js';
import { step, tradeWindow, advanceDay } from './engine.js';
import { generateNextIntradayMarketData, generateNextDayMarketData, isHistoricalSimulationComplete, getSimulationMode, prefetchRealtimeMarketData, type RealtimePrefetchResult, hasHybridModeTransitioned, shouldHybridModeTransition, setHybridModeTransitioned } from '../services/marketDataService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { isMarketOpen as checkMarketOpen, getNextMarketOpen, getETTime } from './marketHours.js';
import type { MarketData } from '../types.js';
import { updateChatMessagesStatusForSimulation } from '../services/multiSimChatService.js';
import { updateTimerState } from '../services/timerService.js';
import { saveSnapshot } from '../store/persistence.js';
import { priceLogService } from '../services/priceLogService.js';

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

// Track price ticks (yfinance rounds) to delay first trade
let priceTickCount = 0;
const REQUIRED_PRICE_TICKS_BEFORE_FIRST_TRADE = 3;

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

    // Save snapshot after step
    try {
      const snapshot = instance.getSnapshot();
      await saveSnapshot(snapshot, simulationTypeId);
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        `Failed to save snapshot after step for ${simulationTypeId}`, {
          error: error instanceof Error ? error.message : String(error)
        });
    }
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

  let snapshot = instance.getSnapshot();
  const simType = instance.getSimulationType();

  // Update chat message status to "delivered" for this round (only for chat-enabled simulations)
  if (simType.chatEnabled) {
    updateChatMessagesStatusForSimulation(simulationTypeId, snapshot.day, snapshot.intradayHour);
    // Get fresh snapshot after updating message status so agents see "delivered" messages
    snapshot = instance.getSnapshot();
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

    // Save snapshot after trade window
    try {
      const updatedSnapshot = instance.getSnapshot();
      await saveSnapshot(updatedSnapshot, simulationTypeId);
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        `Failed to save snapshot after trade window for ${simulationTypeId}`, {
          error: error instanceof Error ? error.message : String(error)
        });
    }
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

    // Calculate new currentDate for the advanced day
    let newCurrentDate: string;
    if ((snapshot.mode === 'historical' || (snapshot.mode === 'hybrid' && !hasHybridModeTransitioned())) && snapshot.startDate) {
      const start = new Date(snapshot.startDate);
      start.setDate(start.getDate() + newDay);
      newCurrentDate = start.toISOString();
    } else if (snapshot.mode === 'realtime' || (snapshot.mode === 'hybrid' && hasHybridModeTransitioned())) {
      // For real-time mode, update currentDate to account for data delay
      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);

      if (USE_DELAYED_DATA) {
        const now = new Date();
        const dataTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
        newCurrentDate = dataTime.toISOString();
      } else {
        newCurrentDate = new Date().toISOString();
      }
    } else {
      // Simulated mode
      const start = snapshot.startDate ? new Date(snapshot.startDate) : new Date();
      start.setDate(start.getDate() + newDay);
      newCurrentDate = start.toISOString();
    }

    instance.updateSnapshot({
      day: newDay,
      intradayHour: 0,
      currentDate: newCurrentDate,
      agents: result.agents,
      benchmarks: result.benchmarks,
      marketData: result.marketData,
      chat: result.chat,
    });

    logger.logSimulationEvent(`Advanced to day ${newDay} for simulation ${simulationTypeId}`, {
      simulationType: simulationTypeId,
      newDay,
      currentDate: newCurrentDate,
    });

    // Log prices and portfolio values at start of new day to ensure previousValue is correct
    try {
      const updatedSnapshot = instance.getSnapshot();
      if (updatedSnapshot.marketData && Object.keys(updatedSnapshot.marketData).length > 0 && updatedSnapshot.agents.length > 0) {
        const timestamp = newDay + (0 / 6.5); // Day + intradayHour fraction
        priceLogService.logPricesAndPortfolios(
          updatedSnapshot.marketData,
          updatedSnapshot.agents,
          newDay,
          0, // intradayHour
          timestamp
        );
      }
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        'Failed to log prices after day advancement', {
          simulationType: simulationTypeId,
          error: error instanceof Error ? error.message : String(error)
        });
    }

    // Save snapshot after day advancement
    try {
      const updatedSnapshot = instance.getSnapshot();
      await saveSnapshot(updatedSnapshot, simulationTypeId);
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        `Failed to save snapshot after day advancement for ${simulationTypeId}`, {
          error: error instanceof Error ? error.message : String(error)
        });
    }
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

      // Increment price tick count (yfinance rounds)
      priceTickCount++;

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

      // Check if hybrid mode should transition to realtime
      // This check must happen BEFORE advancing time to prevent overshooting
      if (mode === 'hybrid' && !hasHybridModeTransitioned()) {
        const currentDate = snapshot.currentDate || snapshot.startDate || new Date().toISOString();
        const minutesPerTick = getSimulatedMinutesPerTick();
        
        // Check if we should transition (including checking if next tick would overshoot)
        if (shouldHybridModeTransition(currentDate, snapshot.day, snapshot.intradayHour, minutesPerTick)) {
          logger.logSimulationEvent('Hybrid mode transitioning from accelerated to realtime (multi-sim)', {
            currentDay: snapshot.day,
            intradayHour: snapshot.intradayHour,
            currentDate: currentDate,
            realtime: new Date().toISOString(),
            minutesPerTick: minutesPerTick
          });
          setHybridModeTransitioned(true);

          // Update timer to reflect new realtime intervals
          updateTimerState();

          // Note: Multi-sim scheduler will automatically use realtime intervals after transition
          // because the mode check below will treat hybrid (transitioned) as realtime
        }
      }

      // Update intraday hour for simulated/historical mode
      // Hybrid mode before transition: uses accelerated logic
      // Hybrid mode after transition: behaves like realtime (skips this block)
      const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());
      if (!isRealtimeMode) {
        const minutesPerTick = getSimulatedMinutesPerTick();
        const newIntradayHour = snapshot.intradayHour + (minutesPerTick / 60);

        // Check if we should advance to next day
        // Market close is 6.5 hours after market open (9:30 AM + 6.5 hours = 4:00 PM ET)
        const MARKET_CLOSE_HOUR = 6.5;
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
      // Check market status for realtime mode and hybrid mode (after transition)
      const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());
      if (isRealtimeMode) {
        const now = getETTime();
        const isOpen = checkMarketOpen(now);
        if (!isOpen) {
          logger.logSimulationEvent('Skipping trade window - market is closed', {
            etTime: now.toISOString(),
            mode,
            hybridTransitioned: mode === 'hybrid' ? hasHybridModeTransitioned() : undefined,
          });
          return;
        }
      }

      // Check if we've had enough price ticks (yfinance rounds) before first trade
      if (!firstTradeExecuted) {
        if (priceTickCount < REQUIRED_PRICE_TICKS_BEFORE_FIRST_TRADE) {
          logger.logSimulationEvent('Skipping trade window - waiting for more price ticks', {
            priceTickCount,
            required: REQUIRED_PRICE_TICKS_BEFORE_FIRST_TRADE,
          });
          return;
        }
        
        const firstSim = simulations.values().next().value;
        if (firstSim) {
          const snapshot = firstSim.getSnapshot();
          if (snapshot.intradayHour >= firstTradeHour) {
            firstTradeExecuted = true;
            logger.logSimulationEvent('First trade window executed', {
              priceTickCount,
              intradayHour: snapshot.intradayHour,
            });
          } else {
            logger.logSimulationEvent('Skipping trade window - first trade hour not reached', {
              currentHour: snapshot.intradayHour,
              firstTradeHour,
              priceTickCount,
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

      // Update timer state after trade window execution
      updateTimerState();
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

  // Initialize timer state
  const { initializeTimer } = await import('../services/timerService.js');
  initializeTimer();
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

  // Export price logs when stopping
  try {
    const { priceLogService } = await import('../services/priceLogService.js');
    await priceLogService.exportLogs().catch(err => {
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        'Failed to export price logs when stopping multi-sim scheduler', { error: err });
    });
  } catch (err) {
    // Silently fail if price log service not available
  }

  logger.logSimulationEvent('Multi-simulation scheduler stopped', {});
};

/**
 * Check if scheduler is running
 */
export const isSchedulerRunning = (): boolean => {
  return isRunning;
};
