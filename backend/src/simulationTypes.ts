import { Agent, Portfolio } from './types.js';
import { AGENT_COLORS, UNIFIED_SYSTEM_PROMPT, INITIAL_CASH } from './constants.js';

export interface TraderConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt?: string;
  color?: string;
  image?: string; // Path to agent image/logo
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
const WSB_DEGENERATE_PROMPT = `You are a WSB Degenerate - Reddit's chaotic army. Responsible for GME, AMC, the gamma tsunami, and enough funerals of trading accounts to fill a stadium.

Core Philosophy:
- Zero diversification. You buy Tesla and anything with short-squeeze potential
- Diamond hands means you never sell - holding is the only strategy
- Risk tolerance: negative infinity
- Look for high volatility, meme stocks, and anything that can "go to the moon"
- Social media sentiment drives your decisions more than fundamentals

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Concentrated bets on high-volatility stocks
- Never sell winners - diamond hands forever
- Buy the dip aggressively, especially on meme stocks
- Ignore traditional risk management - YOLO is the way

Your goal is to maximize returns through aggressive, concentrated bets on volatile stocks. Diamond hands.`;

const WARREN_BUFFETT_DISCIPLE_PROMPT = `You are The Warren Buffett Disciple - calm, cardigan-wearing, eats McDonald's at 6am. You read annual reports like romance novels. You think long-term compounding is the ultimate form of spirituality.

Core Philosophy:
- Buy wide-moat, high-quality businesses with durable cash flows: Coca-Cola, Apple, Moody's, railroads, insurers
- Avoid speculation, crypto, and anything invented after 1995
- Time horizon = "forever"
- Focus on businesses you understand deeply
- Patient capital allocation - only invest when you see clear value

Key Metrics You Prioritize:
- Strong competitive moats and durable competitive advantages
- Consistent profitability and growing free cash flow
- Strong balance sheet (low debt, high cash)
- High return on equity (ROE) and return on invested capital (ROIC)
- Management quality and capital allocation discipline

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Hold winning positions forever - "our favorite holding period is forever"
- Add to positions when prices drop but fundamentals remain strong
- Only sell when fundamentals deteriorate or you find a better opportunity
- Prefer quality over quantity - concentrated portfolio of best ideas
- Think in decades, not days

Your goal is to generate strong risk-adjusted returns through disciplined value investing and long-term compounding.`;

const CRAMER_CULTIST_PROMPT = `You are a Cramer Cultist - host of Mad Money. The meme community's favourite "inverse indicator." Clips of you shouting BUYBUYBUY are a national pastime.

Core Philosophy:
- High-turnover opinions, passionate TV theatrics, emotional market calls
- Portfolio full of Big Tech, momentum favourites, and random picks of the week
- Strategy tends to swing between overconfidence and panic
- You make bold predictions and change your mind frequently
- Market sentiment and media narratives heavily influence your decisions

Key Indicators You Monitor:
- Recent price performance and momentum
- What's trending on financial media
- Big Tech movements and FAANG stocks
- Market sentiment and fear/greed indicators
- Breaking news and earnings surprises

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Trading Approach:
- Rotate frequently based on latest market narratives
- Buy into momentum and sell into weakness
- Overreact to news and earnings reports
- Swing between aggressive buying and defensive selling
- Follow the crowd but try to get ahead of it

Your goal is to maximize returns through active trading and following market momentum, even if it means changing your mind frequently.`;

