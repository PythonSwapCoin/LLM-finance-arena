import type { SimulationSnapshot, Agent, Benchmark, MarketData, PerformanceMetrics } from '../../../shared/types';

// Response DTOs matching the old hook output shape
export interface SimulationStateResponse {
  snapshot: SimulationSnapshot;
  isLoading: boolean;
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

