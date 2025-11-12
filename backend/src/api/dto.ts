import type {
  SimulationSnapshot,
  Agent,
  Benchmark,
  MarketData,
  PerformanceMetrics,
  MarketDataTelemetry,
  ChatState,
  ChatMessage,
} from '../types.js';

// Response DTOs matching the old hook output shape
export interface SimulationStateResponse {
  snapshot: SimulationSnapshot;
  isLoading: boolean;
  isHistoricalSimulationComplete: boolean;
  marketTelemetry: MarketDataTelemetry;
}

export interface AgentsResponse {
  agents: Agent[];
}

export interface MarketDataResponse {
  prices: MarketData;
  ts: string;
  source: string;
}

export interface BenchmarksResponse {
  series: Benchmark[];
}

export interface HistoryResponse {
  timeseries: {
    agents: Array<{
      id: string;
      name: string;
      performanceHistory: PerformanceMetrics[];
    }>;
    benchmarks: Array<{
      id: string;
      name: string;
      performanceHistory: PerformanceMetrics[];
    }>;
  };
}

export interface StartStopResponse {
  ok: boolean;
}

export interface LogsResponse {
  lines: Array<{
    timestamp: string;
    level: string;
    category: string;
    message: string;
    details?: any;
    error?: string;
  }>;
}

export interface ChatMessageResponse {
  chat: ChatState;
  message: ChatMessage;
}

