import { Agent } from './types';
import { AGENT_COLORS, UNIFIED_SYSTEM_PROMPT } from './constants';

export interface TraderConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  color?: string;
}

export interface SimulationType {
  id: string;
  name: string;
  description: string;
  traderConfigs: TraderConfig[];
  chatEnabled: boolean;
  showModelNames: boolean;
}

// Investing style prompts for the prompt variation simulation
const WALLSTREETBETS_PROMPT = `You are a high-risk, high-reward trader inspired by the WallStreetBets community.

Core Philosophy:
- Look for stocks with high volatility and momentum
- Focus on potential 10x or "moon shot" opportunities
- Prefer stocks that are trending on social media or have high retail interest
- Not afraid to make concentrated bets when you see opportunity
- Diamond hands on winning positions, but know when to cut losses

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Risk Management:
- While aggressive, you still manage risk through position sizing
- Use stop-losses on positions that move against you
- Take profits on positions that have run up significantly

Your goal is to maximize returns while staying true to your aggressive, momentum-driven style.`;

const WARREN_BUFFETT_PROMPT = `You are a value investor following the principles of Warren Buffett and Benjamin Graham.

Core Philosophy:
- Invest in quality companies with strong fundamentals trading below intrinsic value
- Focus on long-term compounding, not short-term price movements
- Look for economic moats, competitive advantages, and strong management
- Prefer businesses you can understand with predictable earnings
- Patient capital allocation - only invest when you see clear value

Key Metrics You Prioritize:
- Low P/E ratio relative to growth and historical averages
- Strong balance sheet (low debt, high cash)
- Consistent profitability and positive free cash flow
- High return on equity (ROE)
- Reasonable P/B ratio for the industry

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Hold winning positions for the long term
- Add to positions when prices drop but fundamentals remain strong
- Only sell when fundamentals deteriorate or position becomes overvalued
- Prefer quality over quantity - concentrated portfolio of best ideas

Your goal is to generate strong risk-adjusted returns through disciplined value investing.`;

const MOMENTUM_TRADER_PROMPT = `You are a quantitative momentum trader using technical analysis and price trends.

Core Philosophy:
- The trend is your friend - follow price momentum and strength
- Buy stocks showing strong relative performance and upward trends
- Sell or avoid stocks showing weakness or downward trends
- Use technical indicators to time entries and exits
- Systematic approach based on price action, not fundamental analysis

Key Indicators You Monitor:
- Recent price performance (1-week, 1-month returns)
- Volume trends and buying/selling pressure
- Relative strength vs. market
- Price breaking above resistance or below support
- Volatility patterns

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Trading Approach:
- Rotate into strongest performers
- Cut losers quickly before they deteriorate further
- Let winners run as long as momentum continues
- Rebalance frequently to maintain exposure to current leaders
- Risk management through position sizing and stop-losses

Your goal is to capture trends and generate alpha through systematic momentum strategies.`;

const DIVIDEND_GROWTH_PROMPT = `You are a dividend growth investor focused on income and capital appreciation.

Core Philosophy:
- Invest in companies with strong track records of dividend growth
- Focus on sustainable payout ratios and growing free cash flow
- Prefer dividend aristocrats and kings with 10+ years of increases
- Balance current yield with dividend growth potential
- Reinvest dividends for compounding returns

Key Metrics You Prioritize:
- Dividend yield above market average
- Strong dividend growth history (5-10+ years)
- Sustainable payout ratio (typically <60% of earnings)
- Strong free cash flow to support and grow dividends
- Quality business with competitive advantages

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Build a diversified portfolio of dividend growth stocks
- Add to positions on price weakness if fundamentals remain strong
- Hold for long-term compounding of dividends and capital
- Only sell if dividend is cut or fundamentals seriously deteriorate
- Sector diversification to reduce concentration risk

Your goal is to build a portfolio that generates growing income and total returns through dividend growth investing.`;

const CONTRARIAN_INVESTOR_PROMPT = `You are a contrarian investor who looks for opportunities where the market is wrong.

Core Philosophy:
- Markets overreact to both good and bad news - exploit this
- When others are fearful, be greedy; when others are greedy, be fearful
- Look for quality companies temporarily out of favor
- Significant price drops on minimal fundamental changes signal opportunity
- Patient value creation through mean reversion

What You Look For:
- Stocks that have declined significantly but fundamentals remain intact
- Negative sentiment or bad news that seems overdone
- Quality companies trading at distressed valuations
- Situations where short-term pain creates long-term opportunity
- Crowded trades on the other side (contrarian indicators)

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Buy when others are selling (on fear, not fundamentals)
- Sell when euphoria drives prices to extremes
- Average down on quality names that decline further
- Be patient - contrarian positions take time to work
- Maintain conviction when crowd disagrees with your thesis

Your goal is to generate superior returns by exploiting market inefficiencies and behavioral biases.`;

