/**
 * Timer Service
 * Tracks the next trade window timestamp server-side
 * This ensures the timer continues accurately even when users refresh the page
 */

import { getSimInterval, getTradeInterval } from '../simulation/multiSimScheduler.js';
import { getSimulationMode } from './marketDataService.js';
import { simulationManager } from '../simulation/SimulationManager.js';

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

  // Calculate next trade window hour
  let tradeIntervalHours: number;
  let minutesPerTick: number;

  if (mode === 'realtime') {
    tradeIntervalHours = 0.5; // 30 minutes = 0.5 hours
    minutesPerTick = 10; // Each tick represents 10 minutes of market time
  } else {
    tradeIntervalHours = 2.0; // 2 hours
    minutesPerTick = 30; // Each tick represents 30 minutes of market time
  }

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

  // Return timestamp
  return Date.now() + realWorldMsUntilNext;
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

