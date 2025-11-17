/**
 * Timer Service
 * Tracks the next trade window timestamp server-side
 * This ensures the timer continues accurately even when users refresh the page
 */

import { getSimInterval, getTradeInterval } from '../simulation/multiSimScheduler.js';
import { getSimulationMode, hasHybridModeTransitioned } from './marketDataService.js';
import { simulationManager } from '../simulation/SimulationManager.js';
import { isMarketOpen as checkMarketOpen, getNextMarketOpen, getETTime } from '../simulation/marketHours.js';
import { logger, LogLevel, LogCategory } from './logger.js';

interface TimerState {
  nextTradeWindowTimestamp: number; // Unix timestamp in milliseconds
  lastUpdated: number; // When this was last calculated
}

let timerState: TimerState | null = null;

/**
 * Calculate the next trade window timestamp based on current simulation state
 */
export const calculateNextTradeWindowTimestamp = (): number => {
  const simulations = simulationManager.getAllSimulations();
  if (simulations.size === 0) {
    return Date.now() + getTradeInterval();
  }

  const firstSim = simulations.values().next().value;
  if (!firstSim) {
    return Date.now() + getTradeInterval();
  }

  const snapshot = firstSim.getSnapshot();
  const mode = getSimulationMode();
  const tradeInterval = getTradeInterval();
  const simInterval = getSimInterval();

  // Check if we're in realtime mode (including hybrid mode after transition)
  const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasHybridModeTransitioned());

  // For realtime mode, check market hours
  if (isRealtimeMode) {
    const now = new Date();
    const etTime = getETTime(now); // For logging only
    const isOpen = checkMarketOpen(now); // Pass UTC date, not ET-converted date

    if (!isOpen) {
      // Market is closed - return next market open time
      const nextOpen = getNextMarketOpen(now);
      
      // Only log market status changes (not every timer update)
      const lastMarketStatus = (global as any).lastMarketStatus;
      if (lastMarketStatus !== 'closed') {
        logger.log(LogLevel.INFO, LogCategory.SIMULATION,
          '[MARKET STATUS] MARKET CLOSED', {
            currentET: etTime.toISOString(),
            nextOpen: nextOpen.toISOString(),
            secondsUntilOpen: Math.floor((nextOpen.getTime() - now.getTime()) / 1000),
          });
        (global as any).lastMarketStatus = 'closed';
      }

      return nextOpen.getTime();
    }

    // Market is open - next trade window is one interval away
    const nextTimestamp = Date.now() + tradeInterval;
    
    // Only log market status changes (not every timer update)
    const lastMarketStatus = (global as any).lastMarketStatus;
    if (lastMarketStatus !== 'open') {
      logger.log(LogLevel.INFO, LogCategory.SIMULATION,
        '[MARKET STATUS] MARKET OPEN', {
          currentET: etTime.toISOString(),
          nextTradeWindow: new Date(nextTimestamp).toISOString(),
        });
      (global as any).lastMarketStatus = 'open';
    }

    return nextTimestamp;
  }

  // For simulated/historical mode (and hybrid before transition)
  // Calculate next trade window hour
  // Calculate trade interval in hours from the actual interval milliseconds
  const tradeIntervalHours = tradeInterval / (60 * 60 * 1000); // Convert ms to hours

  // Calculate minutes per tick based on simulation interval
  // For simulated/historical: default 30 minutes per tick
  // For realtime: default 10 minutes per tick
  const minutesPerTick = mode === 'realtime' ? 10 : 30;

  const currentIntradayHour = snapshot.intradayHour;
  const nextTradeWindowHour = Math.ceil(currentIntradayHour / tradeIntervalHours) * tradeIntervalHours;

  // If we're exactly at a trade window, the next one is tradeIntervalHours away
  const hoursUntilNext = currentIntradayHour % tradeIntervalHours === 0
    ? tradeIntervalHours
    : nextTradeWindowHour - currentIntradayHour;

  // Convert simulation hours to simulation minutes
  const simulationMinutesUntilNext = hoursUntilNext * 60;

  // Calculate how many ticks we need
  const ticksNeeded = simulationMinutesUntilNext / minutesPerTick;

  // Convert ticks to real-world milliseconds
  const realWorldMsUntilNext = ticksNeeded * simInterval;

  const nextTimestamp = Date.now() + realWorldMsUntilNext;

  // Reduced logging for simulated mode - only log significant events
  // (Timer logs removed to reduce noise)

  // Return timestamp
  return nextTimestamp;
};

/**
 * Update the timer state (call this after trade windows execute)
 */
export const updateTimerState = (): void => {
  timerState = {
    nextTradeWindowTimestamp: calculateNextTradeWindowTimestamp(),
    lastUpdated: Date.now(),
  };
};

/**
 * Get the current countdown in seconds until next trade window
 */
export const getCountdownSeconds = (): number => {
  if (!timerState) {
    // Initialize if not set
    updateTimerState();
  }

  if (!timerState) {
    return 0;
  }

  const now = Date.now();
  const secondsUntilNext = Math.max(0, Math.floor((timerState.nextTradeWindowTimestamp - now) / 1000));
  
  // If timer expired, recalculate
  if (secondsUntilNext === 0 && (now - timerState.lastUpdated) > 1000) {
    updateTimerState();
    if (timerState) {
      return Math.max(0, Math.floor((timerState.nextTradeWindowTimestamp - now) / 1000));
    }
  }

  return secondsUntilNext;
};

/**
 * Get timer state for API responses
 */
export const getTimerState = (): { countdownSeconds: number; nextTradeWindowTimestamp: number } => {
  const countdownSeconds = getCountdownSeconds();
  const nextTradeWindowTimestamp = timerState?.nextTradeWindowTimestamp || calculateNextTradeWindowTimestamp();
  
  return {
    countdownSeconds,
    nextTradeWindowTimestamp,
  };
};

/**
 * Initialize timer state (call on startup)
 */
export const initializeTimer = (): void => {
  updateTimerState();
};