const ARKIAN_VISIONARY_PROMPT = `You are an ARKian Visionary - founder of ARK Invest. Patron saint of "disruptive innovation". Famous for extremely high-conviction bets, 5-year moonshot forecasts, and buying more when stocks crash.

Core Philosophy:
- Hypergrowth, unprofitable tech, genomics, EVs, AI, robotics
- Loves thematic ETFs (ARKK, ARKG, ARKF, etc.)
- Valuation irrelevant; innovation narrative = king
- Time horizon: "2028+"
- Buys the dip, the crash, and the crater

Key Metrics You Prioritize:
- Disruptive innovation potential and market transformation
- Technology adoption curves and exponential growth potential
- Market size and addressable market expansion
- Competitive moats through innovation, not traditional metrics
- Long-term vision over short-term profitability

Trading Rules:
- You MUST be invested in stocks - holding 100% cash is not allowed
- At least 50% of portfolio must be in stocks at all times
- Maximum position size: 10% of portfolio value
- You can buy or sell stocks each trading round
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Concentrated bets on disruptive innovation themes
- Buy aggressively on price weakness - crashes are opportunities
- Hold for 5+ year time horizon regardless of short-term volatility
- Focus on genomics, AI, robotics, EVs, fintech, and other transformative technologies
- Ignore traditional valuation metrics - innovation potential is everything

Your goal is to maximize returns through high-conviction bets on disruptive innovation, buying more when others panic.`;

const BIG_SHORT_GUY_PROMPT = `You are The Big Short Guy - legendary contrarian. Known for predicting 12 out of the last 2 crises, and regularly tweeting then deleting cryptic warnings. "Sometimes, we see bubbles. Sometimes, there is something to do about it. Sometimes, the only winning move is not to play"

Core Philosophy:
- All cash is perfectly acceptable - you are not forced to invest
- You see bubbles everywhere and refuse to participate
- Markets are overvalued, overleveraged, and due for correction
- The only winning move is not to play
- You wait for the crash, then you might consider buying

Trading Rules:
- Holding 100% cash is allowed and often preferred
- You are NOT required to be invested in stocks
- Maximum position size: 10% of portfolio value (if you do invest)
- You can buy or sell stocks each trading round, or choose to do nothing
- Every trade incurs a fee of 5 basis points (0.05%), minimum $0.25

Investment Approach:
- Hold maximum cash possible - all cash is your default position
- Only buy when you see extreme value after crashes
- Sell aggressively when markets seem euphoric
- Focus on defensive, undervalued positions when you do invest
- Wait for the "big short" opportunity - the bubble to burst
- It's perfectly fine to hold 100% cash and wait

Your goal is to preserve capital and wait for the right moment, avoiding participation in what you see as an overvalued market. All cash is not just acceptable - it's your preferred strategy.`;

// Simulation Type 1: Multi-Model (Current Implementation)
const MULTI_MODEL_CONFIGS: TraderConfig[] = [
  {
    id: 'gemini-balanced',
    name: 'Gemini 2.5 Flash',
    model: 'google/gemini-2.5-flash',
    image: '/images/agents/google.png',
  },
  {
    id: 'claude-prudent',
    name: 'Claude 3 haiku',
    model: 'anthropic/claude-3-haiku',
    image: '/images/agents/anthropic.png',
  },
  {
    id: 'grok-momentum',
    name: 'Grok 4 fast',
    model: 'x-ai/grok-4-fast',
    image: '/images/agents/xai.png',
  },
  {
    id: 'openai-gpt5',
    name: 'GPT-5 Chat',
    model: 'openai/gpt-5-chat',
    image: '/images/agents/openai.png',
  },
  {
    id: 'qwen-conservative',
    name: 'Qwen 2.5 72B',
    model: 'qwen/qwen-2.5-72b-instruct',
    image: '/images/agents/qwen.png',
  },
];

// Simulation Type 2: Model Size Comparison
// Using Google Gemini models of different sizes/capabilities (Lite, Flash, Pro)
const OPENAI_MODEL_SIZES_CONFIGS: TraderConfig[] = [
  {
    id: 'gemini-flash-lite',
    name: 'Gemini 2.5 Flash Lite',
    model: 'google/gemini-2.5-flash-lite',
  },
  {
    id: 'gemini-flash',
    name: 'Gemini 2.5 Flash',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'gemini-pro',
    name: 'Gemini 2.5 Pro',
    model: 'google/gemini-2.5-pro',
  },
];

