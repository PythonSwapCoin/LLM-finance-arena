import type { PerformanceMetrics, Agent, Benchmark, Portfolio, Trade } from '../types.js';
import { setDateToMarketOpenET } from '../simulation/marketHours.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';

/**
 * Utility functions for handling historical data preloading in realtime mode
 */

export interface HistoricalPreloadMetadata {
  mode: 'historical';
  startDate: string; // ISO date string
  endDate: string; // ISO date string
  endDay: number;
  endIntradayHour: number;
  tickIntervalMs: number; // SIM_INTERVAL_MS used in historical mode
  marketMinutesPerTick: number; // SIM_MARKET_MINUTES_PER_TICK used in historical mode
  realtimeTickIntervalMs: number; // REALTIME_SIM_INTERVAL_MS for target interpolation
}

/**
 * Convert a historical day number to an actual timestamp (milliseconds)
 * Historical timestamps use day numbers (0, 0.2, 0.4, ..., 1.0, 1.2, ...)
 * where the integer part is the day number and the fractional part is the intraday hour / 10
 *
 * @param dayTimestamp - Historical timestamp (e.g., 1.4 = day 1, hour 4)
 * @param startDate - Start date of the historical simulation (ISO string)
 * @returns Unix timestamp in milliseconds
 */
export const convertHistoricalTimestampToRealtime = (
  dayTimestamp: number,
  startDate: string
): number => {
  const dayNumber = Math.floor(dayTimestamp);
  const intradayHour = (dayTimestamp - dayNumber) * 10;

  // Parse start date and advance by dayNumber days
  const start = new Date(startDate);
  const date = new Date(start);

  // Add days (accounting for weekends)
  let daysAdded = 0;
  while (daysAdded < dayNumber) {
    date.setUTCDate(date.getUTCDate() + 1);
    // Skip weekends
    const dayOfWeek = date.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      daysAdded++;
    }
  }

  // Set to market open time (9:30 AM ET)
  const marketOpenDate = setDateToMarketOpenET(date);

  // Add intraday hours (each hour represents market hours, not clock hours)
  // Market is 6.5 hours long (9:30 AM - 4:00 PM)
  const minutesToAdd = intradayHour * 60;
  marketOpenDate.setMinutes(marketOpenDate.getMinutes() + minutesToAdd);

  return marketOpenDate.getTime();
};

/**
 * Interpolate performance history from historical intervals to realtime intervals
 *
 * Historical data might have sparse intervals (e.g., every 30 minutes of market time)
 * Realtime mode might expect denser intervals (e.g., every 10 minutes of real time)
 *
 * This function expands historical data points to match the realtime interval by
 * creating multiple copies of each historical data point with adjusted timestamps.
 *
 * @param historicalMetrics - Original performance history from historical mode
 * @param startDate - Start date of historical simulation (ISO string)
 * @param historicalMarketMinutesPerTick - Minutes of market time per historical tick
 * @param realtimeIntervalMs - Realtime tick interval in milliseconds
 * @returns Interpolated performance history with realtime timestamps
 */
export const interpolatePerformanceHistory = (
  historicalMetrics: PerformanceMetrics[],
  startDate: string,
  historicalMarketMinutesPerTick: number,
  realtimeIntervalMs: number
): PerformanceMetrics[] => {
  if (historicalMetrics.length === 0) {
    return [];
  }

  const realtimeIntervalMinutes = realtimeIntervalMs / (60 * 1000);
  const interpolatedMetrics: PerformanceMetrics[] = [];

  logger.log(LogLevel.INFO, LogCategory.SYSTEM,
    'Interpolating performance history', {
      originalPoints: historicalMetrics.length,
      historicalMarketMinutesPerTick,
      realtimeIntervalMinutes
    });

  for (let i = 0; i < historicalMetrics.length; i++) {
    const metric = historicalMetrics[i];
    const nextMetric = i < historicalMetrics.length - 1 ? historicalMetrics[i + 1] : null;

    // Convert historical timestamp to realtime timestamp
    const timestamp = convertHistoricalTimestampToRealtime(metric.timestamp, startDate);

    // Create the main data point with realtime timestamp
    interpolatedMetrics.push({
      ...metric,
      timestamp
    });

    // If there's a next metric, interpolate between current and next
    if (nextMetric && historicalMarketMinutesPerTick > realtimeIntervalMinutes) {
      const nextTimestamp = convertHistoricalTimestampToRealtime(nextMetric.timestamp, startDate);
      const timeDiff = nextTimestamp - timestamp;
      const numInterpolatedPoints = Math.floor(timeDiff / realtimeIntervalMs) - 1;

      // Create interpolated points with constant values (assuming prices stay constant between ticks)
      for (let j = 1; j <= numInterpolatedPoints; j++) {
        interpolatedMetrics.push({
          ...metric, // Same values as current metric
          timestamp: timestamp + (j * realtimeIntervalMs)
        });
      }
    }
  }

  logger.log(LogLevel.INFO, LogCategory.SYSTEM,
    'Performance history interpolated', {
      originalPoints: historicalMetrics.length,
      interpolatedPoints: interpolatedMetrics.length
    });

  return interpolatedMetrics;
};

