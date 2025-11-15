/**
 * Calculate when the next chat message will be delivered based on trade window timing
 */

interface CountdownResult {
  totalSeconds: number;
  nextRoundHour: number;
  isCalculating: boolean;
}

/**
 * Calculate seconds until next trade window (when chat messages are delivered)
 * 
 * @param currentIntradayHour Current intraday hour (e.g., 5.5)
 * @param simulationMode 'simulated' | 'realtime' | 'historical'
 * @returns Countdown information
 */
export function calculateNextChatDelivery(
  currentIntradayHour: number,
  simulationMode: 'simulated' | 'realtime' | 'historical'
): CountdownResult {
  // Default trade window intervals (in hours of simulation time)
  // Trade windows typically happen at: 2, 4, 6, 8, 10, 12 (for 2-hour intervals)
  // Or: 0.5, 1.0, 1.5, 2.0, 2.5, 3.0 (for 30-minute intervals)
  
  let tradeIntervalHours: number;
  let simIntervalMs: number;
  let minutesPerTick: number;

  if (simulationMode === 'realtime') {
    // Real-time mode: trade every 30 minutes, sim tick every 10 minutes
    tradeIntervalHours = 0.5; // 30 minutes = 0.5 hours
    simIntervalMs = 600000; // 10 minutes
    minutesPerTick = 10; // Each tick represents 10 minutes of market time
  } else {
    // Simulated/historical mode: trade every 2 hours, sim tick every 30 seconds (represents 30 min)
    tradeIntervalHours = 2.0; // 2 hours
    simIntervalMs = 30000; // 30 seconds
    minutesPerTick = 30; // Each tick represents 30 minutes of market time
  }

  // Calculate next trade window hour
  // Trade windows happen at multiples of tradeIntervalHours
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
  const realWorldMsUntilNext = ticksNeeded * simIntervalMs;

  // Convert to seconds (don't round, keep precision)
  const totalSeconds = Math.max(0, Math.floor(realWorldMsUntilNext / 1000));

  return {
    totalSeconds,
    nextRoundHour: nextTradeWindowHour,
    isCalculating: false,
  };
}

/**
 * Format countdown message for display with minutes and seconds
 */
export function formatCountdownMessage(totalSeconds: number): string {
  if (totalSeconds <= 0) {
    return 'Next message arriving soon...';
  }
  
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  
  if (minutes === 0) {
    return `Next message will be delivered in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  
  if (seconds === 0) {
    if (minutes === 1) {
      return 'Next message will be delivered in 1 minute';
    }
    return `Next message will be delivered in ${minutes} minutes`;
  }
  
  if (minutes === 1) {
    return `Next message will be delivered in 1 minute and ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }
  
  return `Next message will be delivered in ${minutes} minutes and ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
}

