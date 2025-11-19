import type { FastifyInstance } from 'fastify';
import { simulationState } from '../simulation/state.js';
import { startScheduler, stopScheduler, isSchedulerRunning, getSimInterval, getTradeInterval } from '../simulation/scheduler.js';
import { logger, LogLevel, LogCategory } from '../services/logger.js';
import {
  getSimulationMode,
  createInitialMarketData,
  isHistoricalSimulationComplete,
  getMarketDataTelemetry,
  hasHybridModeTransitioned,
} from '../services/marketDataService.js';
import { exportSimulationData } from '../services/exportService.js';
import { exportLogs } from '../services/logExportService.js';
import { priceLogService } from '../services/priceLogService.js';
import { S_P500_TICKERS } from '../constants.js';
import {
  getPersistenceDriver,
  getPersistenceTargetDescription,
  clearSnapshot,
  saveSnapshot,
  cleanupHistorySnapshots,
} from '../store/persistence.js';
import type {
  SimulationStateResponse,
  AgentsResponse,
  MarketDataResponse,
  BenchmarksResponse,
  HistoryResponse,
  StartStopResponse,
  LogsResponse,
  ChatMessageResponse,
} from './dto.js';
import { addUserMessageToChat } from '../services/chatService.js';
import { isMarketOpen } from '../simulation/marketHours.js';

