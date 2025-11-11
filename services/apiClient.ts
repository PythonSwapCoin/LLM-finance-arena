// API client for backend communication
const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8080/api';

export interface SimulationStateResponse {
  snapshot: {
    day: number;
    intradayHour: number;
    marketData: { [ticker: string]: any };
    agents: any[];
    benchmarks: any[];
    mode: 'simulated' | 'realtime' | 'historical';
    historicalPeriod?: {
      start: string;
      end: string;
    };
    lastUpdated: string;
  };
  isLoading: boolean;
}

export interface AgentsResponse {
  agents: any[];
}

export interface MarketDataResponse {
  prices: { [ticker: string]: any };
  ts: string;
  source: string;
}

export interface BenchmarksResponse {
  series: any[];
}

export interface HistoryResponse {
  timeseries: {
    agents: Array<{
      id: string;
      name: string;
      performanceHistory: any[];
    }>;
    benchmarks: Array<{
      id: string;
      name: string;
      performanceHistory: any[];
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

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  async getSimulationState(): Promise<SimulationStateResponse> {
    return this.request<SimulationStateResponse>('/simulation/state');
  }

  async getAgents(): Promise<AgentsResponse> {
    return this.request<AgentsResponse>('/agents');
  }

  async getMarketData(): Promise<MarketDataResponse> {
    return this.request<MarketDataResponse>('/market-data');
  }

  async getBenchmarks(): Promise<BenchmarksResponse> {
    return this.request<BenchmarksResponse>('/benchmarks');
  }

  async getHistory(): Promise<HistoryResponse> {
    return this.request<HistoryResponse>('/simulation/history');
  }

  async startSimulation(): Promise<StartStopResponse> {
    return this.request<StartStopResponse>('/simulation/start', {
      method: 'POST',
    });
  }

  async stopSimulation(): Promise<StartStopResponse> {
    return this.request<StartStopResponse>('/simulation/stop', {
      method: 'POST',
    });
  }

  async getLogs(level?: string, limit?: number): Promise<LogsResponse> {
    const params = new URLSearchParams();
    if (level) params.append('level', level);
    if (limit) params.append('limit', limit.toString());
    const query = params.toString();
    return this.request<LogsResponse>(`/logs${query ? `?${query}` : ''}`);
  }
}

export const apiClient = new ApiClient(API_BASE);

