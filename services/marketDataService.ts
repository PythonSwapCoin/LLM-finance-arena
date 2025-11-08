
import type { MarketData, TickerData } from '../types';

// Function to generate a somewhat realistic random walk for stock prices
const getNextPrice = (currentPrice: number): number => {
  const volatility = 0.02; // Max 2% change per day
  const trend = 0.0005; // Slight upward bias
  const randomChange = (Math.random() - 0.5) * 2 * volatility;
  const newPrice = currentPrice * (1 + randomChange + trend);
  return Math.max(newPrice, 1); // Prevent price from going to zero
};

export const createInitialMarketData = (tickers: string[]): MarketData => {
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

export const generateNextDayMarketData = (previousMarketData: MarketData): MarketData => {
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
