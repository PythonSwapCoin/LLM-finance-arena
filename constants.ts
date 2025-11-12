import type { Agent, Portfolio } from './types';

const DEFAULT_TICKERS: string[] = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'META', 'BRK-B', 'JPM', 'JNJ',
  'V', 'UNH', 'PG', 'MA', 'HD', 'BAC', 'DIS', 'PFE', 'XOM', 'CVX'
];

const parseTickers = (rawList: string | undefined | null): string[] => {
  if (!rawList) {
    return [];
  }
  return rawList
    .split(',')
    .map(ticker => ticker.trim().toUpperCase())
    .filter(Boolean);
};

const configuredTickers = parseTickers(import.meta.env.VITE_ARENA_TICKERS || import.meta.env.VITE_S_P500_TICKERS);

export const S_P500_TICKERS: string[] = configuredTickers.length > 0 ? configuredTickers : DEFAULT_TICKERS;

export const INITIAL_CASH = 10000;
export const RISK_FREE_RATE = 0.02; // Annual risk-free rate for Sharpe ratio
export const TRADING_DAYS_PER_YEAR = 252;
export const MAX_POSITION_SIZE_PERCENT = 0.10; // 10%
export const S_P500_BENCHMARK_ID = 'SPY';
export const AI_MANAGERS_INDEX_ID = 'AIMI';
export const AGENT_COLORS = ['#8884d8', '#ffc658', '#82ca9d', '#ff8042', '#00C49F', '#0088FE', '#FF6B9D', '#C44569', '#6C5CE7', '#A29BFE'];
export const BENCHMARK_COLORS = {
    [S_P500_BENCHMARK_ID]: '#A3A3A3',
    [AI_MANAGERS_INDEX_ID]: '#F5F5F5'
}

const initialPortfolio: Portfolio = {
  cash: INITIAL_CASH,
  positions: {},
};

// ============================================================================
// TRADER CONFIGURATION
// ============================================================================
// To add a new trader, simply add a new entry to TRADER_CONFIGS below.
// Each trader needs:
//   - id: unique identifier (used internally)
//   - name: display name (shown in UI)
//   - model: OpenRouter model identifier (e.g., 'google/gemini-2.0-flash-exp:free')
//   - systemPrompt: custom trading strategy/personality prompt (optional - will use UNIFIED_SYSTEM_PROMPT if not provided)
//   - color: hex color for charts (optional, will auto-assign if not provided)
//
// Popular OpenRouter models:
//   - 'google/gemini-2.0-flash-exp:free' (free tier, may have rate limits)
//   - 'google/gemini-pro-1.5'
//   - 'anthropic/claude-3.5-sonnet'
//   - 'anthropic/claude-3-opus'
//   - 'openai/gpt-4o'
//   - 'openai/gpt-4-turbo'
//   - 'x-ai/grok-2-1212' (Grok model - check OpenRouter for latest)
//   - 'deepseek/deepseek-chat'
//   - 'qwen/qwen-2.5-72b-instruct'
//   - 'meta-llama/llama-3.1-70b-instruct'
// Note: Some models may require API keys or have rate limits. Check OpenRouter docs.
// ============================================================================

// Unified system prompt for all agents to ensure fair comparison
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
  model: string; // OpenRouter model identifier
  systemPrompt?: string; // Optional - will use UNIFIED_SYSTEM_PROMPT if not provided
  color?: string;
}

export const TRADER_CONFIGS: TraderConfig[] = [
  {
    id: 'gemini-balanced',
    name: 'Gemini 2.5 Flash',
    model: 'google/gemini-2.5-flash',
    // systemPrompt not provided - will use UNIFIED_SYSTEM_PROMPT
  },
  {
    id: 'claude-prudent',
    name: 'Claude 3 haiku',
    model: 'anthropic/claude-3-haiku',
    // systemPrompt not provided - will use UNIFIED_SYSTEM_PROMPT
  },
  {
    id: 'grok-momentum',
    name: 'Grok 4 fast',
    model: 'x-ai/grok-4-fast',
    // systemPrompt not provided - will use UNIFIED_SYSTEM_PROMPT
  },
  {
    id: 'deepseek-analytical',
    name: 'DeepSeek Chat',
    model: 'deepseek/deepseek-chat',
    // systemPrompt not provided - will use UNIFIED_SYSTEM_PROMPT
  },
  {
    id: 'qwen-conservative',
    name: 'Qwen 2.5 72B',
    model: 'qwen/qwen-2.5-72b-instruct',
    // systemPrompt not provided - will use UNIFIED_SYSTEM_PROMPT
  },
];

// Helper function to create agents from trader configs
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
    systemPrompt: config.systemPrompt || UNIFIED_SYSTEM_PROMPT, // Use unified prompt if not provided
  } as Agent & { systemPrompt: string }));
};

export const INITIAL_AGENTS: Agent[] = createAgentsFromConfigs(TRADER_CONFIGS);