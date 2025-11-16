import { simulationState } from './state.js';
import { step, tradeWindow, advanceDay } from './engine.js';
import { generateNextIntradayMarketData, generateNextDayMarketData, isTradingAllowed, isHistoricalSimulationComplete, getSimulationMode, prefetchRealtimeMarketData, type RealtimePrefetchResult, hasHybridModeTransitioned, setHybridModeTransitioned, shouldHybridModeTransition } from '../services/marketDataService.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import { saveSnapshot } from '../store/persistence.js';
import { exportSimulationData } from '../services/exportService.js';
import { exportLogs } from '../services/logExportService.js';
import { priceLogService } from '../services/priceLogService.js';
import { isMarketOpen, getNextMarketOpen, getETTime } from './marketHours.js';

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

// Intervals - different for real-time vs simulated/historical
export const getSimInterval = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    return parseInt(process.env.REALTIME_SIM_INTERVAL_MS || '600000', 10); // 10 minutes default for real-time
  }
  if (mode === 'hybrid') {
    // In hybrid mode, use realtime interval if transitioned, otherwise use simulated interval
    if (hasHybridModeTransitioned()) {
      return parseInt(process.env.REALTIME_SIM_INTERVAL_MS || '600000', 10); // 10 minutes for real-time phase
    }
    return parseInt(process.env.SIM_INTERVAL_MS || '30000', 10); // 30 seconds for accelerated phase
  }
  return parseInt(process.env.SIM_INTERVAL_MS || '30000', 10); // 30 seconds default for simulated/historical
};

export const getTradeInterval = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    return parseInt(process.env.REALTIME_TRADE_INTERVAL_MS || '1800000', 10); // 30 minutes default for real-time
  }
  if (mode === 'hybrid') {
    // In hybrid mode, use realtime interval if transitioned, otherwise use simulated interval
    if (hasHybridModeTransitioned()) {
      return parseInt(process.env.REALTIME_TRADE_INTERVAL_MS || '1800000', 10); // 30 minutes for real-time phase
    }
    return parseInt(process.env.TRADE_INTERVAL_MS || '7200000', 10); // 2 hours for accelerated phase
  }
  return parseInt(process.env.TRADE_INTERVAL_MS || '7200000', 10); // 2 hours default for simulated/historical
};

// Determine how much simulated market time should elapse per scheduler tick.
// Default is 30 minutes so long simulations can cover multiple days quickly.
const getSimulatedMinutesPerTick = (): number => {
  const raw = parseInt(process.env.SIM_MARKET_MINUTES_PER_TICK || '30', 10);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }
  return 30;
};

// Get the first trade hour based on trade interval
const getFirstTradeHour = (): number => {
  const mode = getSimulationMode();
  if (mode === 'realtime') {
    // For real-time: first trade after 30 minutes = 0.5 hours
    const intervalMs = parseInt(process.env.REALTIME_TRADE_INTERVAL_MS || '1800000', 10);
    return intervalMs / (60 * 60 * 1000); // Convert ms to hours
  }
  // For simulated/historical: first trade after trade interval (e.g., 2 hours)
  const intervalMs = parseInt(process.env.TRADE_INTERVAL_MS || '7200000', 10);
  return intervalMs / (60 * 60 * 1000); // Convert ms to hours
};

const EXPORT_INTERVAL_MS = parseInt(process.env.EXPORT_INTERVAL_MS || '86400000', 10); // 24 hours default

let priceTickInterval: NodeJS.Timeout | null = null;
let tradeWindowInterval: NodeJS.Timeout | null = null;
let exportInterval: NodeJS.Timeout | null = null;
let realtimePriceLoopPromise: Promise<void> | null = null;
let realtimeLoopAbortController: { stop: boolean } | null = null;
let isRunning = false;
let lastExportDay = -1;
let lastMarketDay: Date | null = null; // Track last market day for real-time mode
let firstTradeExecuted = false; // Track if first trade has been executed

