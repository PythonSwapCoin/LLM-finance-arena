import { simulationManager } from './SimulationManager.js';
import { step, tradeWindow, advanceDay } from './engine.js';
import { generateNextIntradayMarketData, generateNextDayMarketData, isHistoricalSimulationComplete, getSimulationMode, prefetchRealtimeMarketData, type RealtimePrefetchResult, hasHybridModeTransitioned, shouldHybridModeTransition, setHybridModeTransitioned } from '../services/marketDataService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { isMarketOpen as checkMarketOpen, getNextMarketOpen, getETTime, isMarketOpen } from './marketHours.js';
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

  // Removed verbose "Trade window starting" log - only errors will be logged

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

    // Removed verbose "Trade window completed" log - only errors will be logged

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
      `Failed to execute trade window for simulation ${simulationTypeId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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
      // For historical/hybrid mode, skip weekends - only advance to trading days
      const start = new Date(snapshot.startDate);
      let tradingDaysAdvanced = 0;
      let currentDate = new Date(start);
      
      // Advance to the next trading day (skip weekends)
      while (tradingDaysAdvanced < newDay) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 1);
        const dayOfWeek = currentDate.getUTCDay();
        // Skip weekends (0 = Sunday, 6 = Saturday)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
          tradingDaysAdvanced++;
        }
      }
      newCurrentDate = currentDate.toISOString();
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

    // Check if this is a weekend/holiday in simulated mode
    const isSimulatedMode = snapshot.mode === 'simulated';
    let marketStatus = '';
    if (isSimulatedMode) {
      const dateObj = new Date(newCurrentDate);
      const marketOpen = isMarketOpen(dateObj);
      if (!marketOpen) {
        const dayOfWeek = dateObj.getUTCDay();
        const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        marketStatus = ` (MARKET CLOSED - ${dayNames[dayOfWeek]})`;
      }
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

    // Get S&P 500 price for logging
    const sp500Data = result.marketData['^GSPC'];
    const sp500Price = sp500Data?.price || 0;
    const sp500Change = sp500Data?.dailyChange || 0;
    const sp500ChangePercent = sp500Data?.dailyChangePercent || 0;
    const sp500Info = sp500Price > 0 
      ? ` | S&P 500: $${sp500Price.toFixed(2)} (${sp500Change >= 0 ? '+' : ''}${sp500Change.toFixed(2)}, ${sp500ChangePercent >= 0 ? '+' : ''}${(sp500ChangePercent * 100).toFixed(2)}%)`
      : '';

    logger.log(LogLevel.INFO, LogCategory.SIMULATION,
      `📅 Day ${newDay} started${marketStatus}${sp500Info}`, {
        simulationType: simulationTypeId,
        day: newDay,
        currentDate: newCurrentDate,
        marketOpen: isSimulatedMode ? isMarketOpen(new Date(newCurrentDate)) : undefined,
        sp500: sp500Price > 0 ? {
          price: sp500Price.toFixed(2),
          dailyChange: sp500Change.toFixed(2),
          dailyChangePercent: (sp500ChangePercent * 100).toFixed(2) + '%'
        } : undefined
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
      `Failed to advance day for simulation ${simulationTypeId}`, {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      });
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

          // Restart scheduler to switch from interval-based to realtime loop
          logger.logSimulationEvent('Restarting scheduler with realtime loop after hybrid transition', {
            oldSimInterval: getSimInterval(),
            newTradeInterval: getTradeInterval()
          });

          // Stop current scheduler
          await stopMultiSimScheduler();

          // Restart with new realtime loop after a brief delay
          setTimeout(() => {
            startMultiSimScheduler().catch(err => {
              logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
                'Failed to restart scheduler after hybrid transition', { error: err });
            });
          }, 1000);

          return; // Exit current tick to allow scheduler restart
        }
      }

      // Update intraday hour for simulated/historical mode
      // Hybrid mode before transition: uses accelerated logic
      // Hybrid mode after transition: behaves like realtime (skips this block)
      const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());
      if (!isRealtimeMode) {
        // Check if market is closed (weekend/holiday) in simulated mode
        const currentDate = snapshot.currentDate || snapshot.startDate || new Date().toISOString();
        const dateObj = new Date(currentDate);
        const marketOpen = isMarketOpen(dateObj);
        
        if (!marketOpen && mode === 'simulated') {
          // Skip price ticks when market is closed (weekends/holidays)
          const dayOfWeek = dateObj.getUTCDay();
          const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const lastSkipLog = (global as any).lastMarketClosedSkipLog;
          const skipKey = `${snapshot.day}-${dayOfWeek}`;
          
          // Only log once per day to reduce noise
          if (lastSkipLog !== skipKey) {
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              `⏸️ Skipping price tick - Market closed (${dayNames[dayOfWeek]}, Day ${snapshot.day})`, {
                day: snapshot.day,
                dayOfWeek: dayNames[dayOfWeek],
                currentDate: currentDate,
                marketOpen: false
              });
            (global as any).lastMarketClosedSkipLog = skipKey;
          }
          return; // Skip processing when market is closed
        }
        
        const minutesPerTick = getSimulatedMinutesPerTick();
        const newIntradayHour = snapshot.intradayHour + (minutesPerTick / 60);

        // Check if we should advance to next day
        // Market close is 6.5 hours after market open (9:30 AM + 6.5 hours = 4:00 PM ET)
        const MARKET_CLOSE_HOUR = 6.5;
        const shouldAdvanceDay = newIntradayHour >= MARKET_CLOSE_HOUR;

        if (shouldAdvanceDay) {
          // Check if next day would be a weekend in historical/hybrid mode
          const isHistoricalMode = mode === 'historical' || (mode === 'hybrid' && !hasHybridModeTransitioned());
          if (isHistoricalMode && snapshot.startDate) {
            const nextDay = snapshot.day + 1;
            const start = new Date(snapshot.startDate);
            let tradingDaysAdvanced = 0;
            let checkDate = new Date(start);
            
            // Calculate what date the next day would be
            while (tradingDaysAdvanced < nextDay) {
              checkDate.setUTCDate(checkDate.getUTCDate() + 1);
              const dayOfWeek = checkDate.getUTCDay();
              if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                tradingDaysAdvanced++;
              }
            }
            
            // Check if this date is a weekend
            const dayOfWeek = checkDate.getUTCDay();
            if (dayOfWeek === 0 || dayOfWeek === 6) {
              // Skip weekend - don't advance day, just keep current prices
              const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
              logger.log(LogLevel.INFO, LogCategory.SIMULATION,
                `⏸️ Skipping day advancement - Weekend (${dayNames[dayOfWeek]}, would be Day ${nextDay})`, {
                  day: snapshot.day,
                  nextDay,
                  date: checkDate.toISOString(),
                  dayOfWeek: dayNames[dayOfWeek]
                });
              return; // Skip processing - wait for next trading day
            }
          }
          
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
        // Real-time mode (including hybrid after transition)
        // Check if market is closed - skip price ticks if closed
        const now = new Date();
        const isOpen = checkMarketOpen(now);
        if (!isOpen) {
          // Log market closed status (only once per status change)
          const lastMarketStatus = (global as any).lastPriceTickMarketStatus;
          if (lastMarketStatus !== 'closed') {
            const etTime = getETTime(now);
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              '[MARKET STATUS] MARKET CLOSED - Skipping price tick', {
                etTime: etTime.toISOString(),
                mode,
              });
            (global as any).lastPriceTickMarketStatus = 'closed';
          }
          return; // Skip price tick when market is closed
        } else {
          // Market is open - log status change
          const lastMarketStatus = (global as any).lastPriceTickMarketStatus;
          if (lastMarketStatus !== 'open') {
            const etTime = getETTime(now);
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              '[MARKET STATUS] MARKET OPEN - Processing price tick', {
                etTime: etTime.toISOString(),
                mode,
              });
            (global as any).lastPriceTickMarketStatus = 'open';
          }
        }

        // Calculate intradayHour from current ET time
        // Market opens at 9:30 AM ET, so intradayHour = (current ET time - 9:30 AM) in hours
        const etTime = getETTime(now);
        const etHours = etTime.getUTCHours();
        const etMinutes = etTime.getUTCMinutes();
        const marketOpenHour = 9;
        const marketOpenMinute = 30;
        
        // Calculate hours since market open
        const totalMinutesSinceOpen = (etHours - marketOpenHour) * 60 + (etMinutes - marketOpenMinute);
        const calculatedIntradayHour = Math.max(0, totalMinutesSinceOpen / 60);
        
        // Cap at 6.5 hours (market closes at 4:00 PM ET = 9:30 AM + 6.5 hours)
        const newIntradayHour = Math.min(calculatedIntradayHour, 6.5);

        // Update currentDate and currentTimestamp for realtime mode
        const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
        const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
        
        let newCurrentDate: string;
        let newCurrentTimestamp: number | undefined;
        
        if (USE_DELAYED_DATA) {
          const dataTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
          newCurrentDate = dataTime.toISOString();
          newCurrentTimestamp = dataTime.getTime();
        } else {
          newCurrentDate = now.toISOString();
          newCurrentTimestamp = now.getTime();
        }

        // Update intradayHour, currentDate, and currentTimestamp for all simulations
        for (const [_, instance] of simulations) {
          instance.updateSnapshot({ 
            intradayHour: newIntradayHour,
            currentDate: newCurrentDate,
            currentTimestamp: newCurrentTimestamp
          });
        }

        let newMarketData: MarketData;
        if (prefetchedRealtimeData?.marketData) {
          newMarketData = prefetchedRealtimeData.marketData;
        } else {
          newMarketData = await generateNextIntradayMarketData(currentMarketData, snapshot.day, newIntradayHour);
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
        const now = new Date();
        const isOpen = checkMarketOpen(now);
        if (!isOpen) {
          // Log market closed status (only once per status change)
          const lastMarketStatus = (global as any).lastMarketStatus;
          if (lastMarketStatus !== 'closed') {
            const etTime = getETTime(now);
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              '[MARKET STATUS] MARKET CLOSED - Skipping trade window', {
                etTime: etTime.toISOString(),
                mode,
              });
            (global as any).lastMarketStatus = 'closed';
          }
          return;
        } else {
          // Market is open - log status change
          const lastMarketStatus = (global as any).lastMarketStatus;
          if (lastMarketStatus !== 'open') {
            const etTime = getETTime(now);
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              '[MARKET STATUS] MARKET OPEN', {
                etTime: etTime.toISOString(),
                mode,
              });
            (global as any).lastMarketStatus = 'open';
          }
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
  // Use realtime loop for realtime mode OR hybrid mode after transition
  const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());
  if (isRealtimeMode) {
    // Real-time mode with prefetching
    realtimeLoopAbortController = { stop: false };
    const abortController = realtimeLoopAbortController;

    realtimePriceLoopPromise = (async () => {
      while (!abortController.stop) {
        const now = new Date();
        const isOpen = checkMarketOpen(now);
        if (!isOpen) {
          const nextOpen = getNextMarketOpen(now);
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
