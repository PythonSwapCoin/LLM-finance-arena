import type { MarketData, TickerData } from '../types';
import { Ticker } from './yfinanceService';
import { logger, LogLevel, LogCategory } from './logger';
import { S_P500_TICKERS } from '../constants';

// Read environment variables with better logging
const USE_REAL_DATA_RAW = import.meta.env.VITE_USE_REAL_DATA;
const USE_HISTORICAL_SIMULATION_RAW = import.meta.env.VITE_USE_HISTORICAL_SIMULATION;
const USE_REAL_DATA = USE_REAL_DATA_RAW === 'true';
const USE_HISTORICAL_SIMULATION = USE_HISTORICAL_SIMULATION_RAW === 'true';
const ALPHA_VANTAGE_API_KEY = import.meta.env.VITE_ALPHA_VANTAGE_API_KEY;
const POLYGON_API_KEY = import.meta.env.VITE_POLYGON_API_KEY;

// Log environment variable detection for debugging
console.log('🔧 Environment Variables Detected:', {
  VITE_USE_REAL_DATA: USE_REAL_DATA_RAW,
  VITE_USE_HISTORICAL_SIMULATION: USE_HISTORICAL_SIMULATION_RAW,
  USE_REAL_DATA: USE_REAL_DATA,
  USE_HISTORICAL_SIMULATION: USE_HISTORICAL_SIMULATION,
  hasAlphaVantageKey: !!ALPHA_VANTAGE_API_KEY,
  hasPolygonKey: !!POLYGON_API_KEY,
});

// Warn if both modes are enabled (historical takes precedence)
if (USE_REAL_DATA && USE_HISTORICAL_SIMULATION) {
  console.warn('⚠️ Both VITE_USE_REAL_DATA and VITE_USE_HISTORICAL_SIMULATION are enabled. Historical simulation mode will take precedence.');
}

// Historical data cache for historical simulation mode
let historicalDataCache: { [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] } = {};
let historicalWeekStart: Date | null = null;
let historicalWeekEnd: Date | null = null;
let currentHistoricalDay = 0;
let currentIntradayHour = 0; // 0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6 (13 updates per day, every 30 minutes)
let lastTradingHour = 0; // Track when trading was last allowed (every 2 hours: 0, 2, 4, 6)

// Get historical simulation start date from env or use default (first week of 2025)
const getHistoricalSimulationStartDate = (): Date => {
  const startDateStr = import.meta.env.VITE_HISTORICAL_SIMULATION_START_DATE;
  if (startDateStr) {
    const date = new Date(startDateStr);
    if (!isNaN(date.getTime())) {
      // Ensure it's a Monday
      const dayOfWeek = date.getDay();
      const daysToMonday = dayOfWeek === 0 ? 1 : (dayOfWeek === 1 ? 0 : 8 - dayOfWeek);
      date.setDate(date.getDate() + daysToMonday);
      date.setHours(0, 0, 0, 0);
      return date;
    }
  }
  // Default: First Monday of 2025 (January 6, 2025)
  const defaultDate = new Date('2025-01-06');
  defaultDate.setHours(0, 0, 0, 0);
  return defaultDate;
};

// Export function to check if historical simulation should stop
export const isHistoricalSimulationComplete = (simulationDay?: number): boolean => {
  if (!USE_HISTORICAL_SIMULATION) return false;
  // Historical simulation has 5 days (Mon-Fri)
  // Day 0 = Monday (1st day)
  // Day 1 = Tuesday (2nd day)
  // Day 2 = Wednesday (3rd day)
  // Day 3 = Thursday (4th day)
  // Day 4 = Friday (5th day) - this is the last day
  // Day 5 = would be beyond the 5 days, so we stop
  // We want to process days 0-4 (5 days total), so stop when trying to go to day 5
  if (simulationDay !== undefined) {
    return simulationDay > 4; // Stop when trying to go beyond day 4
  }
  return currentHistoricalDay > 4; // Stop when trying to go beyond day 4
};

// Export function to get current mode
export const getSimulationMode = (): 'simulated' | 'real-time' | 'historical' => {
  if (USE_HISTORICAL_SIMULATION) return 'historical';
  if (USE_REAL_DATA) return 'real-time';
  return 'simulated';
};