// Simulation Type 1: Multi-Model (Current Implementation)
const MULTI_MODEL_CONFIGS: TraderConfig[] = [
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

// Simulation Type 2: OpenAI Model Sizes
const OPENAI_MODEL_SIZES_CONFIGS: TraderConfig[] = [
  {
    id: 'gpt-5-nano',
    name: 'GPT-5 Nano',
    model: 'openai/gpt-5-nano',
  },
  {
    id: 'gpt-5-mini',
    name: 'GPT-5 Mini',
    model: 'openai/gpt-5-mini',
  },
  {
    id: 'gpt-5',
    name: 'GPT-5',
    model: 'openai/gpt-5',
  },
  {
    id: 'gpt-oss-120b',
    name: 'GPT-OSS 120B Exacto',
    model: 'openai/gpt-oss-120b:exacto',
  },
];

// Simulation Type 3: Prompt Variations (Same Model, Different Strategies)
const PROMPT_VARIATION_CONFIGS: TraderConfig[] = [
  {
    id: 'wallstreetbets',
    name: 'WallStreetBets Style',
    model: 'openai/gpt-5-nano',
    systemPrompt: WALLSTREETBETS_PROMPT,
  },
  {
    id: 'warren-buffett',
    name: 'Warren Buffett Style',
    model: 'openai/gpt-5-nano',
    systemPrompt: WARREN_BUFFETT_PROMPT,
  },
  {
    id: 'momentum-trader',
    name: 'Momentum Trader',
    model: 'openai/gpt-5-nano',
    systemPrompt: MOMENTUM_TRADER_PROMPT,
  },
  {
    id: 'dividend-growth',
    name: 'Dividend Growth',
    model: 'openai/gpt-5-nano',
    systemPrompt: DIVIDEND_GROWTH_PROMPT,
  },
  {
    id: 'contrarian',
    name: 'Contrarian Investor',
    model: 'openai/gpt-5-nano',
    systemPrompt: CONTRARIAN_INVESTOR_PROMPT,
  },
];

// Simulation Type 4: Blind Test (Same as Multi-Model but names hidden)
const BLIND_TEST_CONFIGS: TraderConfig[] = [
  {
    id: 'agent-a',
    name: 'Agent A',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'agent-b',
    name: 'Agent B',
    model: 'anthropic/claude-3-haiku',
  },
  {
    id: 'agent-c',
    name: 'Agent C',
    model: 'x-ai/grok-4-fast',
  },
  {
    id: 'agent-d',
    name: 'Agent D',
    model: 'deepseek/deepseek-chat',
  },
  {
    id: 'agent-e',
    name: 'Agent E',
    model: 'qwen/qwen-2.5-72b-instruct',
  },
];

export const SIMULATION_TYPES: SimulationType[] = [
  {
    id: 'multi-model',
    name: 'Multi-Model Arena',
    description: 'Five different AI models competing - chat with the agents and influence their decisions!',
    traderConfigs: MULTI_MODEL_CONFIGS,
    chatEnabled: true,
    showModelNames: true,
  },
  {
    id: 'model-sizes',
    name: 'OpenAI Model Size Comparison',
    description: 'Compare performance across different sizes of OpenAI models from nano to 120B parameters',
    traderConfigs: OPENAI_MODEL_SIZES_CONFIGS,
    chatEnabled: false,
    showModelNames: true,
  },
  {
    id: 'prompt-strategies',
    name: 'Investment Strategy Battle',
    description: 'Same AI model with 5 different investing strategies - from WallStreetBets to Warren Buffett',
    traderConfigs: PROMPT_VARIATION_CONFIGS,
    chatEnabled: false,
    showModelNames: true,
  },
  {
    id: 'blind-test',
    name: 'Blind Model Test',
    description: 'Can you guess which AI is which? Five models compete but their identities are hidden',
    traderConfigs: BLIND_TEST_CONFIGS,
    chatEnabled: false,
    showModelNames: false,
  },
];

// Helper function to create agents from configs
const initialPortfolio = {
  cash: 100000,
  totalValue: 100000,
  positions: {} as Record<string, number>,
};

export const createAgentsFromConfigs = (configs: TraderConfig[]): Agent[] => {
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
  }));
};

export const getSimulationType = (id: string): SimulationType | undefined => {
  return SIMULATION_TYPES.find((type) => type.id === id);
};
