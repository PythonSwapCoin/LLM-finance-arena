import type { SimulationSnapshot, Agent, Benchmark, MarketData, ChatState, ChatConfig, ChatMessage } from '../types.js';
import { INITIAL_AGENTS, INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, BENCHMARK_COLORS } from '../constants.js';
import { calculateAllMetrics } from '../utils/portfolioCalculations.js';
import { getSimulationMode } from '../services/marketDataService.js';
import { cloneChatMessages } from '../utils/chatUtils.js';

class SimulationState {
  private snapshot: SimulationSnapshot;

  private buildChatConfig(): ChatConfig {
    const parseIntWithDefault = (value: string | undefined, fallback: number): number => {
      if (value === undefined) {
        return fallback;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    return {
      enabled: (process.env.CHAT_ENABLED ?? 'true') !== 'false',
      maxMessagesPerAgent: Math.max(1, parseIntWithDefault(process.env.CHAT_MAX_MESSAGES_PER_AGENT, 3)),
      maxMessagesPerUser: Math.max(1, parseIntWithDefault(process.env.CHAT_MAX_MESSAGES_PER_USER, 2)),
      maxMessageLength: Math.max(40, parseIntWithDefault(process.env.CHAT_MESSAGE_MAX_LENGTH, 140)),
    };
  }

  private createChatState(messages: ChatMessage[] = []): ChatState {
    const config = this.buildChatConfig();
    return {
      config,
      messages: cloneChatMessages(messages),
    };
  }

  constructor() {
    this.snapshot = {
      day: 0,
      intradayHour: 0,
      marketData: {},
      agents: [],
      benchmarks: [],
      mode: getSimulationMode(),
      chat: this.createChatState(),
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

    const getMarketOpenDate = (source: Date): string => {
      const marketOpen = new Date(source);
      marketOpen.setHours(9, 30, 0, 0);
      return marketOpen.toISOString();
    };

    if (mode === 'historical') {
      // Use historical period start date
      const { getHistoricalSimulationStartDate } = await import('../services/marketDataService');
      const histStart = getHistoricalSimulationStartDate();
      startDate = histStart.toISOString();
      currentDate = startDate;
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
      // Simulated: begin at the market open of the current day
      startDate = getMarketOpenDate(now);
      currentDate = startDate;
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
      chat: this.createChatState(),
      lastUpdated: new Date().toISOString(),
    };
  }

  getSnapshot(): SimulationSnapshot {
    return {
      ...this.snapshot,
      chat: {
        config: { ...this.snapshot.chat.config },
        messages: cloneChatMessages(this.snapshot.chat.messages),
      },
    };
  }

  updateSnapshot(updates: Partial<SimulationSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...updates,
      chat: updates.chat
        ? {
            config: { ...updates.chat.config },
            messages: cloneChatMessages(updates.chat.messages),
          }
        : this.snapshot.chat,
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

  getChat(): ChatState {
    return {
      config: { ...this.snapshot.chat.config },
      messages: cloneChatMessages(this.snapshot.chat.messages),
    };
  }

  setChat(chat: ChatState): void {
    this.snapshot.chat = {
      config: { ...chat.config },
      messages: cloneChatMessages(chat.messages),
    };
    this.snapshot.lastUpdated = new Date().toISOString();
  }

  loadFromSnapshot(snapshot: SimulationSnapshot): void {
    const restoredChat = snapshot.chat ? this.createChatState(snapshot.chat.messages) : this.createChatState();
    this.snapshot = {
      ...snapshot,
      chat: restoredChat,
    };
  }
}

export const simulationState = new SimulationState();

