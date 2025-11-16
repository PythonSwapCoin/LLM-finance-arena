import type { Portfolio, MarketData, PerformanceMetrics, Trade } from '../types.js';
import { INITIAL_CASH, RISK_FREE_RATE, TRADING_DAYS_PER_YEAR } from '../constants.js';

const getDayIdentifier = (timestamp: number): string => {
  if (!Number.isFinite(timestamp)) {
    return 'unknown';
  }

  if (timestamp > 1_000_000_000) {
    const date = new Date(timestamp * 1000);
    return `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
  }

  return Math.floor(timestamp).toString();
};

export const calculatePortfolioValue = (portfolio: Portfolio, marketData: MarketData): number => {
  const positionsValue = Object.values(portfolio.positions).reduce((acc, position) => {
    const currentPrice = marketData[position.ticker]?.price || 0;
    return acc + position.quantity * currentPrice;
  }, 0);
  return portfolio.cash + positionsValue;
};

export const calculateAllMetrics = (
  portfolio: Portfolio,
  marketData: MarketData,
  history: PerformanceMetrics[],
  day: number,
  dailyTrades: Trade[] = []
): PerformanceMetrics => {
  // Calculate total portfolio value using current prices - this is the robust approach
  const totalValue = calculatePortfolioValue(portfolio, marketData);
  const totalReturn = (totalValue / INITIAL_CASH) - 1;
  
  // Calculate daily return: use the previous entry's totalValue (which is based on prices)
  // This is simpler and more robust than trying to find "different day" entries
  // The previous entry's totalValue is always calculated from prices, so this is correct
  let dailyReturn: number;
  if (history.length === 0) {
    // First entry: no daily return yet
    dailyReturn = 0;
  } else {
    const prevValue = history[history.length - 1].totalValue;
    if (prevValue > 0) {
      // Calculate return from previous entry's value (which was calculated from prices)
      dailyReturn = (totalValue / prevValue) - 1;
    } else {
      // Edge case: prevValue is 0 or invalid
      dailyReturn = 0;
    }
  }

  const dailyReturns = [...history.map(h => h.dailyReturn), dailyReturn];

  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const squaredDiffs = dailyReturns.map(r => Math.pow(r - meanReturn, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

  const excessReturns = dailyReturns.map(r => r - (RISK_FREE_RATE / TRADING_DAYS_PER_YEAR));
  const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const sharpeRatio = (avgExcessReturn / dailyVolatility) * Math.sqrt(TRADING_DAYS_PER_YEAR) || 0;

  const portfolioValues = [...history.map(h => h.totalValue), totalValue];
  let peak = -Infinity;
  let maxDrawdown = 0;
  portfolioValues.forEach(value => {
    if (value > peak) {
      peak = value;
    }
    const drawdown = (peak - value) / peak;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });

  const tradedValue = dailyTrades.reduce((acc, trade) => acc + trade.quantity * trade.price, 0);
  const turnover = totalValue > 0 ? tradedValue / totalValue : 0;

  return {
    totalValue,
    totalReturn,
    dailyReturn,
    annualizedVolatility,
    sharpeRatio,
    maxDrawdown,
    turnover,
    timestamp: day,
  };
};

