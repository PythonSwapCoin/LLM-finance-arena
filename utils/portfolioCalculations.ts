
import type { Portfolio, MarketData, PerformanceMetrics, Trade } from '../types';
import { INITIAL_CASH, RISK_FREE_RATE, TRADING_DAYS_PER_YEAR } from '../constants';

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
  const totalValue = calculatePortfolioValue(portfolio, marketData);
  const totalReturn = (totalValue / INITIAL_CASH) - 1;
  
  const prevValue = history.length > 0 ? history[history.length - 1].totalValue : INITIAL_CASH;
  const dailyReturn = history.length > 0 ? (totalValue / prevValue) - 1 : 0;

  const dailyReturns = [...history.map(h => h.dailyReturn), dailyReturn];

  // Volatility
  const meanReturn = dailyReturns.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const squaredDiffs = dailyReturns.map(r => Math.pow(r - meanReturn, 2));
  const variance = squaredDiffs.reduce((a, b) => a + b, 0) / dailyReturns.length;
  const dailyVolatility = Math.sqrt(variance);
  const annualizedVolatility = dailyVolatility * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Sharpe Ratio
  const excessReturns = dailyReturns.map(r => r - (RISK_FREE_RATE / TRADING_DAYS_PER_YEAR));
  const avgExcessReturn = excessReturns.reduce((a, b) => a + b, 0) / excessReturns.length;
  const sharpeRatio = (avgExcessReturn / dailyVolatility) * Math.sqrt(TRADING_DAYS_PER_YEAR) || 0;

  // Max Drawdown
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

  // Turnover
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
