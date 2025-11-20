import type { MarketData, TickerData, MarketDataTelemetry, SimulationSnapshot } from '../types.js';
import { Ticker, type HistoricalDataPoint } from './yfinanceService.js';
import { logger, LogLevel, LogCategory } from './logger.js';
import { S_P500_TICKERS } from '../constants.js';
import { setDateToMarketOpenET } from '../simulation/marketHours.js';

const resolveMode = (): 'simulated' | 'realtime' | 'historical' | 'hybrid' => {
  const raw = (process.env.MODE || 'simulated').toLowerCase();

  if (raw === 'simulation' || raw === 'simulated') {
    return 'simulated';
  }

  if (raw === 'real-time' || raw === 'real_time' || raw === 'realtime') {
    return 'realtime';
  }

  if (raw === 'historical') {
    return 'historical';
  }

  if (raw === 'hybrid') {
    return 'hybrid';
  }

  logger.log(
    LogLevel.WARNING,
    LogCategory.SYSTEM,
    `Unrecognized MODE "${raw}" – defaulting to simulated`,
    { rawMode: raw }
  );

  return 'simulated';
};

const MODE = resolveMode();
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const HISTORICAL_SIMULATION_START_DATE = process.env.HISTORICAL_SIMULATION_START_DATE;
const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true'; // Use 15-30 min delayed data to avoid rate limits
const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '15', 10); // Default 15 minutes delay
const ENABLE_YAHOO_DETAILED_INFO = process.env.ENABLE_YAHOO_DETAILED_INFO === 'true';

// Helper function to convert a date to ET timezone
const toET = (date: Date): { hour: number; minute: number; dayOfWeek: number; dateObj: Date } => {
  const utc = new Date(date.toISOString());
  const year = utc.getUTCFullYear();
  const month = utc.getUTCMonth();
  const day = utc.getUTCDate();

  // DST calculation
  const march1 = new Date(Date.UTC(year, 2, 1));
  const march1Day = march1.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8));
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const nov1Day = nov1.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1));
  const isDST = utc >= dstStart && utc < dstEnd;
  const etOffsetHours = isDST ? -4 : -5;

  // Convert to ET
  const etTime = new Date(utc.getTime() + (etOffsetHours * 60 * 60 * 1000));

  return {
    hour: etTime.getUTCHours(),
    minute: etTime.getUTCMinutes(),
    dayOfWeek: etTime.getUTCDay(),
    dateObj: etTime,
  };
};

// Historical data cache
let historicalDataCache: { [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] } = {};
let historicalWeekStart: Date | null = null;
let historicalWeekEnd: Date | null = null;
let currentHistoricalDay = 0;
let currentIntradayHour = 0;
let lastTradingHour = 0;

// Hybrid mode state tracking
let hybridModeHasTransitioned = false;

// Rate limiting: simple in-memory tracking
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 10; // max requests per window

// Global Yahoo Finance rate limiting
// Since test shows no delays work fine, we'll be more lenient but still conservative
// Historical endpoints (for delayed data) are less rate-limited than real-time endpoints
let yahooGlobalRateLimit: { count: number; resetAt: number } | null = null;

// Get rate limit settings based on whether we're using delayed data
const getYahooRateLimitSettings = () => {
  if (USE_DELAYED_DATA) {
    // Historical endpoints are very lenient - allow 5 requests per second (very generous)
    // Historical data endpoints are much less rate-limited
    return { window: 1000, max: 5 };
  } else {
    // Real-time endpoints - test showed no delays work, but be conservative: 2 requests per second
    return { window: 1000, max: 2 };
  }

  return null;
};

type MarketDataSource = 'yahoo' | 'alphaVantage' | 'polygon';

interface MarketDataSourceStats {
  success: number;
  failure: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError?: string;
}

interface YahooRateLimitTelemetry {
  windowMs: number;
  maxRequestsPerWindow: number;
  currentCount: number;
  resetAt: number | null;
  blockedRequests: number;
  lastThrottledAt: string | null;
  isThrottled: boolean;
}

const createSourceStats = (): MarketDataSourceStats => ({
  success: 0,
  failure: 0,
  lastSuccessAt: null,
  lastFailureAt: null,
});

const initialYahooSettings = getYahooRateLimitSettings();

const marketDataTelemetry: {
  sources: Record<MarketDataSource, MarketDataSourceStats>;
  rateLimits: { yahoo: YahooRateLimitTelemetry };
} = {
  sources: {
    yahoo: createSourceStats(),
    alphaVantage: createSourceStats(),
    polygon: createSourceStats(),
  },
  rateLimits: {
    yahoo: {
      windowMs: initialYahooSettings.window,
      maxRequestsPerWindow: initialYahooSettings.max,
      currentCount: 0,
      resetAt: null,
      blockedRequests: 0,
      lastThrottledAt: null,
      isThrottled: false,
    },
  },
};

export interface RealtimePrefetchOptions {
  intervalMs: number;
  guardMs?: number;
  batchSize?: number;
  minPauseMs?: number;
  useCache?: boolean;
}

export interface RealtimePrefetchResult {
  marketData: MarketData;
  missingTickers: string[];
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  totalTickers: number;
}

const recordMarketDataResult = (
  source: MarketDataSource,
  success: boolean,
  error?: string
) => {
  const stats = marketDataTelemetry.sources[source];
  const now = new Date().toISOString();

  if (success) {
    stats.success += 1;
    stats.lastSuccessAt = now;
  } else {
    stats.failure += 1;
    stats.lastFailureAt = now;
    stats.lastError = error;
  }
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function checkRateLimit(key: string): boolean {
  const now = Date.now();
  const limit = rateLimitMap.get(key);
  
  if (!limit || now > limit.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return true;
  }
  
  if (limit.count >= RATE_LIMIT_MAX) {
    return false;
  }
  
  limit.count++;
  return true;
}

const ensureYahooGlobalRateLimit = async (): Promise<void> => {
  if (USE_DELAYED_DATA) {
    return;
  }

  const settings = getYahooRateLimitSettings();
  const telemetry = marketDataTelemetry.rateLimits.yahoo;

  while (true) {
    const now = Date.now();

    if (!yahooGlobalRateLimit || now >= yahooGlobalRateLimit.resetAt) {
      yahooGlobalRateLimit = { count: 0, resetAt: now + settings.window };
      telemetry.windowMs = settings.window;
      telemetry.maxRequestsPerWindow = settings.max;
      telemetry.currentCount = 0;
      telemetry.resetAt = yahooGlobalRateLimit.resetAt;
      telemetry.isThrottled = false;
    }

    if (yahooGlobalRateLimit.count < settings.max) {
      yahooGlobalRateLimit.count += 1;
      telemetry.currentCount = yahooGlobalRateLimit.count;
      telemetry.resetAt = yahooGlobalRateLimit.resetAt;
      return;
    }

    const waitTime = Math.max(yahooGlobalRateLimit.resetAt - now, 0);
    telemetry.blockedRequests += 1;
    telemetry.lastThrottledAt = new Date().toISOString();
    telemetry.isThrottled = true;

    logger.log(
      LogLevel.WARNING,
      LogCategory.MARKET_DATA,
      `Yahoo Finance rate limit reached, waiting ${waitTime}ms before retrying`,
      { waitTime, count: yahooGlobalRateLimit.count, limit: settings.max }
    );

    if (waitTime > 0) {
      await sleep(waitTime);
    } else {
      await sleep(settings.window);
    }
  }
};

// Cache for market data (to avoid refetching fresh data)
const marketDataCache = new Map<string, { data: TickerData; timestamp: number }>();
const CACHE_TTL_MS = 60000; // 1 minute cache TTL

function getCachedMarketData(ticker: string): TickerData | null {
  const cached = marketDataCache.get(ticker);
  if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
    return cached.data;
  }
  return null;
}

