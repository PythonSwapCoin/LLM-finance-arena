// Shared types used by both web and backend
// This file should be imported by both packages

export interface TickerData {
  ticker: string;
  price: number;
  dailyChange: number;
  dailyChangePercent: number;
  trailingPE?: number;
  forwardPE?: number;
  priceToBook?: number;
  priceToSales?: number;
  enterpriseValue?: number;
  enterpriseToRevenue?: number;
  enterpriseToEbitda?: number;
  beta?: number;
  marketCap?: number;
  volume?: number;
  averageVolume?: number;
  profitMargins?: number;
  grossMargins?: number;
  operatingMargins?: number;
  debtToEquity?: number;
  dividendYield?: number;
  payoutRatio?: number;
  fiftyTwoWeekChange?: number;
  dayHigh?: number;
  dayLow?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  sector?: string;
  industry?: string;
  longName?: string;
  shortName?: string;
}

export interface MarketData {
  [ticker: string]: TickerData;
}

export type TradeAction = 'buy' | 'sell' | 'hold';

export interface Trade {
  ticker: string;
  action: TradeAction;
  quantity: number;
  price: number;
  timestamp: number;
  fairValue?: number;
  topOfBox?: number;
  bottomOfBox?: number;
  justification?: string;
  fees?: number;
}

export interface Position {
  ticker: string;
  quantity: number;
  averageCost: number;
  lastFairValue?: number;
  lastTopOfBox?: number;
  lastBottomOfBox?: number;
}

export interface Portfolio {
  cash: number;
  positions: { [ticker: string]: Position };
}

export type ChatSenderType = 'user' | 'agent';
export type ChatMessageStatus = 'pending' | 'delivered' | 'responded' | 'ignored';

export interface ChatMessage {
  id: string;
  agentId?: string; // Optional - undefined for general chat messages
  agentName?: string; // Optional - undefined for general chat messages
  sender: string;
  senderType: ChatSenderType;
  content: string;
  roundId: string;
  createdAt: string;
  status?: ChatMessageStatus; // Only for user messages: pending -> delivered -> responded/ignored
}

export interface ChatConfig {
  enabled: boolean;
  maxMessagesPerAgent: number;
  maxMessagesPerUser: number;
  maxMessageLength: number;
}

export interface ChatState {
  config: ChatConfig;
  messages: ChatMessage[];
}

export interface PerformanceMetrics {
  totalValue: number;
  totalReturn: number;
  dailyReturn: number;
  annualizedVolatility: number;
  sharpeRatio: number;
  maxDrawdown: number;
  turnover: number;
  timestamp: number;
  intradayHour?: number;
}

export interface Agent {
  id: string;
  name: string;
  model: string;
  color: string;
  portfolio: Portfolio;
  tradeHistory: Trade[];
  performanceHistory: PerformanceMetrics[];
  rationale: string;
  rationaleHistory: { [day: number]: string };
  image?: string; // Path to agent image/logo
  memory?: {
    recentTrades: Trade[];
    pastRationales: string[];
    pastPerformance: PerformanceMetrics[];
  };
}

export interface Benchmark {
  id: string;
  name: string;
  color: string;
  performanceHistory: PerformanceMetrics[];
  metadata?: {
    lastGspcPrice?: number;  // Track ^GSPC price for S&P 500 benchmark calculations
    [key: string]: any;
  };
}

export interface MarketDataSourceTelemetry {
  success: number;
  failure: number;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastError?: string;
}

export interface YahooRateLimitStatus {
  windowMs: number;
  maxRequestsPerWindow: number;
  currentCount: number;
  resetAt: string | null;
  blockedRequests: number;
  lastThrottledAt: string | null;
  isThrottled: boolean;
}

export interface MarketDataTelemetry {
  sources: {
    yahoo: MarketDataSourceTelemetry;
    alphaVantage: MarketDataSourceTelemetry;
    polygon: MarketDataSourceTelemetry;
  };
  rateLimits: {
    yahoo: YahooRateLimitStatus;
  };
}

// Snapshot type for persistence
export interface SimulationSnapshot {
  day: number;
  intradayHour: number;
  marketData: MarketData;
  agents: Agent[];
  benchmarks: Benchmark[];
  mode: 'simulated' | 'realtime' | 'historical' | 'hybrid';
  historicalPeriod?: {
    start: string;
    end: string;
  };
  // Date tracking for display purposes
  startDate?: string; // ISO date string when simulation started
  currentDate?: string; // ISO date string for current point in simulation
  chat: ChatState;
  currentTimestamp?: number; // Timestamp in milliseconds for realtime mode
  lastUpdated: string;
  // Historical preload metadata (for saving historical data to preload in realtime mode)
  historicalPreloadMetadata?: {
    mode: 'historical' | 'realtime' | 'hybrid' | 'simulated';
    startDate: string;
    endDate: string;
    endDay: number;
    endIntradayHour: number;
    tickIntervalMs: number;
    marketMinutesPerTick: number;
    realtimeTickIntervalMs: number;
  };
  // ID of the historical snapshot used for preloading (to detect config changes)
  preloadSnapshotId?: string;
}