// Export function to get historical simulation period info
export const getHistoricalSimulationPeriod = (): { start: Date | null, end: Date | null } => {
  return {
    start: historicalWeekStart,
    end: historicalWeekEnd,
  };
};

// Function to generate a somewhat realistic random walk for stock prices (for simulation mode)
const getNextPrice = (currentPrice: number): number => {
  const volatility = 0.035; // Max 3.5% change per day for more exciting charts
  const trend = 0.0005; // Slight upward bias
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = currentPrice * (1 + randomChange + trend);
  return Math.max(newPrice, 1); // Prevent price from going to zero
};

// Validate market data for sanity
const validateMarketData = (data: TickerData): boolean => {
  // Price should be positive and reasonable
  if (!data.price || data.price <= 0 || data.price > 100000) {
    return false;
  }
  // Daily change percent should be reasonable (not more than 50% in a day)
  if (Math.abs(data.dailyChangePercent) > 0.5) {
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, `Suspicious daily change for ${data.ticker}: ${(data.dailyChangePercent * 100).toFixed(2)}%`, { ticker: data.ticker, changePercent: data.dailyChangePercent });
    // Don't reject, just warn - some stocks can move 50%+
  }
  return true;
};

// Fetch from Yahoo Finance using yfinance-like service with full financial data
const fetchYahooFinanceData = async (ticker: string): Promise<TickerData | null> => {
  const startTime = Date.now();
  try {
    const yfTicker = new Ticker(ticker);
    // Fetch both fast info (price) and detailed info (financial metrics)
    const [fastInfo, detailedInfo] = await Promise.all([
      yfTicker.fastInfo().catch(() => null),
      yfTicker.info().catch(() => null),
    ]);
    
    const responseTime = Date.now() - startTime;
    
    if (!fastInfo) {
      throw new Error('Failed to fetch price data');
    }
    
    const tickerData: TickerData = {
      ticker,
      price: fastInfo.price,
      dailyChange: fastInfo.change,
      dailyChangePercent: fastInfo.changePercent,
    };
    
    // Add financial metrics if available
    if (detailedInfo) {
      tickerData.trailingPE = detailedInfo.trailingPE;
      tickerData.forwardPE = detailedInfo.forwardPE;
      tickerData.priceToBook = detailedInfo.priceToBook;
      tickerData.priceToSales = detailedInfo.priceToSales;
      tickerData.enterpriseValue = detailedInfo.enterpriseValue;
      tickerData.enterpriseToRevenue = detailedInfo.enterpriseToRevenue;
      tickerData.enterpriseToEbitda = detailedInfo.enterpriseToEbitda;
      tickerData.beta = detailedInfo.beta;
      tickerData.marketCap = detailedInfo.marketCap;
      tickerData.volume = detailedInfo.regularMarketVolume;
      tickerData.averageVolume = detailedInfo.averageVolume;
      tickerData.profitMargins = detailedInfo.profitMargins;
      tickerData.grossMargins = detailedInfo.grossMargins;
      tickerData.operatingMargins = detailedInfo.operatingMargins;
      tickerData.debtToEquity = detailedInfo.debtToEquity;
      tickerData.dividendYield = detailedInfo.dividendYield;
      tickerData.payoutRatio = detailedInfo.payoutRatio;
      tickerData.fiftyTwoWeekChange = detailedInfo.fiftyTwoWeekChange;
      tickerData.dayHigh = detailedInfo.dayHigh;
      tickerData.dayLow = detailedInfo.dayLow;
      tickerData.fiftyTwoWeekHigh = detailedInfo.fiftyTwoWeekHigh;
      tickerData.fiftyTwoWeekLow = detailedInfo.fiftyTwoWeekLow;
      tickerData.sector = detailedInfo.sector;
      tickerData.industry = detailedInfo.industry;
      tickerData.longName = detailedInfo.longName;
    }
    
    // Validate the data
    if (!validateMarketData(tickerData)) {
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, `Invalid market data for ${ticker}, using fallback`, { ticker, price: tickerData.price });
      // Return basic data even if validation fails
    }
    
    logger.logMarketData('Yahoo Finance', ticker, true, tickerData.price);
    logger.logApiCall('Yahoo Finance', `info/${ticker}`, true, 200, undefined, responseTime);
    
    return tickerData;
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.logMarketData('Yahoo Finance', ticker, false, undefined, error);
    logger.logApiCall('Yahoo Finance', `info/${ticker}`, false, undefined, error, responseTime);
    console.error(`Error fetching Yahoo Finance data for ${ticker}:`, error);
    return null;
  }
};