function setCachedMarketData(ticker: string, data: TickerData): void {
  marketDataCache.set(ticker, { data, timestamp: Date.now() });
}

const setToMarketOpen = (date: Date): Date => {
  // Use the ET-aware function from marketHours
  return setDateToMarketOpenET(date);
};

export const getHistoricalSimulationStartDate = (): Date => {
  if (HISTORICAL_SIMULATION_START_DATE) {
    const date = new Date(HISTORICAL_SIMULATION_START_DATE);
    if (!isNaN(date.getTime())) {
      const dayOfWeek = date.getDay();
      const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
      date.setDate(date.getDate() + daysToMonday);
      return setToMarketOpen(date);
    }
  }
  const defaultDate = new Date('2025-01-06');
  return setToMarketOpen(defaultDate);
};

export const isHistoricalSimulationComplete = (simulationDay?: number): boolean => {
  // Only enforce the max historical day limit when we're actually running
  // a historical/simulated flow. In realtime mode (or hybrid after the
  // realtime transition) the scheduler should continue indefinitely.
  const enforceHistoricalLimit =
    MODE === 'historical' ||
    MODE === 'simulated' ||
    (MODE === 'hybrid' && !hybridModeHasTransitioned);

  if (!enforceHistoricalLimit) {
    return false;
  }

  // Check if there's a configured max simulation day
  const maxSimulationDay = process.env.MAX_SIMULATION_DAYS
    ? parseInt(process.env.MAX_SIMULATION_DAYS, 10) - 1  // Convert to 0-indexed day
    : undefined;

  // If no max day is configured, simulation never completes automatically
  if (maxSimulationDay === undefined || !Number.isFinite(maxSimulationDay)) {
    return false;
  }

  if (simulationDay !== undefined) {
    return simulationDay > maxSimulationDay;
  }
  return currentHistoricalDay > maxSimulationDay;
};

export const getSimulationMode = (): 'simulated' | 'realtime' | 'historical' | 'hybrid' => {
  return MODE;
};

export const getHistoricalSimulationPeriod = (): { start: Date | null, end: Date | null } => {
  return {
    start: historicalWeekStart,
    end: historicalWeekEnd,
  };
};

// Hybrid mode helper functions
export const hasHybridModeTransitioned = (): boolean => {
  return hybridModeHasTransitioned;
};

export const setHybridModeTransitioned = (transitioned: boolean): void => {
  hybridModeHasTransitioned = transitioned;
};

export const shouldHybridModeTransition = (currentDate: string, currentDay: number, intradayHour: number, minutesPerTick?: number): boolean => {
  if (MODE !== 'hybrid' || hybridModeHasTransitioned) {
    return false;
  }

  const now = new Date();

  // Account for delayed data: if USE_DELAYED_DATA is enabled, compare against effective time
  // (current time minus delay) instead of actual current time
  const effectiveTime = USE_DELAYED_DATA
    ? new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000))
    : now;

  // Parse simulation date and convert to ET time with intraday hours
  // Market opens at 9:30 AM ET, so intraday hours are relative to that
  const simDateParsed = new Date(currentDate);
  const year = simDateParsed.getUTCFullYear();
  const month = simDateParsed.getUTCMonth();
  const day = simDateParsed.getUTCDate();

  // Calculate DST for this date
  const march1 = new Date(Date.UTC(year, 2, 1));
  const march1Day = march1.getUTCDay();
  const dstStart = new Date(Date.UTC(year, 2, (8 - march1Day) % 7 + 8));
  const nov1 = new Date(Date.UTC(year, 10, 1));
  const nov1Day = nov1.getUTCDay();
  const dstEnd = new Date(Date.UTC(year, 10, (8 - nov1Day) % 7 + 1));
  const checkDate = new Date(Date.UTC(year, month, day, 12, 0, 0));
  const isDST = checkDate >= dstStart && checkDate < dstEnd;
  const etOffsetHours = isDST ? 4 : 5; // EDT is UTC-4, EST is UTC-5

  // Market open is 9:30 AM ET = 13:30 UTC (EDT) or 14:30 UTC (EST)
  const marketOpenHourUTC = 9 + etOffsetHours;
  const marketOpenMinute = 30;

  // Add intraday hours to get the current simulation time in UTC
  const hours = Math.floor(intradayHour);
  const minutes = Math.round((intradayHour - hours) * 60);
  const simulationDate = new Date(Date.UTC(year, month, day, marketOpenHourUTC + hours, marketOpenMinute + minutes, 0, 0));

  // Check if simulation has already passed effective time (simulation is in the future)
  const timeDifference = effectiveTime.getTime() - simulationDate.getTime();

  // Convert times to ET for logging
  const simET = toET(simulationDate);
  const effectiveET = toET(effectiveTime);
  const simETString = `${simET.hour.toString().padStart(2, '0')}:${simET.minute.toString().padStart(2, '0')} ET`;
  const effectiveETString = `${effectiveET.hour.toString().padStart(2, '0')}:${effectiveET.minute.toString().padStart(2, '0')} ET`;

  // If simulation is already in the future relative to effective time, transition immediately
  if (timeDifference < 0) {
    logger.log(LogLevel.INFO, LogCategory.SIMULATION,
      'Hybrid mode transition: simulation is already past effective time', {
        currentDate,
        currentDay,
        intradayHour,
        simulationDateTime: simulationDate.toISOString(),
        simulationTimeET: simETString,
        simulationDayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][simET.dayOfWeek],
        currentDateTime: now.toISOString(),
        effectiveDateTime: effectiveTime.toISOString(),
        effectiveTimeET: effectiveETString,
        effectiveDayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][effectiveET.dayOfWeek],
        useDelayedData: USE_DELAYED_DATA,
        dataDelayMinutes: DATA_DELAY_MINUTES,
        timeDifferenceMinutes: (timeDifference / 60000).toFixed(2),
      });
    return true;
  }

  // Check if the NEXT tick would overshoot effective time
  if (minutesPerTick !== undefined && minutesPerTick > 0) {
    const nextIntradayHour = intradayHour + (minutesPerTick / 60);
    let nextSimulationDate: Date;

    // Handle day advancement if next hour exceeds market close (6.5 hours = 4:00 PM ET)
    if (nextIntradayHour >= 6.5) {
      // Would advance to next day - create new date for next day at market open
      const nextDay = day + 1;
      nextSimulationDate = new Date(Date.UTC(year, month, nextDay, marketOpenHourUTC, marketOpenMinute, 0, 0));
    } else {
      // Same day, just advance intraday hour
      const nextHours = Math.floor(nextIntradayHour);
      const nextMinutes = Math.round((nextIntradayHour - nextHours) * 60);
      nextSimulationDate = new Date(Date.UTC(year, month, day, marketOpenHourUTC + nextHours, marketOpenMinute + nextMinutes, 0, 0));
    }

    const nextTimeDifference = effectiveTime.getTime() - nextSimulationDate.getTime();

    // If next tick would overshoot (go past effective time), transition now
    if (nextTimeDifference < 0) {
      const nextET = toET(nextSimulationDate);
      const nextETString = `${nextET.hour.toString().padStart(2, '0')}:${nextET.minute.toString().padStart(2, '0')} ET`;

      logger.log(LogLevel.INFO, LogCategory.SIMULATION,
        'Hybrid mode transition: next tick would overshoot effective time', {
          currentDate,
          currentDay,
          intradayHour,
          nextIntradayHour,
          simulationDateTime: simulationDate.toISOString(),
          simulationTimeET: simETString,
          nextSimulationDateTime: nextSimulationDate.toISOString(),
          nextSimulationTimeET: nextETString,
          currentDateTime: now.toISOString(),
          effectiveDateTime: effectiveTime.toISOString(),
          effectiveTimeET: effectiveETString,
          useDelayedData: USE_DELAYED_DATA,
          dataDelayMinutes: DATA_DELAY_MINUTES,
          timeDifferenceMinutes: (timeDifference / 60000).toFixed(2),
          nextTimeDifferenceMinutes: (nextTimeDifference / 60000).toFixed(2),
        });
      return true;
    }
  }

  // Check if simulation has caught up to effective time (within a threshold)
  // Use a threshold based on the tick interval to avoid overshooting
  const catchUpThresholdMs = minutesPerTick ? Math.min(minutesPerTick * 60 * 1000, 30 * 60 * 1000) : 15 * 60 * 1000; // Max 30 minutes threshold
  const shouldTransition = timeDifference >= 0 && timeDifference <= catchUpThresholdMs;

  // Only log when we're close to transition (within 5 minutes) or when transitioning
  const timeDifferenceMinutes = timeDifference / 60000;
  if (shouldTransition || timeDifferenceMinutes < 5) {
    logger.log(LogLevel.INFO, LogCategory.SIMULATION,
      shouldTransition ? '🔄 HYBRID MODE TRANSITION: Caught up to real-time!' : 'Hybrid mode: approaching transition',
      {
        currentDate,
        currentDay,
        intradayHour,
        simulationDateTime: simulationDate.toISOString(),
      simulationTimeET: simETString,
      simulationDayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][simET.dayOfWeek],
      currentDateTime: now.toISOString(),
      effectiveDateTime: effectiveTime.toISOString(),
      effectiveTimeET: effectiveETString,
      effectiveDayOfWeek: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][effectiveET.dayOfWeek],
      useDelayedData: USE_DELAYED_DATA,
      dataDelayMinutes: DATA_DELAY_MINUTES,
        timeDifferenceMinutes: (timeDifference / 60000).toFixed(2),
        thresholdMinutes: catchUpThresholdMs / 60000,
        shouldTransition
      });
  }

  return shouldTransition;
};