export const startScheduler = async (): Promise<void> => {
  if (isRunning) {
    logger.logSimulationEvent('Scheduler already running', {});
    return;
  }

  isRunning = true;
  const simInterval = getSimInterval();
  const tradeInterval = getTradeInterval();
  const mode = getSimulationMode();
  const currentSnapshot = simulationState.getSnapshot();
  const firstTradeHour = getFirstTradeHour();
  firstTradeExecuted = currentSnapshot.intradayHour >= firstTradeHour;
  logger.logSimulationEvent('Starting simulation scheduler', {
    mode,
    simInterval,
    tradeInterval,
    exportInterval: EXPORT_INTERVAL_MS
  });

  // Price tick handler function
  const priceTickHandler = async (prefetchedRealtimeData?: RealtimePrefetchResult | null) => {
    try {
      const snapshot = simulationState.getSnapshot();
      
      // Check if historical simulation is complete
      if (isHistoricalSimulationComplete(snapshot.day)) {
        logger.logSimulationEvent('Historical simulation complete, stopping scheduler', {
          totalDays: snapshot.day + 1,
          finalDay: snapshot.day
        });
        // Export final data and logs
        await Promise.all([
          exportSimulationData(simulationState.getSnapshot()).catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
              'Failed to export simulation data on completion', { error: err });
          }),
          exportLogs().catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
              'Failed to export logs on completion', { error: err });
          }),
          priceLogService.exportLogs().catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
              'Failed to export price logs on completion', { error: err });
          })
        ]);
        stopScheduler();
        return;
      }

      const mode = getSimulationMode();

      // Check if hybrid mode should transition to realtime
      // This check must happen BEFORE advancing time to prevent overshooting
      if (mode === 'hybrid' && !hasHybridModeTransitioned()) {
        const currentDate = snapshot.currentDate || snapshot.startDate || new Date().toISOString();
        const minutesPerTick = getSimulatedMinutesPerTick();
        
        // Check if we should transition (including checking if next tick would overshoot)
        if (shouldHybridModeTransition(currentDate, snapshot.day, snapshot.intradayHour, minutesPerTick)) {
          logger.logSimulationEvent('Hybrid mode transitioning from accelerated to realtime', {
            currentDay: snapshot.day,
            intradayHour: snapshot.intradayHour,
            currentDate: currentDate,
            realtime: new Date().toISOString(),
            minutesPerTick: minutesPerTick
          });
          setHybridModeTransitioned(true);

          // Restart scheduler to pick up new realtime intervals
          logger.logSimulationEvent('Restarting scheduler with realtime intervals', {
            oldSimInterval: getSimInterval(),
            newTradeInterval: getTradeInterval()
          });

          // Stop current scheduler
          stopScheduler();

          // Restart with new intervals after a brief delay to ensure clean shutdown
          setTimeout(() => {
            startScheduler().catch(err => {
              logger.log(LogLevel.ERROR, LogCategory.SIMULATION,
                'Failed to restart scheduler after hybrid transition', { error: err });
            });
          }, 1000);

          return; // Exit current tick to allow scheduler restart
        }
      }
      const now = new Date();
      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
      const effectiveTime = USE_DELAYED_DATA
        ? new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000))
        : now;
      const realtimeMarketOpen = isMarketOpen(now);
      const marketOpen = isMarketOpen(effectiveTime);

      // Real-time mode: process when market is open OR when using delayed data
      // (delayed data mode should work even if market hours check fails due to timezone issues)
      // Hybrid mode after transition: behaves like realtime
      const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());

      if (isRealtimeMode) {
        // Get ET time for logging and calculations
        // Convert current time to ET timezone
        const utc = new Date(effectiveTime.toISOString());
        const year = utc.getUTCFullYear();
        const month = utc.getUTCMonth();
        const day = utc.getUTCDate();
        const hour = utc.getUTCHours();
        const minute = utc.getUTCMinutes();
        
        // Calculate DST
        const march1 = new Date(Date.UTC(year, 2, 1));
        const march1Day = march1.getUTCDay();
        const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8));
        const nov1 = new Date(Date.UTC(year, 10, 1));
        const nov1Day = nov1.getUTCDay();
        const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1));
        const isDST = utc >= dstStart && utc < dstEnd;
        const etOffsetHours = isDST ? -4 : -5;
        
        // Calculate ET time
        const etTotalMinutes = (hour * 60 + minute) + (etOffsetHours * 60);
        const etDayOffset = etTotalMinutes < 0 ? -1 : etTotalMinutes >= 1440 ? 1 : 0;
        const etMinutesOfDay = ((etTotalMinutes % 1440) + 1440) % 1440;
        const etHour = Math.floor(etMinutesOfDay / 60);
        const etMinute = etMinutesOfDay % 60;
        const etDayOfWeek = (utc.getUTCDay() + etDayOffset + 7) % 7;
        
        const etTimeString = `${etHour.toString().padStart(2, '0')}:${etMinute.toString().padStart(2, '0')} ET`;
        
        // Create ET date object for day comparison
        const etDateObj = new Date(Date.UTC(year, month, day + etDayOffset));
        
        // Log market status
        logger.log(LogLevel.INFO, LogCategory.SIMULATION,
          `Price tick check: marketOpen=${marketOpen}, delayedData=${USE_DELAYED_DATA}, ET time=${etTimeString}`, {
            localTime: now.toISOString(),
            effectiveTime: effectiveTime.toISOString(),
            etTime: etTimeString,
            marketOpen,
            realtimeMarketOpen,
            useDelayedData: USE_DELAYED_DATA
          });
        
        // Check if we need to advance to a new trading day
        // Use ET date for day comparison
        const shouldAdvanceDay = lastMarketDay && lastMarketDay.getTime() !== etDateObj.getTime() && (marketOpen || USE_DELAYED_DATA);
        
        if (shouldAdvanceDay) {
          // Market opened for a new day (or new day in ET timezone)
          logger.logSimulationEvent(`Market opened - advancing to day ${snapshot.day + 1}`, { 
            currentDay: snapshot.day, 
            nextDay: snapshot.day + 1,
            marketDate: etDateObj.toISOString(),
            etTime: etTimeString
          });
          
          lastMarketDay = etDateObj;
          
          const newMarketData = await generateNextDayMarketData(snapshot.marketData);
          const updatedSnapshot = await advanceDay(snapshot, newMarketData);
          
          // Reset intraday hour to 0 for new day
          // Reset firstTradeExecuted flag for new day
          firstTradeExecuted = false;
          simulationState.updateSnapshot({
            ...updatedSnapshot,
            intradayHour: 0,
          });
          
          // Persist after day advance
          await saveSnapshot(simulationState.getSnapshot()).catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to persist snapshot after day advance', { error: err });
          });
          return;
        }
        
        // Initialize lastMarketDay if not set
        if (!lastMarketDay && (marketOpen || USE_DELAYED_DATA)) {
          lastMarketDay = etDateObj;
        }
        
        // Process only if market is open
        // Even with delayed data, stop processing when market is closed
        // Exception: On the very first tick, if market is closed (e.g., Sunday), 
        // we should wait for the next market open before processing
        if (!marketOpen) {
          if (USE_DELAYED_DATA) {
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              `Market closed (ET time: ${etTimeString}) but processing delayed data tick`, {
                etTime: etTimeString,
                marketOpen,
                useDelayedData: USE_DELAYED_DATA
              });
          } else {
            // Check if this is the first tick and market is closed (e.g., weekend)
            // In this case, we should wait for the next market open
            // We check if we're on day 0 with no previous market day tracked
            const isFirstTick = snapshot.day === 0 && snapshot.intradayHour === 0 && !lastMarketDay;
            if (isFirstTick) {
              const { getNextMarketOpen } = await import('./marketHours.js');
              const nextOpen = getNextMarketOpen(effectiveTime);
              const msUntilOpen = nextOpen.getTime() - effectiveTime.getTime();
              logger.log(LogLevel.INFO, LogCategory.SIMULATION,
                `Market closed on first tick (ET time: ${etTimeString}), waiting for next market open`, {
                  etTime: etTimeString,
                  nextMarketOpen: nextOpen.toISOString(),
                  waitTimeMinutes: Math.round(msUntilOpen / 60000)
                });
              return; // Skip processing - will retry when market opens
            }
            logger.log(LogLevel.INFO, LogCategory.SIMULATION,
              `Skipping price tick: market closed (ET time: ${etTimeString})`, {
                etTime: etTimeString,
                marketOpen
              });
            return; // Skip processing when market is closed
          }
        }
        
        // Map effective market time (real or delayed) to intraday hours (9:30 AM - 4:00 PM ET = 6.5 hours)
        // Market opens at 9:30 AM ET and closes at 4:00 PM ET
        const marketOpenHour = 9.5; // 9:30 AM ET
        const marketCloseHour = 16; // 4:00 PM ET
        const currentHourET = etHour + (etMinute / 60);
        const minutesSinceOpen = (currentHourET - marketOpenHour) * 60;
        let intradayHour = Math.min(Math.max(minutesSinceOpen / 60, 0), 6.5);
        
        // For delayed data mode, if market appears closed but we're in market hours (ET),
        // calculate intraday hour properly
        // Also handle case where we're starting fresh
        if (USE_DELAYED_DATA) {
          // Always calculate based on ET time, even if marketOpen check fails
          if (intradayHour === 0 && currentHourET >= marketOpenHour && currentHourET < marketCloseHour) {
            // Recalculate based on ET time
            intradayHour = Math.min(Math.max(minutesSinceOpen / 60, 0), 6.5);
          } else if (intradayHour === 0 && snapshot.intradayHour === 0) {
            // Starting fresh - begin at market open (hour 0)
            intradayHour = 0;
          } else if (intradayHour === 0 && snapshot.intradayHour > 0) {
            // Continue from last intraday hour if we're past market close or before market open
            intradayHour = Math.min(snapshot.intradayHour + (simInterval / (60 * 60 * 1000)), 6.5);
          }
        }
        
        logger.logSimulationEvent(`Price tick: real-time market data`, {
          day: snapshot.day,
          intradayHour: intradayHour.toFixed(2),
          marketTime: effectiveTime.toISOString(),
          etTime: etTimeString,
          marketOpen: marketOpen,
          useDelayedData: USE_DELAYED_DATA
        });
        
        if (prefetchedRealtimeData) {
          logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
            'Using prefetched market data for real-time tick', {
              receivedTickers: Object.keys(prefetchedRealtimeData.marketData).length,
              missingTickers: prefetchedRealtimeData.missingTickers.length,
              prefetchDurationMs: prefetchedRealtimeData.durationMs,
            });
        } else {
          logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
            'No prefetched market data available, fetching synchronously', {});
        }

        const newMarketData = await generateNextIntradayMarketData(
          snapshot.marketData,
          snapshot.day,
          intradayHour,
          {
            prefetchedData: prefetchedRealtimeData?.marketData,
            missingTickers: prefetchedRealtimeData?.missingTickers,
          }
        );
        
        if (!newMarketData || Object.keys(newMarketData).length === 0) {
          logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
            'No market data generated for real-time update', { 
              day: snapshot.day, 
              intradayHour 
            });
          return;
        }
        
        // Update currentDate and currentTimestamp for delayed data mode
        let newCurrentDate: string;
        let currentTimestamp: number;

        if (USE_DELAYED_DATA) {
          // For delayed data: use (current time - delay) as the data time
          newCurrentDate = effectiveTime.toISOString();
          currentTimestamp = effectiveTime.getTime();
        } else {
          // For real-time: use current ET time with intraday offset
          // Calculate ET time as a Date object
          const etDate = new Date(now);
          // Adjust for ET offset (already calculated above)
          const etTotalMs = now.getTime() + (etOffsetHours * 60 * 60 * 1000);
          const etDateObj = new Date(etTotalMs);
          etDateObj.setUTCHours(etHour, etMinute, 0, 0);
          newCurrentDate = etDateObj.toISOString();
          currentTimestamp = etDateObj.getTime();
        }
        
        const updatedSnapshot = await step({
          ...snapshot,
          mode: snapshot.mode,
          currentTimestamp,
        }, newMarketData);
        simulationState.updateSnapshot({
          ...updatedSnapshot,
          intradayHour: intradayHour,
          currentDate: newCurrentDate,
          currentTimestamp,
        });
        
        // Persist after price tick
        await saveSnapshot(simulationState.getSnapshot()).catch(err => {
          logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
            'Failed to persist snapshot after price tick', { error: err });
        });
        
        logger.log(LogLevel.INFO, LogCategory.SIMULATION, 
          `Price tick completed: updated ${Object.keys(newMarketData).length} tickers`, {
            day: updatedSnapshot.day,
            intradayHour: intradayHour.toFixed(2),
            currentDate: newCurrentDate,
            currentTimestamp: currentTimestamp,
            timestampSeconds: (currentTimestamp / 1000).toFixed(0)
          });
        return;
      }

      // Simulated/Historical mode: use existing logic
      // Hybrid mode before transition: also uses accelerated logic
      const currentHour = snapshot.intradayHour;
      const minutesPerTick = getSimulatedMinutesPerTick();
      const nextHour = currentHour + (minutesPerTick / 60);
      const shouldAdvanceDay = nextHour >= 6.5;
      
      if (shouldAdvanceDay) {
        // Advance to next day
        logger.logSimulationEvent(`Advancing to day ${snapshot.day + 1}`, { 
          currentDay: snapshot.day, 
          nextDay: snapshot.day + 1 
        });
        
        const newMarketData = await generateNextDayMarketData(snapshot.marketData);
        const updatedSnapshot = await advanceDay(snapshot, newMarketData);
        
        // Reset intraday hour to 0 for new day
        // Reset firstTradeExecuted flag for new day
        // Update currentDate for the new day
        firstTradeExecuted = false;
        let newCurrentDate: string;
        if ((snapshot.mode === 'historical' || (snapshot.mode === 'hybrid' && !hasHybridModeTransitioned())) && snapshot.startDate) {
          const start = new Date(snapshot.startDate);
          start.setDate(start.getDate() + updatedSnapshot.day);
          newCurrentDate = start.toISOString();
        } else if (snapshot.mode === 'realtime' || (snapshot.mode === 'hybrid' && hasHybridModeTransitioned())) {
          // For real-time mode, update currentDate
          const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
          const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
          
          if (USE_DELAYED_DATA) {
            // For delayed data: use (current time - delay)
            const now = new Date();
            const dataTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
            newCurrentDate = dataTime.toISOString();
          } else {
            // For real-time without delay: use current time
            newCurrentDate = new Date().toISOString();
          }
        } else {
          // Simulated
          const start = snapshot.startDate ? new Date(snapshot.startDate) : new Date();
          start.setDate(start.getDate() + updatedSnapshot.day);
          newCurrentDate = start.toISOString();
        }
        simulationState.updateSnapshot({
          ...updatedSnapshot,
          intradayHour: 0,
          currentDate: newCurrentDate,
        });
        
        // Persist after day advance
        await saveSnapshot(simulationState.getSnapshot()).catch(err => {
          logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
            'Failed to persist snapshot after day advance', { error: err });
        });
      } else {
        // Intraday update
        const canTrade = isTradingAllowed();
        logger.logSimulationEvent(`Price tick: intraday hour ${nextHour}`, { 
          day: snapshot.day, 
          hour: nextHour, 
          canTrade 
        });
        
        const newMarketData = await generateNextIntradayMarketData(
          snapshot.marketData, 
          snapshot.day, 
          nextHour
        );
        
        if (!newMarketData || Object.keys(newMarketData).length === 0) {
          logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
            'No market data generated for intraday update', { 
              day: snapshot.day, 
              hour: nextHour 
            });
          return;
        }
        
        const updatedSnapshot = await step({
          ...snapshot,
          intradayHour: nextHour >= 6.5 ? 0 : nextHour, // Reset if advancing day
        }, newMarketData);
        
        // Update currentDate based on intraday hour
        const currentSnapshot = simulationState.getSnapshot();
        let newCurrentDate: string = currentSnapshot.currentDate || currentSnapshot.startDate || new Date().toISOString();
        if (currentSnapshot.startDate) {
          const start = new Date(currentSnapshot.startDate);
          if (currentSnapshot.mode === 'realtime' || (currentSnapshot.mode === 'hybrid' && hasHybridModeTransitioned())) {
            // For real-time or hybrid (post-transition), calculate the data time
            const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
            const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);

            if (USE_DELAYED_DATA) {
              // For delayed data: use (current time - delay) as the data time
              // The data we just fetched is from (now - delay), so that's what we display
              const now = new Date();
              const dataTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
              newCurrentDate = dataTime.toISOString();
            } else {
              // For real-time without delay: use actual current time with intraday offset
              const now = new Date();
              const hours = Math.floor(nextHour);
              const minutes = Math.round((nextHour - hours) * 60);
              now.setHours(9 + hours, 30 + minutes, 0, 0);
              newCurrentDate = now.toISOString();
            }
          } else {
            // For simulated/historical or hybrid (pre-transition), calculate from start date
            start.setDate(start.getDate() + currentSnapshot.day);
            const hours = Math.floor(nextHour);
            const minutes = Math.round((nextHour - hours) * 60);
            start.setHours(9 + hours, 30 + minutes, 0, 0);
            newCurrentDate = start.toISOString();
          }
        }
        simulationState.updateSnapshot({
          ...updatedSnapshot,
          intradayHour: nextHour >= 6.5 ? 0 : nextHour,
          currentDate: newCurrentDate,
        });
        
        // Check if we should execute trades at this hour (for simulated/historical mode)
        const firstTradeHour = getFirstTradeHour();
        const tradeIntervalHours = getTradeInterval() / (60 * 60 * 1000); // Convert ms to hours
        const currentHour = nextHour;
        
        // Check if we're at a trade window
        let shouldTrade = false;
        if (!firstTradeExecuted) {
          // First trade: must be at or after firstTradeHour
          if (currentHour >= firstTradeHour && currentHour < firstTradeHour + 0.5) {
            shouldTrade = true;
            firstTradeExecuted = true;
          }
        } else {
          // Subsequent trades: must be at a multiple of tradeIntervalHours after firstTradeHour
          const hoursSinceFirstTrade = currentHour - firstTradeHour;
          const tradeWindowNumber = Math.floor(hoursSinceFirstTrade / tradeIntervalHours);
          const expectedHour = firstTradeHour + (tradeWindowNumber * tradeIntervalHours);
          
          // Check if we're at a trading window (within 0.5 hours = 30 minutes)
          if (Math.abs(currentHour - expectedHour) < 0.5 && currentHour <= 6.5) {
            shouldTrade = true;
          }
        }
        
        if (shouldTrade) {
          logger.logSimulationEvent('Trade window: executing trades (simulated/historical)', { 
            day: snapshot.day, 
            hour: currentHour.toFixed(2),
            firstTradeHour: firstTradeHour.toFixed(2),
            tradeIntervalHours: tradeIntervalHours.toFixed(2)
          });
          
          try {
            const tradeSnapshot = simulationState.getSnapshot();
            const tradeUpdatedSnapshot = await tradeWindow(tradeSnapshot);
            simulationState.updateSnapshot(tradeUpdatedSnapshot);
            
            // Persist after trade window
            await saveSnapshot(simulationState.getSnapshot()).catch(err => {
              logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
                'Failed to persist snapshot after trade window', { error: err });
            });
          } catch (error) {
            logger.log(LogLevel.ERROR, LogCategory.SIMULATION, 
              'Error in trade window', { 
                error: error instanceof Error ? error.message : String(error) 
              });
          }
        }
        
        // Persist after price tick
        await saveSnapshot(simulationState.getSnapshot()).catch(err => {
          logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
            'Failed to persist snapshot after price tick', { error: err });
        });
      }
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SIMULATION, 
        'Error in price tick handler', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      // Continue running even if one tick fails
    }
  };
  
  if (mode === 'realtime') {
    const guardMs = parseInt(process.env.REALTIME_FETCH_GUARD_MS || '5000', 10);
    const batchSize = parseInt(process.env.REALTIME_FETCH_BATCH_SIZE || '8', 10);
    const minPauseMs = parseInt(process.env.REALTIME_FETCH_MIN_PAUSE_MS || '150', 10);
    const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';

    const abortController = { stop: false };
    realtimeLoopAbortController = abortController;

    const runRealtimePriceLoop = async (): Promise<void> => {
      if (USE_DELAYED_DATA) {
        // Maintain small startup delay to ensure downstream services are ready
        await sleep(2000);
      }

      let pendingPrefetch: Promise<RealtimePrefetchResult> | null = null;
      let firstIteration = true;

      while (isRunning && !abortController.stop) {
        const loopStart = Date.now();
        let prefetchedResult: RealtimePrefetchResult | null = null;

        if (!firstIteration && pendingPrefetch) {
          try {
            prefetchedResult = await pendingPrefetch;
          } catch (error) {
            logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
              'Real-time prefetch failed to resolve before tick', {
                error: error instanceof Error ? error.message : String(error),
              });
            prefetchedResult = null;
          }
          pendingPrefetch = null;
        }

        await priceTickHandler(prefetchedResult);

        if (!isRunning || abortController.stop) {
          break;
        }

        const tickers = Object.keys(simulationState.getSnapshot().marketData);
        if (tickers.length > 0) {
          pendingPrefetch = prefetchRealtimeMarketData(tickers, {
            intervalMs: simInterval,
            guardMs,
            batchSize,
            minPauseMs,
            useCache: false,
          }).catch(error => {
            logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
              'Real-time prefetch encountered an error', {
                error: error instanceof Error ? error.message : String(error),
              });
            return {
              marketData: {},
              missingTickers: tickers,
              startedAt: Date.now(),
              finishedAt: Date.now(),
              durationMs: 0,
              totalTickers: tickers.length,
            } as RealtimePrefetchResult;
          });
        } else {
          pendingPrefetch = null;
        }

        const elapsed = Date.now() - loopStart;
        const remaining = Math.max(simInterval - elapsed, 0);
        if (remaining > 0) {
          await sleep(remaining);
        }

        firstIteration = false;
      }

      if (pendingPrefetch) {
        try {
          await pendingPrefetch;
        } catch (error) {
          logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
            'Pending prefetch rejected during realtime loop shutdown', {
              error: error instanceof Error ? error.message : String(error),
            });
        }
      }
    };

    realtimePriceLoopPromise = runRealtimePriceLoop().catch(error => {
      logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
        'Real-time price loop terminated unexpectedly', {
          error: error instanceof Error ? error.message : String(error),
        });
    });

    priceTickInterval = null;
  } else {
    // Price tick: update market data and portfolio values
    priceTickInterval = setInterval(priceTickHandler, simInterval);
  }

  // Trade window: execute trades
  // For real-time: every 30 minutes (first trade after 30 minutes) - use interval
  // For simulated/historical: check in price tick handler (already done above)
  firstTradeExecuted = false;
  
  // Only set up trade window interval for real-time mode
  // For simulated/historical, trade windows are checked in the price tick handler
  const modeForTradeWindow = getSimulationMode();
  if (modeForTradeWindow === 'realtime') {
    // Real-time mode: use interval-based checking
    tradeWindowInterval = setInterval(async () => {
    try {
      const snapshot = simulationState.getSnapshot();
      
      // Check if historical simulation is complete
      if (isHistoricalSimulationComplete(snapshot.day)) {
        // Export final data and logs
        await Promise.all([
          exportSimulationData(simulationState.getSnapshot()).catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to export simulation data on completion', { error: err });
          }),
          exportLogs().catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to export logs on completion', { error: err });
          })
        ]);
        stopScheduler();
        return;
      }

      const now = new Date();
      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
      const effectiveTime = USE_DELAYED_DATA
        ? new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000))
        : now;
      const realtimeMarketOpen = isMarketOpen(now);
      const marketOpen = isMarketOpen(effectiveTime);

      // Calculate ET time for logging (needed before market check)
      const utc = new Date(effectiveTime.toISOString());
      const year = utc.getUTCFullYear();
      const hour = utc.getUTCHours();
      const minute = utc.getUTCMinutes();
      const march1 = new Date(Date.UTC(year, 2, 1));
      const march1Day = march1.getUTCDay();
      const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8));
      const nov1 = new Date(Date.UTC(year, 10, 1));
      const nov1Day = nov1.getUTCDay();
      const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1));
      const isDST = utc >= dstStart && utc < dstEnd;
      const etOffsetHours = isDST ? -4 : -5;
      const etTotalMinutes = (hour * 60 + minute) + (etOffsetHours * 60);
      const etMinutesOfDay = ((etTotalMinutes % 1440) + 1440) % 1440;
      const etHour = Math.floor(etMinutesOfDay / 60);
      const etMinute = etMinutesOfDay % 60;
      const etTimeString = `${etHour.toString().padStart(2, '0')}:${etMinute.toString().padStart(2, '0')} ET`;

      // Only allow trading if market is open
      if (!marketOpen) {
        if (USE_DELAYED_DATA) {
          logger.log(LogLevel.INFO, LogCategory.SIMULATION,
            'Market closed but executing delayed data trade window', {
              marketOpen,
              realtimeMarketOpen,
              etTime: etTimeString,
              effectiveTime: effectiveTime.toISOString(),
            });
        } else {
          logger.log(LogLevel.INFO, LogCategory.SIMULATION,
            'Skipping trade window: market closed', {
              marketOpen,
              realtimeMarketOpen,
              etTime: etTimeString,
            });
          return; // Skip trading when market is closed
        }
      }

      // Calculate intraday hour for reference
      const marketOpenHour = 9.5; // 9:30 AM ET
      const currentHourET = etHour + (etMinute / 60);
      const minutesSinceOpen = (currentHourET - marketOpenHour) * 60;
      const intradayHour = Math.max(0, minutesSinceOpen / 60);
      
      // For real-time mode: the interval itself defines the trade window
      // First trade happens after firstTradeHour, subsequent trades happen every interval
      const firstTradeHour = getFirstTradeHour();
      const tradeIntervalMs = getTradeInterval();
      
      // Check if we should execute the first trade
      if (!firstTradeExecuted) {
        // First trade: must be at least firstTradeHour after market open (or immediately if delayed data)
        if (intradayHour < firstTradeHour && !USE_DELAYED_DATA) {
          logger.log(LogLevel.INFO, LogCategory.SIMULATION, 
            `Waiting for first trade: need ${firstTradeHour.toFixed(3)}h (${(firstTradeHour * 60).toFixed(1)}min), have ${intradayHour.toFixed(3)}h (${(intradayHour * 60).toFixed(1)}min)`, {
              intradayHour: intradayHour.toFixed(3),
              firstTradeHour: firstTradeHour.toFixed(3),
              etTime: etTimeString
            });
          return;
        }
        // Execute first trade
        logger.logSimulationEvent('First trade window: executing trades', {
          day: snapshot.day,
          intradayHour: intradayHour.toFixed(3),
          marketTime: effectiveTime.toISOString(),
          etTime: etTimeString,
          tradeIntervalMinutes: (tradeIntervalMs / 60000).toFixed(1)
        });
        firstTradeExecuted = true;
      } else {
        // Subsequent trades: since the interval fires every tradeIntervalMs,
        // we just execute the trade (the interval itself is the window)
        logger.logSimulationEvent('Trade window: executing trades', {
          day: snapshot.day,
          intradayHour: intradayHour.toFixed(3),
          marketTime: effectiveTime.toISOString(),
          etTime: etTimeString
        });
      }
      
      // Don't trade if market is closed (intraday hour > 6.5 means past 4:00 PM ET)
      if (intradayHour > 6.5) {
        logger.log(LogLevel.INFO, LogCategory.SIMULATION, 
          'Skipping trade: market closed for the day', { intradayHour: intradayHour.toFixed(2) });
        return;
      }

      // Get current timestamp for real-time mode
      const currentTimestamp = effectiveTime.getTime();
      
      const updatedSnapshot = await tradeWindow({
        ...snapshot,
        mode: snapshot.mode,
        currentTimestamp,
      });
      simulationState.updateSnapshot({
        ...updatedSnapshot,
        currentTimestamp,
      });
      
      // Persist after trade window
      await saveSnapshot(simulationState.getSnapshot()).catch(err => {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
          'Failed to persist snapshot after trade window', { error: err });
      });
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SIMULATION, 
        'Error in trade window', { 
          error: error instanceof Error ? error.message : String(error) 
        });
      // Continue running even if one trade window fails
    }
  }, getTradeInterval());
  } else {
    // Simulated/Historical mode: trade windows are checked in price tick handler
    // No separate interval needed
    tradeWindowInterval = null;
  }

  // Periodic export: export data daily (at start of each new day)
  exportInterval = setInterval(async () => {
    try {
      const snapshot = simulationState.getSnapshot();
      // Export when a new day starts
      if (snapshot.day > lastExportDay && snapshot.intradayHour === 0) {
        lastExportDay = snapshot.day;
        logger.logSimulationEvent('Daily export triggered', { day: snapshot.day });
        await Promise.all([
          exportSimulationData(snapshot).catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to export simulation data', { error: err });
          }),
          exportLogs().catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to export logs', { error: err });
          }),
          priceLogService.exportLogs().catch(err => {
            logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
              'Failed to export price logs', { error: err });
          })
        ]);
      }
    } catch (error) {
      logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
        'Error in periodic export', { 
          error: error instanceof Error ? error.message : String(error) 
        });
    }
  }, EXPORT_INTERVAL_MS);
};

export const stopScheduler = (): void => {
  if (!isRunning) {
    return;
  }

  isRunning = false;
  logger.logSimulationEvent('Stopping simulation scheduler', {});

  if (realtimeLoopAbortController) {
    realtimeLoopAbortController.stop = true;
    realtimeLoopAbortController = null;
  }

  realtimePriceLoopPromise = null;

  if (priceTickInterval) {
    clearInterval(priceTickInterval);
    priceTickInterval = null;
  }

  if (tradeWindowInterval) {
    clearInterval(tradeWindowInterval);
    tradeWindowInterval = null;
  }

  if (exportInterval) {
    clearInterval(exportInterval);
    exportInterval = null;
  }

  // Export price logs when stopping
  priceLogService.exportLogs().catch(err => {
    logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
      'Failed to export price logs when stopping scheduler', { error: err });
  });

  saveSnapshot(simulationState.getSnapshot()).catch(err => {
    logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
      'Failed to persist snapshot when stopping scheduler', { error: err });
  });
};

export const isSchedulerRunning = (): boolean => {
  return isRunning;
};