/**
 * Fill gaps between historical end and realtime start with constant values
 * This handles scenarios where there's a time gap (e.g., historical ended Friday,
 * realtime starts Monday, or historical ended last week).
 *
 * @param lastHistoricalMetric - Last performance metric from historical data
 * @param historicalEndDate - End date of historical simulation (ISO string)
 * @param realtimeStartDate - Start date of realtime simulation (ISO string)
 * @param realtimeIntervalMs - Realtime tick interval in milliseconds
 * @returns Array of gap-filling metrics with constant values
 */
export const fillGapMetrics = (
  lastHistoricalMetric: PerformanceMetrics,
  historicalEndDate: string,
  realtimeStartDate: string,
  realtimeIntervalMs: number
): PerformanceMetrics[] => {
  const gapMetrics: PerformanceMetrics[] = [];

  const endDate = new Date(historicalEndDate);
  const startDate = new Date(realtimeStartDate);

  // Calculate time difference
  const timeDiff = startDate.getTime() - endDate.getTime();

  // If no gap or negative gap, return empty array
  if (timeDiff <= 0) {
    return [];
  }

  logger.log(LogLevel.INFO, LogCategory.SYSTEM,
    'Filling gap between historical and realtime', {
      historicalEndDate,
      realtimeStartDate,
      gapDays: timeDiff / (1000 * 60 * 60 * 24),
      realtimeIntervalMinutes: realtimeIntervalMs / (60 * 1000)
    });

  // Start from the day after historical end
  const current = new Date(endDate);
  current.setDate(current.getDate() + 1);

  // Fill with data points, skipping weekends
  while (current < startDate) {
    // Skip weekends
    const dayOfWeek = current.getUTCDay();
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      // Set to market open
      const marketOpenDate = setDateToMarketOpenET(new Date(current));

      // Add data points throughout the trading day
      const marketCloseMs = marketOpenDate.getTime() + (6.5 * 60 * 60 * 1000); // 6.5 hours of trading
      let currentTimeMs = marketOpenDate.getTime();

      while (currentTimeMs < marketCloseMs && currentTimeMs < startDate.getTime()) {
        gapMetrics.push({
          ...lastHistoricalMetric,
          timestamp: currentTimeMs,
          dailyReturn: 0, // No change during gap
        });

        currentTimeMs += realtimeIntervalMs;
      }
    }

    current.setDate(current.getDate() + 1);
  }

  logger.log(LogLevel.INFO, LogCategory.SYSTEM,
    'Gap filled with constant values', {
      gapPoints: gapMetrics.length
    });

  return gapMetrics;
};

/**
 * Prepare agent data from historical snapshot for realtime mode
 * This converts all performance histories to realtime timestamps and
 * interpolates them to match the realtime interval.
 *
 * @param historicalAgents - Agents from historical snapshot
 * @param metadata - Historical preload metadata
 * @param realtimeStartDate - Start date for realtime mode (ISO string)
 * @returns Agents with interpolated performance histories and realtime timestamps
 */
export const prepareAgentsForRealtimePreload = (
  historicalAgents: Agent[],
  metadata: HistoricalPreloadMetadata,
  realtimeStartDate: string
): Agent[] => {
  return historicalAgents.map(agent => {
    // Interpolate performance history
    let interpolated = interpolatePerformanceHistory(
      agent.performanceHistory,
      metadata.startDate,
      metadata.marketMinutesPerTick,
      metadata.realtimeTickIntervalMs
    );

    // Fill gap between historical end and realtime start
    if (interpolated.length > 0) {
      const lastMetric = interpolated[interpolated.length - 1];
      const gapMetrics = fillGapMetrics(
        lastMetric,
        metadata.endDate,
        realtimeStartDate,
        metadata.realtimeTickIntervalMs
      );
      interpolated = [...interpolated, ...gapMetrics];
    }

    // Convert trade history timestamps
    const convertedTrades = agent.tradeHistory.map(trade => ({
      ...trade,
      timestamp: convertHistoricalTimestampToRealtime(trade.timestamp, metadata.startDate)
    }));

    // Update memory with interpolated performance
    const memory = agent.memory ? {
      ...agent.memory,
      pastPerformance: interpolated.slice(-10) // Keep last 10 performance metrics
    } : undefined;

    return {
      ...agent,
      performanceHistory: interpolated,
      tradeHistory: convertedTrades,
      memory
    };
  });
};

/**
 * Prepare benchmark data from historical snapshot for realtime mode
 *
 * @param historicalBenchmarks - Benchmarks from historical snapshot
 * @param metadata - Historical preload metadata
 * @param realtimeStartDate - Start date for realtime mode (ISO string)
 * @returns Benchmarks with interpolated performance histories
 */
export const prepareBenchmarksForRealtimePreload = (
  historicalBenchmarks: Benchmark[],
  metadata: HistoricalPreloadMetadata,
  realtimeStartDate: string
): Benchmark[] => {
  return historicalBenchmarks.map(benchmark => {
    // Interpolate performance history
    let interpolated = interpolatePerformanceHistory(
      benchmark.performanceHistory,
      metadata.startDate,
      metadata.marketMinutesPerTick,
      metadata.realtimeTickIntervalMs
    );

    // Fill gap between historical end and realtime start
    if (interpolated.length > 0) {
      const lastMetric = interpolated[interpolated.length - 1];
      const gapMetrics = fillGapMetrics(
        lastMetric,
        metadata.endDate,
        realtimeStartDate,
        metadata.realtimeTickIntervalMs
      );
      interpolated = [...interpolated, ...gapMetrics];
    }

    return {
      ...benchmark,
      performanceHistory: interpolated
    };
  });
};