const getNextPrice = (currentPrice: number): number => {
  const volatility = 0.035;
  const trend = 0.0005;
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = currentPrice * (1 + randomChange + trend);
  return Math.max(newPrice, 1);
};

const validateMarketData = (data: TickerData, previousPrice?: number): boolean => {
  if (!data.price || data.price <= 0 || data.price > 100000) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      `Invalid price for ${data.ticker}: ${data.price}`, 
      { ticker: data.ticker, price: data.price });
    return false;
  }
  
  // Check for suspicious daily change percentage
  if (Math.abs(data.dailyChangePercent) > 0.5) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
      `Suspicious daily change for ${data.ticker}: ${(data.dailyChangePercent * 100).toFixed(2)}%`, 
      { ticker: data.ticker, changePercent: data.dailyChangePercent });
  }
  
  // Check for sudden price jumps between ticks (more than 5% change)
  if (previousPrice && previousPrice > 0) {
    const priceChangePercent = Math.abs((data.price - previousPrice) / previousPrice);
    if (priceChangePercent > 0.05) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[PRICE JUMP] ${data.ticker}: ${previousPrice.toFixed(2)} → ${data.price.toFixed(2)} (${(priceChangePercent * 100).toFixed(2)}% change)`,
        { 
          ticker: data.ticker, 
          previousPrice, 
          currentPrice: data.price, 
          changePercent: priceChangePercent 
        });
    }
  }
  
  return true;
};

// Fetch delayed data (30 minutes ago) using historical endpoints
// Historical endpoints are less rate-limited than real-time endpoints
// For real-time mode: fetches data from (current time - delayMinutes)
const fetchDelayedYahooFinanceData = async (ticker: string, delayMinutes: number = 30): Promise<TickerData | null> => {
  try {
    const yfTicker = new Ticker(ticker);
    const now = new Date();
    const targetTime = new Date(now.getTime() - (delayMinutes * 60 * 1000));
    
    // For real-time delayed data, we want to get the most recent available data point
    // Try to fetch intraday data from today (if market is open) or most recent trading day
    
    // First, try to get recent intraday data (last 2 hours to ensure we have data)
    const endDate = new Date(targetTime);
    const startDate = new Date(targetTime.getTime() - (2 * 60 * 60 * 1000)); // Get 2 hours of data
    
    // Try 5-minute intervals first (most granular)
    let history: HistoricalDataPoint[] = await yfTicker.history({
      start: startDate,
      end: endDate,
      interval: '5m',
    }).catch(() => [] as HistoricalDataPoint[]);
    
    // If no 5-minute data, try 15-minute intervals
    if (history.length === 0) {
      history = await yfTicker.history({
        start: startDate,
        end: endDate,
        interval: '15m',
      }).catch(() => [] as HistoricalDataPoint[]);
    }
    
    // If no intraday data, try 1-hour intervals
    if (history.length === 0) {
      history = await yfTicker.history({
        start: new Date(targetTime.getTime() - (24 * 60 * 60 * 1000)), // Last 24 hours
        end: targetTime,
        interval: '1h',
      }).catch(() => [] as HistoricalDataPoint[]);
    }
    
    // If we have intraday data, use the closest point to target time
    if (history.length > 0) {
      // Find the data point closest to our target time (30 minutes ago)
      const targetTimestamp = targetTime.getTime();
      let closestPoint = history[0];
      let minDiff = Math.abs(closestPoint.date.getTime() - targetTimestamp);
      
      for (const point of history) {
        const diff = Math.abs(point.date.getTime() - targetTimestamp);
        if (diff < minDiff) {
          minDiff = diff;
          closestPoint = point;
        }
      }
      
      // Calculate change from previous point
      const pointIndex = history.indexOf(closestPoint);
      const prevPoint = pointIndex > 0 ? history[pointIndex - 1] : history[0];
      const change = closestPoint.close - prevPoint.close;
      const changePercent = prevPoint.close > 0 ? change / prevPoint.close : 0;
      
      const tickerData: TickerData = {
        ticker,
        price: closestPoint.close,
        dailyChange: change,
        dailyChangePercent: changePercent,
      };
      
      setCachedMarketData(ticker, tickerData);
      logger.logMarketData(`Yahoo Finance (Delayed ${delayMinutes}m)`, ticker, true, tickerData.price);
      recordMarketDataResult('yahoo', true);
      return tickerData;
    }
    
    // Fallback: get the most recent daily data (previous trading day's close)
    // This is used when market is closed or no intraday data is available
    const dailyHistory = await yfTicker.history({
      start: new Date(targetTime.getTime() - (7 * 24 * 60 * 60 * 1000)), // Last 7 days
      end: targetTime,
      interval: '1d',
    }).catch(() => []);
    
    if (dailyHistory.length > 0) {
      const latest = dailyHistory[dailyHistory.length - 1];
      const prev = dailyHistory.length > 1 ? dailyHistory[dailyHistory.length - 2] : latest;
      const change = latest.close - prev.close;
      const changePercent = prev.close > 0 ? change / prev.close : 0;
      
      const tickerData: TickerData = {
        ticker,
        price: latest.close,
        dailyChange: change,
        dailyChangePercent: changePercent,
      };
      
      setCachedMarketData(ticker, tickerData);
      logger.logMarketData(`Yahoo Finance (Delayed ${delayMinutes}m - Daily)`, ticker, true, tickerData.price);
      recordMarketDataResult('yahoo', true);
      return tickerData;
    }
    
    // Last resort: use fastInfo() to get current price (but this defeats the purpose of delayed data)
    // This should rarely happen, but it's a fallback
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
      `Could not fetch delayed data for ${ticker}, falling back to current data`, { ticker });
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    logger.logMarketData(`Yahoo Finance (Delayed ${delayMinutes}m)`, ticker, false, undefined, errorMessage);
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      `Error fetching delayed data for ${ticker}: ${errorMessage}`, { ticker });
    recordMarketDataResult('yahoo', false, errorMessage);
  }

  return null;
};

const fetchYahooFinanceData = async (ticker: string, useCache: boolean = true): Promise<TickerData | null> => {
  // If using delayed data, fetch from historical endpoints (less rate-limited)
  if (USE_DELAYED_DATA) {
    return await fetchDelayedYahooFinanceData(ticker, DATA_DELAY_MINUTES);
  }
  
  // Check cache first (for real-time mode)
  if (useCache) {
    const cached = getCachedMarketData(ticker);
    if (cached) {
      logger.logMarketData('Yahoo Finance (cached)', ticker, true, cached.price);
      return cached;
    }
  }
  
  await ensureYahooGlobalRateLimit();

  const startTime = Date.now();
  try {
    const yfTicker = new Ticker(ticker);

    // For real-time mode: only use fastInfo() to reduce API calls
    const fastInfo = await yfTicker.fastInfo().catch(() => null);

    const responseTime = Date.now() - startTime;

    if (!fastInfo) {
      throw new Error('Failed to fetch price data');
    }
    
    // Only use fastInfo data - this reduces API calls by 50%
    const tickerData: TickerData = {
      ticker,
      price: fastInfo.price,
      dailyChange: fastInfo.change,
      dailyChangePercent: fastInfo.changePercent,
    };
    
    if (!validateMarketData(tickerData)) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
        `Invalid market data for ${ticker}, using fallback`, { ticker, price: tickerData.price });
    }

    // Cache the data
    setCachedMarketData(ticker, tickerData);

    logger.logMarketData('Yahoo Finance', ticker, true, tickerData.price);
    logger.logApiCall('Yahoo Finance', `fastInfo/${ticker}`, true, 200, undefined, responseTime);
    recordMarketDataResult('yahoo', true);

    return tickerData;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    logger.logMarketData('Yahoo Finance', ticker, false, undefined, errorMessage);
    logger.logApiCall('Yahoo Finance', `fastInfo/${ticker}`, false, undefined, errorMessage, responseTime);
    recordMarketDataResult('yahoo', false, errorMessage);
    return null;
  }
};

const fetchTickerWithCascade = async (ticker: string, useCache: boolean): Promise<TickerData> => {
  let tickerData: TickerData | null = null;
  let sourceUsed = '';

  try {
    tickerData = await fetchYahooFinanceData(ticker, useCache);
    if (tickerData) {
      sourceUsed = 'Yahoo Finance';
    }
  } catch (error) {
    console.warn(`Yahoo Finance failed for ${ticker}, trying next source...`);
  }

  if (!tickerData && ALPHA_VANTAGE_API_KEY) {
    if (!checkRateLimit('alphavantage')) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `Rate limit exceeded for Alpha Vantage`, { ticker });
    } else {
      const startTime = Date.now();
      try {
        const endpoint = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await fetch(endpoint);
        const responseTime = Date.now() - startTime;

        if (response.ok) {
          const data = await response.json() as any;

          if (data['Global Quote'] && data['Global Quote']['05. price']) {
            const price = parseFloat(data['Global Quote']['05. price']);
            const change = parseFloat(data['Global Quote']['09. change'] || '0');
            const changePercent = parseFloat(data['Global Quote']['10. change percent']?.replace('%', '') || '0') / 100;

            tickerData = {
              ticker,
              price,
              dailyChange: change,
              dailyChangePercent: changePercent,
            };
            sourceUsed = 'Alpha Vantage';
            logger.logMarketData('Alpha Vantage', ticker, true, price);
            logger.logApiCall('Alpha Vantage', 'GLOBAL_QUOTE', true, response.status, undefined, responseTime);
            recordMarketDataResult('alphaVantage', true);
          }
        }
        if (!tickerData) {
          const failureMessage = response.ok
            ? 'Alpha Vantage response missing data'
            : `Alpha Vantage HTTP ${response.status}`;
          recordMarketDataResult('alphaVantage', false, failureMessage);
        }
      } catch (error) {
        console.warn(`Alpha Vantage failed for ${ticker}`);
        const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
        recordMarketDataResult('alphaVantage', false, errorMessage);
      }
    }
  }

  if (!tickerData && POLYGON_API_KEY) {
    if (!checkRateLimit('polygon')) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `Rate limit exceeded for Polygon`, { ticker });
    } else {
      const startTime = Date.now();
      try {
        const endpoint = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
        const response = await fetch(endpoint);
        const responseTime = Date.now() - startTime;

        if (response.ok) {
          const data = await response.json() as any;

          if (data.results && data.results.length > 0) {
            const result = data.results[0];
            const currentPrice = result.c;
            const openPrice = result.o;
            const dailyChange = currentPrice - openPrice;
            const dailyChangePercent = openPrice > 0 ? dailyChange / openPrice : 0;

            tickerData = {
              ticker,
              price: currentPrice,
              dailyChange,
              dailyChangePercent,
            };
            sourceUsed = 'Polygon.io';
            logger.logMarketData('Polygon.io', ticker, true, currentPrice);
            logger.logApiCall('Polygon.io', 'prev', true, response.status, undefined, responseTime);
            recordMarketDataResult('polygon', true);
          }
        }
        if (!tickerData) {
          const failureMessage = response.ok
            ? 'Polygon response missing data'
            : `Polygon HTTP ${response.status}`;
          recordMarketDataResult('polygon', false, failureMessage);
        }
      } catch (error) {
        console.warn(`Polygon failed for ${ticker}`);
        const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
        recordMarketDataResult('polygon', false, errorMessage);
      }
    }
  }

  if (!tickerData) {
    const fallbackPrice = 50 + Math.random() * 250;
    tickerData = {
      ticker,
      price: fallbackPrice,
      dailyChange: 0,
      dailyChangePercent: 0,
    };
    sourceUsed = 'Simulated (fallback)';
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      `All data sources failed for ${ticker}, using simulated data`, { ticker, fallbackPrice });
  }

  // Log at DEBUG level to reduce log noise (can be enabled if needed)
  logger.log(LogLevel.DEBUG, LogCategory.MARKET_DATA,
    `Market data fetched for ${ticker} using ${sourceUsed}`, {
      ticker,
      price: tickerData.price,
      source: sourceUsed,
    });

  return tickerData;
};

const fetchRealMarketDataWithCascade = async (tickers: string[], useCache: boolean = true): Promise<MarketData> => {
  const marketData: MarketData = {};

  for (const ticker of tickers) {
    marketData[ticker] = await fetchTickerWithCascade(ticker, useCache);

    const minDelay = USE_DELAYED_DATA ? 100 : 200;
    await new Promise(resolve => setTimeout(resolve, minDelay));
  }

  return marketData;
};

export const prefetchRealtimeMarketData = async (
  tickers: string[],
  options: RealtimePrefetchOptions,
): Promise<RealtimePrefetchResult> => {
  const {
    intervalMs,
    guardMs = parseInt(process.env.REALTIME_FETCH_GUARD_MS || '5000', 10),
    batchSize = parseInt(process.env.REALTIME_FETCH_BATCH_SIZE || '8', 10),
    minPauseMs = parseInt(process.env.REALTIME_FETCH_MIN_PAUSE_MS || '150', 10),
    useCache = false,
  } = options;

  const startedAt = Date.now();
  const marketData: MarketData = {};
  const missingTickers: string[] = [];
  const totalTickers = tickers.length;

  if (totalTickers === 0) {
    return {
      marketData,
      missingTickers,
      startedAt,
      finishedAt: startedAt,
      durationMs: 0,
      totalTickers,
    };
  }

  const effectiveBatchSize = Math.max(batchSize, 1);
  const batches: string[][] = [];
  for (let i = 0; i < tickers.length; i += effectiveBatchSize) {
    batches.push(tickers.slice(i, i + effectiveBatchSize));
  }

  const targetBudget = Math.max(intervalMs - guardMs, 0);

  logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
    'Starting real-time prefetch for next tick', {
      tickers: totalTickers,
      batches: batches.length,
      intervalMs,
      guardMs,
      batchSize: effectiveBatchSize,
      targetBudget,
    });

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
    const batchTickers = batches[batchIndex];
    const results = await Promise.all(batchTickers.map(async ticker => {
      try {
        const data = await fetchTickerWithCascade(ticker, useCache);
        return { ticker, data };
      } catch (error) {
        logger.log(LogLevel.ERROR, LogCategory.MARKET_DATA,
          'Error during real-time prefetch fetch', {
            ticker,
            error: error instanceof Error ? error.message : String(error),
          });
        return { ticker, data: null };
      }
    }));

    results.forEach(result => {
      if (result.data) {
        marketData[result.ticker] = result.data;
      } else {
        missingTickers.push(result.ticker);
      }
    });

    if (batchIndex < batches.length - 1 && targetBudget > 0) {
      const elapsed = Date.now() - startedAt;
      const remainingBatches = batches.length - batchIndex - 1;
      const remainingBudget = Math.max(targetBudget - elapsed, 0);
      let pauseMs = remainingBatches > 0
        ? Math.floor(remainingBudget / remainingBatches)
        : 0;
      pauseMs = Math.max(pauseMs, minPauseMs);
      if (pauseMs > 0) {
        await sleep(pauseMs);
      }
    }
  }

  const finishedAt = Date.now();
  const durationMs = finishedAt - startedAt;

  if (durationMs > intervalMs) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      'Real-time prefetch exceeded interval duration', {
        durationMs,
        intervalMs,
        guardMs,
        tickers: totalTickers,
      });
  }

  if (missingTickers.length > 0) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      'Prefetch completed with missing tickers', {
        missingCount: missingTickers.length,
        sample: missingTickers.slice(0, 5),
      });
  }

  return {
    marketData,
    missingTickers,
    startedAt,
    finishedAt,
    durationMs,
    totalTickers,
  };
};

const fetchHistoricalWeekData = async (tickers: string[]): Promise<{ [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] }> => {
  const historicalData: { [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] } = {};
  
  const weekStart = getHistoricalSimulationStartDate();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4);
  weekEnd.setHours(23, 59, 59, 999);
  
  historicalWeekStart = weekStart;
  historicalWeekEnd = weekEnd;
  currentHistoricalDay = 0;
  
  console.log(`📅 Historical Simulation Period: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]} (Mon-Fri)`);
  
  for (const ticker of tickers) {
    historicalData[ticker] = [];
    
    try {
      const yfTicker = new Ticker(ticker);
      const startDate = new Date(weekStart);
      startDate.setDate(weekStart.getDate() - 2);
      const endDate = new Date(weekEnd);
      endDate.setDate(weekEnd.getDate() + 2);
      
      const history = await yfTicker.history({
        start: startDate,
        end: endDate,
        interval: '1d',
      });
      
      let weekData: { date: string, price: number, change: number, changePercent: number }[] = [];
      let prevClose: number | null = null;
      
      for (const point of history) {
        const date = point.date;
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);
        
        if (dateOnly >= weekStart && dateOnly <= weekEnd) {
          const dayOfWeek = dateOnly.getDay();
          if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            const change = prevClose !== null ? point.close - prevClose : 0;
            const changePercent = prevClose !== null && prevClose > 0 ? change / prevClose : 0;
            
            weekData.push({
              date: dateOnly.toISOString().split('T')[0],
              price: point.close,
              change,
              changePercent,
            });
            
            prevClose = point.close;
          }
        }
      }
      
      weekData.sort((a, b) => a.date.localeCompare(b.date));
      weekData = weekData.slice(0, 5);
      
      if (weekData.length > 0) {
        historicalData[ticker] = weekData;
        logger.logMarketData('Yahoo Finance (Historical)', ticker, true, weekData[0].price);
        continue;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
      logger.logMarketData('Yahoo Finance (Historical)', ticker, false, undefined, errorMessage);
      console.warn(`Error fetching historical data for ${ticker}:`, error);
    }
    
    // Fallback: generate simulated historical data
    const basePrice = 50 + Math.random() * 250;
    if (historicalData[ticker].length === 0) {
      for (let day = 0; day < 5; day++) {
        const date = new Date(weekStart);
        date.setDate(weekStart.getDate() + day);
        const volatility = 0.02;
        const price = basePrice * (1 + (Math.random() - 0.5) * volatility * day);
        historicalData[ticker].push({
          date: date.toISOString().split('T')[0],
          price,
          change: day > 0 ? price - historicalData[ticker][day - 1].price : 0,
          changePercent: day > 0 ? (price - historicalData[ticker][day - 1].price) / historicalData[ticker][day - 1].price : 0,
        });
      }
    }
  }
  
  return historicalData;
};

const createSimulatedMarketData = async (tickers: string[]): Promise<MarketData> => {
  const marketData: MarketData = {};
  
  // Check for duplicates
  const uniqueTickers = [...new Set(tickers)];
  if (uniqueTickers.length !== tickers.length) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      `[TICKER WARNING] Duplicate tickers detected in list`, {
        originalCount: tickers.length,
        uniqueCount: uniqueTickers.length,
        duplicates: tickers.filter((t, i) => tickers.indexOf(t) !== i)
      });
  }
  
  // Benchmark tickers that should always use real prices from yfinance
  const BENCHMARK_TICKERS = ['^GSPC'];
  const benchmarkTickers = uniqueTickers.filter(t => BENCHMARK_TICKERS.includes(t));
  const regularTickers = uniqueTickers.filter(t => !BENCHMARK_TICKERS.includes(t));
  
  // Fetch real prices for benchmark tickers (^GSPC) from yfinance
  if (benchmarkTickers.length > 0) {
    try {
      const realBenchmarkData = await fetchRealMarketDataWithCascade(benchmarkTickers, false);
      Object.assign(marketData, realBenchmarkData);
      logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
        `[BENCHMARK DATA] Fetched real prices for benchmark tickers: ${benchmarkTickers.join(', ')}`, {
          tickers: benchmarkTickers,
          prices: benchmarkTickers.reduce((acc, ticker) => {
            if (realBenchmarkData[ticker]) {
              acc[ticker] = realBenchmarkData[ticker].price.toFixed(2);
            }
            return acc;
          }, {} as Record<string, string>)
        });
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[BENCHMARK DATA] Failed to fetch real prices for benchmark tickers, using fallback`, {
          tickers: benchmarkTickers,
          error: error instanceof Error ? error.message : String(error)
        });
      // Fallback to random prices if fetch fails
      benchmarkTickers.forEach(ticker => {
        marketData[ticker] = {
          ticker,
          price: ticker === '^GSPC' ? 5000 + Math.random() * 1000 : 250 + Math.random() * 100,
          dailyChange: 0,
          dailyChangePercent: 0,
        };
      });
    }
  }
  
  // Expected price ranges for major tickers (for validation)
  const EXPECTED_PRICE_RANGES: Record<string, { min: number; max: number; name: string }> = {
    'GOOGL': { min: 100, max: 300, name: 'Alphabet Class A' },
    'GOOG': { min: 100, max: 300, name: 'Alphabet Class C' },
    'NVDA': { min: 100, max: 200, name: 'NVIDIA' },
    'AAPL': { min: 150, max: 250, name: 'Apple' },
    'MSFT': { min: 300, max: 500, name: 'Microsoft' },
    'AMZN': { min: 100, max: 200, name: 'Amazon' },
    'META': { min: 200, max: 500, name: 'Meta' },
    'TSLA': { min: 100, max: 400, name: 'Tesla' },
  };
  
  // Generate random prices for regular trading tickers
  regularTickers.forEach(ticker => {
    const expectedRange = EXPECTED_PRICE_RANGES[ticker];
    let initialPrice: number;
    
    if (expectedRange) {
      // Use expected range if available
      initialPrice = expectedRange.min + Math.random() * (expectedRange.max - expectedRange.min);
    } else {
      // Default random range for other tickers
      initialPrice = 50 + Math.random() * 250;
    }
    
    marketData[ticker] = {
      ticker,
      price: initialPrice,
      dailyChange: 0,
      dailyChangePercent: 0,
    };
    
    // Log if price seems unusual (outside expected range)
    if (expectedRange && (initialPrice < expectedRange.min * 0.7 || initialPrice > expectedRange.max * 1.3)) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[PRICE INIT] ${ticker} (${expectedRange.name}) initialized at unusual price: $${initialPrice.toFixed(2)} (expected: $${expectedRange.min}-$${expectedRange.max})`, {
          ticker,
          price: initialPrice.toFixed(2),
          expectedRange: `${expectedRange.min}-${expectedRange.max}`
        });
    }
  });
  
  // Log if both GOOGL and GOOG are present (they're different share classes)
  if (regularTickers.includes('GOOGL') && regularTickers.includes('GOOG')) {
    logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
      `[TICKER INFO] Both GOOGL (Class A) and GOOG (Class C) are tracked - these are different Alphabet share classes with different prices`, {
        googlPrice: marketData['GOOGL']?.price.toFixed(2),
        googPrice: marketData['GOOG']?.price.toFixed(2),
        note: 'GOOGL has voting rights, GOOG does not - prices can differ'
      });
  }
  
  return marketData;
};

// Optional: Fetch detailed info for a ticker (for initial setup, not for regular updates)
const fetchYahooFinanceDetailedInfo = async (ticker: string, baseData: TickerData): Promise<TickerData> => {
  if (!checkRateLimit('yahoo')) {
    return baseData; // Return base data if rate limited
  }

  await ensureYahooGlobalRateLimit();
  
  try {
    const yfTicker = new Ticker(ticker);
    const detailedInfo = await yfTicker.info().catch(() => null);
    
    if (detailedInfo) {
      // Merge detailed info into base data
      baseData.trailingPE = detailedInfo.trailingPE;
      baseData.forwardPE = detailedInfo.forwardPE;
      baseData.priceToBook = detailedInfo.priceToBook;
      baseData.priceToSales = detailedInfo.priceToSales;
      baseData.enterpriseValue = detailedInfo.enterpriseValue;
      baseData.enterpriseToRevenue = detailedInfo.enterpriseToRevenue;
      baseData.enterpriseToEbitda = detailedInfo.enterpriseToEbitda;
      baseData.beta = detailedInfo.beta;
      baseData.marketCap = detailedInfo.marketCap;
      baseData.volume = detailedInfo.regularMarketVolume;
      baseData.averageVolume = detailedInfo.averageVolume;
      baseData.profitMargins = detailedInfo.profitMargins;
      baseData.grossMargins = detailedInfo.grossMargins;
      baseData.operatingMargins = detailedInfo.operatingMargins;
      baseData.debtToEquity = detailedInfo.debtToEquity;
      baseData.dividendYield = detailedInfo.dividendYield;
      baseData.payoutRatio = detailedInfo.payoutRatio;
      baseData.fiftyTwoWeekChange = detailedInfo.fiftyTwoWeekChange;
      baseData.dayHigh = detailedInfo.dayHigh;
      baseData.dayLow = detailedInfo.dayLow;
      baseData.fiftyTwoWeekHigh = detailedInfo.fiftyTwoWeekHigh;
      baseData.fiftyTwoWeekLow = detailedInfo.fiftyTwoWeekLow;
      baseData.sector = detailedInfo.sector;
      baseData.industry = detailedInfo.industry;
      baseData.longName = detailedInfo.longName;
      baseData.shortName = detailedInfo.shortName;
      
      // Update cache with enriched data
      setCachedMarketData(ticker, baseData);
      recordMarketDataResult('yahoo', true);
    }
  } catch (error) {
    // Silently fail - we have base data already
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
      `Failed to fetch detailed info for ${ticker}`, { error });
    recordMarketDataResult('yahoo', false, error instanceof Error ? error.message : String(error));
  }

  return baseData;
};

export const createInitialMarketData = async (tickers: string[]): Promise<MarketData> => {
  // Always include ^GSPC for S&P 500 benchmark tracking (^GSPC is the official index)
  // SPY is the ETF - we only need one for benchmarking, so we use ^GSPC
  const tickersWithBenchmark = [...new Set([...tickers, '^GSPC'])];

  // Hybrid mode should use historical data if HISTORICAL_SIMULATION_START_DATE is set
  const shouldUseHistorical = MODE === 'historical' || (MODE === 'hybrid' && HISTORICAL_SIMULATION_START_DATE);
  
  if (shouldUseHistorical) {
    const modeLabel = MODE === 'hybrid' ? 'Hybrid Mode (Historical Phase)' : 'Historical Simulation Mode';
    console.log(`📊 ✅ ${modeLabel} ENABLED`);
    logger.logSimulationEvent(`${modeLabel} ENABLED`, { tickers: tickersWithBenchmark.length });
    historicalDataCache = {};
    currentHistoricalDay = 0;
    historicalDataCache = await fetchHistoricalWeekData(tickersWithBenchmark);
    
    const marketData: MarketData = {};
    tickersWithBenchmark.forEach(ticker => {
      const dayData = historicalDataCache[ticker]?.[0];
      if (dayData) {
        marketData[ticker] = {
          ticker,
          price: dayData.price,
          dailyChange: 0,
          dailyChangePercent: 0,
        };
      } else {
        const fallbackPrice = 50 + Math.random() * 250;
        marketData[ticker] = {
          ticker,
          price: fallbackPrice,
          dailyChange: 0,
          dailyChangePercent: 0,
        };
      }
    });
    return marketData;
  } else if (MODE === 'realtime') {
    console.log('📊 ✅ Real-Time Market Data Mode ENABLED');
    if (USE_DELAYED_DATA) {
      console.log(`⏰ Using ${DATA_DELAY_MINUTES}-minute delayed data`);
      logger.logSimulationEvent('Real-Time Market Data Mode ENABLED (Delayed)', { 
        tickers: tickersWithBenchmark.length, 
        delayMinutes: DATA_DELAY_MINUTES 
      });
    } else {
      logger.logSimulationEvent('Real-Time Market Data Mode ENABLED', { tickers: tickersWithBenchmark.length });
    }
    
    // For initial load, disable cache to ensure fresh data
    // If using delayed data, fetchYahooFinanceData will automatically use delayed endpoints
    const marketData = await fetchRealMarketDataWithCascade(tickersWithBenchmark, false);

    if (ENABLE_YAHOO_DETAILED_INFO && !USE_DELAYED_DATA) {
      logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
        'Enriching initial market data with Yahoo Finance detailed metrics',
        { tickers: tickers.length });

      for (const ticker of Object.keys(marketData)) {
        const baseData = marketData[ticker];
        if (baseData) {
          marketData[ticker] = await fetchYahooFinanceDetailedInfo(ticker, { ...baseData });
        }
      }
    }

    return marketData;
  }
  console.log('📊 ✅ Simulated Market Data Mode (Default)');
  logger.logSimulationEvent('Simulated Market Data Mode ENABLED', { tickers: tickersWithBenchmark.length });
  return await createSimulatedMarketData(tickersWithBenchmark);
};

const getIntradayPrice = (basePrice: number, dailyChangePercent: number, intradayHour: number): number => {
  const progress = intradayHour / 6;
  const intradayVariation = basePrice * dailyChangePercent * progress;
  const volatility = (Math.random() - 0.5) * 0.006;
  return basePrice + intradayVariation + (basePrice * volatility);
};

export const generateNextIntradayMarketData = async (
  previousMarketData: MarketData,
  day: number,
  intradayHour: number,
  options?: { prefetchedData?: MarketData; missingTickers?: string[] }
): Promise<MarketData> => {
  // Hybrid mode should use historical data if HISTORICAL_SIMULATION_START_DATE is set and hasn't transitioned yet
  const shouldUseHistorical = MODE === 'historical' || (MODE === 'hybrid' && HISTORICAL_SIMULATION_START_DATE && !hasHybridModeTransitioned());
  
  if (shouldUseHistorical) {
    // Always include ^GSPC for S&P 500 benchmark tracking
    let tickers = [...new Set([...Object.keys(previousMarketData), '^GSPC'])];
    if (tickers.length === 0) {
      tickers = [...new Set([...Object.keys(historicalDataCache), '^GSPC'])];
    }
    if (tickers.length === 0) {
      tickers = [...new Set([...S_P500_TICKERS, '^GSPC'])];
    }
    
    if (tickers.length === 0) {
      return previousMarketData;
    }
    
    const marketData: MarketData = {};
    
    tickers.forEach(ticker => {
      const historicalDays = historicalDataCache[ticker] || [];
      const dayData = historicalDays[day];
      
      if (dayData) {
        const prevDayData = historicalDays[day - 1];
        const dayOpenPrice = prevDayData ? prevDayData.price : dayData.price;
        const dayClosePrice = dayData.price;
        const dailyChangePercent = dayData.changePercent;
        
        const intradayPrice = getIntradayPrice(dayOpenPrice, dailyChangePercent, intradayHour);
        const prevPrice = previousMarketData[ticker]?.price || dayOpenPrice;
        const intradayChange = intradayPrice - prevPrice;
        const intradayChangePercent = prevPrice > 0 ? intradayChange / prevPrice : 0;
        
        marketData[ticker] = {
          ticker,
          price: intradayPrice,
          dailyChange: intradayPrice - dayOpenPrice,
          dailyChangePercent: dayOpenPrice > 0 ? (intradayPrice - dayOpenPrice) / dayOpenPrice : 0,
        };
      } else {
        const prevPrice = previousMarketData[ticker]?.price || 50 + Math.random() * 250;
        const volatility = (Math.random() - 0.5) * 0.01;
        const newPrice = prevPrice * (1 + volatility);
        marketData[ticker] = {
          ticker,
          price: newPrice,
          dailyChange: newPrice - prevPrice,
          dailyChangePercent: prevPrice > 0 ? (newPrice - prevPrice) / prevPrice : 0,
        };
      }
    });
    
    return marketData;
  } else if (MODE === 'realtime') {
    // Always include ^GSPC for S&P 500 benchmark tracking
    const tickers = [...new Set([...Object.keys(previousMarketData), '^GSPC'])];
    let fetchedData: MarketData = {};
    let usedPrefetch = false;

    if (options?.prefetchedData && Object.keys(options.prefetchedData).length > 0) {
      fetchedData = { ...options.prefetchedData };
      usedPrefetch = true;
      const missing = options.missingTickers ?? tickers.filter(ticker => !fetchedData[ticker]);
      if (missing.length > 0) {
        logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
          'Prefetched data missing tickers, fetching fallbacks', {
            missingCount: missing.length,
          });
        const fallbackData = await fetchRealMarketDataWithCascade(missing, false);
        fetchedData = { ...fetchedData, ...fallbackData };
      }
    } else {
      // Use cache for real-time updates (cache TTL is 1 minute, which matches our default update interval)
      fetchedData = await fetchRealMarketDataWithCascade(tickers, true);
    }

    if (usedPrefetch) {
      logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
        'Applying prefetched real-time market data to snapshot', {
          tickers: Object.keys(fetchedData).length,
        });
    }

    const result: MarketData = { ...previousMarketData };
    Object.keys(fetchedData).forEach(ticker => {
      if (fetchedData[ticker]) {
        result[ticker] = fetchedData[ticker];
      }
    });

    return result;
  }
  
  // Simulated mode
  const newMarketData: MarketData = {};
  const BENCHMARK_TICKERS = ['^GSPC'];
  
  // Fetch real prices for benchmark tickers during intraday updates
  const benchmarkTickers = Object.keys(previousMarketData).filter(t => BENCHMARK_TICKERS.includes(t));
  if (benchmarkTickers.length > 0) {
    try {
      const realBenchmarkData = await fetchRealMarketDataWithCascade(benchmarkTickers, true);
      Object.assign(newMarketData, realBenchmarkData);
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[BENCHMARK DATA] Failed to fetch real prices for benchmark tickers, using previous prices`, {
          tickers: benchmarkTickers,
          error: error instanceof Error ? error.message : String(error)
        });
      // Fallback: keep previous prices
      benchmarkTickers.forEach(ticker => {
        if (previousMarketData[ticker]) {
          newMarketData[ticker] = { ...previousMarketData[ticker] };
        }
      });
    }
  }
  
  // Generate random prices for regular trading tickers
  Object.keys(previousMarketData).forEach(ticker => {
    // Skip benchmark tickers (already handled above)
    if (BENCHMARK_TICKERS.includes(ticker)) {
      return;
    }
    
    const prevData = previousMarketData[ticker];
    const volatility = (Math.random() - 0.5) * 0.01;
    const intradayPrice = prevData.price * (1 + volatility);
    
    const prevPrice = prevData.price;
    const intradayChange = intradayPrice - prevPrice;
    
    const newTickerData: TickerData = {
      ticker,
      price: intradayPrice,
      dailyChange: prevData.dailyChange + intradayChange,
      dailyChangePercent: prevPrice > 0 ? (intradayPrice - (prevPrice - prevData.dailyChange)) / (prevPrice - prevData.dailyChange) : 0,
    };
    
    // Validate and log if there's a suspicious jump (>5% intraday change)
    const intradayChangePercent = Math.abs(intradayChange / prevPrice);
    if (intradayChangePercent > 0.05) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[INTRADAY JUMP] ${ticker}: ${prevPrice.toFixed(2)} → ${intradayPrice.toFixed(2)} (${(intradayChangePercent * 100).toFixed(2)}% change)`,
        { 
          ticker, 
          previousPrice: prevPrice, 
          newPrice: intradayPrice, 
          changePercent: intradayChangePercent,
          intradayHour
        });
    }
    
    validateMarketData(newTickerData, prevPrice);
    newMarketData[ticker] = newTickerData;
  });
  return newMarketData;
};

export const generateNextDayMarketData = async (previousMarketData: MarketData): Promise<MarketData> => {
  currentIntradayHour = 0;
  const BENCHMARK_TICKERS = ['^GSPC'];

  // Hybrid mode should use historical data if HISTORICAL_SIMULATION_START_DATE is set and hasn't transitioned yet
  const shouldUseHistorical = MODE === 'historical' || (MODE === 'hybrid' && HISTORICAL_SIMULATION_START_DATE && !hasHybridModeTransitioned());
  
  if (shouldUseHistorical) {
    // Check if we've run out of historical data (only Mon-Fri, so max index is 4)
    if (currentHistoricalDay >= 4) {
      // No more historical data - return previous market data unchanged
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[HISTORICAL DATA] No more historical data available (day ${currentHistoricalDay + 1}), keeping previous prices`, {
          currentHistoricalDay,
          maxDays: 4
        });
      return previousMarketData;
    }
    
    currentHistoricalDay++;
    // Always include ^GSPC for S&P 500 benchmark tracking
    const tickers = [...new Set([...Object.keys(previousMarketData), '^GSPC'])];
    const marketData: MarketData = {};
    
    tickers.forEach(ticker => {
      const historicalDays = historicalDataCache[ticker] || [];
      const dayData = historicalDays[currentHistoricalDay];

      if (dayData) {
        // Get previous day's historical data to calculate the change correctly
        // Anchor the new day to the actual historical close to avoid cumulative drift
        // from intraday simulation noise. This ensures each historical day starts
        // from the real market close for that date.
        const previousDayData = currentHistoricalDay > 0 ? historicalDays[currentHistoricalDay - 1] : null;
        const previousDayClose = previousDayData?.price || dayData.price;

        marketData[ticker] = {
          ticker,
          price: dayData.price,
          dailyChange: dayData.change ?? dayData.price - previousDayClose,
          dailyChangePercent: dayData.changePercent ?? (previousDayClose > 0
            ? (dayData.price - previousDayClose) / previousDayClose
            : 0),
        };
      } else {
        // No data for this day - use last available data
        const lastData = historicalDays[historicalDays.length - 1];
        if (lastData) {
          logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
            `[HISTORICAL DATA] No data for ${ticker} on day ${currentHistoricalDay}, using last available price`, {
              ticker,
              day: currentHistoricalDay,
              lastPrice: lastData.price
            });
          marketData[ticker] = {
            ticker,
            price: lastData.price,
            dailyChange: 0,
            dailyChangePercent: 0,
          };
        } else {
          // No historical data at all - use previous price
          logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
            `[HISTORICAL DATA] No historical data for ${ticker}, using previous price`, {
              ticker,
              previousPrice: previousMarketData[ticker]?.price
            });
          marketData[ticker] = previousMarketData[ticker] || {
            ticker,
            price: 50 + Math.random() * 250,
            dailyChange: 0,
            dailyChangePercent: 0,
          };
        }
      }
    });
    
    return marketData;
  } else if (MODE === 'realtime') {
    // Always include ^GSPC for S&P 500 benchmark tracking
    const tickers = [...new Set([...Object.keys(previousMarketData), '^GSPC'])];
    return await fetchRealMarketDataWithCascade(tickers);
  }
  
  // Simulated mode
  const newMarketData: MarketData = {};
  
  // Fetch real prices for benchmark tickers
  const benchmarkTickers = Object.keys(previousMarketData).filter(t => BENCHMARK_TICKERS.includes(t));
  if (benchmarkTickers.length > 0) {
    try {
      const realBenchmarkData = await fetchRealMarketDataWithCascade(benchmarkTickers, true);
      Object.assign(newMarketData, realBenchmarkData);
    } catch (error) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA,
        `[BENCHMARK DATA] Failed to fetch real prices for benchmark tickers, using previous prices`, {
          tickers: benchmarkTickers,
          error: error instanceof Error ? error.message : String(error)
        });
      // Fallback: keep previous prices
      benchmarkTickers.forEach(ticker => {
        if (previousMarketData[ticker]) {
          newMarketData[ticker] = { ...previousMarketData[ticker] };
        }
      });
    }
  }
  
  // Generate random prices for regular trading tickers
  Object.keys(previousMarketData).forEach(ticker => {
    // Skip benchmark tickers (already handled above)
    if (BENCHMARK_TICKERS.includes(ticker)) {
      return;
    }
    
    const prevData = previousMarketData[ticker];
    const newPrice = getNextPrice(prevData.price);
    const dailyChange = newPrice - prevData.price;
    const dailyChangePercent = dailyChange / prevData.price;

    const newTickerData: TickerData = {
      ticker,
      price: newPrice,
      dailyChange,
      dailyChangePercent,
    };
    
    // Validate and log day transition price changes
    const priceChangePercent = Math.abs(dailyChangePercent);
    if (priceChangePercent > 0.05) {
      logger.log(LogLevel.INFO, LogCategory.MARKET_DATA,
        `[DAY TRANSITION] ${ticker}: ${prevData.price.toFixed(2)} → ${newPrice.toFixed(2)} (${(priceChangePercent * 100).toFixed(2)}% change)`,
        { 
          ticker, 
          previousPrice: prevData.price, 
          newPrice, 
          changePercent: priceChangePercent,
          dailyChange,
          dailyChangePercent
        });
    }
    
    validateMarketData(newTickerData, prevData.price);
    newMarketData[ticker] = newTickerData;
  });
  return newMarketData;
};