// Cascade: Try Yahoo Finance first (default, no API key needed) -> Alpha Vantage -> Polygon
const fetchRealMarketDataWithCascade = async (tickers: string[]): Promise<MarketData> => {
  const marketData: MarketData = {};
  
  for (const ticker of tickers) {
    let tickerData: TickerData | null = null;
    let sourceUsed = '';
    
    // Try Yahoo Finance first (default, no API key needed)
    try {
      tickerData = await fetchYahooFinanceData(ticker);
      if (tickerData) {
        sourceUsed = 'Yahoo Finance';
      }
    } catch (error) {
      console.warn(`Yahoo Finance failed for ${ticker}, trying next source...`);
    }
    
    // Try Alpha Vantage if Yahoo Finance didn't work
    if (!tickerData && ALPHA_VANTAGE_API_KEY) {
      const startTime = Date.now();
      try {
        const endpoint = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_API_KEY}`;
        const response = await fetch(endpoint);
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
          const data = await response.json();
          
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
          } else {
            logger.logMarketData('Alpha Vantage', ticker, false, undefined, 'No price data in response');
            logger.logApiCall('Alpha Vantage', 'GLOBAL_QUOTE', false, response.status, 'No price data in response', responseTime);
          }
        } else {
          logger.logMarketData('Alpha Vantage', ticker, false, undefined, `HTTP ${response.status}`);
          logger.logApiCall('Alpha Vantage', 'GLOBAL_QUOTE', false, response.status, `HTTP ${response.status}`, responseTime);
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.logMarketData('Alpha Vantage', ticker, false, undefined, error);
        logger.logApiCall('Alpha Vantage', 'GLOBAL_QUOTE', false, undefined, error, responseTime);
        console.warn(`Alpha Vantage failed for ${ticker}, trying next source...`);
      }
    }
    
    // Try Polygon if previous sources didn't work
    if (!tickerData && POLYGON_API_KEY) {
      const startTime = Date.now();
      try {
        const endpoint = `https://api.polygon.io/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
        const response = await fetch(endpoint);
        const responseTime = Date.now() - startTime;
        
        if (response.ok) {
          const data = await response.json();
          
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
          } else {
            logger.logMarketData('Polygon.io', ticker, false, undefined, 'No results in response');
            logger.logApiCall('Polygon.io', 'prev', false, response.status, 'No results in response', responseTime);
          }
        } else {
          logger.logMarketData('Polygon.io', ticker, false, undefined, `HTTP ${response.status}`);
          logger.logApiCall('Polygon.io', 'prev', false, response.status, `HTTP ${response.status}`, responseTime);
        }
      } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.logMarketData('Polygon.io', ticker, false, undefined, error);
        logger.logApiCall('Polygon.io', 'prev', false, undefined, error, responseTime);
        console.warn(`Polygon failed for ${ticker}`);
      }
    }
    
    // Fallback to simulated if all sources fail
    if (!tickerData) {
      const fallbackPrice = 50 + Math.random() * 250;
      tickerData = {
        ticker,
        price: fallbackPrice,
        dailyChange: 0,
        dailyChangePercent: 0,
      };
      sourceUsed = 'Simulated (fallback)';
      logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, `All data sources failed for ${ticker}, using simulated data`, { ticker, fallbackPrice });
      console.warn(`All data sources failed for ${ticker}, using simulated data`);
    }
    
    if (sourceUsed && ticker === tickers[0]) {
      console.log(`📊 Data source for ${ticker}: ${sourceUsed}`);
    }
    
    marketData[ticker] = tickerData;
    
    // Rate limiting: wait between requests
    if (tickers.length > 5) {
      await new Promise(resolve => setTimeout(resolve, 200)); // Small delay between tickers
    }
  }
  
  return marketData;
};

