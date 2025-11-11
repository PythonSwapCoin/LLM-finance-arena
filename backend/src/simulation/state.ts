import type { SimulationSnapshot, Agent, Benchmark, MarketData } from '../types';
import { INITIAL_AGENTS, INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, BENCHMARK_COLORS } from '../constants';
import { calculateAllMetrics } from '../utils/portfolioCalculations';
import { getSimulationMode } from '../services/marketDataService';

class SimulationState {
  private snapshot: SimulationSnapshot;

  constructor() {
    this.snapshot = {
      day: 0,
      intradayHour: 0,
      marketData: {},
      agents: [],
      benchmarks: [],
      mode: getSimulationMode(),
      lastUpdated: new Date().toISOString(),
    };
  }

  async initialize(marketData: MarketData): Promise<void> {
    const initialAgentStates = INITIAL_AGENTS.map(agent => {
      const initialMetrics = calculateAllMetrics(agent.portfolio, marketData, [], 0);
      return { 
        ...agent, 
        performanceHistory: [initialMetrics],
        rationaleHistory: { 0: 'Initial state - no trades yet.' },
        memory: {
          recentTrades: [],
          pastRationales: [],
          pastPerformance: [initialMetrics],
        }
      };
    });

    const initialBenchmarkMetrics = calculateAllMetrics({cash: INITIAL_CASH, positions: {}}, marketData, [], 0);
    const benchmarks: Benchmark[] = [
      { 
        id: S_P500_BENCHMARK_ID, 
        name: 'S&P 500', 
        color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID], 
        performanceHistory: [initialBenchmarkMetrics] 
      },
      { 
        id: AI_MANAGERS_INDEX_ID, 
        name: 'AI Managers Index', 
        color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID], 
        performanceHistory: [initialBenchmarkMetrics] 
      }
    ];

    const mode = getSimulationMode();
    const now = new Date();
    let startDate: string;
    let currentDate: string;

    if (mode === 'historical') {
      // Use historical period start date
      const { getHistoricalSimulationStartDate } = await import('../services/marketDataService');
      const histStart = getHistoricalSimulationStartDate();
      startDate = histStart.toISOString();
      currentDate = histStart.toISOString();
    } else if (mode === 'realtime') {
      // Use current date/time for real-time start
      startDate = now.toISOString();
      
      // If using delayed data, currentDate should reflect the delayed time
      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
      
      if (USE_DELAYED_DATA) {
        // Set currentDate to (now - delay) to reflect the actual data time
        const delayedTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
        currentDate = delayedTime.toISOString();
      } else {
        // Real-time without delay: use current time
        currentDate = now.toISOString();
      }
    } else {
      // Simulated: use current date as starting point
      startDate = now.toISOString();
      currentDate = now.toISOString();
    }

    // For real-time mode, also set currentTimestamp
    let currentTimestamp: number | undefined;
    if (mode === 'realtime') {
      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);
      if (USE_DELAYED_DATA) {
        const delayedTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
        currentTimestamp = delayedTime.getTime();
      } else {
        currentTimestamp = now.getTime();
      }
    }

    this.snapshot = {
      day: 0,
      intradayHour: 0,
      marketData,
      agents: initialAgentStates,
      benchmarks,
      mode,
      startDate,
      currentDate,
      currentTimestamp,
      lastUpdated: new Date().toISOString(),
    };
  }

  getSnapshot(): SimulationSnapshot {
    return { ...this.snapshot };
  }

  updateSnapshot(updates: Partial<SimulationSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
  }

  getDay(): number {
    return this.snapshot.day;
  }

  getIntradayHour(): number {
    return this.snapshot.intradayHour;
  }

  getMarketData(): MarketData {
    return { ...this.snapshot.marketData };
  }

  getAgents(): Agent[] {
    return [...this.snapshot.agents];
  }

  getBenchmarks(): Benchmark[] {
    return [...this.snapshot.benchmarks];
  }

  getMode(): 'simulated' | 'realtime' | 'historical' {
    return this.snapshot.mode;
  }

  setDay(day: number): void {
    this.snapshot.day = day;
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  setIntradayHour(hour: number): void {
    this.snapshot.intradayHour = hour;
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  setMarketData(marketData: MarketData): void {
    this.snapshot.marketData = { ...marketData };
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  setAgents(agents: Agent[]): void {
    this.snapshot.agents = [...agents];
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  setBenchmarks(benchmarks: Benchmark[]): void {
    this.snapshot.benchmarks = [...benchmarks];
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  loadFromSnapshot(snapshot: SimulationSnapshot): void {
    this.snapshot = { ...snapshot };
  }
}

export const simulationState = new SimulationState();