export const getMarketDataTelemetry = (): MarketDataTelemetry => {
  const { sources, rateLimits } = marketDataTelemetry;
  return {
    sources: {
      yahoo: { ...sources.yahoo },
      alphaVantage: { ...sources.alphaVantage },
      polygon: { ...sources.polygon },
    },
    rateLimits: {
      yahoo: {
        windowMs: rateLimits.yahoo.windowMs,
        maxRequestsPerWindow: rateLimits.yahoo.maxRequestsPerWindow,
        currentCount: rateLimits.yahoo.currentCount,
        resetAt: rateLimits.yahoo.resetAt ? new Date(rateLimits.yahoo.resetAt).toISOString() : null,
        blockedRequests: rateLimits.yahoo.blockedRequests,
        lastThrottledAt: rateLimits.yahoo.lastThrottledAt,
        isThrottled: rateLimits.yahoo.isThrottled,
      },
    },
  };
};

export const advanceIntradayHour = (): { hour: number; shouldAdvanceDay: boolean } => {
  currentIntradayHour += 0.5;
  const shouldAdvanceDay = currentIntradayHour >= 6.5;
  if (shouldAdvanceDay) {
    currentIntradayHour = 0;
  }
  return { hour: currentIntradayHour, shouldAdvanceDay };
};