// Fetch historical data for specified week (Mon-Fri)
const fetchHistoricalWeekData = async (tickers: string[]): Promise<{ [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] }> => {
  const historicalData: { [ticker: string]: { date: string, price: number, change: number, changePercent: number }[] } = {};
  
  // Get the start date (default: first week of 2025)
  const weekStart = getHistoricalSimulationStartDate();
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 4); // Friday (4 days after Monday)
  weekEnd.setHours(23, 59, 59, 999);
  
  historicalWeekStart = weekStart;
  historicalWeekEnd = weekEnd;
  currentHistoricalDay = 0;
  
  console.log(`📅 Historical Simulation Period: ${weekStart.toISOString().split('T')[0]} to ${weekEnd.toISOString().split('T')[0]} (Mon-Fri)`);
  
  // Fetch 5 days of data (Mon-Fri) for each ticker using yfinance service
  for (const ticker of tickers) {
    historicalData[ticker] = [];
    
    // Try to fetch historical data from Yahoo Finance using yfinance service
    try {
      const yfTicker = new Ticker(ticker);
      // Fetch data with some buffer before and after to ensure we get the full week
      const startDate = new Date(weekStart);
      startDate.setDate(weekStart.getDate() - 2); // Start a bit earlier
      const endDate = new Date(weekEnd);
      endDate.setDate(weekEnd.getDate() + 2); // End a bit later
      
      const history = await yfTicker.history({
        start: startDate,
        end: endDate,
        interval: '1d',
      });
      
      // Filter for the 5 trading days of the specified week (Mon-Fri)
      let weekData: { date: string, price: number, change: number, changePercent: number }[] = [];
      let prevClose: number | null = null;
      
      for (const point of history) {
        const date = point.date;
        const dateOnly = new Date(date);
        dateOnly.setHours(0, 0, 0, 0);
        
        // Check if this date is within the specified week (Mon-Fri)
        if (dateOnly >= weekStart && dateOnly <= weekEnd) {
          const dayOfWeek = dateOnly.getDay();
          if (dayOfWeek >= 1 && dayOfWeek <= 5) { // Monday to Friday
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
      
      // Sort by date and take first 5
      weekData.sort((a, b) => a.date.localeCompare(b.date));
      weekData = weekData.slice(0, 5);
      
      if (weekData.length > 0) {
        historicalData[ticker] = weekData;
        logger.logMarketData('Yahoo Finance (Historical)', ticker, true, weekData[0].price);
        continue;
      } else {
        logger.logMarketData('Yahoo Finance (Historical)', ticker, false, undefined, 'No data found for specified week');
      }
    } catch (error) {
      logger.logMarketData('Yahoo Finance (Historical)', ticker, false, undefined, error);
      console.warn(`Error fetching historical data for ${ticker}:`, error);
    }
    
    // Fallback: generate simulated historical data
    logger.log(LogLevel.WARNING, LogCategory.MARKET_DATA, `Using simulated historical data for ${ticker}`, { ticker });
    const basePrice = 50 + Math.random() * 250;
    // Ensure we have data for all 5 days
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

// Fetch real market data (current implementation with cascade)
const fetchRealMarketData = async (tickers: string[]): Promise<MarketData> => {
  return await fetchRealMarketDataWithCascade(tickers);
};

// Create simulated market data (original implementation)
const createSimulatedMarketData = (tickers: string[]): MarketData => {
  const marketData: MarketData = {};
  tickers.forEach(ticker => {
    const initialPrice = 50 + Math.random() * 250; // Initial price between 50 and 300
    marketData[ticker] = {
      ticker,
      price: initialPrice,
      dailyChange: 0,
      dailyChangePercent: 0,
    };
  });
  return marketData;
};

export const createInitialMarketData = async (tickers: string[]): Promise<MarketData> => {
  // Historical simulation mode takes precedence
  if (USE_HISTORICAL_SIMULATION) {
    console.log('📊 ✅ Historical Simulation Mode ENABLED (last week\'s real data)');
    console.log('📊 Mode will run for 5 days (Mon-Fri) and auto-stop');
    logger.logSimulationEvent('Historical Simulation Mode ENABLED', { tickers: tickers.length });
    // Historical simulation mode: fetch last week's data
    // Reset cache and day counter
    historicalDataCache = {};
    currentHistoricalDay = 0;
    historicalDataCache = await fetchHistoricalWeekData(tickers);
    
    // Return Monday's data
    const marketData: MarketData = {};
    tickers.forEach(ticker => {
      const dayData = historicalDataCache[ticker]?.[0];
      if (dayData) {
        marketData[ticker] = {
          ticker,
          price: dayData.price,
          dailyChange: 0, // First day has no change
          dailyChangePercent: 0,
        };
      } else {
        // Fallback
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
  } else if (USE_REAL_DATA) {
    console.log('📊 ✅ Real-Time Market Data Mode ENABLED');
    console.log('📊 Data source order: Yahoo Finance → Alpha Vantage → Polygon.io');
    logger.logSimulationEvent('Real-Time Market Data Mode ENABLED', { tickers: tickers.length });
    return await fetchRealMarketData(tickers);
  }
  console.log('📊 ✅ Simulated Market Data Mode (Default)');
  console.log('📊 Using randomly generated market data');
  logger.logSimulationEvent('Simulated Market Data Mode ENABLED', { tickers: tickers.length });
  return createSimulatedMarketData(tickers);
};

// Generate intraday price variation (simulates price movement within a day)
const getIntradayPrice = (basePrice: number, dailyChangePercent: number, intradayHour: number): number => {
  // Simulate intraday price movement: start at open, move toward close
  // intradayHour: 0 (market open), 2, 4, 6 (market close)
  // Progress from 0% to 100% of daily change
  const progress = intradayHour / 6; // 0, 0.083, 0.167, 0.25, 0.33, 0.417, 0.5, 0.583, 0.67, 0.75, 0.833, 0.917, 1.0
  const intradayVariation = basePrice * dailyChangePercent * progress;
  // Add some random intraday volatility (±0.3% for more realistic movement)
  const volatility = (Math.random() - 0.5) * 0.006;
  return basePrice + intradayVariation + (basePrice * volatility);
};

export const generateNextIntradayMarketData = async (previousMarketData: MarketData, day: number, intradayHour: number): Promise<MarketData> => {
  if (USE_HISTORICAL_SIMULATION) {
    // Historical simulation: use cached historical data with intraday variation
    // Get tickers from previousMarketData, or from historical cache, or fallback to constants
    let tickers = Object.keys(previousMarketData);
    if (tickers.length === 0) {
      // If previousMarketData is empty, get tickers from historical cache
      tickers = Object.keys(historicalDataCache);
    }
    if (tickers.length === 0) {
      // Final fallback: use the ticker list from constants
      tickers = S_P500_TICKERS;
      console.warn('No tickers in previousMarketData or cache, using S_P500_TICKERS as fallback');
    }
    
    if (tickers.length === 0) {
      console.error('No tickers available for intraday market data generation - this should not happen');
      return previousMarketData; // Return previous data if we have nothing
    }
    
    const marketData: MarketData = {};
    
    tickers.forEach(ticker => {
      const historicalDays = historicalDataCache[ticker] || [];
      const dayData = historicalDays[day];
      
      if (dayData) {
        // Get the day's opening price (from previous day's close or current day's first price)
        const prevDayData = historicalDays[day - 1];
        const dayOpenPrice = prevDayData ? prevDayData.price : dayData.price;
        const dayClosePrice = dayData.price;
        const dailyChangePercent = dayData.changePercent;
        
        // Calculate intraday price - interpolate between open and close
        const intradayPrice = getIntradayPrice(dayOpenPrice, dailyChangePercent, intradayHour);
        
        // Calculate change from previous intraday update (or from open if first update)
        const prevPrice = previousMarketData[ticker]?.price || dayOpenPrice;
        const intradayChange = intradayPrice - prevPrice;
        const intradayChangePercent = prevPrice > 0 ? intradayChange / prevPrice : 0;
        
        marketData[ticker] = {
          ticker,
          price: intradayPrice,
          dailyChange: intradayPrice - dayOpenPrice, // Change from day open
          dailyChangePercent: dayOpenPrice > 0 ? (intradayPrice - dayOpenPrice) / dayOpenPrice : 0,
        };
      } else {
        // Fallback: use previous price with small variation
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
  } else if (USE_REAL_DATA) {
    // For real data, fetch fresh data (intraday updates would require real-time API)
    const tickers = Object.keys(previousMarketData);
    return await fetchRealMarketData(tickers);
  }
  
  // Simulated mode: generate intraday price variation
  const newMarketData: MarketData = {};
  Object.keys(previousMarketData).forEach(ticker => {
    const prevData = previousMarketData[ticker];
    // For simulated mode, add small intraday variation
    const volatility = (Math.random() - 0.5) * 0.01; // ±0.5% intraday volatility
    const intradayPrice = prevData.price * (1 + volatility);
    
    // Calculate change from previous update
    const prevPrice = prevData.price;
    const intradayChange = intradayPrice - prevPrice;
    
    newMarketData[ticker] = {
      ticker,
      price: intradayPrice,
      dailyChange: prevData.dailyChange + intradayChange, // Accumulate daily change
      dailyChangePercent: prevPrice > 0 ? (intradayPrice - (prevPrice - prevData.dailyChange)) / (prevPrice - prevData.dailyChange) : 0,
    };
  });
  return newMarketData;
};

export const generateNextDayMarketData = async (previousMarketData: MarketData): Promise<MarketData> => {
  // Reset intraday hour when starting a new day
  currentIntradayHour = 0;
  
  if (USE_HISTORICAL_SIMULATION) {
    // Historical simulation: use next day from cached historical data
    currentHistoricalDay++;
    const tickers = Object.keys(previousMarketData);
    const marketData: MarketData = {};
    
    tickers.forEach(ticker => {
      const historicalDays = historicalDataCache[ticker] || [];
      const dayData = historicalDays[currentHistoricalDay];
      
      if (dayData) {
        const prevDayData = historicalDays[currentHistoricalDay - 1];
        const dayOpenPrice = prevDayData ? prevDayData.price : dayData.price;
        // Start of day: price at open (intradayHour = 0)
        marketData[ticker] = {
          ticker,
          price: dayOpenPrice,
          dailyChange: 0, // No change at market open
          dailyChangePercent: 0,
        };
      } else {
        // If we've run out of historical data, use the last known price
        const lastData = historicalDays[historicalDays.length - 1];
        if (lastData) {
          marketData[ticker] = {
            ticker,
            price: lastData.price,
            dailyChange: 0,
            dailyChangePercent: 0,
          };
        } else {
          // Fallback
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
  } else if (USE_REAL_DATA) {
    // Fetch fresh real market data
    const tickers = Object.keys(previousMarketData);
    return await fetchRealMarketData(tickers);
  }
  
  // Simulated mode: generate next day data
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

// Export function to advance intraday hour (every 30 minutes)
// Returns the new hour and whether we should advance to the next day
export const advanceIntradayHour = (): { hour: number; shouldAdvanceDay: boolean } => {
  currentIntradayHour += 0.5; // 30 minutes = 0.5 hours
  const shouldAdvanceDay = currentIntradayHour >= 6.5;
  if (shouldAdvanceDay) {
    currentIntradayHour = 0; // Reset for next day
  }
  return { hour: currentIntradayHour, shouldAdvanceDay };
};

// Check if trading is allowed (only every 2 hours: 0, 2, 4, 6)
export const isTradingAllowed = (): boolean => {
  const currentHour = Math.floor(currentIntradayHour);
  // Allow trading at hours 0, 2, 4, 6 (every 2 hours)
  if (currentHour !== lastTradingHour && currentHour % 2 === 0 && currentHour <= 6) {
    lastTradingHour = currentHour;
    return true;
  }
  return false;
};

// Export function to get current intraday hour
export const getCurrentIntradayHour = (): number => {
  return currentIntradayHour;
};