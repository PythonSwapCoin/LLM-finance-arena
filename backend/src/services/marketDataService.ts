import type { MarketData, TickerData } from '../types';
import { Ticker, type HistoricalDataPoint } from './yfinanceService';
import { logger, LogLevel, LogCategory } from './logger';
import { S_P500_TICKERS } from '../constants';

const MODE = (process.env.MODE || 'simulated') as 'simulated' | 'realtime' | 'historical';
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
const HISTORICAL_SIMULATION_START_DATE = process.env.HISTORICAL_SIMULATION_START_DATE;
const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true'; // Use 15-30 min delayed data to avoid rate limits
const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '15', 10); // Default 15 minutes delay

// Historical data cache
let historicalDataCache: { [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] } = {};
let historicalWeekStart: Date | null = null;
let historicalWeekEnd: Date | null = null;
let currentHistoricalDay = 0;
let currentIntradayHour = 0;
let lastTradingHour = 0;

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
};

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

function checkYahooGlobalRateLimit(): boolean {
  const now = Date.now();
  const settings = getYahooRateLimitSettings();
  
  if (!yahooGlobalRateLimit || now > yahooGlobalRateLimit.resetAt) {
    // Reset window
    yahooGlobalRateLimit = { count: 1, resetAt: now + settings.window };
    return true;
  }
  
  if (yahooGlobalRateLimit.count >= settings.max) {
    // Log rate limit hit with details
    const timeUntilReset = yahooGlobalRateLimit.resetAt - now;
    logger.log(LogLevel.DEBUG, LogCategory.MARKET_DATA, 
      `Yahoo Finance rate limit check: ${yahooGlobalRateLimit.count}/${settings.max} requests, ${timeUntilReset}ms until reset`, {});
    return false;
  }
  
  yahooGlobalRateLimit.count++;
  return true;
}

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

export const getHistoricalSimulationStartDate = (): Date => {
  if (HISTORICAL_SIMULATION_START_DATE) {
    const date = new Date(HISTORICAL_SIMULATION_START_DATE);
    if (!isNaN(date.getTime())) {
      const dayOfWeek = date.getDay();
      const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
      date.setDate(date.getDate() + daysToMonday);
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }
  const defaultDate = new Date('2025-01-06');
  defaultDate.setHours(0, 0, 0, 0);
  return defaultDate;
};

export const isHistoricalSimulationComplete = (simulationDay?: number): boolean => {
  if (MODE !== 'historical') return false;
  if (simulationDay !== undefined) {
    return simulationDay > 4;
  }
  return currentHistoricalDay > 4;
};

export const getSimulationMode = (): 'simulated' | 'realtime' | 'historical' => {
  return MODE;
};

export const getHistoricalSimulationPeriod = (): { start: Date | null, end: Date | null } => {
  return {
    start: historicalWeekStart,
    end: historicalWeekEnd,
  };
};

const getNextPrice = (currentPrice: number): number => {
  const volatility = 0.035;
  const trend = 0.0005;
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = currentPrice * (1 + randomChange + trend);
  return Math.max(newPrice, 1);
};

const validateMarketData = (data: TickerData): boolean => {
  if (!data.price || data.price <= 0 || data.price > 100000) {
    return false;
  }
  if (Math.abs(data.dailyChangePercent) > 0.5) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
      `Suspicious daily change for ${data.ticker}: ${(data.dailyChangePercent * 100).toFixed(2)}%`, 
      { ticker: data.ticker, changePercent: data.dailyChangePercent });
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
      return tickerData;
    }
    
    // Last resort: use fastInfo() to get current price (but this defeats the purpose of delayed data)
    // This should rarely happen, but it's a fallback
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
      `Could not fetch delayed data for ${ticker}, falling back to current data`, { ticker });
    return null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    logger.logMarketData('Yahoo Finance (Delayed)', ticker, false, undefined, errorMessage);
    return null;
  }
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
  
  // For delayed data, skip proactive rate limiting (historical endpoints are very lenient)
  // For real-time, do a lightweight check but don't block aggressively
  if (!USE_DELAYED_DATA) {
    // Lightweight rate limit check - only block if we've clearly hit a limit
    // Test showed no delays work fine, so we're being very permissive
    const settings = getYahooRateLimitSettings();
    if (yahooGlobalRateLimit && yahooGlobalRateLimit.count >= settings.max) {
      const now = Date.now();
      if (yahooGlobalRateLimit.resetAt > now) {
        // Only wait if we're clearly over the limit
        const waitTime = Math.min(yahooGlobalRateLimit.resetAt - now, 1000); // Max 1 second wait
        if (waitTime > 100) {
          logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
            `Rate limit check: waiting ${waitTime}ms`, { ticker, waitTime });
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
  }

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
    
    return tickerData;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error || 'Unknown error');
    logger.logMarketData('Yahoo Finance', ticker, false, undefined, errorMessage);
    logger.logApiCall('Yahoo Finance', `fastInfo/${ticker}`, false, undefined, errorMessage, responseTime);
    return null;
  }
};

