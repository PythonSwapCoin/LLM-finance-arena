import type { SimulationSnapshot, Agent, Benchmark, MarketData, ChatState } from '../types.js';
import { SIMULATION_TYPES, SimulationType, createAgentsFromConfigs, getAllSimulationTypes } from '../simulationTypes.js';
import { INITIAL_CASH, S_P500_BENCHMARK_ID, AI_MANAGERS_INDEX_ID, BENCHMARK_COLORS } from '../constants.js';
import { calculateAllMetrics } from '../utils/portfolioCalculations.js';
import { getSimulationMode } from '../services/marketDataService.js';
import { cloneChatMessages } from '../utils/chatUtils.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import type { ChatConfig, ChatMessage } from '../types.js';
import { loadSnapshot, saveSnapshot } from '../store/persistence.js';

/**
 * SimulationInstance - manages state for a single simulation
 */
class SimulationInstance {
  private snapshot: SimulationSnapshot;
  private simulationType: SimulationType;

  constructor(simulationType: SimulationType) {
    this.simulationType = simulationType;
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

  private buildChatConfig(): ChatConfig {
    const parseIntWithDefault = (value: string | undefined, fallback: number): number => {
      if (value === undefined) {
        return fallback;
      }
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : fallback;
    };

    // Chat is only enabled for the main multi-model simulation
    const enabled = this.simulationType.chatEnabled && (process.env.CHAT_ENABLED ?? 'true') !== 'false';

    return {
      enabled,
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

  loadFromSnapshot(snapshot: SimulationSnapshot): void {
    // Restore chat state
    const restoredChat = snapshot.chat ? this.createChatState(snapshot.chat.messages) : this.createChatState();
    
    this.snapshot = {
      ...snapshot,
      chat: restoredChat,
    };

    logger.logSimulationEvent('Simulation instance loaded from snapshot', {
      simulationType: this.simulationType.id,
      day: snapshot.day,
      intradayHour: snapshot.intradayHour,
      agentCount: snapshot.agents.length,
    });
  }

  async initialize(marketData: MarketData, snapshot?: SimulationSnapshot | null): Promise<void> {
    // If snapshot provided, load from it instead of creating fresh
    if (snapshot) {
      this.loadFromSnapshot(snapshot);
      return;
    }

    const mode = getSimulationMode();

    // Check if we should preload historical data in realtime mode
    const shouldPreloadHistorical = mode === 'realtime' &&
      process.env.REALTIME_PRELOAD_HISTORICAL === 'true';

    let initialAgentStates: Agent[];
    let benchmarks: Benchmark[];

    if (shouldPreloadHistorical) {
      // Load historical preload snapshot
      const { prepareAgentsForRealtimePreload, prepareBenchmarksForRealtimePreload, getHistoricalPreloadSnapshotId } = await import('../utils/historicalPreload.js');

      const typedPreloadSnapshotId = getHistoricalPreloadSnapshotId(this.simulationType.id);
      const fallbackPreloadSnapshotId = getHistoricalPreloadSnapshotId();

      try {
        logger.logSimulationEvent('Loading historical preload snapshot for realtime mode', {
          snapshotId: typedPreloadSnapshotId,
          simulationType: this.simulationType.id
        });

        let historicalSnapshot = await loadSnapshot(typedPreloadSnapshotId);

        if (!historicalSnapshot && fallbackPreloadSnapshotId !== typedPreloadSnapshotId) {
          logger.log(LogLevel.INFO, LogCategory.SYSTEM,
            'Typed preload snapshot not found, falling back to default preload ID', {
              typedPreloadSnapshotId,
              fallbackPreloadSnapshotId,
              simulationType: this.simulationType.id
            });
          historicalSnapshot = await loadSnapshot(fallbackPreloadSnapshotId);
        }

        if (historicalSnapshot && historicalSnapshot.historicalPreloadMetadata) {
          const metadata = historicalSnapshot.historicalPreloadMetadata;
          const realtimeStartDate = new Date().toISOString();

          logger.logSimulationEvent('Historical preload snapshot found, interpolating data', {
            historicalStart: metadata.startDate,
            historicalEnd: metadata.endDate,
            realtimeStart: realtimeStartDate,
            historicalPoints: historicalSnapshot.agents[0]?.performanceHistory?.length || 0,
            historicalMarketMinutesPerTick: metadata.marketMinutesPerTick,
            realtimeIntervalMs: metadata.realtimeTickIntervalMs,
            simulationType: this.simulationType.id
          });

          // Prepare agents and benchmarks with interpolated data
          initialAgentStates = prepareAgentsForRealtimePreload(
            historicalSnapshot.agents,
            metadata,
            realtimeStartDate
          );

          benchmarks = prepareBenchmarksForRealtimePreload(
            historicalSnapshot.benchmarks,
            metadata,
            realtimeStartDate
          );

          logger.logSimulationEvent('Historical data preloaded successfully', {
            agents: initialAgentStates.length,
            interpolatedPoints: initialAgentStates[0]?.performanceHistory?.length || 0,
            simulationType: this.simulationType.id
          });
        } else {
          logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
            'Historical preload snapshot not found or missing metadata, starting fresh', {
              snapshotId: typedPreloadSnapshotId,
              simulationType: this.simulationType.id
            });

          // Fall back to normal initialization
          const agents = createAgentsFromConfigs(this.simulationType.traderConfigs);
          initialAgentStates = agents.map(agent => {
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
          benchmarks = [
            {
              id: S_P500_BENCHMARK_ID,
              name: 'S&P 500',
              color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID],
              performanceHistory: [initialBenchmarkMetrics],
              metadata: {
                lastGspcPrice: marketData['^GSPC']?.price
              }
            }
          ];

          if (this.simulationType.id === 'multi-model') {
            benchmarks.push({
              id: AI_MANAGERS_INDEX_ID,
              name: 'AI Managers Index',
              color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID],
              performanceHistory: [initialBenchmarkMetrics]
            });
          }
        }
      } catch (error) {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
          'Failed to load historical preload snapshot, starting fresh', {
            error: error instanceof Error ? error.message : String(error),
            simulationType: this.simulationType.id
          });

        // Fall back to normal initialization
        const agents = createAgentsFromConfigs(this.simulationType.traderConfigs);
        initialAgentStates = agents.map(agent => {
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
        benchmarks = [
          {
            id: S_P500_BENCHMARK_ID,
            name: 'S&P 500',
            color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID],
            performanceHistory: [initialBenchmarkMetrics],
            metadata: {
              lastGspcPrice: marketData['^GSPC']?.price
            }
          }
        ];

        if (this.simulationType.id === 'multi-model') {
          benchmarks.push({
            id: AI_MANAGERS_INDEX_ID,
            name: 'AI Managers Index',
            color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID],
            performanceHistory: [initialBenchmarkMetrics]
          });
        }
      }
    } else {
      // Normal initialization without preload
      const agents = createAgentsFromConfigs(this.simulationType.traderConfigs);
      initialAgentStates = agents.map(agent => {
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
      benchmarks = [
        {
          id: S_P500_BENCHMARK_ID,
          name: 'S&P 500',
          color: BENCHMARK_COLORS[S_P500_BENCHMARK_ID],
          performanceHistory: [initialBenchmarkMetrics],
          metadata: {
            lastGspcPrice: marketData['^GSPC']?.price
          }
        }
      ];

      if (this.simulationType.id === 'multi-model') {
        benchmarks.push({
          id: AI_MANAGERS_INDEX_ID,
          name: 'AI Managers Index',
          color: BENCHMARK_COLORS[AI_MANAGERS_INDEX_ID],
          performanceHistory: [initialBenchmarkMetrics]
        });
      }
    }
    const now = new Date();
    let startDate: string;
    let currentDate: string;

    const getMarketOpenDate = async (source: Date): Promise<string> => {
      const { setDateToMarketOpenET, getNextMarketOpen, isMarketOpen } = await import('./marketHours.js');
      // If the source date is a weekend or market is closed, get the next market open
      if (!isMarketOpen(source)) {
        const nextOpen = getNextMarketOpen(source);
        return nextOpen.toISOString();
      }
      const marketOpen = setDateToMarketOpenET(source);
      return marketOpen.toISOString();
    };

    if (mode === 'realtime') {
      startDate = now.toISOString();

      const USE_DELAYED_DATA = process.env.USE_DELAYED_DATA === 'true';
      const DATA_DELAY_MINUTES = parseInt(process.env.DATA_DELAY_MINUTES || '30', 10);

      if (USE_DELAYED_DATA) {
        const delayedTime = new Date(now.getTime() - (DATA_DELAY_MINUTES * 60 * 1000));
        currentDate = delayedTime.toISOString();
      } else {
        currentDate = now.toISOString();
      }
    } else {
      // For all non-realtime modes (historical, simulated, hybrid): begin at market open
      if (mode === 'historical') {
        const { getHistoricalSimulationStartDate } = await import('../services/marketDataService.js');
        const histStart = getHistoricalSimulationStartDate();
        startDate = histStart.toISOString();
        currentDate = startDate;
      } else {
        // Simulated or hybrid mode: use HISTORICAL_SIMULATION_START_DATE if set, otherwise use current date
        const SIMULATED_START_DATE = process.env.HISTORICAL_SIMULATION_START_DATE || process.env.SIMULATED_START_DATE;
        if (SIMULATED_START_DATE && mode === 'hybrid') {
          // For hybrid mode, use getHistoricalSimulationStartDate to ensure correct Monday adjustment
          const { getHistoricalSimulationStartDate } = await import('../services/marketDataService.js');
          const histStart = getHistoricalSimulationStartDate();
          startDate = histStart.toISOString();
          currentDate = startDate;
        } else if (SIMULATED_START_DATE) {
          const date = new Date(SIMULATED_START_DATE);
          if (!isNaN(date.getTime())) {
            startDate = await getMarketOpenDate(date);
            currentDate = startDate;
          } else {
            startDate = await getMarketOpenDate(now);
            currentDate = startDate;
          }
        } else {
          startDate = await getMarketOpenDate(now);
          currentDate = startDate;
        }
      }
    }

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

    logger.logSimulationEvent('Simulation instance initialized', {
      simulationType: this.simulationType.id,
      agentCount: initialAgentStates.length,
      chatEnabled: this.simulationType.chatEnabled,
    });
  }

  getSnapshot(): SimulationSnapshot {
    return {
      ...this.snapshot,
      chat: {
        config: this.snapshot.chat.config,
        messages: cloneChatMessages(this.snapshot.chat.messages),
      },
    };
  }

  updateSnapshot(updates: Partial<SimulationSnapshot>): void {
    this.snapshot = {
      ...this.snapshot,
      ...updates,
      lastUpdated: new Date().toISOString(),
    };
  }

  getSimulationType(): SimulationType {
    return this.simulationType;
  }

  reset(): void {
    this.snapshot = {
      day: 0,
      intradayHour: 0,
      marketData: this.snapshot.marketData,
      agents: [],
      benchmarks: [],
      mode: getSimulationMode(),
      chat: this.createChatState(),
      lastUpdated: new Date().toISOString(),
    };
  }
}

/**
 * SimulationManager - manages all simulation instances
 */
class SimulationManager {
  private simulations: Map<string, SimulationInstance>;
  private sharedMarketData: MarketData | null;

  constructor() {
    this.simulations = new Map();
    this.sharedMarketData = null;
  }

  /**
   * Initialize all simulation types with the same market data
   * Loads snapshots from persistence if RESET_SIMULATION is false
   */
  async initializeAll(initialMarketData: MarketData): Promise<void> {
    this.sharedMarketData = initialMarketData;

    const enabledTypes = SIMULATION_TYPES;
    const allTypes = getAllSimulationTypes();
    
    // Check if we should reset (start fresh)
    const shouldReset = process.env.RESET_SIMULATION === 'true';
    
    // Log which simulations are enabled/disabled
    logger.logSimulationEvent('Simulation types status', {
      enabled: enabledTypes.map(t => t.id),
      disabled: allTypes.filter(t => !t.enabled).map(t => t.id),
      totalAvailable: allTypes.length,
      resetSimulation: shouldReset,
    });

    // Only initialize enabled simulations
    for (const simType of enabledTypes) {
      const instance = new SimulationInstance(simType);
      
      if (shouldReset) {
        // Start fresh
        logger.logSimulationEvent('Starting fresh simulation (RESET_SIMULATION=true)', {
          simulationType: simType.id,
        });
        await instance.initialize(initialMarketData);
      } else {
        // Try to load from persistence
        try {
          const snapshot = await loadSnapshot(simType.id);
          if (snapshot) {
            logger.logSimulationEvent('Loaded snapshot from persistence', {
              simulationType: simType.id,
              day: snapshot.day,
              intradayHour: snapshot.intradayHour,
            });
            // Use the market data from snapshot if available, otherwise use initial
            const snapshotMarketData = snapshot.marketData && Object.keys(snapshot.marketData).length > 0
              ? snapshot.marketData
              : initialMarketData;
            await instance.initialize(snapshotMarketData, snapshot);
          } else {
            logger.logSimulationEvent('No snapshot found, starting fresh', {
              simulationType: simType.id,
            });
            await instance.initialize(initialMarketData);
          }
        } catch (error) {
          logger.log(LogLevel.ERROR, LogCategory.SYSTEM,
            `Failed to load snapshot for ${simType.id}, starting fresh`, {
              error: error instanceof Error ? error.message : String(error)
            });
          await instance.initialize(initialMarketData);
        }
      }
      
      this.simulations.set(simType.id, instance);
      
      // Save initial snapshot if starting fresh (always save after initialization)
      try {
        const snapshot = instance.getSnapshot();
        await saveSnapshot(snapshot, simType.id);
      } catch (error) {
        logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
          `Failed to save initial snapshot for ${simType.id}`, {
            error: error instanceof Error ? error.message : String(error)
          });
      }
    }

    logger.logSimulationEvent('Simulation instances initialized', {
      initializedCount: this.simulations.size,
      initializedTypes: enabledTypes.map(t => t.id),
      enabledCount: enabledTypes.length,
      totalAvailable: allTypes.length,
      resetSimulation: shouldReset,
    });
  }

  /**
   * Get a specific simulation instance
   */
  getSimulation(typeId: string): SimulationInstance | undefined {
    return this.simulations.get(typeId);
  }

  /**
   * Get all simulation instances
   */
  getAllSimulations(): Map<string, SimulationInstance> {
    return this.simulations;
  }

  /**
   * Update shared market data for all simulations
   */
  updateSharedMarketData(marketData: MarketData): void {
    this.sharedMarketData = marketData;
    // Update market data for all simulations
    for (const [_, instance] of this.simulations) {
      const snapshot = instance.getSnapshot();
      instance.updateSnapshot({ marketData });
    }
  }

  /**
   * Get the shared market data
   */
  getSharedMarketData(): MarketData | null {
    return this.sharedMarketData;
  }

  /**
   * Reset a specific simulation
   */
  async resetSimulation(typeId: string): Promise<void> {
    const instance = this.simulations.get(typeId);
    if (!instance) {
      throw new Error(`Simulation type ${typeId} not found`);
    }

    instance.reset();
    if (this.sharedMarketData) {
      await instance.initialize(this.sharedMarketData);
    }
  }

  /**
   * Reset all simulations
   */
  async resetAll(): Promise<void> {
    if (!this.sharedMarketData) {
      throw new Error('No market data available for reset');
    }

    for (const [typeId, _] of this.simulations) {
      await this.resetSimulation(typeId);
    }
  }

  /**
   * Get list of all simulation types (only enabled ones)
   */
  getSimulationTypes(): SimulationType[] {
    return SIMULATION_TYPES;
  }

  /**
   * Get all simulation types including disabled ones with enabled status
   */
  getAllSimulationTypesWithStatus(): Array<SimulationType & { enabled: boolean }> {
    return getAllSimulationTypes();
  }
}

// Export singleton instance
export const simulationManager = new SimulationManager();
