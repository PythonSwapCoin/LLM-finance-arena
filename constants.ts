
import type { Agent, Portfolio } from './types';

export const S_P500_TICKERS: string[] = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'BRK-B', 'JPM', 'JNJ',
  'V', 'UNH', 'PG', 'MA', 'HD', 'BAC', 'DIS', 'PFE', 'XOM', 'CVX'
];

export const INITIAL_CASH = 1000000;
export const RISK_FREE_RATE = 0.02; // Annual risk-free rate for Sharpe ratio
export const TRADING_DAYS_PER_YEAR = 252;
export const MAX_POSITION_SIZE_PERCENT = 0.10; // 10%
export const S_P500_BENCHMARK_ID = 'SPY';
export const AI_MANAGERS_INDEX_ID = 'AIMI';


const initialPortfolio: Portfolio = {
  cash: INITIAL_CASH,
  positions: {},
};

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'gemini-pro-balanced',
    name: 'Gemini Pro (Balanced)',
    model: 'gemini-2.5-pro',
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
  {
    id: 'gemini-flash-aggressive',
    name: 'Gemini Flash (Aggressive)',
    model: 'gemini-2.5-flash',
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
  {
    id: 'prudent-value-investor',
    name: 'Prudent Value Investor',
    model: 'gemini-2.5-pro',
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
    {
    id: 'momentum-trader-9000',
    name: 'Momentum Trader 9000',
    model: 'gemini-2.5-flash',
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  }
];
