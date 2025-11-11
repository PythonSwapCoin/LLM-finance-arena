import type { Agent, Portfolio } from './types.js';

export const S_P500_TICKERS: string[] = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'BRK-B', 'JPM', 'JNJ',
  'V', 'UNH', 'PG', 'MA', 'HD', 'BAC', 'DIS', 'PFE', 'XOM', 'CVX'
];

export const INITIAL_CASH = 10000;
export const RISK_FREE_RATE = 0.02;
export const TRADING_DAYS_PER_YEAR = 252;
export const MAX_POSITION_SIZE_PERCENT = 0.10;
export const S_P500_BENCHMARK_ID = 'SPY';
export const AI_MANAGERS_INDEX_ID = 'AIMI';
export const AGENT_COLORS = ['#8884d8', '#ffc658', '#82ca9d', '#ff8042', '#00C49F', '#0088FE', '#FF6B9D', '#C44569', '#6C5CE7', '#A29BFE'];
export const BENCHMARK_COLORS = {
  [S_P500_BENCHMARK_ID]: '#A3A3A3',
  [AI_MANAGERS_INDEX_ID]: '#F5F5F5'
};

const initialPortfolio: Portfolio = {
  cash: INITIAL_CASH,
  positions: {},
};

export const UNIFIED_SYSTEM_PROMPT = `You are a portfolio manager operating in an equity-trading environment.
Your goal is to maximize risk-adjusted returns while adhering to trading rules.
Evaluate market signals, sector performance, and stock momentum based on the provided data.
Maintain diversification and avoid excessive turnover.
Focus on quality companies with strong fundamentals.

CRITICAL REQUIREMENT: You MUST make trading decisions every day. You cannot hold 100% cash.
- If you have cash, you MUST buy stocks that meet your criteria
- You must invest at least 50% of your portfolio in stocks
- Being too conservative and holding cash is NOT acceptable - you are a portfolio manager, not a cash holder
- Make at least one trade per day when you have cash available
- Your job is to invest, not to wait`;

interface TraderConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  color?: string;
}

export const TRADER_CONFIGS: TraderConfig[] = [
  {
    id: 'gemini-balanced',
    name: 'Gemini 2.5 Flash',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'claude-prudent',
    name: 'Claude 3 haiku',
    model: 'anthropic/claude-3-haiku',
  },
  {
    id: 'grok-momentum',
    name: 'Grok 4 fast',
    model: 'x-ai/grok-4-fast',
  },
  {
    id: 'deepseek-analytical',
    name: 'DeepSeek Chat',
    model: 'deepseek/deepseek-chat',
  },
  {
    id: 'qwen-conservative',
    name: 'Qwen 2.5 72B',
    model: 'qwen/qwen-2.5-72b-instruct',
  },
];

const createAgentsFromConfigs = (configs: TraderConfig[]): Agent[] => {
  return configs.map((config, index) => ({
    id: config.id,
    name: config.name,
    model: config.model,
    color: config.color || AGENT_COLORS[index % AGENT_COLORS.length],
    portfolio: { ...initialPortfolio, positions: {} },
    tradeHistory: [],
    performanceHistory: [],
    rationale: 'Awaiting first trading day.',
    rationaleHistory: { 0: 'Awaiting first trading day.' },
    systemPrompt: config.systemPrompt || UNIFIED_SYSTEM_PROMPT,
  } as Agent & { systemPrompt: string }));
};

export const INITIAL_AGENTS: Agent[] = createAgentsFromConfigs(TRADER_CONFIGS);

