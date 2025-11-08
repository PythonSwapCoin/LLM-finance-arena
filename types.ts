export interface TickerData {
  ticker: string;
  price: number;
  dailyChange: number;
  dailyChangePercent: number;
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
}

export interface Position {
  ticker: string;
  quantity: number;
  averageCost: number;
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
  timestamp: number; // Day number
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
}

export interface Benchmark {
    id: string;
    name: string;
    color: string;
    performanceHistory: PerformanceMetrics[];
}