export const registerRoutes = async (fastify: FastifyInstance): Promise<void> => {
  // Health check
  fastify.get('/healthz', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Connection status endpoint - returns backend info for frontend verification
  fastify.get('/api/status', async () => {
    const telemetry = getMarketDataTelemetry();
    
    // Check if we're using multi-simulation mode
    const { simulationManager } = await import('../simulation/SimulationManager.js');
    const simulations = simulationManager.getAllSimulations();
    
    let mode: string = 'simulated';
    let day = 0;
    let intradayHour = 0;
    let agentsCount = 0;
    let tickersCount = 0;
    let lastUpdated: string | undefined;
    
    if (simulations.size > 0) {
      // Use first simulation's state for status (they all share the same mode/day)
      const firstSim = simulations.values().next().value;
      const snapshot = firstSim.getSnapshot();
      mode = snapshot.mode || 'simulated';
      day = snapshot.day;
      intradayHour = snapshot.intradayHour;
      agentsCount = snapshot.agents.length;
      tickersCount = Object.keys(snapshot.marketData).length;
      lastUpdated = snapshot.lastUpdated;
    } else {
      // Fallback to old single-simulation state if multi-sim not initialized
      const snapshot = simulationState.getSnapshot();
      mode = snapshot.mode || 'simulated';
      day = snapshot.day;
      intradayHour = snapshot.intradayHour;
      agentsCount = snapshot.agents.length;
      tickersCount = Object.keys(snapshot.marketData).length;
      lastUpdated = snapshot.lastUpdated;
    }

    // Determine market status display:
    // - Historical/simulated/hybrid (before transition): always show as "live" (return true)
    // - Realtime/hybrid (after transition): show actual market status (true/false)
    const hasTransitioned = hasHybridModeTransitioned();
    const isRealtimeMode = mode === 'realtime' || (mode === 'hybrid' && hasTransitioned);
    const isHistoricalOrSimulated = mode === 'historical' || mode === 'simulated';
    const isHybridBeforeTransition = mode === 'hybrid' && !hasTransitioned;
    
    let marketOpenStatus: boolean | null;
    if (isHistoricalOrSimulated || isHybridBeforeTransition) {
      // Show as "LIVE" for historical/simulated/hybrid (before transition)
      marketOpenStatus = true;
    } else if (isRealtimeMode) {
      // Show actual market status for realtime/hybrid (after transition)
      // This will return false if market is closed (e.g., Monday morning before 9:30 AM ET)
      const actualMarketStatus = isMarketOpen();
      marketOpenStatus = actualMarketStatus;
      
      // Log transition detection for debugging
      if (mode === 'hybrid' && hasTransitioned) {
        const { logger, LogLevel, LogCategory } = await import('../services/logger.js');
        logger.log(LogLevel.INFO, LogCategory.SYSTEM,
          'Status endpoint: Hybrid mode transitioned, market status check', {
            mode,
            hasTransitioned,
            isRealtimeMode,
            marketOpen: actualMarketStatus,
            currentTime: new Date().toISOString(),
          });
      }
    } else {
      // Fallback: shouldn't happen, but default to null
      marketOpenStatus = null;
    }

    return {
      status: 'connected',
      backend: 'online',
      timestamp: new Date().toISOString(),
      simulation: {
        mode,
        day,
        intradayHour,
        agentsCount,
        tickersCount,
        lastUpdated: lastUpdated || new Date().toISOString(),
        simIntervalMs: getSimInterval(),
        tradeIntervalMs: getTradeInterval(),
        isMarketOpen: marketOpenStatus, // null for non-realtime modes, boolean for realtime/hybrid
      },
      marketData: {
        tickersCount,
        sources: telemetry.sources,
        rateLimits: telemetry.rateLimits,
      },
    };
  });

  // Get simulation state
  fastify.get('/api/simulation/state', async (): Promise<SimulationStateResponse> => {
    const snapshot = simulationState.getSnapshot();
    return {
      snapshot,
      isLoading: false, // Backend doesn't track loading state the same way
      isHistoricalSimulationComplete: isHistoricalSimulationComplete(snapshot.day),
      marketTelemetry: getMarketDataTelemetry(),
    };
  });

  // Get agents
  fastify.get('/api/agents', async (): Promise<AgentsResponse> => {
    return {
      agents: simulationState.getAgents(),
    };
  });

  // Get market data
  fastify.get('/api/market-data', async (): Promise<MarketDataResponse> => {
    const snapshot = simulationState.getSnapshot();
    return {
      prices: snapshot.marketData,
      ts: snapshot.lastUpdated,
      source: getSimulationMode(),
    };
  });

  // Get benchmarks
  fastify.get('/api/benchmarks', async (): Promise<BenchmarksResponse> => {
    return {
      series: simulationState.getBenchmarks(),
    };
  });

  // Get simulation history
  fastify.get('/api/simulation/history', async (): Promise<HistoryResponse> => {
    const agents = simulationState.getAgents();
    const benchmarks = simulationState.getBenchmarks();
    
    return {
      timeseries: {
        agents: agents.map(agent => ({
          id: agent.id,
          name: agent.name,
          performanceHistory: agent.performanceHistory,
        })),
        benchmarks: benchmarks.map(b => ({
          id: b.id,
          name: b.name,
          performanceHistory: b.performanceHistory,
        })),
      },
    };
  });

  // Start simulation
  fastify.post('/api/simulation/start', async (request, reply): Promise<StartStopResponse> => {
    try {
      if (!isSchedulerRunning()) {
        await startScheduler();
      }
      return { ok: true };
    } catch (error) {
      reply.code(500);
      return { ok: false };
    }
  });

  // Stop simulation
  fastify.post('/api/simulation/stop', async (): Promise<StartStopResponse> => {
    stopScheduler();
    return { ok: true };
  });

  // Get logs
  fastify.get<{ Querystring: { level?: string; limit?: string } }>('/api/logs', async (request): Promise<LogsResponse> => {
    const level = request.query.level as LogLevel | undefined;
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : undefined;
    
    const logs = logger.getLogs(level, limit);
    
    return {
      lines: logs.map(log => ({
        timestamp: log.timestamp,
        level: log.level,
        category: log.category,
        message: log.message,
        details: log.details,
        error: log.error,
      })),
    };
  });

  // Export simulation data
  fastify.post('/api/simulation/export', async (request, reply) => {
    try {
      const snapshot = simulationState.getSnapshot();
      const filepath = await exportSimulationData(snapshot);
      return { 
        ok: true, 
        filepath,
        message: 'Simulation data exported successfully'
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  fastify.post('/api/database/cleanup-history', async (request, reply) => {
    try {
      if (getPersistenceDriver() !== 'postgres') {
        reply.code(400);
        return {
          ok: false,
          message: 'History cleanup is only available when using Postgres persistence',
        };
      }

      const persistenceTarget = getPersistenceTargetDescription();
      const result = await cleanupHistorySnapshots();

      return {
        ok: true,
        persistenceTarget,
        tableExisted: result.tableExisted,
        deletedRows: result.deletedRows,
        sizeBeforeBytes: result.sizeBeforeBytes,
        sizeAfterBytes: result.sizeAfterBytes,
        freedBytes: result.freedBytes,
        message: result.tableExisted
          ? 'simulation_snapshot_history cleared successfully'
          : 'History table not found; nothing to clean',
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  // Export logs
  fastify.post('/api/logs/export', async (request, reply) => {
    try {
      const filepath = await exportLogs();
      return { 
        ok: true, 
        filepath,
        message: 'Logs exported successfully'
      };
    } catch (error) {
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });

  // Export price logs (stock prices and portfolio values)
  fastify.post('/api/price-logs/export', {
    schema: {
      body: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }
  }, async (request, reply) => {
    try {
      const filepath = await priceLogService.exportLogs();
      return { 
        ok: true, 
        filepath,
        message: 'Price logs exported successfully'
      };
    } catch (error) {
      reply.code(500);
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });

  // Get price logs summary
  fastify.get<{ Querystring: { day?: string } }>('/api/price-logs/summary', async (request) => {
    try {
      const day = request.query.day ? parseInt(request.query.day, 10) : undefined;
      const summary = priceLogService.getPriceMovementSummary(day);
      const logCount = priceLogService.getLogs().length;
      return { 
        ok: true, 
        summary,
        day: day || 'all',
        totalLogEntries: logCount
      };
    } catch (error) {
      return { 
        ok: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });

  // Get price logs status (diagnostic endpoint)
  fastify.get('/api/price-logs/status', async () => {
    try {
      const logs = priceLogService.getLogs();
      const latestLog = logs.length > 0 ? logs[logs.length - 1] : null;
      return {
        ok: true,
        totalEntries: logs.length,
        latestLog: latestLog ? {
          day: latestLog.day,
          intradayHour: latestLog.intradayHour,
          timestamp: latestLog.timestamp,
          stockCount: latestLog.stockPrices.length,
          agentCount: latestLog.portfolioValues.length
        } : null,
        message: logs.length === 0 
          ? 'No logs captured yet. Make sure the simulation is running and price ticks are occurring.'
          : `Logging is working. ${logs.length} entries captured.`
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  });

  fastify.post<{ Body: { username: string; agentId: string; content: string } }>('/api/chat/messages', async (request, reply): Promise<ChatMessageResponse | { error: string }> => {
    try {
      const { username, agentId, content } = request.body;
      logger.log(LogLevel.INFO, LogCategory.SYSTEM,
        '[CHAT] Received message', { username, agentId, contentLength: content.length });
      const result = addUserMessageToChat({ username, agentId, content });
      logger.log(LogLevel.INFO, LogCategory.SYSTEM,
        '[CHAT] Message added', { messageId: result.message.id, roundId: result.message.roundId, totalMessages: result.chat.messages.length });
      return result;
    } catch (error) {
      reply.code(400);
      logger.log(LogLevel.WARNING, LogCategory.SYSTEM,
        '[CHAT] Message rejected', {
          username: request.body.username,
          agentId: request.body.agentId,
          error: error instanceof Error ? error.message : String(error)
        });
      return {
        error: error instanceof Error ? error.message : 'Failed to send chat message',
      };
    }
  });

  // Reset simulation (delete snapshot and restart from day 0)
  fastify.post('/api/simulation/reset', async (request, reply) => {
    try {
      stopScheduler();

      const persistenceDriver = getPersistenceDriver();
      const persistenceTarget = getPersistenceTargetDescription();

      await clearSnapshot();

      // Reinitialize simulation
      const initialMarketData = await createInitialMarketData(S_P500_TICKERS);
      await simulationState.initialize(initialMarketData);

      // Save initial state
      await saveSnapshot(simulationState.getSnapshot()).catch(err => {
        logger.log(LogLevel.ERROR, LogCategory.SYSTEM, 
          'Failed to save initial snapshot after reset', { error: err });
      });
      
      // Restart scheduler
      await startScheduler();

      logger.logSimulationEvent('Simulation reset successfully', {
        driver: persistenceDriver,
        target: persistenceTarget,
      });

      return {
        ok: true,
        message: `Simulation reset successfully - starting from day 0 (${persistenceDriver} persistence)`
      };
    } catch (error) {
      reply.code(500);
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  });
};