const fetchRealMarketDataWithCascade = async (tickers: string[], useCache: boolean = true): Promise<MarketData> => {
  const marketData: MarketData = {};
  
  for (const ticker of tickers) {
    let tickerData: TickerData | null = null;
    let sourceUsed = '';
    
    // Try Yahoo Finance first
    try {
      tickerData = await fetchYahooFinanceData(ticker, useCache);
      if (tickerData) {
        sourceUsed = 'Yahoo Finance';
      }
    } catch (error) {
      console.warn(`Yahoo Finance failed for ${ticker}, trying next source...`);
    }
    
    // Try Alpha Vantage
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
            }
          }
        } catch (error) {
          console.warn(`Alpha Vantage failed for ${ticker}`);
        }
      }
    }
    
    // Try Polygon
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
            }
          }
        } catch (error) {
          console.warn(`Polygon failed for ${ticker}`);
        }
      }
    }
    
    // Fallback to simulated
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
    
    marketData[ticker] = tickerData;
    
    // Rate limiting delay: 
    // - For delayed data (historical endpoints): 100ms is fine (historical endpoints are very lenient)
    // - For real-time data: 200ms (test showed no delays work, minimal delay for safety)
    // Since test showed no delays work fine, we use very minimal delays
    const minDelay = USE_DELAYED_DATA ? 100 : 200;
    await new Promise(resolve => setTimeout(resolve, minDelay));
  }
  
  return marketData;
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

const createSimulatedMarketData = (tickers: string[]): MarketData => {
  const marketData: MarketData = {};
  tickers.forEach(ticker => {
    const initialPrice = 50 + Math.random() * 250;
    marketData[ticker] = {
      ticker,
      price: initialPrice,
      dailyChange: 0,
      dailyChangePercent: 0,
    };
  });
  return marketData;
};

// Optional: Fetch detailed info for a ticker (for initial setup, not for regular updates)
const fetchYahooFinanceDetailedInfo = async (ticker: string, baseData: TickerData): Promise<TickerData> => {
  // Only fetch detailed info if we haven't hit rate limits and it's worth it
  if (!checkYahooGlobalRateLimit() || !checkRateLimit('yahoo')) {
    return baseData; // Return base data if rate limited
  }
  
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
      
      // Update cache with enriched data
      setCachedMarketData(ticker, baseData);
    }
  } catch (error) {
    // Silently fail - we have base data already
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, 
      `Failed to fetch detailed info for ${ticker}`, { error });
  }
  
  return baseData;
};

export const createInitialMarketData = async (tickers: string[]): Promise<MarketData> => {
  if (MODE === 'historical') {
    console.log('📊 ✅ Historical Simulation Mode ENABLED');
    logger.logSimulationEvent('Historical Simulation Mode ENABLED', { tickers: tickers.length });
    historicalDataCache = {};
    currentHistoricalDay = 0;
    historicalDataCache = await fetchHistoricalWeekData(tickers);
    
    const marketData: MarketData = {};
    tickers.forEach(ticker => {
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
        tickers: tickers.length, 
        delayMinutes: DATA_DELAY_MINUTES 
      });
    } else {
      logger.logSimulationEvent('Real-Time Market Data Mode ENABLED', { tickers: tickers.length });
    }
    
    // For initial load, disable cache to ensure fresh data
    // If using delayed data, fetchYahooFinanceData will automatically use delayed endpoints
    const marketData = await fetchRealMarketDataWithCascade(tickers, false);
    
    // Note: We skip detailed info fetching to avoid rate limits
    // The fastInfo() data is sufficient for trading decisions
    
    return marketData;
  }
  console.log('📊 ✅ Simulated Market Data Mode (Default)');
  logger.logSimulationEvent('Simulated Market Data Mode ENABLED', { tickers: tickers.length });
  return createSimulatedMarketData(tickers);
};

