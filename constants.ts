import type { Agent, Portfolio } from './types';

export const S_P500_TICKERS: string[] = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'BRK-B', 'JPM', 'JNJ',
  'V', 'UNH', 'PG', 'MA', 'HD', 'BAC', 'DIS', 'PFE', 'XOM', 'CVX'
];

export const INITIAL_CASH = 10000;
export const RISK_FREE_RATE = 0.02; // Annual risk-free rate for Sharpe ratio
export const TRADING_DAYS_PER_YEAR = 252;
export const MAX_POSITION_SIZE_PERCENT = 0.10; // 10%
export const S_P500_BENCHMARK_ID = 'SPY';
export const AI_MANAGERS_INDEX_ID = 'AIMI';
export const AGENT_COLORS = ['#8884d8', '#ffc658', '#82ca9d', '#ff8042', '#00C49F', '#0088FE' ];
export const BENCHMARK_COLORS = {
    [S_P500_BENCHMARK_ID]: '#A3A3A3',
    [AI_MANAGERS_INDEX_ID]: '#F5F5F5'
}

const initialPortfolio: Portfolio = {
  cash: INITIAL_CASH,
  positions: {},
};

export const INITIAL_AGENTS: Agent[] = [
  {
    id: 'gemini-pro-balanced',
    name: 'Gemini 2.5 Pro',
    model: 'gemini-2.5-pro',
    color: AGENT_COLORS[0],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
  {
    id: 'gemini-flash-aggressive',
    name: 'Gemini 2.5 Flash',
    model: 'gemini-2.5-flash',
    color: AGENT_COLORS[1],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
  {
    id: 'prudent-value-investor',
    name: 'Claude 4.5 Sonnet',
    model: 'gemini-2.5-pro',
    color: AGENT_COLORS[2],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
    {
    id: 'momentum-trader-9000',
    name: 'Grok 4',
    model: 'gemini-2.5-flash',
    color: AGENT_COLORS[3],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
   {
    id: 'deepseek-standin',
    name: 'DeepSeek V3.1',
    model: 'gemini-2.5-pro',
    color: AGENT_COLORS[4],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  },
  {
    id: 'qwen-standin',
    name: 'Qwen 3 Max',
    model: 'gemini-2.5-flash',
    color: AGENT_COLORS[5],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
  }
];