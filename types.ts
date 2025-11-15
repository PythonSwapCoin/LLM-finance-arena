export interface TickerData {
  ticker: string;
  price: number;
  dailyChange: number;
  dailyChangePercent: number;
  // Financial metrics from defaultKeyStatistics
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
  timestamp: number; // Day number
  fairValue?: number; // Estimated fair value of the stock
  topOfBox?: number; // 10% best case scenario price by next day
  bottomOfBox?: number; // 10% worst case scenario price by next day
  justification?: string; // One sentence justification for the trade
  fees?: number; // Execution fees charged for the trade
}

export interface Position {
  ticker: string;
  quantity: number;
  averageCost: number;
  lastFairValue?: number; // Last estimated fair value
  lastTopOfBox?: number; // Last estimated top of box
  lastBottomOfBox?: number; // Last estimated bottom of box
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
  timestamp: number; // Day number (for intraday: day + hour/10, e.g., 1.0, 1.2, 1.4, 1.6, 2.0)
  intradayHour?: number; // 0, 2, 4, 6 for intraday updates
}

export interface Agent {
  id: string;
  name: string;
  model: string;
  color: string;
  portfolio: Portfolio;
  tradeHistory: Trade[];
  performanceHistory: PerformanceMetrics[];
  rationale: string; // Current rationale
  rationaleHistory: { [day: number]: string }; // Historical rationales by day
  image?: string; // Path to agent image/logo
  memory?: { // Agent memory/context for past decisions
    recentTrades: Trade[]; // Last N trades for context
    pastRationales: string[]; // Recent rationales
    pastPerformance: PerformanceMetrics[]; // Recent performance snapshots
  };
}

export interface Benchmark {
    id: string;
    name: string;
    color: string;
    performanceHistory: PerformanceMetrics[];
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