const getIntradayPrice = (basePrice: number, dailyChangePercent: number, intradayHour: number): number => {
  const progress = intradayHour / 6;
  const intradayVariation = basePrice * dailyChangePercent * progress;
  const volatility = (Math.random() - 0.5) * 0.006;
  return basePrice + intradayVariation + (basePrice * volatility);
};

export const generateNextIntradayMarketData = async (previousMarketData: MarketData, day: number, intradayHour: number): Promise<MarketData> => {
  if (MODE === 'historical') {
    let tickers = Object.keys(previousMarketData);
    if (tickers.length === 0) {
      tickers = Object.keys(historicalDataCache);
    }
    if (tickers.length === 0) {
      tickers = S_P500_TICKERS;
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
    const tickers = Object.keys(previousMarketData);
    // Use cache for real-time updates (cache TTL is 1 minute, which matches our 10-minute update interval)
    const newMarketData = await fetchRealMarketDataWithCascade(tickers, true);
    
    // If cascade fails for some tickers, use previous data as fallback
    const result: MarketData = { ...previousMarketData };
    Object.keys(newMarketData).forEach(ticker => {
      if (newMarketData[ticker]) {
        result[ticker] = newMarketData[ticker];
      }
    });
    
    return result;
  }
  
  // Simulated mode
  const newMarketData: MarketData = {};
  Object.keys(previousMarketData).forEach(ticker => {
    const prevData = previousMarketData[ticker];
    const volatility = (Math.random() - 0.5) * 0.01;
    const intradayPrice = prevData.price * (1 + volatility);
    
    const prevPrice = prevData.price;
    const intradayChange = intradayPrice - prevPrice;
    
    newMarketData[ticker] = {
      ticker,
      price: intradayPrice,
      dailyChange: prevData.dailyChange + intradayChange,
      dailyChangePercent: prevPrice > 0 ? (intradayPrice - (prevPrice - prevData.dailyChange)) / (prevPrice - prevData.dailyChange) : 0,
    };
  });
  return newMarketData;
};

export const generateNextDayMarketData = async (previousMarketData: MarketData): Promise<MarketData> => {
  currentIntradayHour = 0;
  
  if (MODE === 'historical') {
    currentHistoricalDay++;
    const tickers = Object.keys(previousMarketData);
    const marketData: MarketData = {};
    
    tickers.forEach(ticker => {
      const historicalDays = historicalDataCache[ticker] || [];
      const dayData = historicalDays[currentHistoricalDay];
      
      if (dayData) {
        const prevDayData = historicalDays[currentHistoricalDay - 1];
        const dayOpenPrice = prevDayData ? prevDayData.price : dayData.price;
        marketData[ticker] = {
          ticker,
          price: dayOpenPrice,
          dailyChange: 0,
          dailyChangePercent: 0,
        };
      } else {
        const lastData = historicalDays[historicalDays.length - 1];
        if (lastData) {
          marketData[ticker] = {
            ticker,
            price: lastData.price,
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
      }
    });
    
    return marketData;
  } else if (MODE === 'realtime') {
    const tickers = Object.keys(previousMarketData);
    return await fetchRealMarketDataWithCascade(tickers);
  }
  
  // Simulated mode
  const newMarketData: MarketData = {};
  Object.keys(previousMarketData).forEach(ticker => {
    const prevData = previousMarketData[ticker];
    const newPrice = getNextPrice(prevData.price);
    const dailyChange = newPrice - prevData.price;
    const dailyChangePercent = dailyChange / prevData.price;

    newMarketData[ticker] = {
      ticker,
      price: newPrice,
      dailyChange,
      dailyChangePercent,
    };
  });
  return newMarketData;
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