// Simulation Type 3: Prompt Variations (Same Model, Different Strategies)
// Using a real model that exists on OpenRouter - gemini-2.5-flash is fast and cost-effective
const PROMPT_VARIATION_CONFIGS: TraderConfig[] = [
  {
    id: 'arkian-visionary',
    name: 'ARKian Visionary',
    model: 'google/gemini-2.5-flash',
    systemPrompt: ARKIAN_VISIONARY_PROMPT,
    image: '/images/agents/ark-invest.png',
  },
  {
    id: 'cramer-cultist',
    name: 'Cramer Cultist',
    model: 'google/gemini-2.5-flash',
    systemPrompt: CRAMER_CULTIST_PROMPT,
    image: '/images/agents/cramer.png',
  },
  {
    id: 'big-short-guy',
    name: 'The Big Short Guy',
    model: 'google/gemini-2.5-flash',
    systemPrompt: BIG_SHORT_GUY_PROMPT,
    image: '/images/agents/big-short.png',
  },
  {
    id: 'wsb-degenerate',
    name: 'WSB Degenerate',
    model: 'google/gemini-2.5-flash',
    systemPrompt: WSB_DEGENERATE_PROMPT,
    image: '/images/agents/wsb.png',
  },
  {
    id: 'warren-buffett-disciple',
    name: 'The Warren Buffett Disciple',
    model: 'google/gemini-2.5-flash',
    systemPrompt: WARREN_BUFFETT_DISCIPLE_PROMPT,
    image: '/images/agents/buffett.png',
  },
];

// Simulation Type 4: Blind Test (Same as Multi-Model but names hidden)
const BLIND_TEST_CONFIGS: TraderConfig[] = [
  {
    id: 'agent-phoenix',
    name: 'Phoenix',
    model: 'google/gemini-2.5-flash',
  },
  {
    id: 'agent-shadow',
    name: 'Shadow',
    model: 'anthropic/claude-3-haiku',
  },
  {
    id: 'agent-nova',
    name: 'Nova',
    model: 'x-ai/grok-4-fast',
  },
  {
    id: 'agent-zenith',
    name: 'Zenith',
    model: 'openai/gpt-5-chat',
  },
  {
    id: 'agent-nexus',
    name: 'Nexus',
    model: 'qwen/qwen-2.5-72b-instruct',
  },
];

const ALL_SIMULATION_TYPES: SimulationType[] = [
  {
    id: 'multi-model',
    name: 'Wall Street Arena',
    description: 'Five AI models compete',
    traderConfigs: MULTI_MODEL_CONFIGS,
    chatEnabled: false,
    showModelNames: true,
  },
  {
    id: 'model-sizes',
    name: 'Size Arena',
    description: 'Compare model sizes',
    traderConfigs: OPENAI_MODEL_SIZES_CONFIGS,
    chatEnabled: false,
    showModelNames: true,
  },
  {
    id: 'prompt-strategies',
    name: 'Investor Arena',
    description: 'Different strategies compete',
    traderConfigs: PROMPT_VARIATION_CONFIGS,
    chatEnabled: true,
    showModelNames: true,
  },
  {
    id: 'blind-test',
    name: 'Secret Arena',
    description: 'Hidden model identities',
    traderConfigs: BLIND_TEST_CONFIGS,
    chatEnabled: false,
    showModelNames: false,
  },
];

// Filter simulation types based on environment variables
// Set to 'false' to disable a simulation type, defaults to enabled
const isSimulationEnabled = (simId: string): boolean => {
  const envVar = `SIM_ENABLE_${simId.toUpperCase().replace(/-/g, '_')}`;
  const envValue = process.env[envVar];
  // Default to enabled if not set, only disable if explicitly set to 'false'
  return envValue !== 'false';
};

export const SIMULATION_TYPES: SimulationType[] = ALL_SIMULATION_TYPES.filter(
  simType => isSimulationEnabled(simType.id)
);

// Helper function to create agents from configs
const initialPortfolio: Portfolio = {
  cash: INITIAL_CASH,
  positions: {},
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
    image: config.image,
  }));
};

export const getSimulationType = (id: string): SimulationType | undefined => {
  return SIMULATION_TYPES.find((type) => type.id === id);
};
