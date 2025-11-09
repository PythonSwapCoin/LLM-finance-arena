import { S_P500_TICKERS } from '../types.js';

// Environment variables (from Vercel env)
const USE_REAL_DATA = process.env.USE_REAL_DATA === 'true';
const USE_HISTORICAL_SIMULATION = process.env.USE_HISTORICAL_SIMULATION === 'true';
const ALPHA_VANTAGE_API_KEY = process.env.ALPHA_VANTAGE_API_KEY;
const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

// State variables
let historicalDataCache = {};
let historicalWeekStart = null;
let historicalWeekEnd = null;
let currentHistoricalDay = 0;
let currentIntradayHour = 0;
let lastTradingHour = 0;

// Get historical simulation start date
const getHistoricalSimulationStartDate = () => {
  const startDateStr = process.env.HISTORICAL_SIMULATION_START_DATE;
  if (startDateStr) {
    const date = new Date(startDateStr);
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

// Fetch from Yahoo Finance using CORS proxy
const fetchYahooFinanceData = async (ticker) => {
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=summaryProfile,price,defaultKeyStatistics,financialData`;
    const proxies = [
      `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      `https://corsproxy.io/?${encodeURIComponent(url)}`,
    ];
    
    for (const proxyUrl of proxies) {
      try {
        const response = await fetch(proxyUrl, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(10000),
        });
        
        if (response.ok) {
          const data = await response.json();
          const result = data.quoteSummary?.result?.[0];
          if (!result) continue;

          const price = result.price || {};
          const stats = result.defaultKeyStatistics || {};
          const financialData = result.financialData || {};
          const summary = result.summaryProfile || {};

          const getRaw = (obj, key) => obj?.[key]?.raw ?? obj?.[key];

          return {
            ticker,
            price: getRaw(price, 'regularMarketPrice') || price.regularMarketPrice,
            dailyChange: getRaw(price, 'regularMarketChange') || price.regularMarketChange || 0,
            dailyChangePercent: getRaw(price, 'regularMarketChangePercent') || price.regularMarketChangePercent || 0,
            trailingPE: getRaw(stats, 'trailingPE'),
            forwardPE: getRaw(stats, 'forwardPE'),
            priceToBook: getRaw(stats, 'priceToBook'),
            priceToSales: getRaw(stats, 'priceToSalesTrailing12Months'),
            beta: getRaw(stats, 'beta'),
            marketCap: getRaw(price, 'marketCap'),
            dividendYield: getRaw(stats, 'dividendYield'),
            sector: summary.sector,
            industry: summary.industry,
            longName: price.longName || summary.longName,
          };
        }
      } catch (error) {
        continue;
      }
    }
    return null;
  } catch (error) {
    console.error(`Error fetching Yahoo Finance data for ${ticker}:`, error);
    return null;
  }
};

// Fetch real market data
export const fetchRealMarketData = async (tickers) => {
  const marketData = {};
  
  for (const ticker of tickers) {
    const data = await fetchYahooFinanceData(ticker);
    if (data) {
      marketData[ticker] = data;
    } else {
      // Fallback to simulated data
      const fallbackPrice = 50 + Math.random() * 250;
      marketData[ticker] = {
        ticker,
        price: fallbackPrice,
        dailyChange: 0,
        dailyChangePercent: 0,
      };
    }
  }
  
  return marketData;
};

// Generate simulated market data
const createSimulatedMarketData = (tickers) => {
  const marketData = {};
  tickers.forEach(ticker => {
    const basePrice = 50 + Math.random() * 250;
    marketData[ticker] = {
      ticker,
      price: basePrice,
      dailyChange: 0,
      dailyChangePercent: 0,
    };
  });
  return marketData;
};

// Get next price for simulated mode
const getNextPrice = (currentPrice) => {
  const volatility = 0.035;
  const trend = 0.0005;
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = currentPrice * (1 + randomChange + trend);
  return Math.max(newPrice, 1);
};

// Create initial market data
export const createInitialMarketData = async (tickers) => {
  if (USE_HISTORICAL_SIMULATION) {
    // Historical mode - fetch historical data
    historicalDataCache = {};
    currentHistoricalDay = 0;
    // For now, use real data as historical
    return await fetchRealMarketData(tickers);
  } else if (USE_REAL_DATA) {
    return await fetchRealMarketData(tickers);
  }
  return createSimulatedMarketData(tickers);
};

// Generate next day market data
export const generateNextDayMarketData = async (previousMarketData) => {
  currentIntradayHour = 0;
  lastTradingHour = 0;
  
  if (USE_HISTORICAL_SIMULATION) {
    currentHistoricalDay++;
    // Use cached historical data or fetch new
    return await fetchRealMarketData(Object.keys(previousMarketData));
  } else if (USE_REAL_DATA) {
    return await fetchRealMarketData(Object.keys(previousMarketData));
  }
  
  // Simulated mode
  const newMarketData = {};
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

// Generate next intraday market data
export const generateNextIntradayMarketData = async (previousMarketData, day, intradayHour) => {
  if (USE_REAL_DATA) {
    // For real data, fetch fresh data
    return await fetchRealMarketData(Object.keys(previousMarketData));
  }
  
  // Simulated mode: generate intraday variation
  const newMarketData = {};
  Object.keys(previousMarketData).forEach(ticker => {
    const prevData = previousMarketData[ticker];
    const volatility = (Math.random() - 0.5) * 0.01;
    const intradayPrice = prevData.price * (1 + volatility);
    newMarketData[ticker] = {
      ticker,
      price: intradayPrice,
      dailyChange: prevData.dailyChange + (intradayPrice - prevData.price),
      dailyChangePercent: prevData.dailyChangePercent,
    };
  });
  return newMarketData;
};

// Advance intraday hour
export const advanceIntradayHour = () => {
  currentIntradayHour += 0.5;
  const shouldAdvanceDay = currentIntradayHour >= 6.5;
  if (shouldAdvanceDay) {
    currentIntradayHour = 0;
    lastTradingHour = 0;
  }
  return { hour: currentIntradayHour, shouldAdvanceDay };
};

// Check if trading is allowed
export const isTradingAllowed = () => {
  const currentHour = Math.floor(currentIntradayHour);
  if (currentHour !== lastTradingHour && currentHour % 2 === 0 && currentHour <= 6) {
    lastTradingHour = currentHour;
    return true;
  }
  return false;
};

// Get current intraday hour
export const getCurrentIntradayHour = () => {
  return currentIntradayHour;
};

// Check if historical simulation is complete
export const isHistoricalSimulationComplete = (simulationDay) => {
  if (!USE_HISTORICAL_SIMULATION) return false;
  if (simulationDay !== undefined) {
    return simulationDay > 4;
  }
  return currentHistoricalDay > 4;
};

// Get simulation mode
export const getSimulationMode = () => {
  if (USE_HISTORICAL_SIMULATION) return 'historical';
  if (USE_REAL_DATA) return 'real-time';
  return 'simulated';
};