export const isTradingAllowed = (): boolean => {
  const currentHour = Math.floor(currentIntradayHour);
  if (currentHour !== lastTradingHour && currentHour % 2 === 0 && currentHour <= 6) {
    lastTradingHour = currentHour;
    return true;
  }
  return false;
};

export const getCurrentIntradayHour = (): number => {
  return currentIntradayHour;
};

const ensureHistoricalCacheForSnapshot = async (
  snapshot: SimulationSnapshot
): Promise<void> => {
  const tickers = Object.keys(snapshot.marketData || {});
  const requiredDay = Math.max(0, snapshot.day ?? 0);

  const hasCacheForAllTickers = tickers.every(ticker => {
    const entries = historicalDataCache[ticker];
    return entries && entries.length > requiredDay;
  });

  if (!hasCacheForAllTickers || Object.keys(historicalDataCache).length === 0) {
    const tickersToFetch = tickers.length > 0 ? tickers : S_P500_TICKERS;
    logger.logSimulationEvent('Refreshing historical data cache from persisted snapshot', {
      tickers: tickersToFetch.length,
      requestedDay: snapshot.day,
    });
    historicalDataCache = await fetchHistoricalWeekData(tickersToFetch);
  }

  currentHistoricalDay = Math.min(requiredDay, 4);

  if (snapshot.startDate) {
    const start = new Date(snapshot.startDate);
    if (!isNaN(start.getTime())) {
      const normalizedStart = setToMarketOpen(start);
      historicalWeekStart = normalizedStart;
      const end = new Date(normalizedStart);
      end.setDate(normalizedStart.getDate() + 4);
      end.setHours(23, 59, 59, 999);
      historicalWeekEnd = end;
    }
  } else if (!historicalWeekStart || !historicalWeekEnd) {
    const defaultStart = getHistoricalSimulationStartDate();
    historicalWeekStart = defaultStart;
    const end = new Date(defaultStart);
    end.setDate(defaultStart.getDate() + 4);
    end.setHours(23, 59, 59, 999);
    historicalWeekEnd = end;
  }
};

export const synchronizeSimulationFromSnapshot = async (
  snapshot: SimulationSnapshot
): Promise<void> => {
  currentIntradayHour = snapshot.intradayHour ?? 0;
  lastTradingHour = Math.floor(currentIntradayHour);

  if (snapshot.mode === 'historical') {
    await ensureHistoricalCacheForSnapshot(snapshot);
  } else {
    currentHistoricalDay = Math.max(0, snapshot.day ?? 0);
  }
};

