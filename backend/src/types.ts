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
  mode: 'simulated' | 'realtime' | 'historical';
  historicalPeriod?: {
    start: string;
    end: string;
  };
  // Date tracking for display purposes
  startDate?: string; // ISO date string when simulation started
  currentDate?: string; // ISO date string for current point in simulation
  currentTimestamp?: number; // Timestamp in milliseconds for realtime mode
  lastUpdated: string;
}

